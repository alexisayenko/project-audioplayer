"""Git-backed store: pull --rebase -> write -> commit -> push; failed pushes retry in the background."""

from __future__ import annotations

import logging
import os
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

log = logging.getLogger("audioplayer.git")

FAILS_BEFORE_ERROR = 5


class GitError(RuntimeError):
    pass


class GitSync:
    def __init__(
        self,
        data_repo: Path,
        covers_repo: Path | None = None,
        ssh_key: str | None = None,
        backoff: tuple[float, float] = (2.0, 300.0),
    ) -> None:
        self.data_repo = Path(data_repo)
        self.covers_repo = Path(covers_repo) if covers_repo else None
        self._ssh_key = ssh_key
        self._backoff = backoff
        self.lock = threading.RLock()
        self._state = threading.Lock()
        self._dirty: set[Path] = set()
        self._fails = 0
        self._retry: threading.Thread | None = None
        self._stop = threading.Event()

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

    def _git(self, repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
        p = subprocess.run(
            ["git", *args], cwd=repo, env=self._env(), capture_output=True, text=True, timeout=120
        )
        if check and p.returncode != 0:
            msg = (p.stderr or p.stdout).strip()
            if self._ssh_key:
                msg = msg.replace(self._ssh_key, "<key>")
            raise GitError(f"git {args[0]} failed: {msg[:300]}")
        return p

    def status(self) -> str:
        """ok: nothing unpushed; pending: unpushed, retrying; error: retries keep failing."""
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

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Hold the git lock, pull, and discard uncommitted tracked changes if the body raises."""
        with self.lock:
            self.pull()
            try:
                yield
            except BaseException:
                for repo in self._repos():
                    self._git(repo, "checkout", "--", ".", check=False)
                raise

    def commit(self, message: str) -> None:
        """Commit changes under audioplayer/ in every repo, then push; a failed push keeps the commit."""
        with self.lock:
            for repo in self._repos():
                added = self._git(repo, "add", "-A", "--", "audioplayer", check=False)
                if added.returncode != 0 and "did not match any files" not in added.stderr:
                    raise GitError(f"git add failed: {added.stderr.strip()[:300]}")
                if self._git(repo, "diff", "--cached", "--quiet", check=False).returncode != 0:
                    self._git(repo, "commit", "-m", message)
                    with self._state:
                        self._dirty.add(repo)
            self._push_all()

    def _push_all(self) -> bool:
        with self.lock:
            for repo in self._dirty.copy():
                try:
                    self._git(repo, "push")
                except GitError as exc:
                    log.warning("push failed in %s: %s", repo.name, exc)
                    with self._state:
                        self._fails += 1
                    self._ensure_retry()
                    return False
                with self._state:
                    self._dirty.discard(repo)
            with self._state:
                self._fails = 0
            return True

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

    def resync(self) -> None:
        """Startup: push local commits left over from a previous run."""
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


def from_env() -> GitSync | None:
    data = os.environ.get("AUDIO_DATA_REPO", "").strip()
    if not data:
        return None
    covers = os.environ.get("AUDIO_COVERS_REPO", "").strip()
    return GitSync(
        Path(data), Path(covers) if covers else None, os.environ.get("AUDIO_GIT_SSH_KEY") or None
    )
