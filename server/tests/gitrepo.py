import os
import subprocess
import time
from pathlib import Path

from app import gitstore


def git(cwd, *args):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
                          cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def remote(tmp_path, name):
    bare = tmp_path / f"{name}.git"
    git(tmp_path, "init", "--bare", "-b", "main", str(bare))
    seed = tmp_path / f"{name}-seed"
    git(tmp_path, "clone", str(bare), str(seed))
    git(seed, "checkout", "-b", "main")
    (seed / "README").write_text(name)
    git(seed, "add", "README")
    git(seed, "commit", "-m", "init")
    git(seed, "push", "-u", "origin", "main")
    clone = tmp_path / name
    git(tmp_path, "clone", str(bare), str(clone))
    return bare, clone


def write(clone, rel, text):
    p = Path(clone) / "audioplayer" / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def save(s, clone, rel, text, msg):
    with s.transaction():
        write(clone, rel, text)
        s.commit(msg)


def subjects(bare):
    return git(bare, "log", "--format=%s", "main").splitlines()


def slow_hook(bare, seconds):
    hook = bare / "hooks" / "pre-receive"
    hook.write_text(f"#!/bin/sh\nsleep {seconds}\n")
    os.chmod(hook, 0o755)


def clock(start=1_800_000_000.0):
    box = {"t": start}
    fn = lambda: box["t"]
    fn.box = box
    return fn


def commit_at(clone, ts):
    env = {**os.environ, "GIT_COMMITTER_DATE": f"{int(ts)} +0000", "GIT_AUTHOR_DATE": f"{int(ts)} +0000"}
    subprocess.run(["git", "commit", "-q", "--amend", "--no-edit", "--date", f"{int(ts)} +0000"],
                   cwd=clone, check=True, env=env, capture_output=True)


def make_sync(tmp_path, covers=False, **kw):
    bare, clone = remote(tmp_path, "data")
    cov = cbare = None
    if covers:
        cbare, cov = remote(tmp_path, "covers")
    kw.setdefault("state_file", tmp_path / "state" / "gitsync-state.json")
    s = gitstore.GitSync(clone, cov, **kw)
    return s, bare, clone, cbare, cov


def wait(cond, secs=5):
    end = time.time() + secs
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False
