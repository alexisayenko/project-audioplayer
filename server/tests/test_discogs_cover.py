import urllib.error

import pytest

from app import coverimg, discogs_cover, discogs_lookup, httpjson
from tests.test_covers import H, VID, client, image, link, put_json, reply, song, web  # noqa: F401

PAGE = "https://www.discogs.com/master/5659-Hallucinogen-Twisted?redirected=true"
IMG = "https://i.discogs.com/abc/full.jpeg"


@pytest.fixture
def api(monkeypatch, web):  # noqa: F811
    """Fake Discogs API: `docs` maps an API path to a document or an exception; token set; the image host resolves publicly."""
    monkeypatch.setenv("DISCOGS_TOKEN", "test-token")
    web.hosts["i.discogs.com"] = "93.184.216.34"
    docs, asked = {}, []

    def get(path, params=None):
        asked.append(path)
        doc = docs[path]
        if isinstance(doc, Exception):
            raise doc
        return doc

    monkeypatch.setattr(discogs_lookup, "_get", get)
    return type("Api", (), {"docs": docs, "asked": asked, "web": web})


def not_found():
    return urllib.error.HTTPError("https://api.discogs.com/x", 404, "Not Found", {}, None)


def images(*items):
    return {"images": [{"type": t, "uri": u, "uri150": u + "?150", "resource_url": u} for t, u in items]}


@pytest.mark.parametrize("url,expected", [
    (PAGE, ("master", 5659)),
    ("https://www.discogs.com/master/5659", ("master", 5659)),
    ("https://discogs.com/release/12-Some-Title", ("release", 12)),
    ("http://www.discogs.com/en/master/5659-Hallucinogen-Twisted", ("master", 5659)),
    ("https://www.discogs.com/de/release/12/", ("release", 12)),
    ("https://www.discogs.com/fr/master/9?utm_source=x#top", ("master", 9)),
])
def test_parse_page_accepts_master_and_release_pages(url, expected):
    assert discogs_cover.parse_page(url) == expected


@pytest.mark.parametrize("url", [
    "https://discogs.com.evil.com/master/5659",
    "https://www.discogs.com.evil.com/release/1",
    "https://evil.com/www.discogs.com/master/5659",
    "https://sub.discogs.com/master/5659",
    "https://i.discogs.com/master/5659",
    "https://user:pw@www.discogs.com/master/5659",
    "https://www.discogs.com:8443/master/5659",
    "ftp://www.discogs.com/master/5659",
    "https://www.discogs.com/artist/5659-Name",
    "https://www.discogs.com/master/abc",
    "https://www.discogs.com/eng/master/5659",
    "https://www.discogs.com/master/5659/edit",
    "not a url",
])
def test_parse_page_refuses_everything_else(url):
    assert discogs_cover.parse_page(url) is None


def test_master_with_a_primary_image_stores_it(client, song, api, tmp_path):
    api.docs["masters/5659"] = images(("secondary", IMG + "2"), ("primary", IMG))
    api.web.pages[("i.discogs.com", "/abc/full.jpeg")] = reply(body=image("PNG", (30, 30)), ctype="image/jpeg")
    r = put_json(client, {"url": PAGE})
    assert r.status_code == 200, r.text
    assert r.json()["cover_source"] == "custom"
    assert api.asked == ["masters/5659"]
    assert [c[1] for c in api.web.calls] == ["i.discogs.com"]


def test_first_image_is_used_without_a_primary_and_resource_url_is_the_fallback(client, song, api):
    api.docs["releases/12"] = {"images": [{"type": "secondary", "uri": "", "resource_url": IMG}]}
    api.web.pages[("i.discogs.com", "/abc/full.jpeg")] = reply(body=image())
    assert put_json(client, {"url": "https://www.discogs.com/release/12-Some-Title"}).status_code == 200
    assert api.asked == ["releases/12"]


def test_master_without_images_falls_back_to_its_main_release(client, song, api):
    api.docs["masters/5659"] = {"images": [], "main_release": 777}
    api.docs["releases/777"] = images(("primary", IMG))
    api.web.pages[("i.discogs.com", "/abc/full.jpeg")] = reply(body=image())
    assert put_json(client, {"url": PAGE}).status_code == 200
    assert api.asked == ["masters/5659", "releases/777"]


def test_master_without_images_and_without_a_main_release_has_no_cover(client, song, api):
    api.docs["masters/5659"] = {"images": []}
    r = put_json(client, {"url": PAGE})
    assert r.status_code == 422
    assert r.json() == {"error": "cover_url_unreachable", "detail": "Discogs has no cover for this page."}


def test_unknown_page_is_422_with_a_clear_message(client, song, api):
    api.docs["masters/5659"] = not_found()
    r = put_json(client, {"url": PAGE})
    assert r.status_code == 422
    assert r.json()["error"] == "cover_url_unreachable"
    assert r.json()["detail"] == "Discogs has no cover for this page."


def test_other_discogs_failures_are_502(client, song, api):
    api.docs["masters/5659"] = urllib.error.HTTPError("https://api.discogs.com/x", 500, "boom", {}, None)
    assert put_json(client, {"url": PAGE}).status_code == 502
    api.docs["masters/5659"] = OSError("down")
    assert put_json(client, {"url": PAGE}).status_code == 502


