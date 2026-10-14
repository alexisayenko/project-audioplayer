import pytest
from fastapi.testclient import TestClient

from app import hosts, main, session

CSRF = {session.CSRF_HEADER: session.CSRF_VALUE}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in ("PUBLIC_HOSTS", "CANONICAL_HOST", "OAUTH_REDIRECT_URIS", "APPLE_WEB_REDIRECT_URI"):
        monkeypatch.delenv(name, raising=False)


def client(peer="203.0.113.9"):
    async def app(scope, receive, send):
        if scope["type"] == "http":
            scope = {**scope, "client": (peer, 5000)}
        await main.app(scope, receive, send)

    return TestClient(app, base_url="https://play.isayenko.net", follow_redirects=False)


def test_unset_means_no_redirect():
    r = client().get("/health", headers={"host": "play.isayenko.net"})
    assert r.status_code == 200
    assert client().get("/auth/config").status_code == 200


def test_get_and_head_redirect_keep_path_and_query(monkeypatch):
    monkeypatch.setenv("CANONICAL_HOST", "electrophone.cc")
    r = client().get("/library?a=1&b=x%20y")
    assert r.status_code == 308
    assert r.headers["location"] == "https://electrophone.cc/library?a=1&b=x%20y"
    assert client().head("/").status_code == 308


def test_canonical_host_not_redirected(monkeypatch):
    monkeypatch.setenv("CANONICAL_HOST", "electrophone.cc")
    assert client().get("/auth/config", headers={"host": "electrophone.cc"}).status_code == 200


def test_health_and_writes_exempt(monkeypatch):
    monkeypatch.setenv("CANONICAL_HOST", "electrophone.cc")
    assert client().get("/health").status_code == 200
    assert client().post("/auth/logout", headers=CSRF).status_code == 204
    assert client().delete("/library/x").status_code != 308
    assert client().patch("/library/x", json={}).status_code != 308


def test_forwarded_host_ignored_from_untrusted_peer(monkeypatch):
    monkeypatch.setenv("CANONICAL_HOST", "electrophone.cc")
    r = client().get("/auth/config", headers={"x-forwarded-host": "electrophone.cc"})
    assert r.status_code == 308


def test_forwarded_host_honoured_from_loopback(monkeypatch):
    monkeypatch.setenv("CANONICAL_HOST", "electrophone.cc")
    r = client("127.0.0.1").get("/auth/config", headers={"x-forwarded-host": "electrophone.cc"})
    assert r.status_code == 200


def test_invalid_canonical_is_ignored(monkeypatch):
    monkeypatch.setenv("CANONICAL_HOST", "evil.com/path?x=1")
    assert client().get("/auth/config").status_code == 200


def test_public_hosts_validation(monkeypatch):
    monkeypatch.setenv("PUBLIC_HOSTS", " Play.Isayenko.net, electrophone.cc ,bad host,,x/y,-a.com")
    assert hosts.public_hosts() == ["play.isayenko.net", "electrophone.cc"]


def test_apple_redirect_follows_host_by_default():
    assert client().get("/auth/config").json()["apple_redirect"] == "https://play.isayenko.net/"
    r = client().get("/auth/config", headers={"host": "electrophone.cc"})
    assert r.json()["apple_redirect"] == "https://electrophone.cc/"


def test_unknown_host_never_leaks_into_redirect_uri(monkeypatch):
    monkeypatch.setenv("PUBLIC_HOSTS", "play.isayenko.net,electrophone.cc")
    monkeypatch.setenv("CANONICAL_HOST", "electrophone.cc")
    cfg = client("127.0.0.1").get("/auth/config", headers={"host": "evil.example", "x-forwarded-host": "evil.example"})
    assert cfg.status_code == 308 or cfg.json()["apple_redirect"] == "https://electrophone.cc/"
    monkeypatch.delenv("CANONICAL_HOST")
    cfg = client().get("/auth/config", headers={"host": "evil.example"})
    assert cfg.json()["apple_redirect"] == "https://play.isayenko.net/"


def test_explicit_redirect_uris(monkeypatch):
    monkeypatch.setenv("OAUTH_REDIRECT_URIS", "https://play.isayenko.net/,https://electrophone.cc/cb")
    assert client().get("/auth/config", headers={"host": "electrophone.cc"}).json()["apple_redirect"] == "https://electrophone.cc/cb"
    assert client().get("/auth/config", headers={"host": "evil.example"}).json()["apple_redirect"] == "https://play.isayenko.net/"


def test_explicit_single_redirect_uri_still_wins(monkeypatch):
    monkeypatch.setenv("APPLE_WEB_REDIRECT_URI", "https://play.example.com/")
    assert client().get("/auth/config").json()["apple_redirect"] == "https://play.example.com/"


def test_cookie_scope_unchanged_host_only(monkeypatch):
    from app.routes import auth
    assert auth._COOKIE_FLAGS == {"path": "/", "httponly": True, "secure": True, "samesite": "strict"}
    out = client().post("/auth/logout", headers=CSRF)
    assert "domain" not in out.headers["set-cookie"].lower()


def test_csrf_origin_must_match_each_host():
    assert session.csrf_ok({**CSRF, "origin": "https://electrophone.cc"}, "electrophone.cc")
    assert not session.csrf_ok({**CSRF, "origin": "https://electrophone.cc"}, "play.isayenko.net")
