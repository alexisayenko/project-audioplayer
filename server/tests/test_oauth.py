import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import deps, main, oauth, users

APPLE_AUD = "com.example.app"
GOOGLE_AUD = "client.apps.googleusercontent.com"
OWNER = "alex.isayenko@gmail.com"
OWNER_UID = users.uid_for_email(OWNER)


def put_audio(tmp_path, uid=OWNER_UID):
    d = tmp_path / "users" / uid
    d.mkdir(parents=True, exist_ok=True)
    (d / "dQw4w9WgXcQ.m4a").write_bytes(b"audio")


@pytest.fixture(scope="module")
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def client(key, tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setenv("APPLE_AUDIENCE", APPLE_AUD)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", GOOGLE_AUD)
    monkeypatch.delenv("ALLOWED_EMAIL", raising=False)
    monkeypatch.delenv("ALLOWED_APPLE_SUB", raising=False)
    monkeypatch.setattr(deps, "DOWNLOAD_DIR", tmp_path)
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path / "data")
    fake = SimpleNamespace(get_signing_key_from_jwt=lambda t: SimpleNamespace(key=key.public_key()))
    monkeypatch.setattr(oauth, "_jwks", lambda provider: fake)
    return TestClient(main.app)


def make(key, provider="google", **over):
    claims = {
        "iss": "https://accounts.google.com" if provider == "google" else "https://appleid.apple.com",
        "aud": GOOGLE_AUD if provider == "google" else APPLE_AUD,
        "sub": "123",
        "email": OWNER,
        "email_verified": True,
        "exp": int(time.time()) + 600,
    }
    claims.update(over)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "k1"})


def get(client, token):
    return client.get("/tags", headers={"Authorization": f"Bearer {token}"}).status_code


def test_google_valid(client, key):
    assert get(client, make(key)) == 200


def test_apple_valid_string_verified(client, key):
    assert get(client, make(key, "apple", email_verified="true")) == 200


def test_expired(client, key):
    assert get(client, make(key, exp=int(time.time()) - 600)) == 401


def test_wrong_audience(client, key):
    assert get(client, make(key, aud="other")) == 401


def test_wrong_issuer(client, key):
    assert get(client, make(key, iss="https://evil.example")) == 401


def test_other_verified_email_is_a_new_user_not_the_owner(client, key):
    tok = make(key, email="eve@gmail.com")
    assert get(client, tok) == 200
    assert client.get("/me", headers={"Authorization": f"Bearer {tok}"}).json()["owner"] is False


def test_unverified_email(client, key):
    assert get(client, make(key, email_verified=False)) == 403


def test_bad_signature(client, monkeypatch):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    fake = SimpleNamespace(get_signing_key_from_jwt=lambda t: SimpleNamespace(key=other.public_key()))
    monkeypatch.setattr(oauth, "_jwks", lambda provider: fake)
    assert get(client, make(rsa.generate_private_key(public_exponent=65537, key_size=2048))) == 401


def test_garbage_token(client):
    assert get(client, "not-a-jwt") == 401


