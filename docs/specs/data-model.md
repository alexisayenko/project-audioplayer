# Data model

Code: `server/app/library.py`, `server/app/schemas.py` (`SongMeta`).

## Song record

| Field | Type | Required | Validation / rule |
| --- | --- | --- | --- |
| `id` | string | yes | YouTube video id `^[A-Za-z0-9_-]{11}$`, `soundcloud-<numeric track id>` `^soundcloud-[0-9]{1,20}$`, or a metadata-only `spotify-`/`applemusic-`/`shazam-<id>` `^(spotify\|applemusic\|shazam)-[A-Za-z0-9_-]{1,64}$`; immutable; unique |
| `source` | string | no | `youtube` (default when absent; old records are not migrated) or `soundcloud`; set by the server on new SoundCloud songs |
| `title` | string | yes | non-empty after trim (PATCH: 422 if empty; Add: falls back to yt-dlp title, then id; promo noise is cleaned on Add only, ADD-077; stored titles and artists are never rewritten, the web joins edited pills with ' - ', ADD-071) |
| `artist` | string or null | no | trimmed; empty becomes `null` |
| `album` | string or null | no | trimmed; empty becomes `null` |
| `remixer` | string or null | no | free text, the remix and additional production credit, the cut-out remix bracket text ("Sadrican 2026 Remix"; ADD-070); trimmed; empty becomes `null`; absent in old records |
| `year` | int or null | no | 1900..next year (the current UTC year + 1, computed per request: 2027 in 2026; `server/app/timeutil.py` `max_year`) (422 outside; a stored value above the limit is kept and accepted unchanged by `PATCH`, DATA-062); the original release year |
| `remix_year` | int or null | no | 1900..next year (the current UTC year + 1, computed per request: 2027 in 2026; `server/app/timeutil.py` `max_year`) (422 outside), the year the remix was released, optional and separate from `year` (DATA-061); absent in old records, read as `null` |
| `tags` | string[] | yes (may be `[]`) | normalised, see [tags.md](tags.md); `decade:<NN>s` is derived from `year` (TAG-050..052) |
| `bpm` | int or null | no | whole beats per minute, 20..300 (422 outside); a typed or PATCHed fraction is rounded; detected values are rounded; fractional values in old files are rounded on load (saved on the next write) |
| `duration` | number or null | no | seconds, technical, set at download |
| `source_url` | string | yes | canonical `https://www.youtube.com/watch?v=<id>`, or `https://soundcloud.com/<artist>/<track>[/s-<secret>]`, no tracking parameters; dirty values in old files are cleaned on load (saved on the next write) |
| `musicbrainz_url` | string or null | no | `https://musicbrainz.org/recording/<mbid>` of the matched recording; any other host, path or malformed id is dropped to `null` (also on load); absent = `null` (grey MusicBrainz icon) |
| `spotify_url` | string or null | no | `https://open.spotify.com/track/<id>` or `/album/<id>` (22-character id); any other host, kind or id is dropped to `null` (also on load); absent = `null` (grey Spotify icon) |
| `discogs_url` | string or null | no | `https://www.discogs.com/release/<id>` or `/master/<id>` of the matched Discogs release; any other host or path is dropped to `null` (also on load); absent = `null` (grey Discogs icon) |
| `wikipedia_song` | string or null | no | `https://<lang>.wikipedia.org/wiki/<title>` or `https://www.wikidata.org/wiki/Q<id>`; any other host or shape is dropped to `null` (also on load); absent = `null` |
| `wikipedia_artist` | string or null | no | same rule, for the band/artist |
| `wikipedia_album` | string or null | no | same rule, for the album article; absent = empty (older catalogs have no such key and stay valid; the server writes it only once it is set, DATA-071) |
| `file` | string or null | yes | audio file name only, `<id>.m4a`, never a path; `null` = metadata-only song (no audio) |
| `sources` | object[] | no | `[{source, id, url}]`, first is primary; absent in old records, derived from `id` and `source_url` at read time |
| `updated_at` | string | no | UTC `YYYY-MM-DDTHH:MM:SSZ`, set on edit, bpm and audio changes; absent = `added_at` |
| `cover` | string or null | no | `covers/<id>.jpg`, or `null` if the thumbnail fetch failed |
| `added_at` | string | yes | UTC `YYYY-MM-DDTHH:MM:SSZ` |

