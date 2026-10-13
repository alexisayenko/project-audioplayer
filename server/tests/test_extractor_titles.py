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
