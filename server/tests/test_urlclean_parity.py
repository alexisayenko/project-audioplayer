import json
from pathlib import Path

import pytest

from app import library, urlclean

CASES = json.loads((Path(__file__).parent / "fixtures" / "url_clean_cases.json").read_text(encoding="utf-8"))
TAGS = json.loads((Path(__file__).parent / "fixtures" / "tag_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES["clean"], ids=[repr(c["input"]) for c in CASES["clean"]])
def test_clean_url_matches_the_shared_cases(case):
    assert urlclean.clean_url(case["input"]) == case["output"]


@pytest.mark.parametrize("case", CASES["soundcloud"], ids=[repr(c["input"]) for c in CASES["soundcloud"]])
def test_classify_soundcloud_matches_the_shared_cases(case):
    got = urlclean.classify_soundcloud(case["input"])
    assert (got[0], got[1]) == (case["kind"], case["url"]) if case["kind"] else got is None


@pytest.mark.parametrize("case", CASES["source_of"], ids=[c["id"] for c in CASES["source_of"]])
def test_source_of_matches_the_shared_cases(case):
    assert urlclean.source_of(case["id"]) == case["source"]


@pytest.mark.parametrize("case", TAGS["decade_tag"], ids=[repr(c["year"]) for c in TAGS["decade_tag"]])
def test_decade_tag_matches_the_shared_cases(case):
    assert library.decade_tag(case["year"]) == case["tag"]
