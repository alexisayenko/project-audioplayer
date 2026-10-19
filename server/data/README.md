# Server data

## Genre vocabulary

The canonical `genre:` list (TAG-077 to TAG-084, ADR-0023). Read once at start by `app/genre_vocab.py`; the server refuses to start without these two files.

- `genre_discogs.json`: `families` (the 11 kept level-1 names in the fixed order of GEN-037), `genres` (476 entries: lowercase genre name to its `parents`, a list of families; `parents[0]` is the family Discogs files it under, further entries are other families it is also filed under, GEN-039, GEN-057), `discogs_names` (Discogs's own spelling where it differs from the stored one beyond case, spaces, hyphens and "&"), `unverified` (0 names kept without a successful search check, see below). Terminology (ADR-0030): every name below a family is a genre; a Discogs genre (Discogs calls it a style) is one of ours. The file was `genre_discogs.json` until 2026-10-19.
- `genre_extras.json`: `extras` (53 real genres Discogs lacks), each with `parents` (a list of family names or canonical names; `parents[0]` is the primary parent and gives the family, GEN-057), an optional `family` (override of the derived family: space disco, a level 3 genre under disco), and `note` (where it came from). Reviewed in git.
- `genre_levels.json` (not part of the loaded vocabulary files above, validated by `genre_vocab.load_levels`): the three-level tree, see [genre-levels.md](../../docs/tech/genre-levels.md): `parents` per genre instead of the old `parent`, `also_under` and `also_in_genres`.
- `genre_families.json` is gone: the vocabulary replaces it (GEN-038 step 1).

Stored spelling: Discogs's name lowercased, except where the project already used another spelling (drum and bass, rock and roll, rhythm and blues, psytrance, synthpop, hi-nrg, hip house, euro disco, dance pop and similar). Lookups ignore case, spaces, hyphens, accents and "&" versus "and". Discogs genres that TAG-073 drops as junk (comedy, novelty, parody) or TAG-075 retags (romantic) are left out.

### Source and terms (TAG-084)

- Source: the Genres and Styles list of the Discogs database guidelines (Discogs help centre). Only names and the genre to family relation are stored; no release data, no runtime dependency.
- Terms: Discogs publishes its monthly data dumps into the public domain (CC0) and its API terms allow non-commercial use with an identifying User-Agent; names of Discogs genres and styles are facts, not releases. The help centre and the terms pages answered with a bot check (HTTP 403) when this list was made, so the wording was not re-read then: confirm the terms once from a browser (open point of task-0035).
- How this list was made (2026-10-16): the help article could not be fetched, so the list was written from memory of it, extended with candidate names from the earlier reviewed table and the live library, and every name was then checked against the public Discogs database search (`https://api.discogs.com/database/search?style=<name>&per_page=10`, no token, one request every 2.5 s, under the 25 per minute limit, User-Agent `ElectrophoneVocabCheck/1.0`). A name is kept when releases with exactly that Discogs style exist (840 names were checked; 307 candidates with no exact match were left out). The result had 512 genres (476 after the removed families of 2026-10-18), fewer than the roughly 550 of the Discogs list: names that could not be recalled are missing, and the diff against the article (open point of task-0035) closes the gap; until then a missing genre can be added to `genre_extras.json`. The search cannot tell which genre a style belongs to (genre and style filter independently), so the style to genre relation comes from the reviewed table of ADR-0021 and from memory of the list; `also_under` is advisory. Names without a check are listed in `unverified` (0).

### Refresh

1. Get the current list (the help article in a browser, or single checks with the search above).
2. Diff it against `genre_discogs.json` (new, renamed and removed names); keep the stored spelling rules above.
3. Review in git; an extras entry that becomes a Discogs genre moves out of `genre_extras.json`.
4. `sh scripts/check.sh` (the validator tests of TAG-083 run on the new files); deploy; read `backups-genre-merge/review-<uid>.json` after the first start.

### Review notes

- Library tags that no rule maps (kept on the songs, listed in the review file): aaron smith, joris, medley, music video, party, popcorn, skrux, ⚈⚈.
- ALIASES and RETAGS targets must be canonical; add an alias in `app/genre_filter.py` before adding an extras entry for a mere spelling variant.