- DATA-001 MUST: every song has a unique `id` that is a valid YouTube video id or a `soundcloud-<numeric id>` id (DATA-024); the SoundCloud id grammar is `^soundcloud-[0-9]{1,20}$` with ASCII digits only (`urlclean.SOUNDCLOUD_ID_RE`), so `soundcloud-`, `soundcloud-abc` and non-ASCII digits are refused. Status: implemented
- DATA-024 MUST: `source` is optional; absent means `youtube`; the file is `<id>.m4a` and the cover `covers/<id>.jpg` for both sources; a mixed library round-trips unchanged. Status: implemented
- DATA-002 MUST: `id`, `source_url`, `file`, `cover`, `duration`, `added_at` are server-set; PATCH accepts only title, artist, album, remixer, year, remix_year, bpm, tags, wikipedia_song, wikipedia_artist, wikipedia_album, musicbrainz_url, discogs_url. Status: implemented
- DATA-062 MUST: `year` and `remix_year` accept 1900..`max_year()` (the current UTC year + 1, so the limit moves every January; Alex decided BJ1). `POST /songs` and `PATCH` answer 422 `year must be from 1900 to 2027` (or `remix_year ...`) outside it; a `PATCH` value equal to the song's stored one is accepted, and stored years are never dropped or rewritten on load. Years that yt-dlp, MusicBrainz, Discogs, Wikidata or Wikipedia report outside the range are discarded (never an error). Web inputs get `min=1900` and `max` = current year + 1 (`web/js/constants.js` `MIN_YEAR`, `maxYear()`) and the form shows "Enter a year from 1900 to 2027" instead of sending. Status: implemented
- DATA-061 MUST: a song may carry `remix_year`, an integer 1900..next year (DATA-062) or `null`: the year the remix named in `remixer` was released. It is independent of `year`, which stays the original release year and alone drives the `decade:` tag, the stats chart and year-based logic. Validated like `year` (JSON integers and numeric strings accepted, anything else or out of range is 422); an old record without the key reads as `null` in `/library` and is not rewritten; no lookup (MusicBrainz, Wikipedia, Discogs, yt-dlp, identify) ever fills it. Status: implemented
- DATA-003 MUST: `file` is reduced to its base name when read; an absent `file` key defaults to `<id>.m4a`; an explicit `null` stays `null` (metadata-only). Status: implemented
- DATA-004 MUST: optional fields may be `null`; old records lacking `bpm` or other optional fields load without error. Status: implemented
- DATA-005 (superseded by ADR-0010, see CAT-001): a song record exists only after its audio download succeeded. Status: superseded; a record may now exist without audio (`file: null`). Downloads still write the record only after they succeed.
- DATA-006 MUST: the API rejects `bpm` outside 20..300 and `year` outside 1900..the current UTC year + 1 (`timeutil.valid_year`, as DATA-062) with 422. Status: implemented
- DATA-008 MUST: `wikipedia_song`, `wikipedia_artist` and `wikipedia_album` are validated by `wiki_lookup.clean_link` on POST, PATCH and load: https only (http is upgraded), host `*.wikipedia.org` with a `/wiki/<title>` path or `wikidata.org/wiki/Q<id>`, no credentials or odd ports, query and fragment dropped for Wikidata; anything else becomes `null`, never a 422. Status: implemented
- DATA-072 MUST: `spotify_url` is validated by `urlclean.clean_spotify_url` on POST, PATCH and load: http or https on `open.spotify.com`, an optional `intl-xx` segment, `/track/<22 chars>` or `/album/<22 chars>`, normalised to `https://open.spotify.com/<kind>/<id>` (query dropped); anything else becomes `null`, never a 422. Empty is allowed. It is in the guest view and the catalog (`guest.SONG_KEYS`); a record without it reads as empty. Status: implemented
- DATA-073 MUST: the YouTube and SoundCloud links of a song are the entries of `sources[]` (`{source, id, url}`; old records derive one from the id and `source_url`). PATCH edits them through `youtube_url` and `soundcloud_url` (response shape unchanged: `sources`, `source_url`). A value must be an https or http YouTube link (`youtube.com`, `music.youtube.com`, `youtu.be`, normalised to `https://www.youtube.com/watch?v=<id>`) or a SoundCloud track link (`soundcloud.com/<artist>/<track>`, normalised; `on.soundcloud.com` short links are refused), else 422 `youtube_url must be ...` / `soundcloud_url must be ...`; `null` or empty clears. The song `id` never changes and an existing audio file is never deleted or renamed by a link edit. The link of the song's own kind (a YouTube-id song's YouTube link, a `soundcloud-` song's SoundCloud link) cannot be cleared (422): the song would lose the source its audio comes from; the other kind can be added, changed and cleared freely, and clearing a link of a catalog-only id (`spotify-`, `applemusic-`, `shazam-`) is always allowed. The own-kind link is mirrored into `source_url`. The next Download (`POST /songs/{id}/audio`, or a re-fetch) uses the stored link of the song's own kind: for YouTube the video of that link (stored as `<id>.m4a` of the song), for SoundCloud that track URL; an edited link therefore changes what the next Download fetches, not the audio already on the server. A SoundCloud link added to a YouTube-id song (or the reverse) is metadata only: an icon and a link, never fetched. Status: implemented
- DATA-009 MUST: `musicbrainz_url` is validated by `genre_lookup.clean_recording_url` on POST, PATCH and load: http or https on `musicbrainz.org` (optional `www.`) with `/recording/<uuid>`, normalised to `https://musicbrainz.org/recording/<lowercase uuid>`; anything else becomes `null`, never a 422. Clients fill it from `services.musicbrainz.url` of `POST /metadata` so the icon stays lit when the song is reopened; old builds ignore it. Status: implemented
- DATA-050 MUST: `discogs_url` is validated by `discogs_lookup.clean_url` on POST, PATCH and load: http or https on `discogs.com` (optional `www.` and language prefix) with `/release/<digits>` or `/master/<digits>` (a trailing slug is cut), normalised to `https://www.discogs.com/<kind>/<id>`; anything else becomes `null`, never a 422. It is set only by the user, through "Apply links" after an identification (ADD-090) or a Discogs-matched preview; old builds ignore it. Status: implemented
- DATA-007 MUST: `POST /songs` and PATCH round a typed `bpm` to an integer; `library.normalize` rounds stored fractions on load. Status: implemented
- DATA-070 MUST: `bpm: null` means "not detected yet", not "no tempo": the BPM backfill may fill it; a non-null `bpm` (typed or detected) is never overwritten by it. Status: implemented
- DATA-074 MUST: `metadata_checked_at` (UTC string, server-set) marks a song the metadata backfill has answered for; it is never sent by clients. Status: implemented

