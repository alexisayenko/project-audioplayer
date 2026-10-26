import json
import os
from pathlib import Path

from tests.test_albums_youtube import pv  # noqa: F401
from tests.test_albums_youtube_flow import HALLU_SEARCH, hallu, post_commit  # noqa: F401
from tests.test_albums import discogs  # noqa: F401
from tests.test_albums_youtube import yt  # noqa: F401
from tests.test_library import H, client  # noqa: F401

WEB_FIX = Path(__file__).resolve().parents[2] / "web" / "js" / "fixtures"
UPDATE = bool(os.environ.get("UPDATE_WEB_FIXTURES"))


def dump(name, data):
    path = WEB_FIX / name
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if UPDATE:
        WEB_FIX.mkdir(exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
    assert json.loads(path.read_text(encoding="utf-8")) == data, f"{name} is stale: rerun with UPDATE_WEB_FIXTURES=1"


def test_preview_and_search_responses_match_the_web_fixtures(client, hallu):
    preview = pv(client).json()
    dump("yt-preview.json", preview)
    pl = [{"position": t["position"], "title": t["title"], "durationS": t["durationS"]} for t in preview["tracks"]]
    search = client.post("/albums/discogs-search", json={"artist": "Hallucinogen", "album": "Twisted", "trackCount": 11, "playlistTracks": pl}, headers=H)
    dump("yt-search.json", search.json())


def test_commit_body_the_web_builds_is_accepted_by_the_server(client, hallu):
    sent = json.loads((WEB_FIX / "yt-commit-request.json").read_text(encoding="utf-8"))
    r = post_commit(client, sent)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["linked"] == 9 and out["unlinked"] == 0
    assert [s["position"] for s in out["songs"]] == list(range(1, 10))
    assert [t["songId"] for t in out["album"]["tracks"]] == [s["songId"] for s in out["songs"]]


def test_fallback_commit_body_the_web_builds_is_accepted_by_the_server(client, yt):
    sent = json.loads((WEB_FIX / "yt-commit-fallback-request.json").read_text(encoding="utf-8"))
    r = post_commit(client, sent)
    assert r.status_code == 201, r.text
    assert r.json()["album"]["title"] == sent["fallback"]["title"]
