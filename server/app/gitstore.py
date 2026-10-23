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
WATCHED_JSON = ("library.json", "profile.json", "drafts.json", "genre_layout.json")
DEFAULT_OWNED = ("audioplayer/",)
FLOCK_WAIT_S = 30.0
UNPUSHED_RANGE = "@{u}..HEAD"


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
    behind: int = 0


class Inbound(NamedTuple):
    status: str
    error: str = ""
    behind: int = 0
    local: int = 0


def normalize_prefixes(prefixes: Any) -> tuple[str, ...]:
    """Repo-relative directory prefixes the server owns, each with one trailing slash; the default when none is usable."""
    if isinstance(prefixes, str):
        prefixes = prefixes.split(",")
    cleaned = tuple(dict.fromkeys(p.strip().strip("/") + "/" for p in (prefixes or ()) if p and p.strip().strip("/")))
    return cleaned or DEFAULT_OWNED


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
        inbound: bool = True,
        rebase_foreign: bool = True,
        owned_prefixes: tuple[str, ...] | None = None,
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
        self.inbound = inbound
        self.rebase_foreign = rebase_foreign
        self.owned_prefixes = normalize_prefixes(owned_prefixes)
        self._flock_fh: Any = None
        self._flock_depth = 0
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

    @property
    def write_lock_path(self) -> Path:
        return Path(str(self.state_file) + ".write.lock")

    def _flock_take(self, wait_s: float) -> bool:
        """Caller holds self.lock. Cross-process write lock shared with the timer's inbound pull; re-entrant."""
        if self._flock_depth:
            self._flock_depth += 1
            return True
        import fcntl

        try:
            self.write_lock_path.parent.mkdir(parents=True, exist_ok=True)
            fh = open(self.write_lock_path, "a")
        except OSError as exc:
            log.warning("write lock file unavailable, continuing without it: %s", exc)
            self._flock_depth = 1
            return True
        deadline = time.monotonic() + wait_s
        while True:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    fh.close()
                    return False
                time.sleep(0.005)
        self._flock_fh = fh
        self._flock_depth = 1
        return True

    def _flock_drop(self) -> None:
        self._flock_depth -= 1
        if self._flock_depth == 0 and self._flock_fh is not None:
            import fcntl

            try:
                fcntl.flock(self._flock_fh, fcntl.LOCK_UN)
            finally:
                self._flock_fh.close()
                self._flock_fh = None

    @contextmanager
    def try_exclusive(self, wait_s: float) -> Iterator[bool]:
        """The in-process git lock plus the cross-process write flock; False when not obtained within wait_s."""
        if not self.lock.acquire(timeout=wait_s):
            yield False
            return
        try:
            if not self._flock_take(wait_s):
                yield False
                return
            try:
                yield True
            finally:
                self._flock_drop()
        finally:
            self.lock.release()

    @contextmanager
    def exclusive(self) -> Iterator[None]:
        """Every tree write (saves, cover writes) runs inside this; the timer's inbound fast-forward takes the same flock."""
        with self.try_exclusive(FLOCK_WAIT_S) as got:
            if not got:
                raise GitError("git write lock busy")
            yield

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Hold the git lock; discard uncommitted changes and the files the body created if it raises."""
        with self.exclusive():
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
        with self.exclusive():
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
        counted = self._git(repo, "rev-list", "--count", UNPUSHED_RANGE, check=False)
        if counted.returncode != 0:
            return Probe(None, None, False)
        count = int(counted.stdout.strip() or 0)
        behind = self._git(repo, "rev-list", "--count", "HEAD..@{u}", check=False).stdout.strip()
        behind_n = int(behind) if behind.isdigit() else 0
        if count:
            stamps = self._git(repo, "log", UNPUSHED_RANGE, "--format=%ct", check=False).stdout.split()
            return Probe(count, min(int(s) for s in stamps) if stamps else None, False, behind_n)
        contains = self._git(repo, "merge-base", "--is-ancestor", "@{u}", "HEAD", check=False)
        return Probe(0, None, contains.returncode == 0, behind_n)

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
                code = max(code, self._pass_repo(repo, state, repos, push_timeout))
            return self._finish_pass(state, code)

    def _pass_repo(self, repo: Path, state: dict[str, Any], repos: dict[str, Any], timeout: int) -> int:
        name = self.repo_name(repo)
        rs = repos.setdefault(name, {"failures": 0, "rejected": False, "last_ok_at": None})
        if self.inbound:
            skipped = self._inbound_step(repo, name, rs, state, timeout)
            if skipped is not None:
                return skipped
        probe = self.probe(repo, fresh=True)
        if probe.count is None:
            state["last_error"] = f"{name}: no upstream"
            pass_log.error("%s has no upstream", name)
            return 1
        if rs.get("rejected") and not self._clear_or_keep_rejected(name, rs, probe):
            return 2
        if probe.count == 0:
            rs.update(failures=0, last_ok_at=_iso(self.clock()))
            return 0
        return self._record_push_result(repo, name, rs, state, self.push_repo(repo, timeout=timeout))

    def _inbound_step(self, repo: Path, name: str, rs: dict[str, Any], state: dict[str, Any], timeout: int) -> int | None:
        """The exit code that ends this repo's pass early (the inbound change cannot be applied), else None to go on to the push."""
        inb = self.inbound_repo(repo, timeout=timeout)
        if inb.status in ("none", "pulled"):
            rs.update(behind=0, inbound_error=None)
            if inb.status == "pulled":
                state["last_pull_at"] = rs["last_pull_at"] = _iso(self.clock())
        elif inb.status == "rebased":
            rs.update(behind=0, inbound_error=None, rejected=False)
            state["last_rebase_at"] = rs["last_rebase_at"] = _iso(self.clock())
            rs["foreign_commits"] = int(rs.get("foreign_commits") or 0) + inb.behind
        elif inb.status in ("diverged", "invalid", "failed"):
            rs.update(behind=inb.behind, inbound_error=inb.error)
            state["last_error"] = inb.error
            pass_log.error("%s", inb.error)
            return 2 if inb.status == "diverged" else 1
        elif inb.status == "busy":
            pass_log.info("%s inbound pull skipped: a save holds the write lock", name)
        else:
            pass_log.warning("%s fetch failed: %s", name, inb.error)
        return None

    def _clear_or_keep_rejected(self, name: str, rs: dict[str, Any], probe: Probe) -> bool:
        """True when the rejection is cleared because local matches the remote; False keeps the repo stopped."""
        if not probe.synced:
            pass_log.error("%s is rejected: the remote moved, not pushing (fix by hand, see deploy.md)", name)
            return False
        rs.update(rejected=False, failures=0)
        pass_log.warning("%s rejection cleared: local matches the remote", name)
        return True

    def _record_push_result(self, repo: Path, name: str, rs: dict[str, Any], state: dict[str, Any], result: PushResult) -> int:
        now_iso = _iso(self.clock())
        if result.status == "ok":
            rs.update(failures=0, last_ok_at=now_iso)
            state["last_push_at"] = now_iso
            return 0
        if result.status == "rejected" and self.inbound and self.rebase_foreign and self._foreign_overlap(repo) is None:
            return self._record_moved_remote(name, rs, state)
        if result.status == "rejected" and self.inbound:
            message = self.diverged_message(name)
            rs.update(behind=self.probe(repo, fresh=True).behind, inbound_error=message)
            state["last_error"] = message
            pass_log.error("%s", message)
            return 2
        if result.status == "rejected":
            rs["rejected"] = True
            state["last_error"] = f"{name}: push rejected"
            pass_log.error("%s push rejected: single-writer rule broken, stopped pushing it", name)
            return 2
        rs["failures"] = int(rs.get("failures", 0)) + 1
        state["last_error"] = f"{name}: {result.error}"
        level = logging.ERROR if rs["failures"] >= FAILS_BEFORE_ERROR else logging.WARNING
        pass_log.log(level, "%s push failed (%d in a row): %s", name, rs["failures"], result.error)
        return 1

    def _record_moved_remote(self, name: str, rs: dict[str, Any], state: dict[str, Any]) -> int:
        """The push lost a race with a foreign push outside the owned paths: the next run rebases; it only counts as a failure."""
        rs["failures"] = int(rs.get("failures", 0)) + 1
        state["last_error"] = f"{name}: push rejected, GitHub moved; retrying"
        level = logging.ERROR if rs["failures"] >= FAILS_BEFORE_ERROR else logging.WARNING
        pass_log.log(level, "%s push rejected, GitHub moved by foreign commits (%d in a row); the next run rebases", name, rs["failures"])
        return 1

    def _finish_pass(self, state: dict[str, Any], code: int) -> int:
        if code == 0:
            state["last_error"] = None
        state["last_run_at"] = _iso(self.clock())
        save_state(self.state_file, state)
        self._probes.clear()
        return code

    # --- inbound fast-forward (ADR-0027) ---------------------------------------------------------

    def _ahead_behind(self, repo: Path) -> tuple[int, int] | None:
        out = self._git(repo, "rev-list", "--left-right", "--count", "HEAD...@{u}", check=False)
        parts = out.stdout.split()
        if out.returncode != 0 or len(parts) != 2:
            return None
        return int(parts[0]), int(parts[1])

    def diverged_message(self, name: str) -> str:
        return f"{name} diverged: GitHub and the server both have new commits; resolve by hand"

    def inbound_repo(self, repo: Path, timeout: int = 60, wait_s: float = 0.5) -> Inbound:
        """Fetch; fast-forward only when origin is ahead and nothing is unpushed. Never rebases, merges or forces."""
        name = self.repo_name(repo)
        fetched = self._git(repo, "fetch", check=False, timeout=timeout)
        if fetched.returncode != 0:
            return Inbound("offline", self._short_error(fetched.stderr or fetched.stdout))
        self._probes.pop(repo, None)
        counts = self._ahead_behind(repo)
        if counts is None or counts[1] == 0:
            return Inbound("none")
        ahead, behind = counts
        if ahead and not self.rebase_foreign:
            return Inbound("diverged", self.diverged_message(name), behind)
        with self.try_exclusive(wait_s) as got:
            if not got:
                return Inbound("busy", behind=behind)
            counts = self._ahead_behind(repo)
            if counts is None or counts[1] == 0:
                return Inbound("none")
            if counts[0] and self.rebase_foreign:
                return self._rebase_foreign(repo, name, counts[0], counts[1], timeout)
            if counts[0]:
                return Inbound("diverged", self.diverged_message(name), counts[1])
            return self._fast_forward(repo, name, counts[1])

    def is_owned(self, rel: str) -> bool:
        return rel.startswith(self.owned_prefixes)

    def _paths(self, repo: Path, *revs: str) -> set[str] | None:
        """Every path touched by any commit in the range (a merge against each parent, both sides of a rename); None when git fails."""
        logged = self._git(repo, "log", "--name-only", "--no-renames", "-m", "--format=", "-z", *revs, check=False)
        if logged.returncode != 0:
            return None
        return {n.strip("\n") for n in logged.stdout.split("\0") if n.strip("\n")}

    def _foreign_overlap(self, repo: Path) -> str | None:
        """None when every GitHub-only commit stays outside the owned paths (and clear of the local-only paths); else why not."""
        base = self._git(repo, "merge-base", "HEAD", "@{u}", check=False)
        if base.returncode != 0 or not base.stdout.strip():
            return "no merge base"
        b = base.stdout.strip()
        foreign = self._paths(repo, f"{b}..@{{u}}")
        local = self._paths(repo, f"{b}..HEAD")
        if foreign is None or local is None:
            return "cannot list paths"
        hit = next((p for p in sorted(foreign) if self.is_owned(p)), None)
        if hit:
            return hit
        return next(iter(sorted(foreign & local)), None)

    def _rebase_foreign(self, repo: Path, name: str, ahead: int, behind: int, timeout: int) -> Inbound:
        """Caller holds the write lock. Rebase the local-only commits onto origin when GitHub's new commits stay outside the owned paths."""
        diverged = Inbound("diverged", self.diverged_message(name), behind)
        old = self._git(repo, "rev-parse", "HEAD").stdout.strip()
        why = self._foreign_overlap(repo)
        if why:
            pass_log.error("%s diverged: GitHub commits touch %s", name, why)
            return diverged
        if self._git(repo, "rev-list", "--merges", "--count", UNPUSHED_RANGE, check=False).stdout.strip() != "0":
            pass_log.error("%s diverged: local commits contain a merge", name)
            return diverged
        started = time.monotonic()
        rebased = self._git(repo, "-c", "core.editor=true", "rebase", "--no-autostash", "@{u}", check=False, timeout=timeout)
        if rebased.returncode != 0:
            self._restore(repo, old)
            pass_log.error("%s rebase failed, restored %s: %s", name, old[:10], self._short_error(rebased.stderr or rebased.stdout))
            return diverged
        bad = self._invalid_in_tree(repo)
        if bad:
            self._restore(repo, old)
            pass_log.error("%s rebased tree invalid, restored %s: %s (%s)", name, old[:10], bad[0], bad[1])
            return Inbound("invalid", f"{name}: inbound change invalid after rebase ({bad[0]})", behind)
        self._probes.pop(repo, None)
        pass_log.info("rebased %d local commits over %d foreign commits (paths outside %s) in %.2fs",
                      ahead, behind, ", ".join(self.owned_prefixes), time.monotonic() - started)
        return Inbound("rebased", behind=behind, local=ahead)

    def _restore(self, repo: Path, old: str) -> None:
        self._git(repo, "rebase", "--abort", check=False)
        if self._git(repo, "rev-parse", "HEAD", check=False).stdout.strip() != old:
            self._git(repo, "reset", "--hard", old, check=False)
        self._probes.pop(repo, None)

    def _invalid_in_tree(self, repo: Path) -> tuple[str, str] | None:
        """(path, why) of the first library.json / profile.json in the owned part of HEAD's tree that is unusable."""
        listed = self._git(repo, "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", *self.owned_prefixes, check=False)
        if listed.returncode != 0:
            return "tree", "unreadable"
        rels = [n for n in listed.stdout.split("\0") if n.rsplit("/", 1)[-1] in WATCHED_JSON]
        if not rels:
            return None
        try:
            batch = subprocess.run(["git", "cat-file", "--batch"], cwd=repo, env=self._env(), capture_output=True,
                                   input="".join(f"HEAD:{r}\n" for r in rels).encode(), timeout=120)
        except subprocess.TimeoutExpired:
            return "tree", "timed out"
        data, pos = batch.stdout, 0
        for rel in rels:
            end = data.find(b"\n", pos)
            head = data[pos:end].split() if end >= 0 else []
            if len(head) != 3 or head[1] != b"blob":
                return rel, "unreadable"
            size = int(head[2])
            body = data[end + 1:end + 1 + size]
            pos = end + 1 + size + 1
            problem = check_inbound_json(rel, body.decode("utf-8", "replace"))
            if problem:
                return rel, problem
        return None

    def _fast_forward(self, repo: Path, name: str, behind: int) -> Inbound:
        old = self._git(repo, "rev-parse", "HEAD").stdout.strip()
        new = self._git(repo, "rev-parse", "@{u}").stdout.strip()
        names = self._git(repo, "diff", "--name-only", "--diff-filter=d", "-z", old, new, "--", *self.owned_prefixes, check=False)
        watched = [n for n in names.stdout.split("\0") if n.rsplit("/", 1)[-1] in WATCHED_JSON]
        for rel in watched:
            blob = self._git(repo, "show", f"{new}:{rel}", check=False)
            problem = check_inbound_json(rel, blob.stdout) if blob.returncode == 0 else "unreadable"
            if problem:
                pass_log.error("%s inbound change invalid, not applied: %s (%s)", name, rel, problem)
                return Inbound("invalid", f"{name}: inbound change invalid ({rel})", behind)
        merged = self._git(repo, "merge", "--ff-only", new, check=False)
        if merged.returncode != 0:
            why = self._short_error(merged.stderr or merged.stdout)
            pass_log.error("%s inbound fast-forward failed: %s", name, why)
            return Inbound("failed", f"{name}: inbound change failed: {why}", behind)
        self._probes.pop(repo, None)
        for rel in watched:
            try:
                problem = check_inbound_json(rel, (repo / rel).read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                problem = str(exc)
            if problem:
                self._git(repo, "reset", "--hard", old)
                self._probes.pop(repo, None)
                pass_log.error("%s inbound change invalid, rolled back: %s (%s)", name, rel, problem)
                return Inbound("invalid", f"{name}: inbound change invalid ({rel})", behind)
        pass_log.info("%s fast-forwarded %d commit(s) from the remote", name, behind)
        return Inbound("pulled", behind=behind)

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
        with self.exclusive():
            for repo in self._repos():
                try:
                    self._recover_repo(repo)
                except (GitError, OSError) as exc:
                    log.exception("startup recovery failed in %s: %s", repo.name, exc)
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
            res = self._fast_forward(repo, self.repo_name(repo), int(behind.stdout.strip()))
            if res.error:
                log.error("startup fast-forward not applied: %s", res.error)
            self._probes.pop(repo, None)
            return
        log.error("%s diverged from the remote at startup: not merging, pushing stopped", self.repo_name(repo))
        if self.inbound:
            return
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
                ahead = self._git(repo, "rev-list", "--count", UNPUSHED_RANGE, check=False)
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
        if errors:
            last_error = errors[0]
        elif request_mode:
            last_error = self._last_error
        else:
            last_error = state.get("last_error")
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
            "inbound": {
                "enabled": self.inbound, "last_pull_at": state.get("last_pull_at"), "behind": sum(v["behind"] for v in views),
                "foreign_commits": sum(int(((state.get("repos") or {}).get(v["name"]) or {}).get("foreign_commits") or 0) for v in views),
                "last_rebase_at": state.get("last_rebase_at"),
            },
            "repos": [{k: v[k] for k in ("name", "state", "unpushed", "oldest_unpushed_age_s", "rejected", "failures")} for v in views],
        }

    def _repo_view(self, repo: Path, state: dict[str, Any], now: float, request_mode: bool) -> dict[str, Any]:
        name = self.repo_name(repo)
        rs = (state.get("repos") or {}).get(name) or {}
        probe = self.probe(repo)
        rejected = (bool(rs.get("rejected")) or repo in self._rejected) and not probe.synced
        if request_mode:
            failures = self._fails if repo in self._dirty else 0
        else:
            failures = int(rs.get("failures") or 0)
        count = probe.count or 0
        age = None if probe.oldest is None else max(0, int(now - probe.oldest))
        level, error = self._view_level(name, probe, rs, rejected, failures, age)
        return {"name": name, "state": level, "unpushed": count, "oldest_unpushed_age_s": age if count else None,
                "rejected": rejected, "failures": failures, "error": error, "behind": probe.behind}

    def _view_level(self, name: str, probe: Probe, rs: dict[str, Any], rejected: bool, failures: int, age: int | None) -> tuple[str, str | None]:
        if probe.count is None:
            return "error", f"{name}: no upstream"
        if rejected:
            return "error", f"{name}: push rejected"
        if self.inbound and probe.behind > 0 and rs.get("inbound_error"):
            return "error", str(rs["inbound_error"])
        if failures >= FAILS_BEFORE_ERROR:
            return "error", f"{name}: not reaching git"
        if not probe.count:
            return "ok", None
        if age is not None and age > self.stale_after_s:
            return "stale", None
        return "pending", None

    def _log_transition(self, worst: str, views: list[dict[str, Any]]) -> None:
        if worst in ("stale", "error") and worst != self._logged_state:
            detail = "; ".join(f"{v['name']}={v['state']} unpushed={v['unpushed']} age={v['oldest_unpushed_age_s']}" for v in views)
            log.error("git sync is %s: %s", worst, detail)
        self._logged_state = worst


