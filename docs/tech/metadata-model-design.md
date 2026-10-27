# Metadata model design: structured credits and versions

Design for [task-0036](../tasks/task-0036.md), written against the real code on 2026-10-16. Requirements it implements: DATA-120 to DATA-125, ADD-111/112, LIB-134 (built and deployed 2026-10-16). This file is the single plan for three builders: `server`, `form`, `display`. Builders append only to the "Contract changes" appendix at the end.

Decisions taken here that go beyond the task text are marked **D** and listed again under Risks.

## 0. Summary

- Stored song: `title` (base), `artists[]`, `featured[]`, `released`, optional `version {kind, name, by[], year, of}`, plus an immutable `raw {...}` of the original source strings. The four legacy keys `artist`, `remixer`, `remix_year`, `year` are NOT stored after migration.
- API responses keep `title`, `artist`, `remixer`, `year`, `remix_year` as derived compatibility values, next to the new keys. The iOS app never sees a changed type or a missing key.
- Requests may send legacy keys, structure keys, or both. Structure wins per group; a legacy value equal to the current projection is a no-op, so an iOS round trip never damages structure.
- No automatic splitting of `&`, `,`, `feat.` anywhere in the migration. `artists` is one entry per existing pill token (the separator rules of ADD-071). Splitting exists only as a suggestion (`credits_split`), shown in the form and listed in a review file.
- Migration: idempotent, per user, at startup, with a one-time backup and a review file, plus an in-memory lazy migration at load (DATA-025) so no code path ever sees an old record.

## 1. Inventory of current use

Fields in question: `title`, `artist`, `remixer`, `year`, `remix_year`, `tags` (decade tag derives from `year`), `sources` (links only; untouched).

### 1.1 Server (`server/app`)

| File | Use | Change |
| --- | --- | --- |
| `schemas.py` | `SongMeta`: `title, artist, album, remixer, year, remix_year` (+ links, bpm). `PatchSongRequest(SongMeta)`. `CreateSongRequest.metadata: SongMeta = SongMeta()`. `MetadataRequest {title, artist, sources, wiki_*}` | add `artists, featured, released, version` (`VersionIn`), `source_raw` on create; `MetadataRequest` gains optional `version_kind` |
| `library.py` | `normalize_song`: strips `remixer`; `normalize_tags` uses `s["year"]` for `decade:*`; `public_song` adds `audio_state`, `sources`, `remix_year`; `download_name` uses `artist`, `title`; `with_decade(tags, year)`; `catalog_revision` hashes public songs | lazy `credits.ensure`; decade from `released`; `public_song` adds the projection; `download_name` via `credits.artist_string` |
| `routes/songs.py` | `_TEXT_FIELDS = (title, artist, album, remixer)`; `_check_years` for `year`, `remix_year`; `_edited` assigns `year`, `remix_year`, recomputes `decade` from `year`; `create_song` builds `meta` from `model_dump()` and runs `titleclean.clean` on `title` | structure-aware create and edit through `credits.apply_changes`; `model_dump(exclude_unset=True)` so "sent" is knowable; year checks on `released`, `version.year` |
| `downloads.py` | two record builders (`_downloaded_song` line ~135, `add_metadata_only` line ~235) write `title, artist, remixer, year, remix_year`; `with_decade(tags, year)` | build with `credits.new_fields(meta, raw)`; no legacy keys written |
| `extractor.py` | `preview`/`probe`/SoundCloud: `title, artist, remixer` via `titles.split_title` / `cut_remix`; `_year` takes `release_year`, else `release_date`, else **`upload_date`**; `_published_year` separately | add `raw` and `suggested_credits` to the preview; Decision AR (DATA-126, [details](metadata-model-decisions-AR.md)): `_year` drops the `upload_date` fallback and also `release_year`/`release_date`, so `preview.year` is never publish- or platform-derived; `_published_year` stays and feeds only `version.year` suggestions |
| `titles.py` | `split_artist_title`, `split_title`, `cut_remix`, `normalize_feat`, `lookup_credits` (primary + featured names split on `, & and x`), `artist_candidates`, `lookup_title`, `lookup_query` | unchanged; `credits_split` reuses `_FEAT_KEY`, `_REMIX_WORD`, `lookup_credits` |
| `titleclean.py` | promo-noise cleaning of `title` on add (twin of `web/js/title-clean.js`) | unchanged |
| `metadata.py` | `gather(title, artist, ...)`, `merge` returns `{album, year, published_year, remix_year, tags}`; its `years` chain today ends with the yt-dlp `sources` years; `services` includes `musicbrainz.url` | accept `version_kind`; for a version drop `services.musicbrainz` and the Discogs url; additive `version_year` = `remix_year`; AR: `year` chain is wiki links/infobox/guess, then MusicBrainz, then Discogs (new), yt-dlp source years removed; for a version the lookup uses the base `title` and the original `artists` (the `of` artist for a cover) |
| `genre_lookup.py` | `_first_year` / `lookup` year of the recording | AR: earliest credible year, never a compilation-derived date (Haddaway 1993 case test) |
| `discogs_lookup.py` | `_year`: earliest year over releases, various-artists excluded | kept; its year joins the `merge` chain |
| `identify.py` | reads `song["artist"]`, `song["title"]`; returns links incl. `musicbrainz` | read through `credits.artist_string`; for a version song the `musicbrainz` link is not offered |
| `metafill.py` | `_needs` tests blank `year`; `apply` fills `year` when blank and `musicbrainz_url` from `services.musicbrainz.url`; `_fetch` passes `title`, `artist` | read/write `released`; never fill `musicbrainz_url` or `discogs_url` for a song with a version; `album` fill skipped for a version song (SHOULD) |
| `routes/lookup.py` | `/preview` returns extractor meta plus `suggested_year`, `remixer`, `title_raw`; `/metadata` passes `title`, `artist` | additive keys only (section 5) |
| `routes/analyze.py`, `routes/covers.py` | return `library.public_song` | no change (public_song changes) |
| `routes/catalog.py` | `/library`, `/catalog` return `deps.public_songs`, guest scrubbed | add top-level `credits_schema` |
| `guest.py` | `SONG_KEYS` whitelist includes `title, artist, remixer, year, remix_year` | add `artists, featured, released, version`; `raw` stays out |
| `genre_lookup.py`, `wiki_lookup.py`, `discogs_lookup.py`, `acoustid_lookup.py` | take `(artist, title)` strings, own `year` results | unchanged; callers pass `credits.artist_string(song)` and the base `title` |
| `gitstore.py`, `deps.py`, `users.py` | git commits of `audioplayer/`; `deps.tx`, `deps.data_root`, backups live outside the git-added tree | reused by the migration; unchanged |
| `migrate_tags.py` | the genre migration pattern: `_stale`, `backup_path`, `review_path`, `migrate`, `run`, `write_review` | template for `migrate_credits.py` |
| `main.py` | `_startup`: `migrate_tags.run()` | add `migrate_credits.run()` |
| `scripts/clean-titles.py` | rewrites `title` only | verify it keeps unknown keys (it must not drop `artists`, `raw`); no code change expected |

