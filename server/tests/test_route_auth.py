import os
import re

import pytest
from fastapi.routing import APIRoute

from app import anon, guest, main
from tests.test_guest import lib, web  # noqa: F401
from tests.test_library import VID, client  # noqa: F401
from tests.test_users import CSRF

PUBLIC = {
    ("GET", "/auth/config"),
    ("POST", "/auth/session"),
    ("POST", "/auth/logout"),
    ("POST", "/anon/session"),
    ("GET", "/health"),
    ("GET", "/version"),
    ("GET", "/features/data"),
    ("GET", "/legal"),
    ("GET", "/robots.txt"),
    ("GET", "/"),
    ("GET", "/index.html"),
    ("GET", "/_v/{version}/{path:path}"),
}
GUEST_READABLE = {
    ("GET", "/library"),
    ("GET", "/tags"),
    ("GET", "/genres/graph"),
    ("GET", "/genres/vocabulary"),
    ("GET", "/genres/v2"),
    ("GET", "/catalog"),
    ("GET", "/files/{video_id}"),
    ("GET", "/covers/{video_id}"),
    ("GET", "/songs/{video_id}/peaks"),
    ("GET", "/me"),
}
ANON_ROUTES = {
    ("POST", "/anon/downloads"),
    ("GET", "/anon/downloads/{job_id}"),
    ("GET", "/anon/downloads/{job_id}/file"),
    ("GET", "/anon/downloads/{job_id}/cover"),
    ("POST", "/anon/downloads/{job_id}/ack"),
}
AUTH = {"require_token", "require_token_or_query"}
GUEST_AUTH = {"read_user"}
ANON_AUTH = {"require_anon"}


def _calls(dependant):
    for sub in dependant.dependencies:
        yield sub.call.__name__
        yield from _calls(sub)


def _routes(names):
    found = set()
    for route in main.app.routes:
        if isinstance(route, APIRoute) and not names.isdisjoint(_calls(route.dependant)):
            found |= {(m, route.path) for m in route.methods - {"HEAD"}}
    return found


def test_every_api_route_requires_auth_except_the_public_ones():
    open_routes = set()
    for route in main.app.routes:
        if not isinstance(route, APIRoute):
            continue
        if (AUTH | GUEST_AUTH | ANON_AUTH).isdisjoint(_calls(route.dependant)):
            open_routes |= {(m, route.path) for m in route.methods - {"HEAD"}}
    assert open_routes - PUBLIC == set()


def test_only_the_fixed_read_only_allow_list_is_open_to_guests():
    assert _routes(GUEST_AUTH) == GUEST_READABLE
    assert all(method == "GET" for method, _ in GUEST_READABLE)
    assert _routes(AUTH).isdisjoint(GUEST_READABLE)


def test_new_routes_are_protected():
    paths = {(m, r.path) for r in main.app.routes if isinstance(r, APIRoute) for m in r.methods}
    assert ("GET", "/genres/graph") in paths
    assert ("GET", "/songs/{video_id}/identify") in paths


def test_draft_routes_need_credentials_and_are_not_guest_readable():
    drafts = {(m, r.path) for r in main.app.routes if isinstance(r, APIRoute) and r.path.startswith("/drafts") for m in r.methods - {"HEAD"}}
    assert drafts == {
        ("GET", "/drafts"), ("POST", "/drafts"), ("DELETE", "/drafts"),
        ("PATCH", "/drafts/{draft_id}"), ("DELETE", "/drafts/{draft_id}"), ("POST", "/drafts/{draft_id}/refresh"),
    }
    assert drafts <= _routes({"require_token"})
    assert drafts.isdisjoint(_routes(GUEST_AUTH))
    assert not any(p.startswith("/drafts") for _, p in GUEST_READABLE)


def test_listening_routes_need_credentials_and_are_not_guest_readable():
    plays = {(m, r.path) for r in main.app.routes if isinstance(r, APIRoute) and r.path in ("/plays", "/stats/listening") for m in r.methods - {"HEAD"}}
    assert plays == {("POST", "/plays"), ("GET", "/stats/listening")}
    assert plays <= _routes({"require_token"})
    assert plays.isdisjoint(_routes(GUEST_AUTH))


def _anonymous_data_routes():
    return sorted({
        (m, r.path) for r in main.app.routes if isinstance(r, APIRoute) for m in r.methods - {"HEAD"}
    } - PUBLIC)


@pytest.mark.parametrize(("method", "path"), _anonymous_data_routes())
def test_public_view_defaults_to_off_so_every_data_route_is_401_for_anonymous(lib, method, path):
    assert "PUBLIC_VIEW" not in os.environ
    assert guest.enabled() is False
    url = re.sub(r"\{[^}]+\}", VID, path)
    r = web().request(method, url, json={} if method in ("POST", "PUT", "PATCH") else None, headers=CSRF)
    assert r.status_code == 401, (method, path, r.status_code)


@pytest.mark.parametrize("value", ["", "0", "false", "off", "no", "banana"])
def test_only_an_explicit_yes_enables_the_public_view(monkeypatch, value):
    monkeypatch.setenv("PUBLIC_VIEW", value)
    assert guest.enabled() is False


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", " ON "])
def test_the_public_view_can_still_be_enabled_explicitly(monkeypatch, value):
    monkeypatch.setenv("PUBLIC_VIEW", value)
    assert guest.enabled() is True


def test_the_anonymous_web_shell_and_health_stay_open_with_the_view_off(lib):
    anon = web()
    for path in ("/health", "/version", "/auth/config", "/legal", "/robots.txt"):
        assert anon.get(path).status_code == 200, path
    assert anon.get("/").status_code == 200


def test_only_the_fixed_anonymous_download_routes_take_an_anonymous_token():
    assert _routes(ANON_AUTH) == ANON_ROUTES
    assert _routes(ANON_AUTH).isdisjoint(_routes(AUTH | GUEST_AUTH))
    assert {(m, p) for m, p in _anonymous_data_routes() if p.startswith("/anon")} == ANON_ROUTES


@pytest.mark.parametrize(("method", "path"), [r for r in _anonymous_data_routes() if not r[1].startswith("/anon")])
def test_an_anonymous_token_opens_no_route_outside_anon(lib, method, path):
    token = anon.issue()[0]
    url = re.sub(r"\{[^}]+\}", VID, path)
    r = web().request(method, url, json={} if method in ("POST", "PUT", "PATCH") else None, headers={**CSRF, "X-Anon-Token": token})
    assert r.status_code == 401, (method, path, r.status_code)
