import logging

import pytest
from fastapi.testclient import TestClient

from app import legal, main


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("LEGAL_CONTACT", raising=False)
    monkeypatch.delenv("CANONICAL_HOST", raising=False)


def client():
    return TestClient(main.app, follow_redirects=False)


def test_robots_txt_is_public_plain_text_disallow_all():
    r = client().get("/robots.txt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert r.text == "User-agent: *\nDisallow: /\n"


def test_x_robots_tag_on_api_static_error_and_redirect_responses(monkeypatch):
    tag = "noindex, nofollow, noarchive"
    c = client()
    for path in ("/health", "/auth/config", "/", "/library", "/no-such-route", "/legal", "/robots.txt"):
        assert c.get(path).headers["x-robots-tag"] == tag, path
    monkeypatch.setenv("CANONICAL_HOST", "play.example.net")
    r = c.get("/library", headers={"host": "other.example.net"})
    assert r.status_code == 308 and r.headers["x-robots-tag"] == tag


def test_legal_payload_without_contact():
    r = client().get("/legal")
    assert r.status_code == 200
    assert r.json() == {"note": legal.NOTE, "contact": None}
    assert r.headers["cache-control"] == "public, max-age=300"
    assert "private" not in r.headers["cache-control"]


@pytest.mark.parametrize("value", ["legal@example.com", "https://example.com/contact?x=1"])
def test_legal_payload_with_contact(monkeypatch, value):
    monkeypatch.setenv("LEGAL_CONTACT", f"  {value} ")
    assert client().get("/legal").json()["contact"] == value


@pytest.mark.parametrize("value", [
    "javascript:alert(1)", "http://example.com", "mailto:a@b.co", "data:text/html,x", "https://", "a@b",
    "https://ex ample.com", 'https://example.com/"onmouseover=1', "https://example.com/<x>", "x" * 300 + "@example.com",
])
def test_invalid_contact_is_ignored_with_a_warning(monkeypatch, caplog, value):
    monkeypatch.setenv("LEGAL_CONTACT", value)
    with caplog.at_level(logging.WARNING):
        legal.check_startup()
    assert "LEGAL_CONTACT ignored" in caplog.text
    assert client().get("/legal").json()["contact"] is None


def test_public_on_every_host_with_a_canonical_host(monkeypatch):
    monkeypatch.setenv("CANONICAL_HOST", "play.example.net")
    for path in ("/health", "/robots.txt", "/legal"):
        assert client().get(path, headers={"host": "other.example.net"}).status_code == 200