Other `tags`/`sources` uses (`library.clean_tags`, `genre_filter`, `sources_of`) are independent of this model. `decade:` is derived from the release year only; with `released` it is unchanged in meaning.

### 1.2 Web (`web/js`)

| File | Reads / writes | Owner after change |
| --- | --- | --- |
| `song-form.js` | fields `title, artist, remixer, album, year, remixYear` (token fields via `token-field.js`); `values()` returns `title, keep_title, artist, remixer, album, year, remix_year, tags, wiki*...`; `setValues`, `reset`; remix-year auto suggestion from `published_year` and `remix_year` of `/metadata` | form |
| `song-payload.js` | `songFields` (`title, artist, album, remixer, year, remix_year`), `yearError`, `addBody`, `patchBody`, `metadataBody` (`title`, `artist`) | form |
| `remix-year.js` | `planRemixYear({remixer, current, auto, published, specific})` | form |
| `token-field.js`, `tokens.js` | field kinds `title`, `artist`, `remixer` (`SEPARATOR ' - '`), `splitTokens`, `joinTokens` | form (`token-field.js`); `tokens.js` is read-only shared |
| `song-form-title.js`, `song-form-bpm.js` | title cleaning hint; moves a pill between title and artist (`f.artist`) | form |
| `add.js` | `paintMeta`: `[v.artist, v.album, v.year]`; "Already in your library": `[song.title, song.artist]` | form |
| `metadata-apply.js` | `cur.year`; `suggestionText(sug, cur)` uses `artist`, `title` | form |
| `edit-dialog.js` | `dialogHead('Edit song', null)`, delete text `"${s.title}"`, `patchBody` | display |
| `display-title.js` | `displayTitle` (title plus remixer pills, deduped against the title), `displayString`, `remixTooltip` (uses `remix_year`), `titleNodes`, `subtitleString` (`artist · year`) | display (was a facade over `credits.js`; removed, task-0122 F6) |
| `track-sub.js` | `trackSub`: `artist · year` | display (removed, task-0122 F6; `credits.subtitle`) |
| `library-rows.js` | `displayString`, `titleNodes`, `trackSub`, tooltip `${full} - ${s.artist}` | display |
| `library-data.js` | sort `artist` (`a.artist`, then `title`), `year` sort, search hay `[title, artist, album, remixer, tags]` | display |
| `player.js` | `fullTitle`, mini player (`mini-title` via `titleNodes`, `mini-artist` = `song.artist`), `player-title`, `player-sub` = `subtitleString`, `document.title` | display |
| `player-ui.js` | queue rows: `displayString`, `titleNodes`, `s.artist`; mini artist line | display |
| `player-media.js` | Media Session `title: displayString`, `artist: song.artist` | display |
| `share-open.js`, `share-ui.js` | share page header `song.artist`; `navigator.share({title: displayString})` | display |
| `song-card.js` | `cardModel`: `displayTitle`, `subtitleString`, `remixYear` fact from `remix_year` | display |
| `stats.js`, `stats-table.js`, `stats-data.js`, `stats-chart.js` | `titleNodes`, `displayString`, `song.artist`, `song.year` (plot, decade) | display (`artist` uses); `year` users keep working on the derived `year` |
| `genres.js` | now-playing: `titleNodes(song)`, `song.artist` | display |
| `viz-ui.js` | `titleNodes(song)`, `song.artist` | display |
| `bulk.js` | name `[s.artist, s.title].join(' - ')` | display |
| `identify-plan.js`, `identify-block.js` | `matched.artist`/`title` from the server's `identify` result (not song fields); `getYear` | form (`identify-block.js`: `getYear` becomes released), `identify-plan.js` unchanged |
| `api.js` | forwards bodies; no field knowledge | unchanged |
| `style.css` | `.remix-row`, `.suggested` | form |

### 1.3 iOS (`ios/Sources`, read only)

What the app DECODES (Swift `Codable`; unknown keys are ignored, so new keys are safe; the catalog decoder drops a whole song when one decoded key has a wrong type, `CatalogResponse.Lossy`, so types of these keys must never change):

- `ServerSong` (`ServerLink.swift`): `id` String, `title` String (non-optional: never null or absent), `artist` String?, `album` String?, `remixer` String?, `year` Int?, `duration` Double?, `cover` String?, `tags` [String]?, `bpm` Double?, `source_url` String?, `wikipedia_song` String?, `wikipedia_artist` String?, `musicbrainz_url` String?, `added_at` String?, `audio_state` String?, `sources` [`SongSource {source, id, url}`]?.
- `CatalogResponse` (`APIModels.swift`): `ids` [String], `songs` [ServerSong] (lossy). Reads the `ETag` header; `since` query.
- `Preview`: `id`, `source`, `source_url`, `title`, `artist`, `album`, `remixer`, `year` Int?, `duration`, `thumbnail`, `tags`, `wikipedia_song`, `wikipedia_artist`, `in_library`.
- `MetadataResult`: `album`, `year`, `tags`, `services{youtube,soundcloud,wikipedia,spotify,musicbrainz,discogs: {found,url}}`, `suggest{artist,title}`.
- `SongStatus`: `status`, `progress`, `error`. `SearchResult`: `id,title,artist,duration,thumbnail` (search route, outside this change).
- `Track` is the on-device model: `title, artist (String), remixer, year, album, tags, bpm, sourceURL, wikipedia*, musicbrainzURL, addedAt, sources`. It has no `remix_year`, `released`, `artists`, `version`.

What the app SENDS:

- `POST /songs` `{url, metadata:{title, artist, album, remixer|null, year|null, wikipedia_song|null, wikipedia_artist|null, musicbrainz_url|null}, tags}` (`AddSheet.swift`).
- `PATCH /songs/{id}` `{title, artist, album, remixer|null, year|null, wikipedia_song, wikipedia_artist, musicbrainz_url, tags}` (`SongEditView.swift`): the whole form every time, so every unchanged legacy value comes back (hence the no-op rule in 3.3).
- `POST /metadata` `{title, artist, sources:[{url}], wiki_song|null, wiki_artist|null}`; `POST /preview` `{url}`.
- It never sends `remix_year`, `album` is a non-null string.

## 2. Stored schema (after migration)

`library.json` keeps `{settings, songs}`. New: `settings.credits_schema = 1` (idempotence marker and schema version).

Song keys added or changed (every other key unchanged):

