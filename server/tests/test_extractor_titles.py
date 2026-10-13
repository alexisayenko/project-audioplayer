from app import extractor

YT = "dQw4w9WgXcQ"


class FakeYDL:
    info: dict = {}

    def __init__(self, opts):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=False):
        return dict(FakeYDL.info)


def test_search_cuts_channel_prefix_from_title(monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(FakeYDL, "info", {"entries": [{"id": YT, "title": "RÜFÜS DU SOL ●● Innerbloom (Official Video)", "uploader": "RÜFÜS DU SOL", "duration": 579}]})
    [r] = extractor.search("innerbloom", 1)
    assert (r["artist"], r["title"]) == ("RÜFÜS DU SOL", "Innerbloom")


def test_preview_cuts_channel_prefix_from_title(monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(FakeYDL, "info", {"title": "RÜFÜS DU SOL ●● Innerbloom (Official Video)", "uploader": "RÜFÜS DU SOL", "duration": 579})
    p = extractor.preview(YT)
    assert (p["artist"], p["title"]) == ("RÜFÜS DU SOL", "Innerbloom")


CH = "Melodic Techno & Progressive Trance Anthem Rework | Sadrican"


def test_preview_cuts_remix_into_remixer(monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(FakeYDL, "info", {"title": "Delerium - Innocente (Sadrican 2026 Remix)", "uploader": CH})
    p = extractor.preview(YT)
    assert (p["title"], p["remixer"]) == ("Delerium - Innocente", "Sadrican 2026 Remix")
    assert p["artist"] == CH


def test_preview_remixer_is_none_without_remix(monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(FakeYDL, "info", {"title": "A - B (Extended Mix)", "uploader": "X"})
    assert extractor.preview(YT)["remixer"] is None


def test_search_keeps_full_title_with_remix(monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(FakeYDL, "info", {"entries": [{"id": YT, "title": "A - B (Sadrican Remix)", "uploader": "X"}]})
    [r] = extractor.search("b", 1)
    assert "Sadrican Remix" in r["title"]


def test_download_audio_cuts_remix(monkeypatch):
    from pathlib import Path

    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(FakeYDL, "info", {"title": "A - B (Sadrican Remix)", "uploader": "X"})
    d = extractor.download_audio(YT, Path("."))
    assert (d["title"], d["remixer"]) == ("A - B", "Sadrican Remix")


LIVE = "Dua Lipa and Elton John - Cold Heart (Live from the Royal Albert Hall)"


def test_preview_keeps_live_in_title(monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(FakeYDL, "info", {"title": LIVE, "uploader": "Dua Lipa", "duration": 200})
    p = extractor.preview(YT)
    assert p["title"].endswith("(Live from the Royal Albert Hall)")


def test_preview_example_keeps_feat_and_cuts_remix_segment(monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(
        FakeYDL,
        "info",
        {"title": "Kato Feat. Jon - Turn The Lights Off | Jon Hamm Club Dance Scene | DEEPO Remix Long Version", "uploader": "DEEPO Music"},
    )
    p = extractor.preview(YT)
    assert p["artist"] == "Kato Feat. Jon"
    assert p["title"] == "Turn The Lights Off | Jon Hamm Club Dance Scene"
    assert p["remixer"] == "DEEPO Remix Long Version"
