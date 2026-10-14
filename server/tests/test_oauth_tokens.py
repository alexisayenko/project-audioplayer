import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import oauth
from app.problems import Problem

G_AUD = "web.apps.googleusercontent.com"
A_AUD = "com.example.app"


@pytest.fixture(scope="module")
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def other_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def env(key, monkeypatch):
    for n in ("GOOGLE_CLIENT_ID", "GOOGLE_WEB_CLIENT_ID", "APPLE_AUDIENCE", "APPLE_WEB_CLIENT_ID"):
        monkeypatch.delenv(n, raising=False)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", G_AUD)
    monkeypatch.setenv("APPLE_AUDIENCE", A_AUD)
    fake = SimpleNamespace(get_signing_key_from_jwt=lambda t: SimpleNamespace(key=key.public_key()))
    monkeypatch.setattr(oauth, "_jwks", lambda provider: fake)


def mint(key, provider="google", **over):
    claims = {
        "iss": "https://accounts.google.com" if provider == "google" else "https://appleid.apple.com",
        "aud": G_AUD if provider == "google" else A_AUD,
        "sub": "sub-1", "email": "User@Example.COM", "email_verified": True,
        "exp": int(time.time()) + 600,
    }
    claims.update(over)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "k"})


def fails(token, status, code):
    with pytest.raises(Problem) as ei:
        oauth.verify_identity(token)
    assert (ei.value.status, ei.value.code) == (status, code)


def test_valid_google_lowercases_email(key):
    assert oauth.verify_identity(mint(key)) == {"provider": "google", "email": "user@example.com", "sub": "sub-1"}


def test_google_accepts_both_issuer_spellings(key):
    assert oauth.verify_identity(mint(key, iss="accounts.google.com"))["provider"] == "google"


@pytest.mark.parametrize("over", [
    {"aud": "someone-else"}, {"iss": "https://evil.example"}, {"exp": int(time.time()) - 3600},
    {"exp": None}, {"sub": None}, {"aud": None}, {"iss": None}, {"nbf": int(time.time()) + 3600},
])
def test_bad_claims_are_401(key, over):
    fails(mint(key, **over), 401, "bad_token")


def test_wrong_signature_key_is_401(other_key):
    fails(mint(other_key), 401, "bad_token")


def test_alg_none_and_hs256_confusion_rejected(key):
    unsigned = jwt.encode({"iss": "https://accounts.google.com", "aud": G_AUD, "sub": "s", "exp": int(time.time()) + 60}, None, algorithm="none")
    fails(unsigned, 401, "bad_token")
    pub = key.public_key().public_bytes(
        __import__("cryptography.hazmat.primitives.serialization", fromlist=["x"]).Encoding.PEM,
        __import__("cryptography.hazmat.primitives.serialization", fromlist=["x"]).PublicFormat.SubjectPublicKeyInfo)
    try:
        forged = jwt.encode({"iss": "https://accounts.google.com", "aud": G_AUD, "sub": "s", "exp": int(time.time()) + 60}, pub, algorithm="HS256")
    except Exception:
        pytest.skip("PyJWT refuses PEM as HMAC secret")
    fails(forged, 401, "bad_token")


@pytest.mark.parametrize("token", ["", "x", "a.b.c", "....", "ж"])
def test_garbage_tokens_are_401(token):
    fails(token, 401, "bad_token")


def test_google_audience_does_not_authenticate_as_apple(key):
    fails(mint(key, "apple", aud=G_AUD), 401, "bad_token")


def test_issuer_of_one_provider_with_audience_of_other_rejected(key):
    fails(mint(key, "google", iss="https://appleid.apple.com"), 401, "bad_token")


def test_no_audience_configured_means_nothing_is_accepted(key, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID")
    monkeypatch.delenv("APPLE_AUDIENCE")
    fails(mint(key), 401, "bad_token")


def test_web_client_ids_extend_audiences(key, monkeypatch):
    monkeypatch.setenv("GOOGLE_WEB_CLIENT_ID", "web2")
    monkeypatch.setenv("APPLE_WEB_CLIENT_ID", " svc.web , ,")
    assert oauth.audiences("google") == [G_AUD, "web2"]
    assert oauth.audiences("apple") == [A_AUD, "svc.web"]
    assert oauth.verify_identity(mint(key, aud="web2"))["provider"] == "google"
    assert oauth.verify_identity(mint(key, "apple", aud="svc.web"))["provider"] == "apple"


def test_audience_matching_is_case_sensitive(key):
    fails(mint(key, aud=G_AUD.upper()), 401, "bad_token")


@pytest.mark.parametrize("verified", [False, "false", "False", None, "yes", 0])
def test_unverified_email_is_403(key, verified):
    fails(mint(key, email_verified=verified), 403, "unverified_email")


def test_string_true_counts_as_verified(key):
    assert oauth.verify_identity(mint(key, email_verified="true"))["email"] == "user@example.com"


def test_google_without_email_is_403(key):
    fails(mint(key, email=None), 403, "no_email")
    fails(mint(key, email="  "), 403, "no_email")


def test_apple_private_relay_email_and_missing_email(key):
    relay = "abc123@privaterelay.appleid.com"
    got = oauth.verify_identity(mint(key, "apple", email=relay, email_verified="true"))
    assert got == {"provider": "apple", "email": relay, "sub": "sub-1"}
    none = oauth.verify_identity(mint(key, "apple", email=None, sub="000123.abc"))
    assert none == {"provider": "apple", "email": "", "sub": "000123.abc"}


def test_apple_unverified_relay_email_still_403(key):
    fails(mint(key, "apple", email="x@privaterelay.appleid.com", email_verified=False), 403, "unverified_email")



def test_jwks_client_is_built_once_per_provider(monkeypatch):
    made = []
    monkeypatch.undo()
    monkeypatch.setattr(oauth, "_clients", {})
    monkeypatch.setattr(oauth, "PyJWKClient", lambda url, **kw: made.append((url, kw)) or object())
    a, b = oauth._jwks("google"), oauth._jwks("google")
    c = oauth._jwks("apple")
    assert a is b
    assert a is not c
    assert [u for u, _ in made] == [oauth.PROVIDERS["google"]["jwks"], oauth.PROVIDERS["apple"]["jwks"]]
    assert made[0][1]["cache_keys"] is True
