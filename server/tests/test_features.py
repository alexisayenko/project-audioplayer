import json
import os
import subprocess
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import buildinfo, deps, features as gf, main


TASKS = {
    "task-0061": {"id": "task-0061", "title": "Expandable Help menu in the sidebar", "status": "in progress", "tags": ["web"]},
    "task-0062": {"id": "task-0062", "title": "Info popovers on the title line", "status": "done", "tags": []},
}


def commit(sha, day, subject, body="", files=(), hour=12):
    ts = int(datetime(2026, 10, day, hour, tzinfo=timezone.utc).timestamp())
    return {"sha": sha * 40 if len(sha) == 1 else sha, "date": f"2026-10-{day:02d}", "ts": ts, "subject": subject, "body": body, "files": list(files)}


def test_clean_subject_filters_types_and_strips_prefix():
    assert gf.clean_subject("feat(web): help menu in the sidebar") == "Help menu in the sidebar"
    for s in ("fix: crash on empty queue", "perf(web)!: faster start", "refactor: tidy", "fix(web): x"):
        assert gf.clean_subject(s) is None, s
    assert gf.clean_subject("feat(web)!: faster start") == "Faster start"
    for s in ("docs(tasks): task-0067", "chore: bump", "test: add", "style: x", "Merge branch main", "no prefix at all", "Revert feat: x", "feat: "):
        assert gf.clean_subject(s) is None


def test_clean_subject_trims_at_a_word_boundary():
    out = gf.clean_subject("feat: " + "word " * 40)
    assert out.endswith("word...") and len(out) <= 114


def test_by_day_groups_by_utc_day_with_last_commit_hash():
    commits = [commit("a", 19, "feat: first", hour=9), commit("b", 19, "feat: second", hour=18), commit("c", 20, "feat: third"), commit("d", 20, "docs: only docs", hour=20)]
    out = gf.by_day(commits, {}, {})
    by_date = {r["date"]: r for r in out}
    assert by_date["2026-10-19"]["hash"] == "bbbbbbb" and by_date["2026-10-19"]["full"] == "b" * 40
    assert [i["text"] for i in by_date["2026-10-19"]["items"]] == ["Second", "First"]
    assert by_date["2026-10-20"]["hash"] == "ddddddd"


def test_day_without_feature_commits_makes_no_release():
    assert gf.by_day([commit("a", 19, "docs: x"), commit("b", 19, "chore: y")], {}, {}) == []
    assert gf.by_day([], {}, {}) == []


def test_utc_day_boundary():
    assert gf.utc_day(int(datetime(2026, 10, 19, 23, 59, tzinfo=timezone.utc).timestamp())) == "2026-10-19"
    assert gf.utc_day(int(datetime(2026, 10, 20, 0, 1, tzinfo=timezone.utc).timestamp())) == "2026-10-20"


def test_more_than_twelve_items_are_summarised():
    commits = [commit("a", 19, f"feat: thing {i}", hour=1) for i in range(15)]
    for i, c in enumerate(commits):
        c["ts"] += i
    items = gf.by_day(commits, {}, {})[0]["items"]
    assert len(items) == 13 and items[-1] == {"text": "and 3 more", "task": None}


def test_task_link_from_message_subject_and_body():
    assert gf.task_of(commit("a", 19, "feat: x task-0061"), TASKS, [], {}) == "task-0061"
    assert gf.task_of(commit("a", 19, "feat: x", body="Refs task-0062."), TASKS, [], {}) == "task-0062"
    assert gf.task_of(commit("a", 19, "feat: x task-0999"), TASKS, [], {}) is None


def test_task_link_from_touched_task_file_needs_title_overlap():
    c = commit("a", 19, "feat(web): sidebar help menu", files=["docs/tasks/task-0061.md", "docs/tasks/task-0062.md"])
    assert gf.task_of(c, TASKS, c["files"], {}) == "task-0061"
    other = commit("b", 19, "feat: unrelated thing", files=["docs/tasks/task-0061.md"])
    assert gf.task_of(other, TASKS, other["files"], {}) is None


def test_task_link_from_release_files_needs_two_words():
    c = commit("a", 19, "feat: expandable help menu")
    assert gf.task_of(c, TASKS, ["docs/tasks/task-0061.md"], {}) == "task-0061"
    weak = commit("b", 19, "feat: help only")
    assert gf.task_of(weak, TASKS, ["docs/tasks/task-0061.md"], {}) is None