| Key | Type | Rule |
| --- | --- | --- |
| `title` | string | base title, never empty; no version text for songs created in the new form; migrated songs keep their title untouched |
| `artists` | list of string | main artists, ordered, trimmed, no empty entries, case-insensitive duplicates dropped on write (not on migration); may be empty (unknown artist); presence of this key is the per-song migrated marker |
| `featured` | list of string | same rules; `[]` when none |
| `released` | int or null | first release year of the original recording, 1900..`max_year()` on write (a stored out-of-range int is kept, as today) |
| `version` | object, absent when none | `{kind, name, by, year, of}`; key absent means no version (never `null`, never `{}`) |
| `version.kind` | enum | `remix, live, acoustic, extended, instrumental, remaster, edit, cover, other` |
| `version.name` | string or null | credited text exactly as written |
| `version.by` | list of string | remix by; `[]` when unknown |
| `version.year` | int or null | year of the version (replaces `remix_year`) |
| `version.of` | string or null | original artist; only when `kind` is `cover` (422 otherwise on write) |
| `raw` | object | immutable source strings, see below |

A version is dropped on write when `kind` is `other` and `name`, `by`, `year`, `of` are all empty.

`raw` holds the values as first stored or as the source gave them, never edited by any endpoint after it is set: `{title?, artist?, remixer?, year?, remix_year?}` (a key only when the original value was a non-empty string or an int). It exists for audit and for re-suggesting; it never feeds display or search. Set once: by the migration for old songs; for new songs from `source_raw` of `POST /songs` (the web form passes what the preview showed before any edit) else from the submitted legacy strings. Stripped from the guest view.

Removed from the file after migration: `artist`, `remixer`, `remix_year`, `year` (one editable source of truth). They exist only in API responses.

Examples (post-migration records, other keys omitted):

```json
// A: two main artists, no version. A song migrated from artist "Martin Garrix & Tiesto" would instead have artists ["Martin Garrix & Tiesto"] until the user accepts the split.
{"title": "The Only Way Is Up", "artists": ["Martin Garrix", "Tiesto"], "featured": [], "released": null,
 "raw": {"title": "The Only Way Is Up", "artist": "Martin Garrix & Tiesto"}}

// B: released 1993; the 2014 YouTube upload year is only published_year in the preview, never stored as released
{"title": "What Is Love", "artists": ["Haddaway"], "featured": [], "released": 1993, "raw": {"title": "What Is Love", "artist": "Haddaway", "year": 1993}}

// C: live version; released unknown, version.year unknown
{"title": "Cold Heart", "artists": ["Dua Lipa", "Elton John"], "featured": [], "released": null,
 "version": {"kind": "live", "name": "Live, Royal Albert Hall", "by": [], "year": null}}

// D: three artists, remix; by filled by the user (migration would leave by empty)
{"title": "Pressure", "artists": ["Nadia Ali", "Starkillers", "Alex Kenji"], "featured": [], "released": null,
 "version": {"kind": "remix", "name": "Alesso Remix", "by": ["Alesso"], "year": null}}

// E: cover (DATA-122): Artist B covers Artist A
{"title": "Song", "artists": ["Artist B"], "featured": [], "released": null,
 "version": {"kind": "cover", "name": null, "by": [], "year": null, "of": "Artist A"}}

// F: featured
{"title": "Turn The Lights Off", "artists": ["Kato"], "featured": ["Jon"], "released": 2009}

// G: a migrated legacy song (artist "Nadia Ali, Starkillers & Alex Kenji", remixer "Alesso Remix", year 2009, remix_year 2012): ONE artists entry, nothing split
{"title": "Pressure", "artists": ["Nadia Ali, Starkillers & Alex Kenji"], "featured": [], "released": 2009,
 "version": {"kind": "remix", "name": "Alesso Remix", "by": [], "year": 2012},
 "raw": {"title": "Pressure", "artist": "Nadia Ali, Starkillers & Alex Kenji", "remixer": "Alesso Remix", "year": 2009, "remix_year": 2012}}
```

Example A's `released` is null: not verified.

Key order written (stable diffs): existing keys, then `artists, featured, released, version, raw` placed where `artist` stood.

## 3. Compatibility projection

One module owns it: `server/app/credits.py`.

### 3.1 Structure to legacy (on every read, in `library.public_song`)

| Legacy key | Value |
| --- | --- |
| `title` | `title` (base title; same key, same meaning as the new key) |
| `artist` | `null` when `artists` and `featured` are empty. Else, when `featured` is empty and `raw.artist` exists and `split_tokens(raw.artist) == artists`: `raw.artist.strip()` (exact round trip of migrated and untouched data). Else `join_names(artists)` plus `" feat. " + join_names(featured)` when featured exist |
| `remixer` | `null` without a version. Else `version.name` when non-empty; else `join_names(by)` when non-empty; else the capitalised `kind` unless `other` ("Live", "Cover"); else `null` |
| `year` | `released` |
| `remix_year` | `version.year`, `null` without a version |

`join_names`: one name as is; two `A & B`; three or more `A, B & C` (the same function exists in `web/js/credits.js`; both are tested against one table in `server/tests/fixtures/credits_split_cases.json`, section "join"). The legacy `artist` for new multi-artist songs is therefore what the display line shows. Server lookups already tolerate it (`titles.artist_candidates` splits on `, ` and ` - ` and tries the whole string first; `titles.lookup_credits` splits `, & and x`).

Legacy `remixer` for non-remix versions is a **D**: the iOS app labels the line "Remix: ..." (IOS-063); a live version reads "Remix: Live, Royal Albert Hall". Cosmetic, additive, fixable later in iOS; the alternative (appending `(Live, ...)` to `title`) would give `title` two meanings and was rejected.

Always present in responses: `artists` (`[]`), `featured` (`[]`), `released` (null), `title`, the five legacy keys. `version` only when set. `raw` for the owner and signed-in users, never for guests.

### 3.2 Legacy to structure (on write: POST metadata, PATCH, and any in-memory change saved by `library.save_doc`)

Groups; within a group a structure key present in the request shadows every legacy key of that group (even a different one):

| Group | Structure keys | Legacy keys it shadows |
| --- | --- | --- |
| credits | `artists`, `featured` | `artist` |
| version | `version` | `remixer`, `remix_year` |
| released | `released` | `year` |
| title | `title` | (same key) |

"Present" means present in the JSON body (pydantic `exclude_unset`), so explicit `null` counts: `version: null` removes the version and shadows `remixer`. Within one group `artists` alone leaves `featured` unchanged and vice versa. A `version` object REPLACES the whole stored version (no key-level merge); omitted sub-keys become `by: []`, `name`, `year`, `of` null.

Legacy-only writes (iOS, old web, scripts) when no structure key of the group is present, each applied only if the value differs from the current projection (3.3):

- `artist` string `v` (trimmed; blank is none): `artists = split_tokens(v)`, `featured = []`. The whole string is kept as pills; nothing is parsed. If the old `featured` had entries they are replaced, because the sent string is the whole credit line that the client displayed (it contained them via `feat.`).
- `remixer`: blank or null removes the version entirely. Non-blank: if a version exists `name = v` (kind, `by`, `year`, `of` kept); else `version = {kind: kind_for(v), name: v, by: [], year: null}` where `kind_for` is `other` when the text matches `mixed by` and not `remix|mashup`, else `remix`.
- `remix_year`: sets `version.year` (null clears); with no version and a non-null value creates `{kind: "other", name: null, by: [], year: v}`. Empty versions are dropped.
- `year`: sets `released` (null clears). Range check as today (1900..`max_year()`, an unchanged stored value passes).
- `title`: replaces `title`, trimmed, non-empty (422 else), no parsing of feat or remix text.