def test_missing_token_is_discogs_not_configured(client, song, api, monkeypatch):
    monkeypatch.delenv("DISCOGS_TOKEN")
    r = put_json(client, {"url": PAGE})
    assert r.status_code == 422
    assert r.json()["error"] == "discogs_not_configured"
    assert api.asked == []


def test_a_non_discogs_image_in_the_api_answer_is_ignored(client, song, api):
    api.docs["masters/5659"] = {"images": [{"type": "primary", "uri": "https://evil.example/a.jpg", "resource_url": "http://i.discogs.com/a.jpg"}]}
    assert put_json(client, {"url": PAGE}).json()["error"] == "cover_url_unreachable"
    assert api.web.calls == []


def test_the_page_address_is_never_fetched_directly(client, song, api):
    api.docs["masters/5659"] = images(("primary", IMG))
    api.web.pages[("i.discogs.com", "/abc/full.jpeg")] = reply(body=image())
    put_json(client, {"url": PAGE})
    assert all(call[1] != "www.discogs.com" for call in api.web.calls)


def test_from_url_route_accepts_a_discogs_page_too(client, song, api):
    api.docs["releases/12"] = images(("primary", IMG))
    api.web.pages[("i.discogs.com", "/abc/full.jpeg")] = reply(body=image())
    r = client.post(f"/songs/{VID}/cover/from-url", json={"url": "https://discogs.com/release/12"}, headers=H)
    assert r.status_code == 200


def test_image_download_keeps_the_ssrf_checks(client, song, api):
    api.web.hosts["i.discogs.com"] = "10.0.0.5"
    api.docs["masters/5659"] = images(("primary", IMG))
    r = put_json(client, {"url": PAGE})
    assert r.status_code == 422
    assert r.json()["error"] == "cover_url_refused"


def test_discogs_pages_share_the_cover_url_limit(client, song, api, monkeypatch):
    from app import coverupload

    api.docs["masters/5659"] = not_found()
    calls = []
    monkeypatch.setattr(coverupload, "charge", lambda window, user: calls.append(window))
    put_json(client, {"url": PAGE})
    assert calls == [coverupload.fetches]


def test_token_goes_only_to_discogs_hosts(monkeypatch):
    monkeypatch.setenv("DISCOGS_TOKEN", "test-token")
    assert coverimg.auth_headers("i.discogs.com") == {"Authorization": "Discogs token=test-token"}
    assert coverimg.auth_headers("discogs.com") == {"Authorization": "Discogs token=test-token"}
    assert coverimg.auth_headers("discogs.com.evil.com") == {}
    assert coverimg.auth_headers("img.example") == {}
    monkeypatch.delenv("DISCOGS_TOKEN")
    assert coverimg.auth_headers("i.discogs.com") == {}


def test_discogs_images_use_the_descriptive_user_agent(monkeypatch):
    assert coverimg.user_agent_for("i.discogs.com") == httpjson.user_agent()
    assert coverimg.user_agent_for("img.example") == coverimg.USER_AGENT


def test_suggestions_include_the_stored_discogs_page(client, song, api, monkeypatch):
    link(client, discogs_url="https://www.discogs.com/master/5659-Hallucinogen-Twisted")
    api.docs["masters/5659"] = images(("primary", IMG))
    got = client.get(f"/songs/{VID}/cover/suggestions", headers=H).json()["suggestions"]
    assert got == [{"url": "https://www.discogs.com/master/5659", "thumb": IMG + "?150", "title": "Discogs", "source": "discogs",
                    "page": "https://www.discogs.com/master/5659", "width": None, "height": None}]


def test_suggestion_still_listed_when_the_thumbnail_lookup_fails(client, song, api):
    link(client, discogs_url="https://www.discogs.com/release/12")
    api.docs["releases/12"] = OSError("down")
    got = client.get(f"/songs/{VID}/cover/suggestions", headers=H).json()["suggestions"]
    assert got[0]["source"] == "discogs"
    assert got[0]["thumb"] is None


def test_suggestions_skip_discogs_without_a_token(client, song, api, monkeypatch):
    monkeypatch.delenv("DISCOGS_TOKEN")
    link(client, discogs_url="https://www.discogs.com/release/12")
    assert client.get(f"/songs/{VID}/cover/suggestions", headers=H).json() == {"suggestions": []}


def test_discogs_comes_after_wikipedia_within_four(client, song, api, monkeypatch):
    from app import wiki_lookup

    link(client, wikipedia_song="https://en.wikipedia.org/wiki/A", discogs_url="https://www.discogs.com/release/12")
    api.docs["releases/12"] = images(("primary", IMG))
    monkeypatch.setattr(wiki_lookup, "cover_candidates", lambda links: [{"url": f"https://u/{i}", "source": "wikipedia"} for i in range(4)])
    got = client.get(f"/songs/{VID}/cover/suggestions", headers=H).json()["suggestions"]
    assert [s["source"] for s in got] == ["wikipedia"] * 3 + ["discogs"]
