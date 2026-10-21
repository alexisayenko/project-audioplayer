import pytest

from app import library, urlclean

VID = "jNQXAC9IVRw"
CLEAN = f"https://www.youtube.com/watch?v={VID}"


@pytest.mark.parametrize(
    "raw",
    [
        f"https://youtu.be/{VID}?si=abc123",
        f"https://youtu.be/{VID}?t=42&si=abc123",
        f"https://www.youtube.com/watch?v={VID}&si=abc123",
        f"https://www.youtube.com/watch?si=abc123&v={VID}",
        f"https://www.youtube.com/watch?feature=share&v={VID}&pp=xyz&utm_source=a",
        f"https://m.youtube.com/watch?v={VID}&t=5s",
        f"https://music.youtube.com/watch?v={VID}&si=abc&list=RDAMVM{VID}",
        f"https://www.youtube.com/shorts/{VID}?si=abc",
        f"https://www.youtube.com/embed/{VID}?feature=oembed",
        f"https://www.youtube.com/live/{VID}?si=abc",
        f"youtube.com/watch?v={VID}",
        f"  {CLEAN}  ",
        CLEAN,
        VID,
    ],
)
def test_youtube_forms_become_canonical(raw):
    assert urlclean.clean_url(raw) == CLEAN


def test_other_urls_lose_only_tracking_params():
    c = urlclean.clean_url
    assert c("https://example.com/a?id=7&utm_source=x&UTM_medium=y&si=1&fbclid=z&gclid=g&pp=p&feature=f") == "https://example.com/a?id=7"
    assert c("https://example.com/a?si=1&fbclid=z") == "https://example.com/a"
    assert c("https://example.com/a?id=7#frag") == "https://example.com/a?id=7#frag"
    assert c("https://example.com/a") == "https://example.com/a"


def test_invalid_input_untouched():
    for raw in ["nonsense", "", "ftp://example.com/a?si=1", f"https://evil.example/watch?v={VID}"]:
        assert urlclean.clean_url(raw) == raw


def test_dirty_source_url_cleaned_on_load():
    doc = library.normalize({"songs": [{"id": VID, "source_url": f"https://youtu.be/{VID}?si=abc"}, {"id": "x"}]})
    assert doc["songs"][0]["sources"] == [{"type": "youtube", "ref": VID, "trim_start": None, "trim_end": None}]
    assert "source_url" not in doc["songs"][0]
    assert "sources" not in doc["songs"][1]
