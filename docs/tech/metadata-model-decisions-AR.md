# Metadata model: Decision AR (First released year)

Status: decided by Alex 2026-10-16. The metadata-model architect must read this file and fold it into `metadata-model-design.md` ("Contract changes" appendix) when that file exists. Task: [task-0036](../tasks/task-0036.md), requirement DATA-126 in [data-model.md](../specs/data-model.md), ADD-111 in [add-song.md](../specs/add-song.md).

## Decision AR

`released` ("First released", the year of the ORIGINAL recording) comes ONLY from Wikipedia, MusicBrainz or Discogs. The YouTube or SoundCloud upload (publish) date is NEVER used for `released` and never drives the `decade:` tag.

Rules:

1. Source precedence for `released`: (a) the Wikipedia song infobox or Wikidata release year when a verified song page was found (`wiki_lookup`); (b) the EARLIEST credible release year of the recording on MusicBrainz, never a compilation's year (the Haddaway case: MusicBrainz returned 2002/2003 for a 1993 song); (c) the earliest Discogs release year. A typed value always wins and is never overwritten.
2. No source gives a year: `released` stays empty. No fallback to the upload date, no `decade:` tag suggested; the form shows the field empty and lets Alex type it.
3. yt-dlp metadata (`release_year`, `release_date`, `upload_date`, SoundCloud `timestamp`) is not a source of `released`. This also removes the platform's own `release_year`/`release_date`: only the three named sources count.
4. The upload/publish date feeds only `version.year`, when the song has a version (remix, live, acoustic, extended, instrumental, remaster, edit, cover, other), as a visibly marked suggestion (ADD-111: dashed, italic, replaced by typing) unless a better source for that version exists (the `remix_year` hook). With no version the publish year goes nowhere.
5. A version's year and the original's years never mix: the original's years are never applied as `version.year`, and the version's own date (a remix's MusicBrainz date, the upload year) is never applied as `released`.
6. `released` for a version is the first release year of the ORIGINAL work, only from the three sources, else empty. Remix: the original recording (base `title` plus the original `artists`; look up the base title, never the remix recording or its release). Cover: the original song (base `title` plus `version.of`). Live, acoustic, extended, instrumental, remaster, edit, other: the studio original (base title plus `artists`). If a lookup can only find the version's own entry or date, `released` stays empty rather than guessing.
7. Decade: `decade:` is derived from `released` only (`year` while it is the compatibility value, DATA-123). Empty `released` means no decade tag from automatic sources; an existing `decade:` tag is untouched when `released` is empty (the current `with_decade` behaviour).

## Consequences

- `extractor._year` no longer falls back to `upload_date`; `published_year` stays and is used only for `version.year` suggestions.
- `/preview` and `/metadata` keep returning `published_year` (API-048), for `version.year` suggestions only.
- Existing songs are NOT re-dated automatically.
- Open item (not done, no data changed): a one-off review list of songs whose current `year` equals their upload year and that have no other source (no Wikipedia, MusicBrainz or Discogs match), so Alex can fix them by hand. The data does not store the upload date, so the list needs a fresh yt-dlp lookup per song.

## Code paths that must change

Server:

- `server/app/extractor.py` `_year` (lines ~94-98): drop the `upload_date` fallback; per rule 3 also stop using `release_year`/`release_date` for `released` (the contract is that `preview["year"]` is never publish-derived). Callers at ~168 (SoundCloud passes only release fields) and ~194 (YouTube passes the whole `info`). `_published_year` stays.
- `server/app/routes/lookup.py` `_apply_suggestions` (~44, ~47): `suggested_year` is wiki > MusicBrainz > Discogs (MusicBrainz is missing today); `meta["year"]` is filled from that chain, not only `wiki["year"]`; for versions look up the original (base title, original artist), not the version string.
- `server/app/metadata.py` `merge` (~65-67): the `years` chain is wiki links/infobox/guess > MusicBrainz > Discogs; remove `s.get("year") for s in sources` (yt-dlp years); keep the `published_year` and `remix_year` outputs. Discogs year is not in `merge` yet (it is in `identify.py`).
- `server/app/genre_lookup.py` `_first_year` (~157) and `lookup` (~235): use the earliest credible year and reject a compilation-derived date (a recording's `first-release-date` can come from a compilation); add a Haddaway-style test.
- `server/app/identify.py` (~134): the order wiki > MusicBrainz > Discogs is already right; keep it, with the compilation guard coming through `genre_lookup`.
- `server/app/discogs_lookup.py` (`_year`, ~94-113, ~179): earliest year across releases already sorts by year; keep "various artists" compilations excluded.
- `server/app/downloads.py` (~139-147, ~239-247): `with_decade(..., meta.get("year") or found.get("year"))` must only ever see a year from the three sources; no code change if the callers above are fixed, but add a test that an upload-only year gives no `decade:` tag.
- `server/app/metafill.py` (~150-160) and `server/app/backfill.py`: confirm they fill `year` only from the `/metadata` chain (blank-only already); no upload fallback.
- `server/app/library.py` (`decade_tag`, `with_decade`, ~137-160): no change now (`year`-only); later `released`.

Web:

- `web/js/song-form.js` (~39, ~45, ~175, ~313) and `web/js/remix-year.js` (`planRemixYear`): `published` feeds only the version-year suggestion (already so); extend from remix to every `version.kind` when the structured form lands.
- `web/js/identify-plan.js` (~29, `yearAction`): unchanged (uses `suggested_year`).
- The form shows an empty Year when no source gave one, with no suggestion styling.

Tests: `server/tests` for `extractor._year`, `metadata.merge`, `genre_lookup` first year, `/preview` `suggested_year`; web tests for the empty-Year form.
Docs: API-048 in `docs/specs/api.md` (line ~40) already says `published_year` never feeds `year`; keep.
