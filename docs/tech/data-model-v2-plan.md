# Data model v2: implementation plan (task-0043)

Status: implemented on branch `worktree-agent-a9ef527b632364730`, not deployed. Spec: DATA-144 to DATA-155 in [data-model.md](../specs/data-model.md#data-model-v2-final-model-approved-2026-10-16), ADR-0025, [task-0043](../tasks/task-0043.md). Deploy steps: [deploy.md](deploy.md#data-model-v2-migration).

## 1. Field mapping (deployed ADR-0024 shape -> v2)

| Deployed | v2 stored | Note |
|---|---|---|
| `artists[]` | `mainArtists[]` | |
| `featured[]` | `featuredArtists[]` | |
| `released` | `releaseYear` | never the upload date (DATA-126 unchanged) |
| `album` (string or null) | `albums[]` | empty or null becomes `[]`; `albums[0]` is the original album |
| `version.kind` | `version.type` | values unchanged |
| `version.name` | `version.name` | |
| `version.by[]` | `version.artists[]` | |
| `version.year` | `version.releaseYear` | |
| `version.of[]` | `version.originalArtists[]` | only for `cover` and `mashup`; the key is absent when the list is empty |
| `raw{title,artist,remixer,year,remix_year}` | `rawTitle` (= `raw.title`) | `raw` is dropped only when the derived `artist` stays identical without it; otherwise `raw` stays and the song is listed in the review file |
| `sources[{source,id,url}]` | `sources[{platform,url}]` | `source` becomes `platform`; `id` is derived on output |
| `tags` with `decade:`, `lang:`, `country:` | `tags` (genre and plain tags only) | `decade:` computed at runtime, `lang:` discarded, `country:` moves to the Artist table |
| (new) | `artists` table in `library.json`: `[{name, countries[]}]` | one entry per main-artist name, keyed case-insensitively, never auto-split |
| `settings.credits_schema: 1` | `settings.credits_schema: 2` | the data-model version |

Decision D1 (genres): the stored list stays `tags[]` with `genre:` prefixed values (every genre rule, vocabulary check and migration already works on that form); `genres[]` (bare names) is a derived response field. Both names exist in the API; only `tags` is stored.

## 2. API contract (the web and iOS follow this)

Every song response carries the v2 fields: `mainArtists`, `featuredArtists`, `releaseYear`, `albums`, `genres` (derived, bare names), `version {type, name, artists, releaseYear, originalArtists?}` (key absent without a version), `sources [{platform, url}]` plus the legacy `source` and `id` on each entry, `rawTitle` (not for guests).
Legacy derived fields stay in every response (iOS decodes only these): `artist`, `remixer`, `remix_year`, `year`, `album` (= `albums[0]`), and `tags` as a view = stored tags + `decade:NNs` (from `releaseYear`) + `country:xx` (countries of the main artists).
The ADR-0024 names (`artists`, `featured`, `released`, `version.kind/by/year/of`, `raw`) are no longer in responses.

Requests (`POST /songs` metadata, `PATCH /songs/{id}`) accept, for one release, the new names, the ADR-0024 names and the flat legacy names. In one group the new name shadows the old one, which shadows the legacy one: `mainArtists`/`featuredArtists` > `artists`/`featured` > `artist`; `releaseYear` > `released` > `year`; `version` (either key set) > `remixer`/`remix_year`; `albums` > `album`. A legacy value equal to its current derived value is ignored (iOS echoes the whole form). `tags` in a request may still hold `decade:`, `lang:`, `country:`: `decade:` and `lang:` are dropped, `country:` is written to the Artist table when the song has exactly one main artist (otherwise ignored).

New: `GET /library` also returns `artists: [{name, countries}]`; `GET /artists` (same list, readable by guests); `PATCH /artists/{name}` with `{countries: [ISO 3166-1 alpha-2...]}` edits the countries (404 unknown name, 422 bad code).
Suggestions (`suggested_credits` in preview and metadata responses) use the new names.

## 3. Migration (`server/app/migrate_model2.py`)

Pure function `convert(doc) -> (new_doc, report)` over the raw JSON of the deployed shape (also accepts the flat legacy shape), then `check(old, new)` and file-level `migrate(path, dry_run)`.

1. Dry run (default for the CLI): converts a copy, writes a JSON report, touches nothing.
2. Check: for every song the five legacy derived fields (`artist`, `remixer`, `year`, `remix_year`, `album`) computed by the OLD projection from the OLD song must equal those computed by the new projection from the NEW song. Any difference aborts (nothing written).
3. Report: songs, tag removals per prefix (`decade`, `lang`, `country`), decade tags that disagree with `releaseYear`, version types, songs that kept `raw`, artist table size, artists with conflicting or unassignable countries (written to `review-artists-<uid>.json`, never applied), tag-view differences (informational).
4. Apply: backup of `library.json` to `<data repo>/backups-model2/<uid>/library.json` (outside the git-added tree; never overwritten, a numbered copy is made instead), atomic write, one git commit per user via `deps.tx`, `updated_at` untouched.
5. Refuses to run twice: a file that is already model 2 (`credits_schema` 2 and every song in the v2 shape) is reported `already_migrated` and left alone. Idempotent.
6. Startup: `main._startup` runs it first, before the genre-tag migration; `migrate_credits` was removed because the converter reads the flat and ADR-0024 shapes too (its review file stays as written). If the check fails the library stays unchanged and the server still serves it (the loader converts the shape in memory); the failure is logged.
7. CLI: `python -m app.migrate_model2 --library PATH [--report FILE] [--apply] [--backup-dir DIR]`.

## 4. Compatibility

- Loader (`library.normalize_song`) converts flat legacy, ADR-0024 and v2 shapes to v2 in memory, so no code path sees an old shape; `save_doc` absorbs legacy keys left by old writers.
- iOS: reads only derived fields (`artist`, `album`, `remixer`, `year`, `tags`, `sources` with `source`/`id`/`url`); pinned by `server/tests/fixtures/ios_contract.json`.
- Guest view keeps `mainArtists`, `featuredArtists`, `releaseYear`, `albums`, `genres`, `version`, legacy derived fields, artist countries; drops `rawTitle`.
- Rollback: old code cannot read the migrated file; restore the backup and the previous revision (loses later edits).

## 5. Test plan

- Migration: fixtures from the real shapes (the live guest snapshot as a derived-field oracle, ADR-0024 with `raw`, flat legacy), zero legacy-field diffs, deliberate-diff abort, tag removal counts, Artist table, review files, dry run writes nothing, backup, idempotence and refusal on a second run.
- Round trip: old -> new -> derived legacy equals old (property test).
- Legacy derivation and API compatibility: old-input/new-output, shadowing, echo no-op, ios contract.
- Web: renamed fields in store, forms, card, rows, filters, stats, share, genre pages.
- `scripts/check.sh` passes.

## 6. Out of scope

Artist country lookup from MusicBrainz or Wikipedia (implementation step 6 of task-0042/0043 order) is not built: countries come from the migrated `country:` tags and from manual edits. Chain/tree, Work and full Artist entities stay deferred (DATA-155).