## `library.json`

One file per user: `audioplayer/users/<uid>/library.json` (ADR-0012; ~~`audioplayer/library.json`~~). Next to it `profile.json`: `{"email": "...", "provider": "google"|"apple", "created_at": "...Z", "subs": {"apple": "<sub>"}}` (DATA-040). `uid` = first 16 hex of `sha256(lowercased email)`.

```json
{ "settings": { "music_root": "perkunas://data/music/" },
  "songs": [ { "id": "dQw4w9WgXcQ", "file": "dQw4w9WgXcQ.m4a", "title": "...",
               "artist": "...", "album": null, "year": null, "bpm": 113,
               "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
               "cover": "covers/dQw4w9WgXcQ.jpg", "duration": 213,
               "added_at": "2026-10-12T09:30:00Z", "tags": ["genre:pop"] } ] }
```

- DATA-010 MUST: the file is `{settings, songs}`; written UTF-8 (`ensure_ascii=false`), 2-space indent, trailing newline. Status: implemented
- DATA-011 MUST: writes are atomic (temp file in the same dir, fsync, `os.replace`). Status: implemented
- DATA-012 MUST: a missing file reads as an empty library. Status: implemented
- DATA-013 MUST: `settings.music_root` is `<servername>://<path>/` (resolved via the hosts map, see [storage-and-sync.md](storage-and-sync.md)) or a plain local path; it is seeded on the first save if absent. Status: implemented
- DATA-014 MUST: `library.json` holds no secrets, credentials, IPs or personal data (git history is permanent); the user's email is only in `profile.json` (DATA-040). Status: implemented
- DATA-015 MUST: songs are stored in insertion order (new songs appended); display order is a client concern. Status: implemented

