from fastapi.routing import APIRoute

from app import main  # noqa: F401

PUBLIC = {
    ("GET", "/auth/config"),
    ("POST", "/auth/session"),
    ("POST", "/auth/logout"),
    ("GET", "/health"),
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
    ("GET", "/catalog"),
    ("GET", "/files/{video_id}"),
    ("GET", "/covers/{video_id}"),
    ("GET", "/me"),
}
AUTH = {"require_token", "require_token_or_query"}
GUEST_AUTH = {"read_user"}


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
        if (AUTH | GUEST_AUTH).isdisjoint(_calls(route.dependant)):
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
