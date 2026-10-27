import threading

import pytest

from app import backgroundjob
from app.problems import Problem

RUNNING = ("x_running", "Already running.")
BUSY = ("x_busy", "Busy.")


def runner(ids, work):
    return backgroundjob.Runner("test job", ("hit", "miss"), lambda uid: list(ids), work)


def join(r, uid):
    thread = r.jobs[uid].thread
    thread.join(5)
    assert not thread.is_alive()
    return r.jobs[uid]


def test_idle_status_lists_every_counter_in_order():
    r = runner(["a", "b"], lambda job, ids: None)
    assert r.status("u") == {"state": "idle", "candidates": 2, "total": 0, "hit": 0, "miss": 0, "started_at": None, "finished_at": None}
    assert list(r.status("u")) == ["state", "candidates", "total", "hit", "miss", "started_at", "finished_at"]


def test_a_finished_job_reports_its_counters():
    def work(job, ids):
        job.hit += len(ids)

    r = runner(["a", "b"], work)
    assert r.start("u")[0] == "started"
    job = join(r, "u")
    assert job.state == "done"
    status = r.status("u")
    assert (status["total"], status["hit"], status["miss"]) == (2, 2, 0)
    assert status["finished_at"] is not None
    assert "last_error" not in status


def test_nothing_to_do_starts_no_job():
    r = runner([], lambda job, ids: None)
    kind, state = r.start("u")
    assert (kind, state["state"]) == ("nothing", "idle")
    assert r.jobs == {}


def test_a_crash_is_reported_and_frees_the_slot():
    def work(job, ids):
        raise RuntimeError("disk")

    r = runner(["a"], work)
    r.start("u")
    assert join(r, "u").state == "error"
    assert r.status("u")["last_error"] == "disk"
    assert r.start("u")[0] == "started"
    join(r, "u")


def test_one_job_at_a_time_server_wide_and_cancel():
    gate, seen = threading.Event(), threading.Event()

    def work(job, ids):
        seen.set()
        job.cancel.wait(5)
        gate.set()

    r = runner(["a"], work)
    r.start("u")
    assert seen.wait(5)
    assert r.start("u") == ("running", None)
    assert r.start("other") == ("busy", None)
    assert r.cancel("u")["state"] == "running"
    assert gate.wait(5)
    assert join(r, "u").state == "cancelled"
    r.reset()
    assert r.jobs == {}


def test_start_reply_maps_each_outcome():
    state = {"state": "running"}
    assert backgroundjob.start_reply("started", state, RUNNING, BUSY) is state
    nothing = backgroundjob.start_reply("nothing", state, RUNNING, BUSY)
    assert nothing.status_code == 200
    for kind, code in (("running", "x_running"), ("busy", "x_busy")):
        with pytest.raises(Problem) as exc:
            backgroundjob.start_reply(kind, None, RUNNING, BUSY)
        assert (exc.value.status, exc.value.code) == (409, code)
