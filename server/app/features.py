"""Features screen data (WEB-134 to WEB-138): releases from the git history of the running checkout, planned tasks from docs/tasks, deploys recorded at startup."""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import buildinfo

KEEP_TYPES = {"feat"}
MAX_TEXT = 110
SUBJECT = re.compile(r"^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$")
SKIP_SCOPES = {"data"}
EXCLUDE = (
    r"remov(e|al|als) .*genre", r"genres? (of|for|on|off) ", r"fix the genres", r"wrong genres", r"removal list", r"approved removals",
    r"add(ed)? .* genre to", r"^genre data:", r"^.* removal$", r"reviewed extra", r"vocabulary rows",
)
TASK_REF = re.compile(r"\btask-(\d{4})\b")
TASK_ID = re.compile(r"^task-\d{4}$")
HASH_KEY = re.compile(r"^[0-9a-f]{7,40}$")
REVISION = re.compile(r"HEAD|[0-9a-f]{7,40}(?:\.\.[0-9a-f]{7,40})?")
DEPLOY_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
MAP_KEYS = {"exclude", "items"}
TASK_FILE = re.compile(r"^docs/tasks/(task-\d{4})\.md$")
PLANNED = "to do"
IN_PROGRESS = "in progress"
STOP = {"with", "that", "this", "from", "into", "when", "what", "their", "have", "will", "only", "also", "than", "then", "each", "page", "view"}
SEP = "\x1f"
REC = "\x1e"
GIT_TIMEOUT = 30
STATE_DIR = "_state"
STATE_FILE = "deploys.json"

_lock = threading.Lock()
_cache: dict[str, Any] = {"key": None, "data": None}


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", f"safe.directory={repo}", "-C", str(repo), *args],
        check=True, capture_output=True, text=True, encoding="utf-8", timeout=GIT_TIMEOUT,
    ).stdout


def utc_day(epoch: int | str) -> str:
    return datetime.fromtimestamp(int(epoch), UTC).strftime("%Y-%m-%d")


def parse_log(text: str) -> list[dict[str, Any]]:
    commits = []
    for rec in text.split(REC):
        if not rec.strip():
            continue
        head, _, files = rec.partition(SEP + "\n")
        sha, ct, subject, body = ([*head.split(SEP), "", "", "", ""])[:4]
        commits.append({"sha": sha.strip(), "date": utc_day(ct), "ts": int(ct), "subject": subject.strip(), "body": body.strip(),
                        "files": [f for f in files.split("\n") if f.strip()]})
    return commits


def clean_deploys(raw: Any) -> list[dict[str, str]]:
    """The recorded deploys with a hex commit hash (7 to 40 chars) and a YYYY-MM-DD date; anything else is dropped so no stored value reaches git as an option."""
    if not isinstance(raw, list):
        return []
    return [
        {"hash": d["hash"], "date": d["date"]}
        for d in raw
        if isinstance(d, dict) and isinstance(d.get("hash"), str) and isinstance(d.get("date"), str)
        and HASH_KEY.fullmatch(d["hash"]) and DEPLOY_DAY.fullmatch(d["date"])
    ]


def read_log(repo: Path, rev: str) -> list[dict[str, Any]]:
    if not REVISION.fullmatch(rev):
        raise ValueError("not a commit hash or range")
    fmt = f"{REC}%H{SEP}%ct{SEP}%s{SEP}%b{SEP}"
    return parse_log(git(repo, "log", "--topo-order", f"--format={fmt}", "--name-only", rev))


def clean_subject(subject: str, exclude: tuple[str, ...] | list[str] | None = None) -> str | None:
    """Feature sentence of a feat subject; None for anything else, for data scope and for library data edits.

    A subject that joins clauses with ';' keeps the clauses that are not data edits.
    """
    if subject.startswith(("Merge", "Revert")):
        return None
    m = SUBJECT.match(subject.strip())
    if not m or m.group(1).lower() not in KEEP_TYPES or (m.group(2) or "").strip().lower() in SKIP_SCOPES:
        return None
    patterns = [re.compile(p, re.I) for p in (EXCLUDE if exclude is None else exclude)]
    clauses = [c.strip() for c in m.group(3).split(";")]
    text = "; ".join(c for c in clauses if c and not any(p.search(c) for p in patterns))
    if not text:
        return None
    text = text[0].upper() + text[1:]
    if len(text) > MAX_TEXT:
        cut = text[:MAX_TEXT].rsplit(" ", 1)[0] if " " in text[:MAX_TEXT] else text[:MAX_TEXT]
        text = cut.rstrip(" ,;:-.") + "..."
    return text


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) >= 4 and w not in STOP}


