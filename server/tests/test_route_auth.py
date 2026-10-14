from fastapi.routing import APIRoute

from app import main  # noqa: F401

PUBLIC = {
    ("GET", "/auth/config"),
    ("POST", "/auth/session"),
    ("POST", "/auth/logout"),
    ("GET", "/health"),
    ("GET", "/"),
    ("GET", "/index.html"),
    ("GET", "/_v/{version}/{path:path}"),
}
AUTH = {"require_token", "require_token_or_query"}


def _calls(dependant):
    for sub in dependant.dependencies:
        yield sub.call.__name__
        yield from _calls(sub)


def test_every_api_route_requires_auth_except_the_public_ones():
    open_routes = set()
    for route in main.app.routes:
        if not isinstance(route, APIRoute):
            continue
        if AUTH.isdisjoint(_calls(route.dependant)):
            open_routes |= {(m, route.path) for m in route.methods - {"HEAD"}}
    assert open_routes - PUBLIC == set()


def test_new_routes_are_protected():
    paths = {(m, r.path) for r in main.app.routes if isinstance(r, APIRoute) for m in r.methods}
    assert ("GET", "/genres/graph") in paths
    assert ("GET", "/songs/{video_id}/identify") in paths
