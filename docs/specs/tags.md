# Tags

Code: `server/app/library.py` (`clean_tag`, `clean_tags`, `tag_counts`),
`server/app/extractor.py` (`suggest_tags`), `server/app/genre_lookup.py`,
`web/js/library.js`, `web/js/store.js`, `web/js/tagname.js`, `web/js/tag-editor.js`, `server/app/langcodes.py`. ADR: ADR-0002.

## Semantics

- TAG-001 MUST: tags are the only grouping mechanism; there is no playlist entity and no `genre` field. A "playlist" is a tag filter. Status: implemented
- TAG-002 MUST: a tag is a plain string (`workout`) or namespaced `key:value` (`genre:synthwave`, `mood:chill`). Status: implemented
- TAG-003 MUST: the first `:` splits key and value. Status: implemented

## Normalisation (server: create, PATCH, preview, migration)

- TAG-010 MUST: whitespace is trimmed and runs of spaces collapsed. Status: implemented
- TAG-011 MUST: a valid `key:value` (both parts non-empty) is stored lowercased. Status: implemented
- TAG-012 MUST: a plain tag keeps its case. Status: implemented
- TAG-013 MUST: a tag with `:` but an empty key or value is dropped, never saved as a plain tag (`mood:` and `:x` vanish). Status: implemented
- TAG-017 MUST: the tag editor commits leftover input text on Save only if it is a complete tag (non-empty; for `key:value` both parts non-empty); an incomplete `mood:` or `:x` is ignored. Status: implemented
- TAG-014 MUST: empty tags are dropped; duplicates are removed case-insensitively, first occurrence wins, order preserved. Status: implemented
- TAG-016 MUST: namespaces `country:` (ISO 3166-1 alpha-2, e.g. `country:lt`) and `lang:` (ISO 639-1, e.g. `lang:ru`) are ordinary tags with normalised values: lowercase; `lang:` is no longer suggested (languages dropped, ADR-0012 note) but existing `lang:` tags keep this normalisation: a 3-letter code with a 2-letter equivalent is mapped (`rus` to `ru`) and a region suffix is dropped (`ru-RU` to `ru`); unknown shapes are kept as plain lowercase tags, never rejected. Status: implemented
- TAG-050 MUST: decade tags: the server derives `decade:<NN>s` from `year` for 1950-2029 (`decade:50s`, `60s`, `70s`, `80s`, `90s`, `00s`, `10s`, `20s`; 1994 gives `decade:90s`, 2007 `decade:00s`, 2013 `decade:10s`); a year outside that range or missing derives nothing. Status: implemented
- TAG-051 MUST: on every create, PATCH and load, when `year` is in range the song's `decade:*` tags are replaced by exactly the derived one (a manually typed or stale decade tag is overwritten, so changing the year updates it); when the year is missing or out of range existing `decade:` tags are left untouched. Existing songs with a year are migrated on load and saved on the next write. Status: implemented
- TAG-052 MUST: the `decade:` value is lowercased like any `key:value`; a value not matching `^\d{2}s$` is kept as a plain-normalised tag, never rejected. Status: implemented
- TAG-015 SHOULD: limit tag count and length (today none is enforced; only suggestions are capped: genre 3, country 1). Status: to-confirm

## Tag suggestions (Add preview only)

- TAG-020 MUST: suggested `genre:` tags come from exactly two sources: yt-dlp's real `genre` field and MusicBrainz. YouTube categories are never used. Status: implemented
- TAG-021 MUST: yt-dlp `genre` (string or list; strings split on `,` and `;`) becomes `genre:<value>` tags. Status: implemented
- TAG-022 MUST: the MusicBrainz lookup runs in `/preview` only, never at save. Artist and title are cleaned of noise (`Official Video`, `feat.`, `- Topic`, `VEVO`); a recording is accepted at score >= 90 with a loosely matching artist; genres and tags of the recording (else of the artist) are ranked by votes; top 3 are returned. Status: implemented
- TAG-023 MUST: yt-dlp and MusicBrainz tags are merged, normalised, de-duplicated and capped per namespace in `preview.tags` and `POST /metadata` (genre 3, country 1; `lang:` is dropped, API-048); the user can edit them before saving. Status: implemented
- TAG-024 MUST: a lookup failure, timeout (5 s), no match, or `AUDIO_TAG_LOOKUP` or `AUDIO_GENRE_LOOKUP` (alias) in `0|false|no|off` yields no tags and never fails `/preview`. Status: implemented
- TAG-025 MUST: MusicBrainz calls are limited to ~1 request/s globally and cached in memory per (artist, title). Status: implemented
- TAG-026 MUST: suggestions are written to a song only when the user saves the Add form. Status: implemented
- TAG-027 MUST: the same MusicBrainz lookup also suggests `country:<code>` from the matched artist's `country` (nothing when missing); no `lang:` tag is suggested from work languages or from yt-dlp's `language` field (languages dropped). The lookup also returns an `album` (used by `POST /metadata`): the release credited to the matched artist whose release group is an Album/EP/Single without Compilation/Mixtape/DJ-mix/Live/Remix types, Albums first, then the earliest date; none otherwise. One retry after 1 s on HTTP 503. A failing artist call keeps the recording's tags. Status: implemented