def test_map_file_by_keyword_prefix_and_explicit_none():
    rmap = {"popovers": "task-0062", "abc": "task-0061", "nothing here": None}
    assert gf.task_of(commit("z", 19, "feat: Song title popovers"), TASKS, [], rmap) == "task-0062"
    assert gf.task_of(commit("abcdef", 19, "feat: other"), TASKS, [], rmap) == "task-0061"
    c = commit("z", 19, "feat: nothing here", files=["docs/tasks/task-0061.md"])
    assert gf.task_of(c, TASKS, c["files"], rmap) is None


def test_by_deploys_uses_ranges_and_skips_empty_ones():
    h1, h2, h3 = "1" * 40, "2" * 40, "3" * 40
    ranges = {(None, h1): [commit("a", 19, "feat: one")], (h1, h2): [commit("b", 20, "docs: nope")], (h2, h3): [commit("c", 20, "feat: three")]}
    deploys = [{"hash": h1, "date": "2026-10-19"}, {"hash": h2, "date": "2026-10-20"}, {"hash": h3, "date": "2026-10-20"}]
    out = gf.by_deploys(lambda p, h: ranges[(p, h)], deploys, {}, {})
    assert [(r["hash"], r["date"]) for r in out] == [("1111111", "2026-10-19"), ("3333333", "2026-10-20")]


def test_planned_from_front_matter_newest_first(tmp_path):
    def task(n, status, tags="[web, nav]"):
        (tmp_path / f"task-{n:04d}.md").write_text(f'---\ntask_id: task-{n:04d}\ntitle: "Title {n}"\nstatus: {status}\ntags: {tags}\n---\n\n# x\n', encoding="utf-8")

    task(1, "done")
    task(2, "to do")
    task(3, "to do (waiting for a design)")
    task(10, "in progress")
    task(11, "in progress (iOS done 2026-10-13, web open)")
    task(5, "proposal")
    task(6, "obsolete")
    task(8, "deferred")
    task(7, "blocked", "[]")
    tasks = gf.read_tasks(tmp_path)
    assert [r["id"] for r in gf.planned(tasks)] == ["task-0003", "task-0002"]
    rows = gf.in_progress(tasks)
    assert [r["id"] for r in rows] == ["task-0011", "task-0010"]
    assert rows[1] == {"id": "task-0010", "title": "Title 10", "status": "in progress", "tags": ["web", "nav"]}
    assert rows[0]["status"] == "in progress"


