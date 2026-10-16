"""Git-backed store: a save writes atomically and commits locally; a timer-run CLI (`app.gitsync`) pushes."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, NamedTuple

from .jsonio import write_json_atomic

log = logging.getLogger("audioplayer.git")
pass_log = logging.getLogger("audioplayer.gitsync")

FAILS_BEFORE_ERROR = 5
STATE_NAME = "gitsync-state.json"
ADD_SPEC = ("--", "audioplayer", ":(exclude)*.tmp")
REPO_NAMES = ("data", "covers")


class GitError(RuntimeError):
    pass


class StateError(RuntimeError):
    pass


class PushResult(NamedTuple):
    status: str
    error: str = ""


class Probe(NamedTuple):
    count: int | None
    oldest: int | None
    synced: bool


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(text: Any) -> float | None:
    if not isinstance(text, str):
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def load_state(path: Path, strict: bool = False) -> dict[str, Any]:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("not an object")
        return raw
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        if strict:
            raise StateError(f"state file unreadable: {exc}") from exc
        return {}


def save_state(path: Path, state: dict[str, Any]) -> None:
    write_json_atomic(Path(path), state)


class GitSync:
    def __init__(
        self,
        data_repo: Path,
        covers_repo: Path | None = None,
        ssh_key: str | None = None,
        backoff: tuple[float, float] = (2.0, 300.0),
        mode: str = "timer",
        interval_s: int = 60,
        grace_s: int = 30,
        state_file: Path | str | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.data_repo = Path(data_repo)
        self.covers_repo = Path(covers_repo) if covers_repo else None
        self._ssh_key = ssh_key
        self._backoff = backoff
        self.mode = mode if mode in ("timer", "request") else "timer"
        self.interval_s = interval_s
        self.grace_s = grace_s
        self.state_file = Path(state_file) if state_file else self.data_repo.parent / STATE_NAME
        self.clock = clock
        self.cache_ttl_s = 5.0
        self.lock = threading.RLock()
        self._state = threading.Lock()
        self._dirty: set[Path] = set()
        self._fails = 0
        self._rejected: set[Path] = set()
        self._last_error: str | None = None
        self._retry: threading.Thread | None = None
        self._stop = threading.Event()
        self._probes: dict[Path, tuple[float, Probe]] = {}
        self._logged_state = "ok"

    @property
    def stale_after_s(self) -> int:
        return self.interval_s + self.grace_s

    @property
    def data_root(self) -> Path:
        """`audioplayer/` in the data repo: `users/<uid>/{profile,library}.json` live below it."""
        return self.data_repo / "audioplayer"

    @property
    def covers_root(self) -> Path | None:
        """`audioplayer/` in the covers repo: `users/<uid>/covers/<id>.jpg` live below it."""
        return self.covers_repo / "audioplayer" if self.covers_repo else None

    def _repos(self) -> list[Path]:
        return [self.data_repo] + ([self.covers_repo] if self.covers_repo else [])

    def repo_name(self, repo: Path) -> str:
        return "data" if repo == self.data_repo else "covers"

    def _env(self) -> dict[str, str]:
        env = dict(os.environ)
        env["GIT_TERMINAL_PROMPT"] = "0"
        env.setdefault("GIT_AUTHOR_NAME", "audioplayer-server")
        env.setdefault("GIT_AUTHOR_EMAIL", "audioplayer@localhost")
        env.setdefault("GIT_COMMITTER_NAME", env["GIT_AUTHOR_NAME"])
        env.setdefault("GIT_COMMITTER_EMAIL", env["GIT_AUTHOR_EMAIL"])
        if self._ssh_key:
            env["GIT_SSH_COMMAND"] = (
                f'ssh -i "{self._ssh_key}" -o IdentitiesOnly=yes -o BatchMode=yes '
                "-o StrictHostKeyChecking=accept-new"
            )
        return env

    def _clean(self, text: str) -> str:
        return text.replace(self._ssh_key, "<key>") if self._ssh_key else text

    def _git(self, repo: Path, *args: str, check: bool = True, timeout: int = 120) -> subprocess.CompletedProcess:
        try:
            p = subprocess.run(
                ["git", *args], cwd=repo, env=self._env(), capture_output=True, text=True, timeout=timeout
            )
        except subprocess.TimeoutExpired:
            if check:
                raise GitError(f"git {args[0]} failed: timed out after {timeout}s") from None
            return subprocess.CompletedProcess(list(args), 124, "", f"timed out after {timeout}s")
        if check and p.returncode != 0:
            raise GitError(f"git {args[0]} failed: {self._clean((p.stderr or p.stdout).strip())[:300]}")
        return p

    def _call(self, repo: Path, *args: str, timeout: int = 120) -> subprocess.CompletedProcess:
        if timeout == 120:
            return self._git(repo, *args, check=False)
        return self._git(repo, *args, check=False, timeout=timeout)

    def status(self) -> str:
        """request mode: ok: nothing unpushed; pending: unpushed, retrying; error: retries keep failing."""
        with self._state:
            if not self._dirty:
                return "ok"
            return "error" if self._fails >= FAILS_BEFORE_ERROR else "pending"

    def pull(self) -> None:
        """Best effort: being offline must not block a write."""
        for repo in self._repos():
            try:
                self._git(repo, "pull", "--rebase")
            except GitError as exc:
                log.warning("pull failed in %s: %s", repo.name, exc)
                self._git(repo, "rebase", "--abort", check=False)

    def _untracked(self, repo: Path) -> set[str]:
        out = self._git(repo, "ls-files", "--others", "--exclude-standard", "-z", "--", "audioplayer", check=False).stdout
        return {n for n in out.split("\0") if n}

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Hold the git lock; discard uncommitted changes and the files the body created if it raises."""
        with self.lock:
            if self.mode == "request":
                self.pull()
            before = {repo: self._untracked(repo) for repo in self._repos()}
            try:
                yield
            except BaseException:
                for repo in self._repos():
                    self._git(repo, "reset", "-q", check=False)
                    self._git(repo, "checkout", "--", ".", check=False)
                    for name in sorted(self._untracked(repo) - before[repo]):
                        (repo / name).unlink(missing_ok=True)
                raise

    def _commit_repo(self, repo: Path, message: str) -> bool:
        added = self._git(repo, "add", "-A", *ADD_SPEC, check=False)
        if added.returncode != 0 and "did not match any files" not in added.stderr:
            raise GitError(f"git add failed: {added.stderr.strip()[:300]}")
        if self._git(repo, "diff", "--cached", "--quiet", check=False).returncode != 0:
            self._git(repo, "commit", "-m", message)
            self._probes.pop(repo, None)
            return True
        return False

    def commit(self, message: str) -> None:
        """Commit changes under audioplayer/ in every repo; request mode also pushes."""
        with self.lock:
            for repo in self._repos():
                if self._commit_repo(repo, message) and self.mode == "request":
                    with self._state:
                        self._dirty.add(repo)
            if self.mode == "request":
                self._push_all()

    # --- push ---------------------------------------------------------------------------------

    def probe(self, repo: Path, fresh: bool = False) -> Probe:
        now = time.monotonic()
        hit = self._probes.get(repo)
        if hit and not fresh and now - hit[0] < self.cache_ttl_s:
            return hit[1]
        value = self._probe(repo)
        self._probes[repo] = (now, value)
        return value

    def _probe(self, repo: Path) -> Probe:
        counted = self._git(repo, "rev-list", "--count", "@{u}..HEAD", check=False)
        if counted.returncode != 0:
            return Probe(None, None, False)
        count = int(counted.stdout.strip() or 0)
        if count:
            stamps = self._git(repo, "log", "@{u}..HEAD", "--format=%ct", check=False).stdout.split()
            return Probe(count, min(int(s) for s in stamps) if stamps else None, False)
        contains = self._git(repo, "merge-base", "--is-ancestor", "@{u}", "HEAD", check=False)
        return Probe(0, None, contains.returncode == 0)

    def unpushed(self, repo: Path) -> tuple[int | None, int | None]:
        """(commits in @{u}..HEAD, committer time of the oldest); (None, None) without an upstream."""
        p = self.probe(repo, fresh=True)
        return p.count, p.oldest

    def push_repo(self, repo: Path, timeout: int = 120) -> PushResult:
        pushed = self._call(repo, "push", timeout=timeout)
        if pushed.returncode != 0 and _is_rejection(pushed.stderr):
            self._call(repo, "fetch", timeout=timeout)
            ancestor = self._git(repo, "merge-base", "--is-ancestor", "@{u}", "HEAD", check=False)
            if ancestor.returncode != 0:
                self._probes.pop(repo, None)
                return PushResult("rejected", self._short_error(pushed.stderr))
            pushed = self._call(repo, "push", timeout=timeout)
        self._probes.pop(repo, None)
        if pushed.returncode == 0:
            return PushResult("ok")
        return PushResult("failed", self._short_error(pushed.stderr or pushed.stdout))

    def _short_error(self, text: str) -> str:
        lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
        pick = next((ln for ln in reversed(lines) if ln.startswith(("fatal:", "error:", "!"))), lines[-1] if lines else "push failed")
        return self._clean(pick)[:200]

    def _push_all(self) -> bool:
        with self.lock:
            for repo in self._dirty.copy():
                if repo in self._rejected:
                    continue
                result = self.push_repo(repo)
                if result.status == "rejected":
                    log.error("push rejected in %s: remote has commits this server does not", repo.name)
                    with self._state:
                        self._rejected.add(repo)
                        self._last_error = "push rejected"
                    continue
                if result.status != "ok":
                    log.warning("push failed in %s: %s", repo.name, result.error)
                    with self._state:
                        self._fails += 1
                        self._last_error = result.error
                    self._ensure_retry()
                    return False
                with self._state:
                    self._dirty.discard(repo)
                self._note_push()
            with self._state:
                self._fails = 0
            return True

    def _note_push(self) -> None:
        try:
            state = load_state(self.state_file)
            state["last_push_at"] = _iso(self.clock())
            save_state(self.state_file, state)
        except OSError as exc:
            log.warning("cannot record push time: %s", exc)

    def _ensure_retry(self) -> None:
        if self._retry and self._retry.is_alive():
            return
        self._retry = threading.Thread(target=self._retry_loop, daemon=True)
        self._retry.start()

    def _retry_loop(self) -> None:
        delay = self._backoff[0]
        while not self._stop.wait(delay):
            with self.lock:
                self.pull()
                if self._push_all():
                    return
            delay = min(delay * 2, self._backoff[1])

    # --- the pass shared by the CLI, startup and shutdown ----------------------------------------

    @contextmanager
    def pusher_lock(self) -> Iterator[bool]:
        """The flock that serialises pushers; False when another pusher holds it."""
        import fcntl

        path = Path(str(self.state_file) + ".lock")
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as fh:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                yield False
                return
            try:
                yield True
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)

    def push_pass(self, push_timeout: int = 120, strict: bool = False) -> int | None:
        """Push every repo with unpushed commits. 0 ok, 1 push failed, 2 rejected; None when another pusher runs."""
        with self.pusher_lock() as got:
            if not got:
                return None
            state = load_state(self.state_file, strict=strict)
            repos = state.setdefault("repos", {})
            code = 0
            for repo in self._repos():
                name = self.repo_name(repo)
                rs = repos.setdefault(name, {"failures": 0, "rejected": False, "last_ok_at": None})
                probe = self.probe(repo, fresh=True)
                if probe.count is None:
                    state["last_error"] = f"{name}: no upstream"
                    pass_log.error("%s has no upstream", name)
                    code = code or 1
                    continue
                if rs.get("rejected"):
                    if probe.synced:
                        rs.update(rejected=False, failures=0)
                        pass_log.warning("%s rejection cleared: local matches the remote", name)
                    else:
                        pass_log.error("%s is rejected: the remote moved, not pushing (fix by hand, see deploy.md)", name)
                        code = 2
                        continue
                if probe.count == 0:
                    rs.update(failures=0, last_ok_at=_iso(self.clock()))
                    continue
                result = self.push_repo(repo, timeout=push_timeout)
                now_iso = _iso(self.clock())
                if result.status == "ok":
                    rs.update(failures=0, last_ok_at=now_iso)
                    state["last_push_at"] = now_iso
                elif result.status == "rejected":
                    rs["rejected"] = True
                    state["last_error"] = f"{name}: push rejected"
                    pass_log.error("%s push rejected: single-writer rule broken, stopped pushing it", name)
                    code = 2
                else:
                    rs["failures"] = int(rs.get("failures", 0)) + 1
                    state["last_error"] = f"{name}: {result.error}"
                    level = logging.ERROR if rs["failures"] >= FAILS_BEFORE_ERROR else logging.WARNING
                    pass_log.log(level, "%s push failed (%d in a row): %s", name, rs["failures"], result.error)
                    if code != 2:
                        code = 1
            if code == 0:
                state["last_error"] = None
            state["last_run_at"] = _iso(self.clock())
            save_state(self.state_file, state)
            self._probes.clear()
            return code

    def set_repo_state(self, name: str, **fields: Any) -> None:
        state = load_state(self.state_file)
        rs = state.setdefault("repos", {}).setdefault(name, {"failures": 0, "rejected": False, "last_ok_at": None})
        rs.update(fields)
        save_state(self.state_file, state)

    # --- startup, shutdown -----------------------------------------------------------------------

    def recover_on_startup(self) -> None:
        """timer mode: sweep temp files, commit a dirty tree, fast-forward, push once. request mode: resync()."""
        if self.mode == "request":
            self.resync()
            return
        with self.lock:
            for repo in self._repos():
                try:
                    self._recover_repo(repo)
                except (GitError, OSError) as exc:
                    log.error("startup recovery failed in %s: %s", repo.name, exc)
        try:
            self.push_pass(push_timeout=30)
        except (OSError, StateError) as exc:
            log.warning("startup push skipped: %s", exc)

    def _recover_repo(self, repo: Path) -> None:
        tree = repo / "audioplayer"
        for tmp in tree.rglob(".json-*.tmp") if tree.is_dir() else ():
            tmp.unlink(missing_ok=True)
        if self._git(repo, "status", "--porcelain", "--", "audioplayer", check=False).stdout.strip():
            self._commit_repo(repo, "audioplayer: recover uncommitted changes")
        self._git(repo, "fetch", check=False, timeout=30)
        behind = self._git(repo, "rev-list", "--count", "HEAD..@{u}", check=False)
        if behind.returncode != 0 or behind.stdout.strip() in ("", "0"):
            return
        self._probes.pop(repo, None)
        if self.probe(repo, fresh=True).count == 0:
            self._git(repo, "merge", "--ff-only", "@{u}")
            self._probes.pop(repo, None)
            return
        log.error("%s diverged from the remote at startup: not merging, pushing stopped", self.repo_name(repo))
        with self._state:
            self._rejected.add(repo)
        self.set_repo_state(self.repo_name(repo), rejected=True)

    def flush(self, timeout: int = 20) -> None:
        """Shutdown: one last push so a clean restart loses nothing."""
        try:
            if self.mode == "request":
                self._push_all()
            else:
                self.push_pass(push_timeout=timeout)
        except Exception as exc:
            log.warning("flush failed: %s", exc)

    def resync(self) -> None:
        """request mode startup: push local commits left over from a previous run."""
        with self.lock:
            for repo in self._repos():
                ahead = self._git(repo, "rev-list", "--count", "@{u}..HEAD", check=False)
                if ahead.returncode == 0 and ahead.stdout.strip() not in ("", "0"):
                    with self._state:
                        self._dirty.add(repo)
            if self._dirty:
                self._ensure_retry()

    def stop(self) -> None:
        self._stop.set()
        if self._retry:
            self._retry.join(timeout=5)

    # --- status ---------------------------------------------------------------------------------

    def sync_status(self, owner: bool) -> dict[str, Any]:
        now = self.clock()
        state = load_state(self.state_file)
        request_mode = self.mode == "request"
        views = [self._repo_view(repo, state, now, request_mode) for repo in self._repos()]
        order = ("ok", "pending", "stale", "error")
        worst = max((v["state"] for v in views), key=order.index)
        self._log_transition(worst, views)
        if not owner:
            return {"state": "degraded" if worst in ("stale", "error") else "ok"}
        ages = [v["oldest_unpushed_age_s"] for v in views if v["oldest_unpushed_age_s"] is not None]
        last_run = state.get("last_run_at")
        seen = _parse_iso(last_run)
        errors = [v["error"] for v in views if v.get("error")]
        last_error = errors[0] if errors else (self._last_error if request_mode else state.get("last_error"))
        return {
            "state": worst,
            "unpushed": sum(v["unpushed"] for v in views),
            "oldest_unpushed_age_s": max(ages) if ages else None,
            "last_push_at": state.get("last_push_at"),
            "stale_after_s": self.stale_after_s,
            "mode": self.mode,
            "timer_seen": request_mode or (seen is not None and now - seen <= 3 * self.interval_s),
            "last_run_at": last_run,
            "last_error": self._clean(last_error)[:200] if last_error else None,
            "repos": [{k: v[k] for k in ("name", "state", "unpushed", "oldest_unpushed_age_s", "rejected", "failures")} for v in views],
        }

    def _repo_view(self, repo: Path, state: dict[str, Any], now: float, request_mode: bool) -> dict[str, Any]:
        name = self.repo_name(repo)
        rs = (state.get("repos") or {}).get(name) or {}
        probe = self.probe(repo)
        rejected = bool(rs.get("rejected")) or repo in self._rejected
        if rejected and probe.synced:
            rejected = False
        if request_mode:
            failures = self._fails if repo in self._dirty else 0
        else:
            failures = int(rs.get("failures") or 0)
        count = probe.count or 0
        age = None if probe.oldest is None else max(0, int(now - probe.oldest))
        error = None
        if probe.count is None:
            level, error = "error", f"{name}: no upstream"
        elif rejected:
            level, error = "error", f"{name}: push rejected"
        elif failures >= FAILS_BEFORE_ERROR:
            level, error = "error", f"{name}: not reaching git"
        elif count == 0:
            level = "ok"
        elif age is not None and age > self.stale_after_s:
            level = "stale"
        else:
            level = "pending"
        return {"name": name, "state": level, "unpushed": count, "oldest_unpushed_age_s": age if count else None,
                "rejected": rejected, "failures": failures, "error": error}

    def _log_transition(self, worst: str, views: list[dict[str, Any]]) -> None:
        if worst in ("stale", "error") and worst != self._logged_state:
            detail = "; ".join(f"{v['name']}={v['state']} unpushed={v['unpushed']} age={v['oldest_unpushed_age_s']}" for v in views)
            log.error("git sync is %s: %s", worst, detail)
        self._logged_state = worst


def _is_rejection(stderr: str) -> bool:
    return "[rejected]" in stderr and ("non-fast-forward" in stderr or "fetch first" in stderr)


def from_env() -> GitSync | None:
    data = os.environ.get("AUDIO_DATA_REPO", "").strip()
    if not data:
        return None
    covers = os.environ.get("AUDIO_COVERS_REPO", "").strip()
    mode = os.environ.get("GIT_SYNC_MODE", "timer").strip().lower() or "timer"
    if mode not in ("timer", "request"):
        log.warning("unknown GIT_SYNC_MODE %r, using timer", mode)
        mode = "timer"
    return GitSync(
        Path(data),
        Path(covers) if covers else None,
        os.environ.get("AUDIO_GIT_SSH_KEY") or None,
        mode=mode,
        interval_s=_env_int("GIT_SYNC_INTERVAL_S", 60),
        grace_s=_env_int("GIT_SYNC_STALE_GRACE_S", 30),
        state_file=os.environ.get("GIT_SYNC_STATE_FILE") or None,
    )


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, "")))
    except ValueError:
        return default
