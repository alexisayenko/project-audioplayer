import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import main, oauth

APPLE_AUD = "com.example.app"
GOOGLE_AUD = "client.apps.googleusercontent.com"
OWNER = "alex.isayenko@gmail.com"


@pytest.fixture(scope="module")
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture()
def client(key, tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setenv("APPLE_AUDIENCE", APPLE_AUD)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", GOOGLE_AUD)
    monkeypatch.delenv("ALLOWED_EMAIL", raising=False)
    monkeypatch.delenv("ALLOWED_APPLE_SUB", raising=False)
    monkeypatch.setattr(main, "DOWNLOAD_DIR", tmp_path)
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


def test_wrong_email(client, key):
    assert get(client, make(key, email="eve@gmail.com")) == 403


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


def test_apple_sub_pin(client, key, monkeypatch):
    tok = make(key, "apple", email="relay@privaterelay.appleid.com", sub="001.abc")
    assert get(client, tok) == 403
    monkeypatch.setenv("ALLOWED_APPLE_SUB", "001.abc")
    assert get(client, tok) == 200


def test_api_token_fallback(client):
    assert client.get("/tags", headers={"X-API-Token": "secret"}).status_code == 200
    assert client.get("/tags", headers={"X-API-Token": "no"}).status_code == 401
    assert client.get("/tags", headers={"X-API-Token": "secret", "Authorization": "Bearer junk"}).status_code == 200


def test_file_get_accepts_bearer_and_query_token(client, key, tmp_path):
    (tmp_path / "dQw4w9WgXcQ.m4a").write_bytes(b"audio")
    url = "/files/dQw4w9WgXcQ"
    assert client.get(url, headers={"Authorization": f"Bearer {make(key)}"}).status_code == 200
    assert client.get(url, params={"token": "secret"}).status_code == 200
    assert client.get(url).status_code == 401