## Migration (on every load)

Only in-memory normalisation on load remains (the one-time legacy-to-per-user migration is gone, STO-053).

- DATA-020 MUST: a bare `[...]` or `{songs:[...]}` file is accepted and rewritten as `{settings, songs}` on the next save. Status: implemented
- DATA-021 MUST: a song with `id` and no `file` key gets `file = <id>.m4a`. Status: implemented
- DATA-023 MUST: songs with a `year` from 1950 up to `max_year()` get their `decade:*` tag derived on load (migration, persisted on the next write), create and PATCH. Status: implemented
- DATA-022 MUST: a legacy `genre` field is removed and becomes the tag `genre:<value>`; tags are re-normalised. Status: implemented

Tag namespaces in use (see [tags.md](tags.md)): `genre:<name>`, `country:<ISO 3166-1 alpha-2>` (e.g. `country:lt`; plus the historical `country:su`, TAG-058; names and aliases such as `usa` are mapped to the code on write and load, unknown values are refused on write, TAG-056/057), `lang:<ISO 639-1>` (e.g. `lang:ru`; ISO 639-3 only when no 2-letter code exists), `decade:<NN>s` (derived from `year`, e.g. `decade:90s`), `mood:<name>`; any other `key:value` or plain tag is allowed.
- DATA-025 MUST: migration runs in memory at load and persists on the next write (no separate migration job). Status: implemented

## Audio state and catalog (ADR-0010)

- DATA-030 MUST: audio state is never stored. The server derives it at read time: `none` (`file` is null or the file is missing under `music_root`), `server` (the file exists). `phone` is a client concern. Existing records are not rewritten or migrated. Status: implemented
- DATA-031 MUST: API song objects add, without removing anything: `audio_state`, `sources` (derived if absent) and, when state is `server`, `audio: {file, format, size, duration}`. These are not written to `library.json`. Status: implemented
- DATA-032 MUST: the git store holds catalog metadata only (a few KB per song); audio stays on the music server. Status: implemented
- DATA-033 MUST: if `music_root` cannot be resolved, state falls back to the record's `file` (`server` when set) instead of failing the listing. Status: implemented

## Users (ADR-0012)

