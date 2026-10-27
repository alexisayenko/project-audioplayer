import pytest

from app.problems import error_code
from tests.test_library import H, VID, client  # noqa: F401


def test_a_refusal_with_a_message_gains_a_status_code(client):
    r = client.patch("/songs/not-an-id", json={"title": "T"}, headers=H)
    assert r.status_code == 422
    assert r.json() == {"error": "unprocessable", "detail": "invalid video id"}


def test_a_refusal_whose_detail_is_a_code_keeps_it_as_the_error(client):
    r = client.post("/albums/from-video/preview", json={"url": "https://www.youtube.com/playlist?list=PL123456789012345"}, headers=H)
    assert r.status_code == 400
    assert r.json()["error"] == r.json()["detail"] == "bad_url"


def test_not_found_and_bad_token_stay_a_bare_detail(client):
    missing = client.delete(f"/songs/{VID}", headers=H)
    assert missing.status_code == 404
    assert missing.json() == {"detail": "unknown song"}
    unknown_route = client.get("/no-such-route", headers=H)
    assert unknown_route.status_code == 404
    assert unknown_route.json() == {"detail": "Not Found"}
    bad = client.get("/library", headers={"X-API-Token": "wrong"})
    assert bad.status_code == 401
    assert bad.json() == {"detail": "bad token"}


def test_validation_errors_keep_the_detail_list(client):
    r = client.patch(f"/songs/{VID}", json={"title": 5}, headers=H)
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)
    assert "error" not in r.json()


def test_a_coded_problem_is_unchanged(client):
    r = client.post("/preview", json={"url": "https://example.com/x"}, headers=H)
    assert r.status_code == 422
    assert r.json()["error"] == "unsupported"


@pytest.mark.parametrize("status,detail,want", [
    (409, {"code": "already_exists", "id": "x"}, "already_exists"),
    (409, {"code": "bad_field", "key": "source"}, "bad_field"),
    (409, "album_limit", "album_limit"),
    (409, "already in library", "conflict"),
    (502, "download failed: boom", "bad_gateway"),
    (503, "AUDIO_API_TOKEN is not set", "service_unavailable"),
    (405, "Method Not Allowed", "method_not_allowed"),
    (418, "I'm a teapot", "error"),
    (401, "bad token", None),
    (403, "csrf", None),
    (404, "not_found", None),
    (429, "slow down", None),
])
def test_error_code(status, detail, want):
    assert error_code(status, detail) == want