def task_of(commit: dict[str, Any], tasks: dict[str, dict[str, Any]], release_files: list[str], rmap: dict[str, str | None]) -> str | None:
    """Task id for a commit: reference in the message, hand map, task file of the commit, task file of the release."""
    for m in TASK_REF.finditer(commit["subject"] + "\n" + commit["body"]):
        tid = "task-" + m.group(1)
        if not tasks or tid in tasks:
            return tid
    subject = commit["subject"].lower()
    for key, tid in rmap.items():
        if key in MAP_KEYS:
            continue
        if commit["sha"].startswith(key) or key.lower() in subject:
            return tid or None
    sw = words(commit["subject"])

    def best(files: list[str], need: int) -> str | None:
        scored = []
        for f in files:
            m = TASK_FILE.match(f)
            if m and m.group(1) in tasks:
                scored.append((len(sw & words(tasks[m.group(1)]["title"])), m.group(1)))
        scored = [s for s in scored if s[0] >= need]
        return max(scored)[1] if scored else None

    return best(commit["files"], 1) or best(release_files, 2)


def curated_items(rmap: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """The valid part of the `items` table of the map file: {hash prefix of 7+ hex chars: [{text, task}]}; malformed keys, lists and entries are dropped."""
    table = rmap.get("items") if isinstance(rmap, dict) else None
    out: dict[str, list[dict[str, Any]]] = {}
    if not isinstance(table, dict):
        return out
    for key, entries in table.items():
        if not isinstance(key, str) or not HASH_KEY.match(key.lower()) or not isinstance(entries, list):
            continue
        good = []
        for e in entries:
            if not isinstance(e, dict) or not isinstance(e.get("text"), str) or not e["text"].strip():
                continue
            task = e.get("task")
            if task is not None and not (isinstance(task, str) and TASK_ID.match(task)):
                task = None
            good.append({"text": e["text"].strip(), "task": task})
        if good or not entries:
            out[key.lower()] = good
    return out


def make_release(commits: list[dict[str, Any]], tasks: dict[str, Any], rmap: dict[str, str | None]) -> tuple[str, list[dict[str, Any]]] | None:
    """(full hash of the newest commit, items) of one release; None when it has no feature items."""
    if not commits:
        return None
    ordered = sorted(commits, key=lambda c: c["ts"], reverse=True)
    release_files = [f for c in ordered for f in c["files"]]
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    curated = curated_items(rmap)
    for c in ordered:
        key = next((k for k in curated if c["sha"].startswith(k)), None)
        if key is not None:
            found = curated[key]
        else:
            text = clean_subject(c["subject"], rmap.get("exclude"))
            found = [{"text": text, "task": task_of(c, tasks, release_files, rmap)}] if text else []
        for item in found:
            if item["text"] in seen:
                continue
            seen.add(item["text"])
            items.append(dict(item))
    if not items:
        return None
    return ordered[0]["sha"], items


def by_day(commits: list[dict[str, Any]], tasks: dict[str, Any], rmap: dict[str, str | None]) -> list[dict[str, Any]]:
    days: dict[str, list[dict[str, Any]]] = {}
    for c in commits:
        days.setdefault(c["date"], []).append(c)
    out = []
    for day, group in days.items():
        made = make_release(group, tasks, rmap)
        if made:
            out.append(({"hash": made[0][:7], "full": made[0], "date": day, "items": made[1]}, max(c["ts"] for c in group)))
    return [r for r, _ in sorted(out, key=lambda p: p[1], reverse=True)]


def by_deploys(commits_for: Any, deploys: list[dict[str, str]], tasks: dict[str, Any], rmap: dict[str, str | None]) -> list[dict[str, Any]]:
    """One release per date from the recorded deploys, newest first; commits_for(prev_hash or None, hash) lists the commits of a range."""
    days: dict[str, dict[str, Any]] = {}
    prev = None
    for d in deploys:
        try:
            commits = commits_for(prev, d["hash"])
        except (OSError, subprocess.SubprocessError):
            commits = []
        prev = d["hash"]
        day = days.setdefault(d["date"], {"hash": d["hash"], "commits": {}})
        day["hash"] = d["hash"]
        day["commits"].update({c["sha"]: c for c in commits})
    out = []
    for date, day in days.items():
        made = make_release(list(day["commits"].values()), tasks, rmap)
        if made:
            out.append({"hash": day["hash"][:7], "full": day["hash"], "date": date, "items": made[1]})
    return sorted(out, key=lambda r: r["date"], reverse=True)


def front_matter(text: str) -> dict[str, str]:
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    meta = {}
    for line in (m.group(1) if m else "").split("\n"):
        k, sep, v = line.partition(":")
        if sep:
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta


def read_tasks(tasks_dir: Path) -> dict[str, dict[str, Any]]:
    tasks = {}
    for f in sorted(Path(tasks_dir).glob("task-*.md")):
        try:
            text = f.read_text(encoding="utf-8").replace("\r\n", "\n")
        except (OSError, UnicodeError):
            continue
        meta = front_matter(text)
        tid = meta.get("task_id") or f.stem
        tags = [t.strip() for t in meta.get("tags", "").strip("[]").split(",") if t.strip()]
        tasks[tid] = {"id": tid, "title": meta.get("title", tid), "status": meta.get("status", ""), "tags": tags}
    return tasks


def status_kind(status: str) -> str:
    """"in progress" or "to do" for a status that starts with it (suffixes allowed), else ""."""
    s = status.strip().lower()
    return IN_PROGRESS if s.startswith(IN_PROGRESS) else PLANNED if s.startswith(PLANNED) else ""


def tasks_with(tasks: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    rows = [{**t, "status": kind} for t in tasks.values() if status_kind(t["status"]) == kind]
    return sorted(rows, key=lambda t: t["id"], reverse=True)


def planned(tasks: dict[str, Any]) -> list[dict[str, Any]]:
    return tasks_with(tasks, PLANNED)


def in_progress(tasks: dict[str, Any]) -> list[dict[str, Any]]:
    return tasks_with(tasks, IN_PROGRESS)


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def build(repo: Path, deploys: list[dict[str, str]], rmap: dict[str, str | None]) -> dict[str, Any]:
    """Releases and planned tasks of the checkout `repo`; `unavailable` when its git history cannot be read."""
    tasks = read_tasks(repo / "docs" / "tasks")
    try:
        releases = _releases(repo, clean_deploys(deploys), tasks, rmap)
    except (OSError, subprocess.SubprocessError):
        return {"releases": [], "planned": planned(tasks), "in_progress": in_progress(tasks), "unavailable": True}
    return {"releases": releases, "planned": planned(tasks), "in_progress": in_progress(tasks), "unavailable": False}


def _releases(repo: Path, deploys: list[dict[str, str]], tasks: dict[str, Any], rmap: dict[str, str | None]) -> list[dict[str, Any]]:
    if not deploys:
        return by_day(read_log(repo, "HEAD"), tasks, rmap)
    first = deploys[0]
    try:
        head_commits = read_log(repo, first["hash"])
    except subprocess.CalledProcessError:
        return by_day(read_log(repo, "HEAD"), tasks, rmap)

    def commits_for(prev: str | None, h: str) -> list[dict[str, Any]]:
        if prev is None:
            return [c for c in head_commits if c["date"] >= first["date"]]
        return read_log(repo, f"{prev}..{h}")

    recorded = by_deploys(commits_for, deploys, tasks, rmap)
    return recorded + by_day([c for c in head_commits if c["date"] < first["date"]], tasks, rmap)


def state_path() -> Path:
    """Beside, not inside, the git-added `audioplayer/` tree of the data repo, and in no user's library."""
    from . import deps
    base = deps.SYNC.data_repo if deps.SYNC else deps.data_root()
    return base / STATE_DIR / STATE_FILE


def head(repo: Path) -> str | None:
    try:
        sha = git(repo, "rev-parse", "HEAD").strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return sha if re.fullmatch(r"[0-9a-f]{40}", sha) else None


def record_deploy(repo: Path, path: Path, now: datetime | None = None) -> bool:
    """Append {HEAD, UTC date} to the state file when HEAD differs from the last entry; True when it wrote."""
    sha = head(repo)
    if sha is None:
        return False
    deploys = load_json(path, [])
    if not isinstance(deploys, list):
        deploys = []
    if deploys and deploys[-1].get("hash") == sha:
        return False
    deploys.append({"hash": sha, "date": (now or datetime.now(UTC)).strftime("%Y-%m-%d")})
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(deploys, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return True


def record_startup() -> None:
    """Called at service start: a restart on a new HEAD is a deploy. Never raises."""
    try:
        record_deploy(buildinfo.APP_DIR, state_path())
    except (OSError, ValueError, KeyError, AttributeError):
        pass


def _mtimes(repo: Path, *extra: Path) -> list[float]:
    paths = [*sorted((repo / "docs" / "tasks").glob("task-*.md")), repo / "docs" / "releases-map.json", *extra]
    out = []
    for p in paths:
        try:
            out.append(p.stat().st_mtime_ns)
        except OSError:
            out.append(0)
    return out


def data(repo: Path | None = None, state: Path | None = None) -> dict[str, Any]:
    """The Features payload, cached in memory by HEAD, task file and state file mtimes."""
    repo = repo or buildinfo.APP_DIR
    state = state or state_path()
    key = (str(repo), str(state), head(repo), _mtimes(repo, state))
    with _lock:
        if _cache["key"] == key:
            return _cache["data"]
    payload = build(repo, load_json(state, []), load_json(repo / "docs" / "releases-map.json", {}))
    with _lock:
        _cache["key"], _cache["data"] = key, payload
    return payload
