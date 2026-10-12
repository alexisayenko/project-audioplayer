# Tags

Code: `server/app/library.py` (`clean_tag`, `clean_tags`, `tag_counts`),
`server/app/extractor.py` (`suggest_tags`), `server/app/genre_lookup.py`,
`web/js/library.js`, `web/js/store.js`. ADR: ADR-0002.

## Semantics

- TAG-001 MUST: tags are the only grouping mechanism; there is no playlist entity and no `genre` field. A "playlist" is a tag filter. Status: implemented
- TAG-002 MUST: a tag is a plain string (`workout`) or namespaced `key:value` (`genre:synthwave`, `mood:chill`). Status: implemented
- TAG-003 MUST: the first `:` splits key and value. Status: implemented

## Normalisation (server: create, PATCH, preview, migration)

- TAG-010 MUST: whitespace is trimmed and runs of spaces collapsed. Status: implemented
- TAG-011 MUST: a valid `key:value` (both parts non-empty) is stored lowercased. Status: implemented
- TAG-012 MUST: a plain tag keeps its case. Status: implemented
- TAG-013 MUST: a tag with `:` but an empty key or value is not namespaced; each `:` becomes a space (`a:` becomes `a`). Status: implemented
- TAG-014 MUST: empty tags are dropped; duplicates are removed case-insensitively, first occurrence wins, order preserved. Status: implemented
- TAG-015 SHOULD: limit tag count and length (today none is enforced; only preview suggestions are capped at 4). Status: to-confirm

## Genre suggestions (Add preview only)

- TAG-020 MUST: suggested `genre:` tags come from exactly two sources: yt-dlp's real `genre` field and MusicBrainz. YouTube categories are never used. Status: implemented
- TAG-021 MUST: yt-dlp `genre` (string or list; strings split on `,` and `;`) becomes `genre:<value>` tags. Status: implemented
- TAG-022 MUST: the MusicBrainz lookup runs in `/preview` only, never at save. Artist and title are cleaned of noise (`Official Video`, `feat.`, `- Topic`, `VEVO`); a recording is accepted at score >= 90 with a loosely matching artist; genres and tags of the recording (else of the artist) are ranked by votes; top 3 are returned. Status: implemented
- TAG-023 MUST: yt-dlp and MusicBrainz tags are merged, normalised, de-duplicated and capped at 4 in `preview.tags`; the user can edit them before saving. Status: implemented
- TAG-024 MUST: a lookup failure, timeout (5 s), no match, or `AUDIO_GENRE_LOOKUP` in `0|false|no|off` yields no tags and never fails `/preview`. Status: implemented
- TAG-025 MUST: MusicBrainz calls are limited to ~1 request/s globally and cached in memory per (artist, title). Status: implemented
- TAG-026 MUST: suggestions are written to a song only when the user saves the Add form. Status: implemented

## Counts and filtering

- TAG-030 MUST: `GET /tags` returns `[{tag, count}]` sorted case-insensitively; tags equal case-insensitively are one entry (first spelling shown). Status: implemented
- TAG-031 MUST: the web UI computes the same counts client-side from the loaded library (`store.tagCounts`), not from `/tags`. Status: implemented
- TAG-032 MUST: the Library filter groups chips by key: one group per key (title-cased, sorted alphabetically), plain tags in group "Tags" last; a chip shows the value only (`pop`, not `genre:pop`) plus the count. Status: implemented
- TAG-033 MUST: filtering is single-select, exact case-insensitive match on the full tag; clicking the active chip clears it; a filter whose tag no longer exists is cleared. Status: implemented
- TAG-034 MUST: a song card shows `key:value` tags with the key as a highlighted prefix. Status: implemented
- TAG-035 SHOULD: multi-tag filtering (AND/OR). Status: planned