def test_unconfigured_audience(client, key, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID")
    assert get(client, make(key)) == 401


def test_apple_sub_pin_maps_to_owner(client, key, monkeypatch, tmp_path):
    tok = make(key, "apple", email="relay@privaterelay.appleid.com", sub="001.abc")
    assert client.get("/me", headers={"Authorization": f"Bearer {tok}"}).json()["owner"] is False
    monkeypatch.setenv("ALLOWED_APPLE_SUB", "001.abc")
    me = client.get("/me", headers={"Authorization": f"Bearer {tok}"}).json()
    assert me["owner"] is True
    assert me["email"] == OWNER


def test_api_token_fallback(client):
    assert client.get("/tags", headers={"X-API-Token": "secret"}).status_code == 200
    assert client.get("/tags", headers={"X-API-Token": "no"}).status_code == 401
    assert client.get("/tags", headers={"X-API-Token": "secret", "Authorization": "Bearer junk"}).status_code == 200


def test_file_get_accepts_bearer_and_query_token(client, key, tmp_path, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "0")
    put_audio(tmp_path)
    url = "/files/dQw4w9WgXcQ"
    assert client.get(url, headers={"Authorization": f"Bearer {make(key)}"}).status_code == 200
    assert client.get(url, params={"token": "secret"}).status_code == 200
    assert client.get(url).status_code == 401


WEB_GOOGLE = "web.apps.googleusercontent.com"
WEB_APPLE = "com.example.web"
CSRF = {"X-Requested-With": "audioplayer"}


@pytest.fixture
def web(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", f"{GOOGLE_AUD}, {WEB_GOOGLE}")
    monkeypatch.setenv("APPLE_AUDIENCE", f"{APPLE_AUD},{WEB_APPLE}")
    monkeypatch.setenv("PUBLIC_VIEW", "0")
    return TestClient(main.app, base_url="https://testserver")


def sign_in(web, key, **over):
    return web.post("/auth/session", json={"id_token": make(key, **over)}, headers=CSRF)


def test_multi_audience(client, key, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", f"{GOOGLE_AUD},{WEB_GOOGLE}")
    monkeypatch.setenv("APPLE_AUDIENCE", f"{APPLE_AUD},{WEB_APPLE}")
    monkeypatch.setenv("PUBLIC_VIEW", "0")
    assert get(client, make(key)) == 200
    assert get(client, make(key, aud=WEB_GOOGLE)) == 200
    assert get(client, make(key, "apple", aud=WEB_APPLE)) == 200
    assert get(client, make(key, aud="other")) == 401


def test_web_client_id_env_is_an_audience(client, key, monkeypatch):
    monkeypatch.setenv("GOOGLE_WEB_CLIENT_ID", WEB_GOOGLE)
    assert get(client, make(key, aud=WEB_GOOGLE)) == 200


def test_auth_config_is_public(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_WEB_CLIENT_ID", WEB_GOOGLE)
    monkeypatch.setenv("APPLE_WEB_CLIENT_ID", WEB_APPLE)
    body = client.get("/auth/config").json()
    assert body["google_client_id"] == WEB_GOOGLE
    assert body["apple_client_id"] == WEB_APPLE
    assert body["apple_redirect"] == "https://testserver/"


def test_session_cookie_flags_and_use(web, key, tmp_path):
    res = sign_in(web, key, aud=WEB_GOOGLE)
    assert res.status_code == 200
    assert res.json()["email"] == OWNER
    cookie = res.headers["set-cookie"]
    for part in ("HttpOnly", "Secure", "SameSite=strict", "Max-Age=43200", "Path=/"):
        assert part.lower() in cookie.lower()
    assert "__Host-session=" in cookie
    assert web.get("/tags").status_code == 200
    assert web.get("/auth/me").json()["email"] == OWNER


def test_cookie_authenticated_file_get_without_token_in_url(web, key, tmp_path):
    put_audio(tmp_path)
    assert web.get("/files/dQw4w9WgXcQ").status_code == 401
    sign_in(web, key)
    res = web.get("/files/dQw4w9WgXcQ")
    assert res.status_code == 200
    assert res.content == b"audio"
    assert "no-cache" in res.headers["cache-control"]


def test_session_rejects_bad_id_token_and_closed_signup(web, key, monkeypatch):
    monkeypatch.setenv("SIGNUP_OPEN", "0")
    res = sign_in(web, key, email="eve@gmail.com")
    assert res.status_code == 403
    assert res.json()["error"] == "signup_closed"
    assert sign_in(web, key, aud="other").status_code == 401
    assert web.post("/auth/session", json={"id_token": "junk"}, headers=CSRF).status_code == 401
    assert web.get("/tags").status_code == 401


def test_tampered_or_expired_cookie_rejected(web, key, monkeypatch):
    from app import session

    sign_in(web, key)
    value = web.cookies.get("__Host-session")
    web.cookies.clear()
    web.cookies.set("__Host-session", value[:-2] + "xx", domain="testserver")
    assert web.get("/tags").status_code == 401
    old = session.issue({"provider": "google", "email": OWNER}, now=time.time() - 2 * session.LIFETIME)
    web.cookies.clear()
    web.cookies.set("__Host-session", old, domain="testserver")
    assert web.get("/tags").status_code == 401


def test_csrf_on_cookie_authenticated_writes(web, key):
    sign_in(web, key)
    assert web.delete("/songs/dQw4w9WgXcQ").status_code == 403
    assert web.delete("/songs/dQw4w9WgXcQ", headers={**CSRF, "Origin": "https://evil.example"}).status_code == 403
    assert web.delete("/songs/dQw4w9WgXcQ", headers={**CSRF, "Origin": "https://testserver"}).status_code == 404
    assert web.delete("/songs/dQw4w9WgXcQ", headers=CSRF).status_code == 404


def test_csrf_not_needed_for_header_auth(web):
    assert web.delete("/songs/dQw4w9WgXcQ", headers={"X-API-Token": "secret"}).status_code == 404


def test_session_and_logout_require_csrf_header(web, key):
    assert web.post("/auth/session", json={"id_token": make(key)}).status_code == 403
    assert web.post("/auth/logout").status_code == 403


def test_logout_clears_cookie(web, key):
    sign_in(web, key)
    res = web.post("/auth/logout", headers=CSRF)
    assert res.status_code == 204
    assert 'max-age=0' in res.headers["set-cookie"].lower()
    assert web.get("/tags").status_code == 401


def test_api_token_fallback_with_session_routes(web, key):
    assert web.get("/tags", headers={"X-API-Token": "secret"}).status_code == 200
    sign_in(web, key)
    assert web.get("/tags", headers={"X-API-Token": "wrong"}).status_code == 401
    assert web.get("/auth/me", headers={"X-API-Token": "secret"}).json()["method"] == "token"


def test_session_secret_signs_cookie(web, key, monkeypatch):
    sign_in(web, key)
    value = web.cookies.get("__Host-session")
    monkeypatch.setenv("AUDIO_SESSION_SECRET", "another-secret")
    assert web.get("/tags").status_code == 401
    web.cookies.clear()
    sign_in(web, key)
    assert web.get("/tags").status_code == 200
    monkeypatch.delenv("AUDIO_SESSION_SECRET")
    assert web.get("/tags").status_code == 401
    assert value


def test_api_responses_are_not_cached(web):
    assert web.get("/tags", headers={"X-API-Token": "secret"}).headers["cache-control"] == "private, no-cache"
    assert web.get("/auth/config").headers["cache-control"] == "no-store"


def test_apple_token_with_only_apple_configured(client, key, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID")
    assert get(client, make(key, "apple")) == 200


def test_google_token_with_only_google_configured(client, key, monkeypatch):
    monkeypatch.delenv("APPLE_AUDIENCE")
    assert get(client, make(key)) == 200


def test_tampered_signature(client, key):
    head, body, sig = make(key).split(".")
    flipped = ("A" if sig[0] != "A" else "B") + sig[1:]
    assert get(client, ".".join([head, body, flipped])) == 401


def test_unverified_claims_are_not_decoded(client, key, monkeypatch):
    real = jwt.decode

    def guard(token, *a, **kw):
        assert (kw.get("options") or {}).get("verify_signature", True) is not False
        return real(token, *a, **kw)

    monkeypatch.setattr(oauth.jwt, "decode", guard)
    assert get(client, make(key, "apple")) == 200
