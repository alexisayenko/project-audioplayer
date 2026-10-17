# Server data

## Genre vocabulary

The canonical `genre:` list (TAG-077 to TAG-084, ADR-0023). Read once at start by `app/genre_vocab.py`; the server refuses to start without these two files.

- `genre_styles.json`: `genres` (the 15 Discogs genres in the fixed order of GEN-037), `styles` (512 entries, lowercase style name to the genre Discogs files it under, one genre per style), `also_under` (other genres of a multi-genre style, GEN-039), `discogs_names` (Discogs's own spelling where it differs from the stored one beyond case, spaces, hyphens and "&"), `unverified` (0 names kept without a successful search check, see below).
- `genre_extras.json`: `extras` (51 real genres Discogs lacks), each with `family` (one of the 15), `parent` (a canonical name, or null for a root) and `note` (where it came from). Reviewed in git.
- `genre_families.json` is gone: the vocabulary replaces it (GEN-038 step 1).

Stored spelling: Discogs's name lowercased, except where the project already used another spelling (drum and bass, rock and roll, rhythm and blues, psytrance, synthpop, hi-nrg, hip house, euro disco, dance pop and similar). Lookups ignore case, spaces, hyphens, accents and "&" versus "and". Discogs styles that TAG-073 drops as junk (comedy, novelty, parody) or TAG-075 retags (romantic) are left out.

### Source and terms (TAG-084)

- Source: the Genres and Styles list of the Discogs database guidelines (Discogs help centre). Only names and the style to genre relation are stored; no release data, no runtime dependency.
- Terms: Discogs publishes its monthly data dumps into the public domain (CC0) and its API terms allow non-commercial use with an identifying User-Agent; names of genres and styles are facts, not releases. The help centre and the terms pages answered with a bot check (HTTP 403) when this list was made, so the wording was not re-read then: confirm the terms once from a browser (open point of task-0035).
- How this list was made (2026-10-16): the help article could not be fetched, so the list was written from memory of it, extended with candidate names from the earlier reviewed table and the live library, and every name was then checked against the public Discogs database search (`https://api.discogs.com/database/search?style=<name>&per_page=10`, no token, one request every 2.5 s, under the 25 per minute limit, User-Agent `ElectrophoneVocabCheck/1.0`). A name is kept when releases with exactly that style exist (840 names were checked; 307 candidates with no exact style were left out). The result has 512 styles, fewer than the roughly 550 of the Discogs list: styles that could not be recalled are missing, and the diff against the article (open point of task-0035) closes the gap; until then a missing style can be added to `genre_extras.json`. The search cannot tell which genre a style belongs to (genre and style filter independently), so the style to genre relation comes from the reviewed table of ADR-0021 and from memory of the list; `also_under` is advisory. Names without a check are listed in `unverified` (0).

### Refresh

1. Get the current list (the help article in a browser, or single checks with the search above).
2. Diff it against `genre_styles.json` (new, renamed and removed names); keep the stored spelling rules above.
3. Review in git; an extras entry that becomes a Discogs style moves out of `genre_extras.json`.
4. `sh scripts/check.sh` (the validator tests of TAG-083 run on the new files); deploy; read `backups-genre-merge/review-<uid>.json` after the first start.

### Review notes

- Library tags that no rule maps (kept on the songs, listed in the review file): aaron smith, joris, medley, music video, party, popcorn, skrux, ⚈⚈.
- ALIASES and RETAGS targets must be canonical; add an alias in `app/genre_filter.py` before adding an extras entry for a mere spelling variant.