Apply order inside one request: structure keys, then the unshadowed legacy keys in the order `artist`, `remixer`, `remix_year`, `year`, `title`.

In-memory modules that still assign legacy keys on a loaded song (`metafill` sets `song["year"]`) are covered by the same rule inside `library.save_doc`: `credits.absorb(song)` compares any legacy key present with the projection of the structure and applies the difference as a legacy write, then deletes the legacy keys. Builders must still switch such code to `released`; the absorb step is the safety net, with a logged warning.

### 3.3 No-op rule (iOS safety)

For each legacy key sent: normalise both sides (`strip`, blank to `None`, ints compared as ints) and skip when equal to the projection. The iOS edit form sends `title, artist, album, remixer, year` every time; for an unchanged song none of them alters structure, so `artists`, `featured`, `version.by`, `raw` and `version.kind` survive an iOS edit untouched. Only a value the user changed is converted.

### 3.4 Precedence summary

1. Structure key in the request wins over its legacy twin; the legacy twin is ignored without error (a test pins this).
2. Legacy key equal to the projection: ignored.
3. Legacy key different: converted per 3.2.
4. Unknown keys in the body: `SongMeta` ignores extras as today (pydantic default). `version` with unknown sub-keys: 422 (`extra="forbid"` on `VersionIn`). Bad `kind`: 422 listing the allowed kinds.
5. Nothing is ever written to `raw` by a request after creation.

### 3.5 Limits (validation on write)

At most 30 names per list, 200 characters per name, `version.name` 300, `version.of` 200, trimmed, empty entries dropped. `by`/`artists`/`featured` duplicates dropped case-insensitively, first spelling kept. Years via `timeutil.valid_year` with the "unchanged stored value passes" exception for `released` and `version.year`.

## 4. Migration

New file `server/app/migrate_credits.py`, same shape as `migrate_tags.py`. Pure per-song function lives in `credits.py` (`ensure`, `migrate_fields`).

### 4.1 Per-field rules (`credits.migrate_fields(song)`)

| Old | New | Notes |
| --- | --- | --- |
| `title` | `title` unchanged | never modified; feat or remix text inside it only goes to the review list |
| `artist` (string or null) | `artists = split_tokens(artist)` | one entry per pill token under ADD-071 (separators: spaced `-`, `–`, `—`, `|`, `/`, `//` and fullwidth); `&`, `,`, `and`, `feat.`, `ft.`, `x` never split; blank or null gives `[]`; a Python port of `tokens.js` (`server/app/tokens.py`) is checked against `web/js/tokens.js` by a shared fixture |
| (none) | `featured = []` | |
| `year` | `released = year` when an int (bool and non-numeric rejected; a digit string is converted); out-of-range ints are kept | the year of the original recording per ADD-101; cannot detect songs whose `year` is really an upload year (Risks) |
| `remixer` (trimmed) | `version.name = remixer` | verbatim |
| | `version.kind`: `remix`; `other` when the text has `mixed by` and not `remix`, `mashup` | **D**: `remix` for any other non-blank text because the field is documented as "Remix & additional production"; weak cases (no `remix`/`mashup`/`mix`/`edit` word) are listed in the review file |
| | `version.by = []` | **D**: the pills of the remixer field are credited text ("Alesso Remix", "Gabriel & Dresden Chill Mix"), not names; nothing is invented. A candidate list goes to the review file and is offered in the form |
| `remix_year` | `version.year` | when there is a `remixer`; with none: `version = {kind: "other", name: null, by: [], year}` and a review entry `remix_year_without_remixer` |
| (none) | `version` absent | when no remixer and no remix_year |
| all five old values | `raw` | verbatim from the stored JSON before any normalisation |
| `artist`, `remixer`, `remix_year`, `year` | removed | |
| `updated_at` | untouched | so the catalog `since` delta is not flooded |

Invariant (property-tested): for every legacy song `s`, `project(migrate(s))` equals `s` on `title, artist, remixer, year, remix_year` after trimming and blank-to-null. Whitespace-only `artist` and `remixer` project as `null`.

### 4.2 Idempotence, backup, review, startup

- Marker: per song, `"artists"` is a list; per file, `settings.credits_schema == 1`. `migrate(path)` returns `False` when no song lacks `artists` and the marker is set. Running twice changes nothing (byte-equal file).
- Lazy: `library.normalize_song` calls `credits.ensure(s)` first, before any other normalisation, so every loader (`library.load`, `load_doc`, tests, scripts) sees the new shape (DATA-025: in memory at load, persisted on the next write). A song written by an older build is migrated again on the next load and at the next startup.
- Backup: `<data repo root>/backups-credits/<uid>/library.json`, copied once, only when absent, before the first rewrite (`shutil.copy2`, like `backups-genre-merge`). Outside the git-added `audioplayer/` tree. Rollback to the old build means restoring that file; edits made after migration would be lost, so rollback is a last resort (Risks).
- Write: `deps.tx(uid, "migrate credits")` then `library.save_doc`; one git commit per user via the existing `SYNC.commit` message `audioplayer: <uid8> migrate credits`.
- Review file: `<data repo root>/backups-credits/review-credits-<uid>.json`, rewritten only when its content changed: `{uid, schema: 1, items: [{id, title, artist, remixer, flags: [...], suggested: {artists?, featured?, title?, version?: {kind, by}}}]}`. Never applied. Flags (detected by `credits_split.review_flags(raw)`): `feat_in_artist`, `feat_in_title`, `multi_artist_in_one_pill` (`&`, `,`, ` and `, ` x `, ` vs `), `remix_text_in_title`, `mixed_by`, `live`, `acoustic`, `unplugged`, `extended`, `instrumental`, `remaster`, `edit`, `cover` (words in title or remixer), `remixer_without_remix_word`, `remix_year_without_remixer`, `blank_artist`, `year_out_of_range`. A summary line is logged per user (counts per flag) like `genre review`.
- Startup integration: `main._startup` calls `migrate_credits.run()` right after `migrate_tags.run()`, which already ran `deps.SYNC.resync()`. `run()` iterates `users/*/library.json` (all users, owner included), isolates failures per user (`log.exception`, server still starts because of the lazy path), writes the review for every user.
- Order with the genre migration: independent; `normalize_tags` derives `decade:` from `released` after `ensure`.

## 5. API changes

