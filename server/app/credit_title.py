"""Credits inside a source title or artist text (CRD-010..CRD-016): an unambiguous Featuring or With group is moved out of the text into its own list. Pure; twin of web/js/credit-title.js, both driven by server/tests/fixtures/credit_title_cases.json."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, NamedTuple

from . import titleclean
from .credits_v1 import join_names
from .tokens import join_tokens, split_tokens

_KEY = re.compile(r"(?<!\w)(?:featuring|feat|ft)(?!\w)(\.?)", re.I)
_NUMBER = re.compile(r"\d[\d.,'\"′″]*", re.ASCII)
_TAIL_BRACKET = re.compile(r"[(\[]([^()\[\]]*)[)\]]\s*$")
_WITH_HEAD = re.compile(r"^with\s+(?=\S)", re.I)
_STOPS = (" - ", " – ", " — ", " | ", " ●● ", " • ", ")", "]", "(", "[")
_NAME_SEP = re.compile(r"\s*,\s*|\s+(?:&|\+|x|[aA][nN][dD]|[vV][sS]\.?)\s+")
_EDGE = " -|"


class Group(NamedTuple):
    rest: str
    kind: str
    names: str
    removed: str


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip(_EDGE)


def fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)).casefold()


def _prev_is_number(text: str, end: int) -> bool:
    i = end
    while i > 0 and text[i - 1] in " \t":
        i -= 1
    j = i
    while j > 0 and not text[j - 1].isspace():
        j -= 1
    return j < i and _NUMBER.fullmatch(text, j, i) is not None


def _is_keyword(text: str, m: re.Match[str]) -> bool:
    if m.end() >= len(text) or not text[m.end()].isspace() or _prev_is_number(text, m.start()):
        return False
    if m.group(1) or m.group(0).lower() == "featuring":
        return True
    i = m.end()
    while i < len(text) and text[i].isspace():
        i += 1
    return i < len(text) and (text[i].isupper() or text[i].isdecimal())


def _name_start(text: str) -> bool:
    c = text[:1]
    return bool(c) and c.isalnum() and not c.islower()


def _group_names(inner: str) -> tuple[str, str] | None:
    m = _KEY.match(inner)
    if m and _is_keyword(inner, m) and inner[m.end():].strip():
        return "feat", inner[m.end():].strip()
    w = _WITH_HEAD.match(inner)
    if w and _name_start(inner[w.end():]):
        return "with", inner[w.end():].strip()
    return None


def _feat_end(text: str, start: int) -> int:
    ends = [i for i in (text.find(stop, start) for stop in _STOPS) if i >= 0]
    return min(ends) if ends else len(text)


def _group(text: str, with_ok: bool) -> Group | None:
    """The trailing bracket group "(feat. X)" / "[feat. X]" (and "(with X)" when `with_ok`), else the first valid unbracketed feat keyword up to the end, a " | " or the next bracket group; None when nothing is unambiguous."""
    m = _TAIL_BRACKET.search(text)
    if m:
        found = _group_names(m.group(1).strip())
        if found and (found[0] == "feat" or with_ok):
            return Group(_squash(text[: m.start()]), found[0], found[1], m.group(0).strip())
    for k in _KEY.finditer(text):
        if not _is_keyword(text, k):
            continue
        before = text[: k.start()].rstrip()
        if before.endswith(("(", "[")):
            return None
        stop = _feat_end(text, k.end())
        if stop < len(text) and text[stop] in ")]":
            return None
        return Group(_squash(f"{before} {text[stop:]}"), "feat", text[k.end():stop].strip(), text[k.start():stop].strip())
    return None


def _names(text: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for part in _NAME_SEP.split(text):
        name = part.strip(_EDGE)
        if name and fold(name) not in seen:
            seen.add(fold(name))
            out.append(name)
    return out


def unique(names: list[str], taken: set[str]) -> list[str]:
    """The names whose folded form is not in `taken` yet, each once; `taken` grows."""
    out: list[str] = []
    for n in names:
        key = fold(n)
        if key not in taken:
            taken.add(key)
            out.append(n)
    return out


def parse(artist: str | None, title: str | None) -> dict[str, Any]:
    """`{mainArtists, featuredArtists, withArtists, title, notes, removed}` of a source artist text (pills) and a title already cut of noise and version: a feat keyword inside a pill splits that pill at the keyword only; a trailing "(feat. X)", "[feat. X]", unbracketed " feat. X" or "(with X)" of the title moves out. `removed` lists the exact title groups taken out. Primary names are never split; a name already in a stronger role is dropped (CRD-003); a title that would end up empty stays whole (note `title_empty`)."""
    notes: list[str] = []
    mains: list[str] = []
    featured: list[str] = []
    withs: list[str] = []
    guessed = False
    for pill in split_tokens(artist or ""):
        g = _group(pill, False)
        names = _names(g.names) if g else []
        if g and names and g.rest:
            guessed = guessed or len(names) > 1
            featured += names
            mains.append(g.rest)
        else:
            mains.append(pill)
    text = title or ""
    work = text.strip()
    removed: list[str] = []
    done: set[str] = set()
    for _ in range(2):
        g = _group(work, True)
        names = _names(g.names) if g else []
        if not g or not names or g.kind in done:
            break
        if not g.rest:
            notes.append("title_empty")
            break
        guessed = guessed or len(names) > 1
        (featured if g.kind == "feat" else withs).extend(names)
        removed.append(g.removed)
        work = g.rest
        done.add(g.kind)
    if guessed:
        notes.insert(0, "feat_split_guess")
    taken = {fold(p) for p in mains}
    featured = unique(featured, taken)
    withs = unique(withs, taken)
    return {"mainArtists": mains, "featuredArtists": featured, "withArtists": withs, "title": work if removed else text, "notes": notes, "removed": removed}


def artist_text(mains: list[str], featured: list[str], withs: list[str], *, pills: bool = True) -> str:
    """The legacy artist string: the main artists (pills joined " - ", or names joined A, B & C when `pills` is false), then " feat. " and the featured names, then " with " and the With names."""
    line = join_tokens(mains) if pills else join_names(mains)
    if featured:
        line = f"{line} feat. {join_names(featured)}" if line else f"feat. {join_names(featured)}"
    if withs:
        line = f"{line} with {join_names(withs)}" if line else f"with {join_names(withs)}"
    return line


def split(artist: str, title: str) -> dict[str, Any]:
    """The preview and import form of `parse`: reads the title without its promo noise, then returns `{artist, title, mainArtists, featuredArtists, withArtists}` where `artist` is the legacy string and `title` still holds any noise (the caller cleans it and keeps it as `title_raw`) but not the moved credit group. Without any credit found `artist` and `title` come back untouched."""
    pills = split_tokens(artist or "")
    found = parse(artist, titleclean.clean(title or ""))
    if found["mainArtists"] == pills and not found["removed"]:
        return {"artist": artist, "title": title, "mainArtists": pills, "featuredArtists": [], "withArtists": []}
    out = title or ""
    for group in found["removed"]:
        if group in out:
            out = out.replace(group, " ", 1)
        else:
            out = found["title"]
            break
    return {
        "artist": artist_text(found["mainArtists"], found["featuredArtists"], found["withArtists"]) if (found["featuredArtists"] or found["withArtists"]) else artist,
        "title": _squash(out) if found["removed"] else title,
        "mainArtists": found["mainArtists"], "featuredArtists": found["featuredArtists"], "withArtists": found["withArtists"],
    }