def run(cwd, *args, env=None):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True, capture_output=True, text=True, env={**os.environ, **(env or {})}).stdout


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    (repo / "docs" / "tasks").mkdir(parents=True)
    run(tmp_path, "init", "-q", str(repo))
    (repo / "docs" / "tasks" / "task-0001.md").write_text("---\ntask_id: task-0001\ntitle: Sidebar help\nstatus: to do\ntags: [web]\n---\n", encoding="utf-8")
    for day, subject in ((18, "feat: old thing"), (19, "feat: sidebar help menu task-0001"), (19, "docs: words")):
        (repo / "f.txt").write_text(subject)
        run(repo, "add", "-A")
        stamp = f"2026-10-{day}T12:00:00Z"
        run(repo, "commit", "-q", "-m", subject, env={"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp})
    return repo


def head(repo):
    return run(repo, "rev-parse", "HEAD").strip()


def add_commit(repo, name, subject):
    (repo / name).write_text(subject)
    run(repo, "add", name)
    run(repo, "commit", "-q", "-m", subject)


def test_build_backfills_then_uses_recorded_deploys(tmp_path):
    repo = make_repo(tmp_path)
    data = gf.build(repo, [], {})
    assert [r["date"] for r in data["releases"]] == ["2026-10-19", "2026-10-18"]
    assert data["releases"][0]["items"] == [{"text": "Sidebar help menu task-0001", "task": "task-0001"}]
    assert [p["id"] for p in data["planned"]] == ["task-0001"] and data["unavailable"] is False
    first = {"hash": head(repo), "date": "2026-10-19"}
    add_commit(repo, "g.txt", "feat: after the deploy")
    second = {"hash": head(repo), "date": "2026-10-21"}
    out = gf.build(repo, [first, second], {})["releases"]
    assert [(r["date"], r["hash"]) for r in out] == [("2026-10-21", second["hash"][:7]), ("2026-10-19", first["hash"][:7]), ("2026-10-18", out[2]["hash"])]
    assert out[0]["items"] == [{"text": "After the deploy", "task": None}]


def test_empty_history_and_missing_git_are_unavailable_not_errors(tmp_path):
    empty = tmp_path / "empty"
    (empty / "docs" / "tasks").mkdir(parents=True)
    run(tmp_path, "init", "-q", str(empty))
    assert gf.build(empty, [], {})["releases"] == []
    nogit = tmp_path / "nogit"
    (nogit / "docs" / "tasks").mkdir(parents=True)
    (nogit / "docs" / "tasks" / "task-0003.md").write_text("---\ntask_id: task-0003\ntitle: T\nstatus: to do\n---\n", encoding="utf-8")
    out = gf.build(nogit, [], {})
    assert out["unavailable"] is True and out["releases"] == [] and [p["id"] for p in out["planned"]] == ["task-0003"]


def test_unknown_recorded_hash_falls_back_to_days(tmp_path):
    repo = make_repo(tmp_path)
    out = gf.build(repo, [{"hash": "f" * 40, "date": "2026-10-19"}], {})
    assert [r["date"] for r in out["releases"]] == ["2026-10-19", "2026-10-18"]


def test_record_deploy_appends_once_per_head(tmp_path):
    repo = make_repo(tmp_path)
    state = tmp_path / "st" / "_state" / "deploys.json"
    now = datetime(2026, 10, 21, 23, 59, tzinfo=timezone.utc)
    assert gf.record_deploy(repo, state, now) is True
    assert gf.record_deploy(repo, state, now) is False
    assert json.loads(state.read_text()) == [{"hash": head(repo), "date": "2026-10-21"}]
    add_commit(repo, "h.txt", "feat: more")
    assert gf.record_deploy(repo, state, now) is True
    assert [d["hash"] for d in json.loads(state.read_text())][-1] == head(repo) and len(json.loads(state.read_text())) == 2


def test_record_deploy_without_git_does_nothing(tmp_path):
    assert gf.record_deploy(tmp_path / "none", tmp_path / "s.json") is False
    assert not (tmp_path / "s.json").exists()


def test_state_path_is_outside_the_synced_tree(tmp_path, monkeypatch):
    monkeypatch.setattr(deps, "SYNC", None)
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path)
    assert gf.state_path() == tmp_path / "_state" / "deploys.json"


RECORD_STARTUP = gf.record_startup


def test_startup_records_the_deploy(tmp_path, monkeypatch):
    repo = make_repo(tmp_path)
    monkeypatch.setattr(buildinfo, "APP_DIR", repo)
    monkeypatch.setattr(deps, "SYNC", None)
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path / "data")
    RECORD_STARTUP()
    RECORD_STARTUP()
    assert len(json.loads((tmp_path / "data" / "_state" / "deploys.json").read_text())) == 1


@pytest.fixture
def served(tmp_path, monkeypatch):
    repo = make_repo(tmp_path)
    monkeypatch.setattr(buildinfo, "APP_DIR", repo)
    monkeypatch.setattr(deps, "SYNC", None)
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path / "data")
    gf._cache.update(key=None, data=None)
    return repo, TestClient(main.app)


def test_route_is_public_with_shape_and_no_cache(served):
    repo, client = served
    r = client.get("/features/data")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"
    body = r.json()
    assert set(body) == {"releases", "planned", "in_progress", "unavailable"} and body["unavailable"] is False
    assert body["releases"][0]["date"] == "2026-10-19" and len(body["releases"][0]["full"]) == 40
    assert body["planned"] == [{"id": "task-0001", "title": "Sidebar help", "status": "to do", "tags": ["web"]}]


def test_route_cache_follows_head(served):
    repo, client = served
    first = client.get("/features/data").json()
    assert client.get("/features/data").json() == first
    add_commit(repo, "n.txt", "feat: brand new thing")
    after = client.get("/features/data").json()
    assert any(i["text"] == "Brand new thing" for r in after["releases"] for i in r["items"])