Every change is additive for responses; requests accept the new keys beside the old ones.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /songs` | `metadata` gains `artists, featured, released, version`; top-level `source_raw?: {title?, artist?, remixer?}` | song objects (the 201 `song` of `audio:false`) carry the section 2 keys and the 3.1 projection |
| `PATCH /songs/{id}` | any of `title, artists, featured, released, version (object or null), artist, remixer, year, remix_year, album, bpm, tags, links...` | the updated song, projection included; 422 `artists must be a list of at most 30 names`, `version.kind must be one of ...`, `version.of is only for covers`, `released must be 1900..N`, `version.year must be 1900..N` (same year text as today for legacy keys) |
| `POST /preview` | unchanged | unchanged legacy keys (`title` cut of remix, `artist`, `remixer`, `year`, `published_year`, `suggested_year`, `title_raw`) plus `raw: {title, artist, remixer}` (the extractor strings before cut/clean) and `suggested_credits: {artists, featured, version: {kind, name, by}\|null, notes: [str]}` (a suggestion only; the form shows it behind "Suggested split") and `released_suggestion: {year, source}` where `source` is `wikipedia`, `musicbrainz` or `discogs` only (AR: neither `upload_date` nor yt-dlp `release_year`/`release_date` is ever a source; no source means `year: null` and `released_suggestion: null`); `suggested_year` is wiki, then MusicBrainz, then Discogs; `year` is filled from the same chain |
| `POST /metadata` | unchanged; additive optional `version_kind` | unchanged; additive `version_year` (same value as `remix_year`, which stays); `services.musicbrainz` and the Discogs url empty when `version_kind` is set |
| `GET /library`, `GET /catalog` | - | each song as above; top-level `credits_schema: 1` (iOS ignores it); catalog `revision` changes once after the migration, which only makes iOS refetch |
| Guest view (`guest.scrub_song`) | - | whitelist adds `artists, featured, released, version`; `raw` and `metadata_checked_at` stay out; legacy keys remain |
| `POST /songs/{id}/identify` (analyze route) | - | request unchanged; for a song with a version the `links.musicbrainz` suggestion is `null` |

Schema versioning: file level `settings.credits_schema` (1), API level `credits_schema` in the two list responses. A future change bumps both and ships a migration the same way.

## 6. Module plan

One owner per file. A builder never edits a file owned by another; shared behaviour is agreed through the Contract appendix. Order: server contract first (phase 1), then display and form in parallel (phase 2), then docs and the iOS contract proof (phase 3).

### server

| File | Content |
| --- | --- |
| `server/app/tokens.py` (new) | `tokenize`, `split_tokens`, `join_tokens`, port of `web/js/tokens.js` |
| `server/app/credits.py` (new) | `KINDS`, `join_names`, `ensure`, `migrate_fields`, `new_fields(meta, raw)`, `project`, `artist_string`, `released`, `version_text`, `kind_for`, `clean_changes` (validation, `ValueError` to 422), `apply_changes`, `absorb` |
| `server/app/credits_split.py` (new) | `suggest(artist, title, remixer)`, `review_flags(song)`; reuses `titles.py` regexes; never applied automatically |
| `server/app/migrate_credits.py` (new) | `migrate`, `run`, `write_review`, `backup_path`, `review_path` |
| `server/app/schemas.py` | `VersionIn`, new `SongMeta` keys, `source_raw`, `MetadataRequest.version_kind` |
| `server/app/library.py` | lazy `ensure` in `normalize_song`, `public_song` projection, decade from `released`, `download_name`, `save_doc` absorb |
| `server/app/routes/songs.py` | `create_song` (`exclude_unset`), `_edited`, `_check_years` for the new keys |
| `server/app/downloads.py` | both record builders |
| `server/app/extractor.py` | `raw`, `suggested_credits`, `year` without upload fallback |
| `server/app/routes/lookup.py` | additive preview/metadata keys, `released_suggestion` |
| `server/app/metadata.py` | `version_kind` handling, `version_year` |
| `server/app/metafill.py` | `released`, no `musicbrainz_url`/`discogs_url`/`album` fill for version songs |
| `server/app/identify.py` | `artist_string`, no MusicBrainz link for versions |
| `server/app/routes/catalog.py` | `credits_schema` |
| `server/app/guest.py` | `SONG_KEYS` |
| `server/app/main.py` | startup call |
| `server/tests/test_credits.py`, `test_tokens.py`, `test_credits_split.py`, `test_migrate_credits.py`, `test_ios_contract.py`, `test_credits_properties.py` (new) | section 7 |
| `server/tests/test_remix_year.py`, `test_metadata.py`, `test_guest.py`, `test_library.py` | adapt expectations that read `year`/`remix_year` |
| `server/tests/fixtures/ios_contract.json`, `token_cases.json`, `credits_split_cases.json`, `legacy_library_sample.json` (new) | shared fixtures; the web twins read them |
| `docs/specs/data-model.md`, `docs/specs/api.md`, `docs/tech/decisions.md` (ADR-0024), `docs/tech/README.md`, `docs/tasks/task-0036.md`, `docs/specs/ios.md` (gap note), `docs/CHANGELOG.md` | rule text; ids DATA-127..139, API-120..135, IOS-072..074 |
| `server/app/genre_lookup.py` | AR: earliest credible recording year, compilation guard, Haddaway-style test in `server/tests/test_genre_lookup.py` |
| `server/app/extractor.py` (also above) and `server/tests/test_extractor_mapping.py`, `test_year_limit.py` | AR: upload-only year gives `year: null` and no `decade:` tag |

### form

| File | Content |
| --- | --- |
| `web/js/song-form.js` | fields Title, Artists (pills), Featuring (pills), Version (select), Version name, Remix year, Remix by (pills), Cover of (shown only for Cover), First released, live preview line (`credits.displayLine`), `values()` returns structure keys only |
| `web/js/song-form-credits.js` (new) | the credits block, the "Suggested split" button and panel (Apply / Dismiss per suggestion), the by-versus-name warning |
| `web/js/credits-split.js` (new) | web twin of `credits_split.suggest` (pure) |
| `web/js/song-payload.js` | `addBody`, `patchBody` send `artists, featured, released, version`, no legacy key; `yearError` over `released` and `version.year`; `metadataBody` sends `artist` = display artist string, plus `version_kind` |
| `web/js/remix-year.js` | `planVersionYear({kind, name, current, auto, published, specific})`; `planRemixYear` kept as an alias until tests move |
| `web/js/token-field.js` | field kinds `artists`, `featured`, `by` (same separator rules) |
| `web/js/metadata-apply.js` | `released`, `version_year` |
| `web/js/add.js` | preview header line, "Already in your library" text through `credits.js`; passes `source_raw` |
| `web/js/identify-block.js` | `getYear` reads First released |
| `web/style.css` | layout of the new rows, tokens only |
| tests: `song-form.test.mjs`, `song-payload.test.mjs`, `remix-year.test.mjs`, `token-field.test.mjs`, `add.test.mjs`, `metadata-apply.test.mjs`, new `song-form-credits.test.mjs`, `credits-split.test.mjs`, `tokens-parity.test.mjs` | |
| `docs/specs/add-song.md`, `docs/specs/web.md` | ADD-112 text, ids ADD-113..125, WEB-089..092 |

### display

| File | Content |
| --- | --- |
| `web/js/credits.js` (new) | pure: `joinNames`, `creditParts`, `artistLine`, `titleLine`, `displayLine`, `detailsLines`, `versionTooltip`, `titleNodes`, `subtitle`, `sortKey`, `searchText`, `releasedYear`; legacy-only songs (no `artists` array) take the old code path unchanged |
| `web/js/credits.test.mjs` (new) | table tests incl. the legacy-only equivalence cases from `display-title.test.mjs` |
| `web/js/display-title.js` | thin re-exports of `credits.js` under the old names (`displayTitle`, `displayString`, `remixTooltip`, `titleNodes`, `subtitleString`), so existing imports keep working (removed later, task-0122 F6) |
| `web/js/track-sub.js` | `trackSub` delegates to `credits.subtitle` (removed later, task-0122 F6) |
| `web/js/library-rows.js`, `library-data.js`, `player.js`, `player-ui.js`, `player-media.js`, `share-open.js`, `share-ui.js`, `song-card.js`, `stats.js`, `stats-table.js`, `genres.js`, `viz-ui.js`, `bulk.js`, `edit-dialog.js` | use `credits.js` for names, tooltips, aria labels, sort and search keys, queue, mini player, share, now playing, edit dialog head (shows the display line) and delete confirmation |
| tests: `display-title.test.mjs`, `display-rows.test.mjs`, `song-card.test.mjs`, `library.test.mjs`, `stats-table.test.mjs`, `marquee.test.mjs`, `genres.test.mjs`, `share.test.mjs`, `player.test.mjs` | existing legacy-only fixtures must stay green unmodified |
| `docs/specs/library.md`, `docs/specs/playback.md`, `docs/specs/share.md`, `docs/specs/stats.md` | LIB-134 text, ids LIB-135..145, PLY-142..145, SHARE-018, STA-041 |

### 6.1 Display rules (`credits.js`)

- `joinNames` as in section 3.1.
- `artistLine = joinNames(artists) [+ " feat. " + joinNames(featured)]`.
- Version label `L`: tokens of `version.name` (pills of ADD-071, rejoined with `, `, each hidden when its normalised text is already inside the title, the rule `display-title.js` has today), else the lowercase `kind` word unless `other`. A migrated remix therefore renders exactly as before.
- `titleLine = title [+ " (" + L + ")"]`. `displayLine = artistLine + " - " + titleLine` (just `titleLine` without artists). Cover: `Artist B - Title (cover)`, never `Title (cover artist B)`.
- `detailsLines`: `[{label, value}]` in the order: Version (kind), Version name, Remix by, Remix year, Cover of (`Cover of Artist A`), First released.
- Tooltip of the version part: `Name (year)` when `version.year` is an int (replaces `remixTooltip` via `remix_year`).
- Library row: line 1 `titleNodes` (title span, version span `rmx`), line 2 `artistLine · released` (replaces `trackSub`); tooltip and aria label use `displayLine`.
- `sortKey(song, "artist")`: casefold `artists[0]`, then `title`; legacy-only uses `artist`. `sortKey(song, "title")`: casefold `title`.
- `searchText(song)`: title, artists, featured, version name, by, of, album, tag text; legacy-only: title, artist, album, remixer. Case-insensitive, as `library-data.js` does today.
- `releasedYear(song)`: `released` when an int, else legacy `year`. Code that reads `song.year` (stats, decade, year sort) keeps working because the server still sends `year = released`.
- A song object without an `artists` array is legacy-only (cached or foreign data): every function behaves exactly as `display-title.js` and `track-sub.js` do today.

Artists that were several pills (`A - B` in the old string) now render `A & B`; single-pill songs and legacy-only songs render exactly as before.

### 6.2 Form rules

- Pills: Artists, Featuring and Remix by keep the ADD-071 token behaviour; the value is the list of `splitTokens` pills; a name that itself contains a spaced separator cannot be one pill (same as today).
- Version select empty means no version object is sent (`version: null` on PATCH). Choosing Cover shows Cover of; leaving Cover clears it.
- Live preview: the display line, under the fields, updated on `input`.
- "Suggested split" is visible whenever the current Artists, Title or Version name matches a split pattern (`credits_split`), shows `Artists: A | B`, `Featuring: C`, `Version: remix, by Alesso`, each with Apply and Dismiss; nothing changes until Apply; the suggestion is recomputed from the CURRENT field text, not from `raw`.
- Warning (not blocking) when a name in Remix by does not appear in Version name.
- Remix year: auto suggestion from `published_year` (and `version_year` of `/metadata`) exactly as `planRemixYear` does today, now whenever a Version is chosen; the field is visibly marked as a suggestion until the user types.
- First released (AR): comes only from wiki/MusicBrainz/Discogs (`year` of `/preview` and `/metadata`); empty when no source gave one, no suggestion styling, no decade tag; a typed value is never overwritten; `published_year` never reaches this field.
- Remix year: `published_year` is the only fallback and is shown as a marked suggestion; the original's years are never applied to it, nor the version's date to `released`.
- Edit keeps the old behaviour of not rewriting data on open: values are compared on save; an untouched form sends the same structure back.

## 7. Test plan and risks

### 7.1 Tests

Server (`pytest` in WSL, `~/ap2venv`):

- `test_tokens.py`: `tokens.py` against `fixtures/token_cases.json` (generated once from `web/js/tokens.js` output on 60 strings; `tokens-parity.test.mjs` reads the same file, so both sides stay equal).
- `test_credits.py`: `join_names`; `project` table; `migrate_fields` table (every row of 4.1, `&`/`,`/`feat.` unsplit, `Mixed By DJ Gvozd` gives `other`, `Alesso Remix` gives `remix` with empty `by`, orphan `remix_year`, whitespace, bool and string years); `apply_changes` precedence matrix (3.4: structure and legacy together, `version: null` with `remixer`, equal-to-projection no-op, different value conversion, `of` on non-cover is 422, limits, year ranges and unchanged-stored exception).
- `test_credits_properties.py` (Hypothesis, as `test_properties.py`): migrate is idempotent; `project(migrate(s))` equals the normalised legacy values; `apply_changes` with the projection of a song as legacy input leaves the stored song byte-equal.
- `test_migrate_credits.py`: golden `legacy_library_sample.json` (about 25 songs incl. every flag) migrated twice, second run changes nothing and returns 0; backup created once and not overwritten; review file content and "rewrite only when changed"; failure of one user does not stop the others; `updated_at` untouched; no `artist`/`remixer`/`remix_year`/`year` left in the file; startup test through `TestClient` context.
- `test_credits.py` (the API classes, formerly `test_credits_api.py`): POST (structure, legacy, both), PATCH, `/library`, `/catalog` (`ETag`, `since`), guest view (no `raw`), `/preview` additive keys with a stubbed extractor (the `upload_date`-only video gives `year: null`, `published_year` set), `/metadata` with `version_kind` returns no MusicBrainz url, `metafill` and `identify` never write `musicbrainz_url` or `discogs_url` on a version song, library git commit created by the migration.
- `test_ios_contract.py`, the compatibility proof, because iOS cannot be built here:
  1. Parses `ios/Sources/ServerLink.swift`, `APIModels.swift`, `Track.swift` with regexes for the `ServerSong`, `Preview`, `MetadataResult`, `SongStatus`, `SongSource` property names and optionality and compares them with `fixtures/ios_contract.json` (the list in 1.3). A Swift change that adds or removes a decoded key fails the test until the fixture is updated on purpose.
  2. For legacy, migrated and new-form songs (examples A-G), calls `/catalog` and `/library` and checks every key in `ios_contract.json`: present, with the Swift-compatible JSON type (`title` always a non-empty string; `artist` string or null; `year` int or null; `remixer` string or null; `sources` list of objects with `source`, `id`, `url`).
  3. Replays the exact iOS request bodies (Add and Edit shapes from 1.3, including `remixer: null`, `year: null`, `album: ""`) against structured songs: an unchanged edit leaves `artists`, `featured`, `version`, `raw` and the library file equal except `updated_at`; a changed `artist` becomes `artists` and `featured: []`; a cleared `remixer` removes the version; Add from iOS produces the same structure as the migration would.
  4. Equivalence: for the legacy sample, the five legacy keys of `/catalog` before (computed from the old shape by the test's own `N(s)`) and after migration are equal.

Web (`node --test`, WSL):

- display: `credits.test.mjs` tables (A-G, cover rule, legacy-only equivalence with every existing `display-title.test.mjs` case, dedupe against the title, join forms, sort and search keys, tooltip); every existing display test stays green unmodified.
- form: `song-payload.test.mjs` (structure keys only; no legacy key leaks; empty version sends `version: null` on PATCH, omits it on POST), `song-form-credits.test.mjs` (Suggested split visibility and apply, warning, cover field, version year suggestion marker), `credits-split.test.mjs` against `credits_split_cases.json`, `tokens-parity.test.mjs`, `remix-year.test.mjs` (`planVersionYear`).
- `scripts/check.sh` must stay green: duplicate-id grep (use `xargs`/`awk` if `Argument list too long`), 135 title-clean cases untouched.

### 7.2 Risks

1. **D** `version.by` empty after migration: search and filters by remixer name cover old songs only through `version.name` text until the user accepts a suggestion. The lead brief asked for `by` from the pill tokens; pills are credited text, so filling them would put "Alesso Remix" into a people field. Reversible: a later one-click "accept suggested by" action.
2. **D** `kind: remix` for every non-blank remixer text. Documented meaning of the field; weak cases are in the review file. A live or extended mix typed in that field stays `remix` until edited.
3. **D** Legacy `remixer` carries non-remix version text ("Live, ...") so iOS shows "Remix: Live, ...". Cosmetic.
4. Rollback of the server after migration: an old build reads songs without `artist`. Only the pre-migration backup (`backups-credits/`) restores the old shape, losing later edits. Deploy the new build only with `scripts/check.sh` green; keep the backup.
5. `year` semantics: old `year` values that were upload years (the extractor fell back to `upload_date`) become `released` and cannot be told apart from true release years. Stats and `decade:` tags built on them stay as they are today. The fix (AR) is the extractor change; the data cleanup is manual.
6. AR is decided (DATA-126): the Add form pre-fills First released empty more often, and the `decade:` tag is no longer suggested from an upload year. Existing songs are not re-dated; the one-off review of songs whose `year` equals their upload year is an open item outside this build (needs a fresh yt-dlp lookup per song).
7. Multi-pill artists change rendering: `A - B` showed `A - B`, it will show `A & B`. Single-pill and legacy-only unchanged.
8. Pills cannot hold a name containing a spaced separator; round trip through the pill field would split it. Same limit as today.
9. iOS edits of the artist string replace `artists` with pills and clear `featured` (the sent string is the whole line). Structure created on the web is flattened only if an iOS user actually changes the artist text.
10. `exclude_unset` in `create_song`: `SongMeta()` default and `model_dump()` currently make every key "sent" as null; the rewrite must use `exclude_unset` or legacy nulls would wipe structure. Covered by a test.
11. `catalog_revision` changes once after deploy: every client refetches the catalog once. Harmless.
12. Lookups that match by title and artist return the original recording: enrichment rules (no MusicBrainz id, no Discogs release, no album fill for a song with a version; genres and `released` still allowed) must be enforced in `metafill`, `identify`, `metadata.gather` and the form's `/metadata` handling; the form also never copies a MusicBrainz url from `/metadata` into a version song.
13. A song's `raw` is stored in git (public repo? the data repo is separate, per-user, DATA-014 allows no secrets): only titles and names, no PII.
14. Parallel work: `style.css`, `docs/specs/*.md` and tests have one owner each (section 6); the rule-id ranges per builder in the appendix prevent duplicate ids.

## Contract changes (append-only)

Builders append dated entries below; never edit an earlier entry.

### 2026-10-16 architect (initial contract)

1. Song JSON: section 2 keys; legacy keys derived only (3.1).
2. Request keys: `artists`, `featured`, `released`, `version` (replace semantics), `source_raw` on create; `version: null` removes; legacy keys accepted with 3.2 to 3.4 rules.
3. Response keys always present: `title, artists, featured, released, artist, remixer, year, remix_year`; `version` only when set; `raw` except in the guest view.
4. `/preview` additive: `raw`, `suggested_credits`, `released_suggestion`; `/metadata` additive request `version_kind`, response `version_year`; `/library` and `/catalog` additive `credits_schema`.
5. Shared fixtures (owner server, created in phase 1): `server/tests/fixtures/token_cases.json`, `credits_split_cases.json` (sections `join`, `split`, `review`), `ios_contract.json`, `legacy_library_sample.json`. Web tests read them read-only.
6. `join_names` rule identical in `credits.py` and `credits.js`; `credits.js` is the only display formatter; `display-title.js` and `track-sub.js` remain as facades.
7. Rule-id ranges: server DATA-127..139 (DATA-126 is Decision AR, already in data-model.md), API-120..135, IOS-072..074; form ADD-113..125, WEB-089..092; display LIB-135..145, PLY-142..145, SHARE-018, STA-041. ADD-112 and LIB-134 are rewritten by form and display respectively; DATA-120..125 by server.
8. Phase order: server (credits.py, schemas, library, routes, migration, fixtures) before form and display start merging; display delivers `credits.js` + test first because form imports it; no builder commits, pushes or deploys.

### 2026-10-16 architect (Decision AR folded in)

1. [metadata-model-decisions-AR.md](metadata-model-decisions-AR.md) is part of this contract: DATA-126 (already written in data-model.md) owns it; server builder ids start at DATA-127.
2. `released` sources are exactly wikipedia, musicbrainz, discogs, in that order; `released_suggestion.source` is one of those three; no yt-dlp year, no upload year; `/preview` and `/metadata` `year` follow the same chain; `published_year` and `version_year` only ever feed `version.year`.
3. Version songs: lookups use the base `title` and the original artists (`version.of` for a cover) and may fill `released` and genres, never `musicbrainz_url`, `discogs_url`, `album`.
4. Server files added to the plan: `genre_lookup.py`, `discogs_lookup.py` year handling (owner server); form rule on First released and Remix year as in 6.2.

### 2026-10-16 display builder

1. `web/js/credits.js` exports beyond the contract list (additive): `KINDS`, `isStructured(song)` (true when `artists` is an array), `tooltipLine(song)` (structured: `displayLine`; legacy-only: `Title (Remix) - Artist` as before), `compareKeys(a, b)`.
2. `creditParts(song)` returns `{title, remix, artists, featured, version, structured}`; `remix` is the version label (the old `displayTitle().remix`).
3. `sortKey(song, key)` returns an array: `[artistKey, titleKey]` for `artist`, `[titleKey]` otherwise; compare with `compareKeys`. `searchText(song, extra = [])` returns the lowercase newline-joined haystack, `extra` carries tag text.
4. `detailsLines` labels: `Version`, `Version name`, `Remix by`, `Remix year`, `Cover of` (value is the original artist), `First released`.
5. Version label: `version.name` tokens (deduped against the title), else the lowercase kind word (not for `other`, also deduped); `version.by` is never shown in the title line.
6. Edit dialog head sub shows `displayLine`; the delete text uses `displayLine` only for songs with an `artists` array.

### 2026-10-16 form builder

1. `web/js/api.js` `addSong(url, metadata, tags, keepTitle, sourceRaw)` gained an optional fifth argument that adds `source_raw` to the `POST /songs` body (api.js had no owner; additive).
2. `songForm.values()` returns `artists[]`, `featured[]`, `released` (string), `version` (`{kind, name, by[], year (string), of?}` or `null`); `setValues(partial)` accepts the structure keys and, for convenience, the legacy `artist`, `remixer`, `year`, `remix_year`. `song-payload.js` exports `artistString(v)`, `addBody`/`patchBody`/`metadataBody` as in the contract; `yearError(v, stored)` reads `released` and `version.year` and accepts a legacy `year`/`remix_year` stored value.
3. `planMetadata(resp, cur)` returns `released` (was `year`) and takes `cur.released` and `cur.versioned`; `identifyBlock` options are `getReleased`/`setReleased`.
4. `credits-split.js` `suggest(artist, title, remixer)` is a line-for-line port of `credits_split.suggest` and returns `{artists, featured, version: {kind, name, by}|null, title|null, notes[]}`; cross-checked against the Python on 10 cases.
5. The form relies on `/preview` `raw` being passed back as `source_raw`, on `/metadata` accepting `version_kind` and returning `version_year` (falls back to `remix_year`), and on the legacy `artist`/`remixer`/`year`/`remix_year` keys still being sent by the server for the Add preview; `credits.js` `displayLine`, `joinNames` are imported from the display builder.
6. `web/js/edit-dialog.test.mjs` (display owner) still asserts the legacy `body.artist` of a PATCH; with this change the PATCH carries `artists` (and `version`), so that assertion must become `assert.deepEqual(body.artists, ['Band'])`.
7. Fixture readers `credits-split.test.mjs` and `tokens-parity.test.mjs` run their server-case test only when `server/tests/fixtures/credits_split_cases.json` (key `split`: items `{artist, title, remixer, expected: {...}}` or `{input: {...}, expected}`) and `token_cases.json` (list or `{cases}` of `{input, tokens}`) exist; otherwise the test is skipped.

### 2026-10-16 server builder

1. Fixture shapes as written: `token_cases.json` is a list of `{input, tokenize: [{text, sep}], split: [str], join: str}`; `credits_split_cases.json` has sections `join` (`{names, text}`), `split` (`{artist, title, remixer, expect: {artists, featured, version, title, notes}}`) and `review`; readers accept both spellings (see form entry 7).
2. `credits_split.suggest` returns `{artists, featured, version, title, notes}` (`title` is the base title when the suggestion removes feat or remix text, else null); `credits.SCHEMA = 1` is the schema constant used by `library.save_doc` and the list routes.
3. `ios_contract.json` `always_present` has no `album` (the app decodes it as optional and the server omits it for songs without one); it lists `artists`, `featured`, `released`, `remix_year` instead.
4. `/metadata` with an unknown `version_kind` is 422; `/preview` `released_suggestion` is `null` when no source gave a year.
5. Rules written: DATA-127..139, API-120..135, IOS-072..074; DATA-120..126 are now "implemented" (DATA-126 text unchanged). ADR-0024 added.
6. Cover suggestion (ADD-126): `credits_split.suggest` and `credits-split.js` apply the COVER rule to a title parenthetical `NAME Cover` / `NAME Cover Version`: NAME among the artists or featured (NFD, accents stripped, lower case) means performer (note `cover_performer`, no `of`), else `version.of = NAME`; no artists to compare gives note `cover_ambiguous` and no `of`. A remix or other-kind parenthetical earlier wins as before (the cover one stays in the title). The migration review file adds `of`, `performer` or `ambiguous` to `suggested.version`; stored data is untouched. Live and unplugged are unchanged.
7. Mashups (decision BJ1): `credits.KINDS` gains `mashup`; `version.of` is a list of names for `cover` and `mashup` (`credits.of_names` reads a string or list, `credits.ensure` normalises a stored string; `VersionIn.of` takes `str | list[str]`); `credits_split.suggest` and `credits-split.js` read a trailing `(mashup)` / `[Mash-Up]` / `(mash up)` or a Remixer text of exactly that word as kind `mashup`, with the new note `mashup_makers_unknown` and `of` only from an explicit `x`, `vs`, `vs.` or multiplication-sign split; the cover suggestion's `of` is now `[NAME]` in both languages and in `credits_split_cases.json`. The enrichment guard (`has_version`, `version_kind`) is generic, so a mashup already withholds the MusicBrainz and Discogs links and the album. Web: `token-field.js` gets the pill kind `of` with `setLabel`. Rules: DATA-140, DATA-141, ADD-127, ADD-128, LIB-147, API-136.
## Appendix: final model v2 (2026-10-16)

Alex approved the final song data model (renames, `version` block, Artist table (later removed, ADR-0031), runtime decade). It supersedes the field names above once built. Spec: [data-model.md, Data model v2](../specs/data-model.md#data-model-v2-final-model-approved-2026-10-16) (DATA-144 to DATA-155); ticket: [task-0043](../tasks/task-0043.md).