- DATA-040 MUST: each user has `profile.json` (`email` or `null`, `provider`, `created_at`, optional `subs`) written once at the first sign-in; the email is the only personal data and lives only there, never in a path. Status: implemented
- DATA-041 MUST: `uid` is the first 16 hex chars of `sha256(lowercased email)`; for an Apple token without email, of `sha256(sub)`, and a later token without email finds the profile through `subs`. Status: implemented
- DATA-042 MUST: `settings.music_root` stays one server-wide value (the owner's, or `AUDIO_MUSIC_ROOT`); each user's audio is below `<music_root>/users/<uid>/`. Status: implemented


## Playlists (ADR-0022)

- DATA-110 MUST: each user's `playlists.json` (git-synced, beside `library.json`; no tokens) is `{version: 1, nodes: [...]}`; a node is a folder `{id, kind:"folder", name, parent_id, position}` or a playlist `{id, kind:"playlist", name, description, cover, parent_id, position, smart, rules, source, entries:[{song_id, added}], created, updated}`; `entries` is empty and `rules` set when `smart`, `rules` is null otherwise. Status: planned
- DATA-111 MUST: on load, entries whose `song_id` is not in the library are dropped, a `parent_id` pointing nowhere moves the node to the root, depth over 5 or a cycle is repaired to the root, and `position` is renumbered 0..n-1 per parent; ids are unique and never reused. Status: planned
- DATA-112 MUST: playlists reference songs by `id` only; they never copy song fields, and they do not count toward `USER_MAX_SONGS`. Status: planned

## Genre ontology cache (ADR-0014)

- DATA-060 MUST: the server keeps one server-wide file `genre-ontology.json` in `AUDIO_DATA_DIR` (not in the per-user git repos): `{version, labels: {<lowercase genre>: {qid|null, at}}, entities: {<QID>: {label, parents, related, genre, at}}}` with Unix times, refreshed per entry after 30 days. It is a cache of public Wikidata facts only, rebuildable at any time, and contains no song, tag count, user or email (GEN-004). Status: implemented
- DATA-071 MUST: `wikipedia_album` is an optional field of the same kind as `wikipedia_song`: a missing key means empty and loads as such, `normalize` validates it with `wiki_lookup.clean_link` only when the key exists (so unchanged catalogs are not rewritten), POST/PATCH accept it, and the guest read-only view returns it (`SONG_KEYS`). The iOS app does not read or write it yet and ignores the key on decode. Status: implemented

## Credits and versions (planned)

Decided by Alex 2026-10-16; analysis, examples and the DDEX, MusicBrainz, Discogs and Beatport references are in [task-0036](../tasks/task-0036.md#references). Nothing here is built; the current fields (`title`, `artist`, `remixer`, `year`, `remix_year`) stay valid until the migration.

- DATA-120 MUST (planned): the song carries structured credits, UI label to JSON key: Title `title` (base title, no version text); Artists `artists` (main artists, ordered); Featuring `featured`; First released `released`; Version `version.kind`; Version name `version.name` (credited text exactly as written); Version year `version.year`; Remixed / mixed by `version.by` (people credited on the version, including mixing credits); Original artist `version.of` (covers only). Status: planned
- DATA-121 MUST (planned): `version.kind` is one of remix, live, acoustic, extended, instrumental, remaster, edit, cover, other. A remix is one kind of version; the remix year is `version.year` (the new model has no separate remix year); a song with no version has no `version` object. Status: planned
- DATA-122 MUST (planned): cover rule: the covering artist is the main artist (`artists`), `title` is the base title, `version.kind` is `cover` and `version.of` is the original artist. Display is `Artist B - Title (cover)` with "Cover of Artist A" in the details, never `Title (cover artist B)`. A cover, like any other version, is a different recording and never reuses the original's MusicBrainz recording id. Status: planned
- DATA-123 MUST (planned): display and parsing: the list line is built from the structure (`Artist1 & Artist2 feat. Guest - Title (Version name)`); the credited version name wins for display; `version.by` serves search and filters and the form warns when it disagrees with the version name; the original source strings stay stored untouched; splitting `&` and `feat.` out of raw strings is only a suggestion; `artist`, `remixer`, `remix_year` and `year` become derived compatibility values. Status: planned
- DATA-124 MUST (planned): year semantics: `released` is the first release of the original recording (a platform upload year never becomes `released`); `version.year` is the year of the version, suggested from the platform publish date and marked as a suggestion (ADD-111) unless a better source exists. Status: planned
- DATA-125 MUST (planned): examples: Dua Lipa & Elton John "Cold Heart" live is `{title: "Cold Heart", artists: [...], version: {kind: "live", name: "Live, Royal Albert Hall"}}` with `released` null when unknown; "Mixed By DJ Gvozd" is a mixing credit (`version.by`), not a remix. Status: planned
