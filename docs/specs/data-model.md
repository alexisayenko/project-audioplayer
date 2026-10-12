# Data model

Code: `server/app/library.py`, `server/app/main.py` (`SongMeta`).

## Song record

| Field | Type | Required | Validation / rule |
| --- | --- | --- | --- |
| `id` | string | yes | YouTube video id `^[A-Za-z0-9_-]{11}$`, `soundcloud-<numeric track id>` `^soundcloud-[0-9]{1,20}$`, or a metadata-only `spotify-`/`applemusic-`/`shazam-<id>` `^(spotify\|applemusic\|shazam)-[A-Za-z0-9_-]{1,64}$`; immutable; unique |
| `source` | string | no | `youtube` (default when absent; old records are not migrated) or `soundcloud`; set by the server on new SoundCloud songs |
| `title` | string | yes | non-empty after trim (PATCH: 422 if empty; Add: falls back to yt-dlp title, then id) |
| `artist` | string or null | no | trimmed; empty becomes `null` |
| `album` | string or null | no | trimmed; empty becomes `null` |
| `year` | int or null | no | 0..3000 (422 outside) |
| `tags` | string[] | yes (may be `[]`) | normalised, see [tags.md](tags.md); `decade:<NN>s` is derived from `year` (TAG-050..052) |
| `bpm` | int or null | no | whole beats per minute, 20..300 (422 outside); a typed or PATCHed fraction is rounded; detected values are rounded; fractional values in old files are rounded on load (saved on the next write) |
| `duration` | number or null | no | seconds, technical, set at download |
| `source_url` | string | yes | canonical `https://www.youtube.com/watch?v=<id>`, or `https://soundcloud.com/<artist>/<track>[/s-<secret>]`, no tracking parameters; dirty values in old files are cleaned on load (saved on the next write) |
| `wikipedia_song` | string or null | no | `https://<lang>.wikipedia.org/wiki/<title>` or `https://www.wikidata.org/wiki/Q<id>`; any other host or shape is dropped to `null` (also on load); absent = `null` |
| `wikipedia_artist` | string or null | no | same rule, for the band/artist |
| `file` | string or null | yes | audio file name only, `<id>.m4a`, never a path; `null` = metadata-only song (no audio) |
| `sources` | object[] | no | `[{source, id, url}]`, first is primary; absent in old records, derived from `id` and `source_url` at read time |
| `updated_at` | string | no | UTC `YYYY-MM-DDTHH:MM:SSZ`, set on edit, bpm and audio changes; absent = `added_at` |
| `cover` | string or null | no | `covers/<id>.jpg`, or `null` if the thumbnail fetch failed |
| `added_at` | string | yes | UTC `YYYY-MM-DDTHH:MM:SSZ` |

- DATA-001 MUST: every song has a unique `id` that is a valid YouTube video id or a `soundcloud-<numeric id>` id (DATA-024). Status: implemented
- DATA-024 MUST: `source` is optional; absent means `youtube`; the file is `<id>.m4a` and the cover `covers/<id>.jpg` for both sources; a mixed library round-trips unchanged. Status: implemented
- DATA-002 MUST: `id`, `source_url`, `file`, `cover`, `duration`, `added_at` are server-set; PATCH accepts only title, artist, album, year, bpm, tags, wikipedia_song, wikipedia_artist. Status: implemented
- DATA-003 MUST: `file` is reduced to its base name when read; an absent `file` key defaults to `<id>.m4a`; an explicit `null` stays `null` (metadata-only). Status: implemented
- DATA-004 MUST: optional fields may be `null`; old records lacking `bpm` or other optional fields load without error. Status: implemented
- DATA-005 (superseded by ADR-0010, see CAT-001): a song record exists only after its audio download succeeded. Status: superseded; a record may now exist without audio (`file: null`). Downloads still write the record only after they succeed.
- DATA-006 MUST: the API rejects `bpm` outside 20..300 and `year` outside 0..3000 with 422. Status: implemented
- DATA-008 MUST: `wikipedia_song` and `wikipedia_artist` are validated by `wiki_lookup.clean_link` on POST, PATCH and load: https only (http is upgraded), host `*.wikipedia.org` with a `/wiki/<title>` path or `wikidata.org/wiki/Q<id>`, no credentials or odd ports, query and fragment dropped for Wikidata; anything else becomes `null`, never a 422. Status: implemented
- DATA-007 MUST: `POST /songs` and PATCH round a typed `bpm` to an integer; `library.normalize` rounds stored fractions on load. Status: implemented

## `library.json`

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
- DATA-014 MUST: the file holds no secrets, credentials, IPs or personal data (git history is permanent). Status: implemented
- DATA-015 MUST: songs are stored in insertion order (new songs appended); display order is a client concern. Status: implemented

## Migration (on every load)

- DATA-020 MUST: a bare `[...]` or `{songs:[...]}` file is accepted and rewritten as `{settings, songs}` on the next save. Status: implemented
- DATA-021 MUST: a song with `id` and no `file` key gets `file = <id>.m4a`. Status: implemented
- DATA-023 MUST: songs with a `year` in 1950-2029 get their `decade:*` tag derived on load (migration, persisted on the next write), create and PATCH. Status: implemented
- DATA-022 MUST: a legacy `genre` field is removed and becomes the tag `genre:<value>`; tags are re-normalised. Status: implemented

Tag namespaces in use (see [tags.md](tags.md)): `genre:<name>`, `country:<ISO 3166-1 alpha-2>` (e.g. `country:lt`), `lang:<ISO 639-1>` (e.g. `lang:ru`; ISO 639-3 only when no 2-letter code exists), `decade:<NN>s` (derived from `year`, e.g. `decade:90s`), `mood:<name>`; any other `key:value` or plain tag is allowed.
- DATA-023 MUST: migration runs in memory at load and persists on the next write (no separate migration job). Status: implemented

## Audio state and catalog (ADR-0010)

- DATA-030 MUST: audio state is never stored. The server derives it at read time: `none` (`file` is null or the file is missing under `music_root`), `server` (the file exists). `phone` is a client concern. Existing records are not rewritten or migrated. Status: implemented
- DATA-031 MUST: API song objects add, without removing anything: `audio_state`, `sources` (derived if absent) and, when state is `server`, `audio: {file, format, size, duration}`. These are not written to `library.json`. Status: implemented
- DATA-032 MUST: the git store holds catalog metadata only (a few KB per song); audio stays on the music server. Status: implemented
- DATA-033 MUST: if `music_root` cannot be resolved, state falls back to the record's `file` (`server` when set) instead of failing the listing. Status: implemented
