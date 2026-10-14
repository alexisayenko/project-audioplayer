import base64
import hashlib
import hmac
import json

import pytest

from app import session

IDENT = {"provider": "google", "email": "a@b.co", "uid": "u1"}


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.delenv("AUDIO_SESSION_SECRET", raising=False)
    monkeypatch.setenv("AUDIO_API_TOKEN", "api-token")


def forge(payload: bytes, key: bytes) -> str:
    body = base64.urlsafe_b64encode(payload).rstrip(b"=").decode()
    sig = base64.urlsafe_b64encode(hmac.new(key, body.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{body}.{sig}"


def test_round_trip_and_default_uid():
    got = session.read(session.issue({"provider": "apple", "email": "x@y.z"}))
    assert got == {"provider": "apple", "email": "x@y.z", "uid": ""}


def test_dedicated_secret_wins_over_api_token_derived_key(monkeypatch):
    cookie = session.issue(IDENT)
    monkeypatch.setenv("AUDIO_SESSION_SECRET", "dedicated")
    assert session.read(cookie) is None
    fresh = session.issue(IDENT)
    assert session.read(fresh)["uid"] == "u1"
    monkeypatch.delenv("AUDIO_SESSION_SECRET")
    assert session.read(fresh) is None


def test_unavailable_without_any_secret(monkeypatch):
    monkeypatch.delenv("AUDIO_API_TOKEN")
    assert not session.available()
    assert session.read("a.b") is None


def test_session_key_is_not_the_raw_api_token():
    assert session._key() != b"api-token"


@pytest.mark.parametrize("value", ["", "nodot", ".", "a.b", "....", "\x00.\x00"])
def test_garbage_cookies_are_rejected(value):
    assert session.read(value) is None


def test_tampered_body_and_signature_rejected():
    body, sig = session.issue(IDENT).split(".")
    other = base64.urlsafe_b64encode(json.dumps({"p": "google", "e": "owner@x.y", "u": "OWNER", "x": 9999999999}).encode()).rstrip(b"=").decode()
    assert session.read(f"{other}.{sig}") is None
    assert session.read(f"{body}.{sig[:-2]}AA") is None
    assert session.read(f"{body}.") is None


def test_expiry_boundary():
    cookie = session.issue(IDENT, now=1000)
    assert session.read(cookie, now=1000 + session.LIFETIME) is not None
    assert session.read(cookie, now=1000 + session.LIFETIME + 1) is None


def test_validly_signed_but_malformed_payloads_rejected():
    key = session._key()
    for payload in (b"not json", b"[]", b'{"p":"g","e":"x"}', b'{"p":"g","e":"x","x":"soon"}', b'{"e":"x","x":9999999999}'):
        assert session.read(forge(payload, key)) is None
    ok = forge(b'{"p":"g","e":"x","x":9999999999}', key)
    assert session.read(ok) == {"provider": "g", "email": "x", "uid": ""}


def test_cookie_signed_with_wrong_key_rejected():
    assert session.read(forge(b'{"p":"g","e":"x","x":9999999999}', b"other")) is None


def test_csrf_ok_matrix():
    h = {"x-requested-with": "audioplayer"}
    assert session.csrf_ok(h, "h.example")
    assert session.csrf_ok({**h, "origin": "https://h.example"}, "h.example")
    assert not session.csrf_ok({**h, "origin": "https://evil.example"}, "h.example")
    assert not session.csrf_ok({**h, "origin": "https://h.example.evil.io"}, "h.example")
    assert not session.csrf_ok({}, "h.example")
    assert not session.csrf_ok({"x-requested-with": "XMLHttpRequest"}, "h.example")