def test_route_cache_follows_task_files(served):
    repo, client = served
    client.get("/features/data")
    (repo / "docs" / "tasks" / "task-0009.md").write_text("---\ntask_id: task-0009\ntitle: Fresh\nstatus: in progress\n---\n", encoding="utf-8")
    body = client.get("/features/data").json()
    assert [p["id"] for p in body["in_progress"]] == ["task-0009"] and [p["id"] for p in body["planned"]] == ["task-0001"]


def test_data_scope_and_removal_subjects_are_skipped():
    for s in ("fix(data): remove dub from Gogol Bordello - Immigraniada", "feat(data): approved removals applied", "feat(genres): remove epic as a genre",
              "fix: Fix the genres of After Dark", "fix: Remove five more wrong genres", "feat: add rock genre to Song X", "feat: Genre data: lots"):
        assert gf.clean_subject(s) is None, s


def test_combined_subject_is_split_on_semicolons_and_filtered():
    s = "feat(genres): hardcore is a modifier and the node is hardcore techno; Ace of Base removal; remaster stays plain text"
    assert gf.clean_subject(s) == "Hardcore is a modifier and the node is hardcore techno; remaster stays plain text"
    assert gf.clean_subject("feat: Ace of Base removal; wrong genres fixed") is None


def test_clause_without_a_data_word_is_kept():
    assert gf.clean_subject("feat(web): removal of a song from the queue is undoable") == "Removal of a song from the queue is undoable"


def test_release_with_only_data_edits_is_omitted():
    commits = [commit("a", 19, "fix(data): remove dub from X"), commit("b", 19, "feat: remove epic as a genre")]
    assert gf.by_day(commits, {}, {}) == []


def test_exclude_patterns_come_from_the_map_file():
    assert gf.clean_subject("feat: shiny new widget", ["shiny"]) is None
    assert gf.clean_subject("feat: remove genre of song", ["shiny"]) == "Remove genre of song"
    out = gf.by_day([commit("a", 19, "feat: shiny new widget"), commit("b", 19, "feat: other thing")], {}, {"exclude": ["shiny"]})
    assert [i["text"] for i in out[0]["items"]] == ["Other thing"]


def test_reviewed_extra_subject_is_excluded():
    assert gf.clean_subject("feat: Add Soviet Wave as a reviewed extra under synthwave") is None


def test_vocabulary_rows_subject_is_excluded():
    assert gf.clean_subject("feat: List spacesynth under synthwave in the vocabulary rows, test the served payload") is None


def test_same_day_releases_newest_first_without_duplicates(tmp_path):
    repo = make_repo(tmp_path)
    first = head(repo)
    add_commit(repo, "a1.txt", "feat: second deploy feature")
    second = head(repo)
    add_commit(repo, "a2.txt", "feat: third deploy feature")
    third = head(repo)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    deploys = [{"hash": first, "date": "2026-10-19"}, {"hash": second, "date": today}, {"hash": third, "date": today}]
    out = gf.build(repo, deploys, {})["releases"]
    assert [r["full"] for r in out[:3]] == [third, second, first]
    assert out[0]["date"] == out[1]["date"] == today
    texts = [i["text"] for r in out for i in r["items"]]
    assert len(texts) == len(set(texts))
    assert out[-1]["date"] == "2026-10-18"


def test_backfilled_days_sort_by_last_commit_time():
    commits = [commit("a", 20, "feat: later", hour=1), commit("b", 19, "feat: earlier", hour=23), commit("c", 20, "feat: latest", hour=22)]
    assert [r["date"] for r in gf.by_day(commits, {}, {})] == ["2026-10-20", "2026-10-19"]


def test_release_with_only_fix_and_perf_commits_is_omitted_but_anchors_the_range():
    commits = [commit("a", 19, "fix: crash"), commit("b", 19, "perf: faster")]
    assert gf.by_day(commits, {}, {}) == []
    h1, h2 = "1" * 40, "2" * 40
    ranges = {(None, h1): [commit("c", 19, "feat: one")], (h1, h2): commits}
    deploys = [{"hash": h1, "date": "2026-10-19"}, {"hash": h2, "date": "2026-10-20"}]
    assert [r["hash"] for r in gf.by_deploys(lambda p, h: ranges[(p, h)], deploys, {}, {})] == ["1111111"]