## Suggestions from Wikipedia and Wikidata

- TAG-040 MUST: the MusicBrainz lookup also requests `url-rels` (recording, artist; the first linked work when the recording has none) and picks the `wikipedia` relation, English preferred, else the `wikidata` one resolved to an English (else any) Wikipedia sitelink via `Special:EntityData/Q<id>.json`, else kept as the Wikidata URL. They go to `preview.wikipedia_song` / `wikipedia_artist`. Status: implemented
- TAG-041 MUST: facts come from structured Wikidata claims, never from article text: genre `P136` (English label, max 3, song first then artist; one batched `wbgetentities` call), country from the artist's `P495`, else `P27`, else `P740` via the place's `P17`, else the song's `P495`, mapped through `P297` to `country:xx` (the song's `P407` language is not used); year from the song's `P577` (earliest, precision year or finer), else MusicBrainz `first-release-date`; the artist's inception `P571` is never a song year. Status: implemented
- TAG-042 MUST: these merge into `preview.tags` after the MusicBrainz and yt-dlp tags (dedupe, per-namespace caps of TAG-023); `preview.suggested_year` carries the year and fills `year` only when yt-dlp gave none. Status: implemented
- TAG-043 MUST: `POST /lookup/wikipedia` derives the same tags and year from user-edited links (Wikipedia URL to Wikidata id via the `pageprops` API); the UI puts the tags in the Suggested row only. Status: implemented
- TAG-044 MUST: all Wikimedia calls use `AUDIO_MB_USER_AGENT`, a 5 s timeout and in-memory caches by Wikidata id; the `AUDIO_TAG_LOOKUP` switch disables them; any failure gives no suggestions and never breaks `/preview`. Status: implemented

## Counts and filtering

- TAG-030 MUST: `GET /tags` returns `[{tag, count}]` sorted case-insensitively; tags equal case-insensitively are one entry (first spelling shown). Status: implemented
- TAG-031 MUST: the web UI computes the same counts client-side from the loaded library (`store.tagCounts`), not from `/tags`. Status: implemented
- TAG-032 MUST: the Library filter groups chips by key: Genre, Decade (`decade`, chronological), Country (`country`), then other keys (title-cased, alphabetical), plain tags in group "Tags" last; a chip shows the value only (`pop`, not `genre:pop`) plus the count. Status: implemented
- TAG-033 MUST: filtering is single-select, exact case-insensitive match on the full tag; clicking the active chip clears it; a filter whose tag no longer exists is cleared. Status: implemented
- TAG-034 MUST: a song card shows `key:value` tags with the key as a highlighted prefix. Status: implemented
- TAG-036 MUST: `country:` values display as names via `Intl.DisplayNames`; `lang:` tags in stored data are kept untouched but hidden everywhere in the web UI (not shown, filtered, searched or offered; no Language group) (`web/js/tagname.js`; raw value as fallback, raw tag in the tooltip); search matches code and name; editing always uses the raw `key:value` tags. Status: implemented
- TAG-038 MUST: `decade:90s` displays as "the 90s" (raw tag in the tooltip, `web/js/tagname.js`); search matches "90s"; the tag editor previews the derived decade chip as soon as the Year input changes (the server is authoritative on save). Status: implemented
- TAG-037 MUST: tags are edited with the shared tag editor (LIB-055, ADD-004). Status: implemented
- TAG-035 SHOULD: multi-tag filtering (AND/OR). Status: planned