def check_inbound_json(rel: str, text: str) -> str | None:
    """None when `text` is a usable library.json / profile.json, else why not."""
    try:
        raw = json.loads(text)
    except ValueError:
        return "not valid JSON"
    if rel.endswith("library.json"):
        from . import library

        if not isinstance(raw, (dict, list)) or (isinstance(raw, dict) and not isinstance(raw.get("songs", []), list)):
            return "not a library"
        try:
            library.normalize(raw)
        except Exception as exc:
            return f"library schema: {type(exc).__name__}"
    elif not isinstance(raw, dict):
        return "not an object"
    elif rel.endswith("drafts.json") and not isinstance(raw.get("drafts", []), list):
        return "not a draft list"
    elif rel.endswith("genre_layout.json") and not all(isinstance(raw.get(k, {}), dict) for k in ("positions", "families")):
        return "not a genre layout"
    return None


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
        inbound=_env_flag("GIT_SYNC_INBOUND"),
        rebase_foreign=_env_flag("GIT_SYNC_REBASE_FOREIGN"),
        owned_prefixes=normalize_prefixes(os.environ.get("GIT_SYNC_OWNED_PREFIXES", "")),
    )


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "1").strip().lower() not in ("0", "false", "off", "no")


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, "")))
    except ValueError:
        return default
