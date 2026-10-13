# Concept: catalog and audio

Status: accepted 2026-10-13, server side implemented, iOS Library partly ([ADR-0010](../tech/decisions.md)). Specs: [`../specs/catalog.md`](../specs/catalog.md).
Tasks: task-0006 to task-0015.

## The idea

The app has two parts.

1. **Metadata (the catalog)**: the list of the owner's favourite songs: title,
   artist, album, year, tags, cover, source links. A few KB per song. It lives in
   GitHub (`library.json` + covers, ADR-0005).
2. **Audio**: files, fetched on demand and stored locally, on the server and on
   the phone.

Two activities follow: **populate** the catalog from every possible source, and
**download + listen**. Populating is cheap and fast; audio is the costly part and
is fetched only for songs the owner wants to hear.

The key principle is unchanged: songs I pick are on my phone and play reliably,
offline, with the screen locked. A downloaded song never depends on the server.

## Vocabulary

- **Catalog**: all song records, with or without audio.
- **Audio state**: per song, `none` -> `server` -> `phone`.
- **Source**: where a record or its audio came from: `youtube`, `soundcloud`,
  `spotify`, `manual`.
- **Match**: a candidate YouTube video proposed for a song that has no audio source
  (typically Spotify-only); the owner confirms or rejects it.
- **Get audio**: the action that turns state `none` into `server` (and, on the
  phone, `server` into `phone`).

## Source matrix

| Source | Metadata | Audio | Notes |
| --- | --- | --- | --- |
| YouTube link | yes (yt-dlp) | yes | id unchanged |
| SoundCloud link | yes | yes, except Go+ preview-only | id `soundcloud-<id>`; see the SoundCloud ADR |
| Spotify track link | yes (Web API, client credentials) | never (DRM) | id `spotify-<id>`; audio via a confirmed YouTube match |
| Text search | yes (YouTube results) | yes | becomes a YouTube record |
| Manual entry | yes (typed) | none until a match or link is attached | id `manual-<n>` or later attached |
| Apple Music link | yes (iTunes Lookup API, keyless) | never (DRM) | id `applemusic-<id>`; unverified, task-0012 |
| Shazam listen (ShazamKit) | yes (title, artist, ISRC, artwork) | never | needs mic and network; iOS only; task-0013 |
| Shazam import | yes (history) | never | format by research; task-0014 |
| SoundHound | share-link page metadata only | never | parked, fragile; task-0015 |
| Playlists (later) | yes, many records | per song | public Spotify playlists first |
| Spotify Liked Songs | yes | via match | needs one-time OAuth; optional |

## User journeys

**Populate from a Spotify link.** Add (to catalog) -> paste a Spotify track link ->
server reads title, artist, album, year, cover from the Spotify Web API -> preview
with "No audio yet" -> edit tags -> Save. The record appears in Library with state
`none`. Nothing is downloaded.

**Populate by listening.** Add -> Listen -> a song plays nearby -> ShazamKit returns a match -> result card -> Save. The record has state `none`. Apple Music links follow the Spotify journey; Shazam history imports once.

Order of sources: YouTube/SoundCloud (done) -> Spotify -> Apple Music -> ShazamKit Listen -> Shazam import.

**Get audio for one song.** Row or song screen -> Get audio. A YouTube song downloads
at once. A Spotify-only song first shows the server's best YouTube match (title,
channel, duration, thumbnail); the owner confirms, picks another candidate, or
cancels. Wrong versions (live, remix, lyric video) are the reason for the confirm.
State goes `none` -> `server`, then the phone copy follows (`phone`).

**Listen offline.** The catalog is already on the phone. Rows with state `phone` play
with no network. Rows in `none` or `server` are visible, tagged and searchable
offline, but Play is disabled until the audio is on the phone.

**Bulk Get audio.** Library -> select songs (or a filter result) -> Get audio. Matches
that need confirmation queue up as a review list; unambiguous ones (YouTube,
SoundCloud) start immediately. Progress shows per row.

## Data model sketch

Existing record fields stay. Added:

- `sources`: list of `{source, id, url}`; the first is the primary. A YouTube-only
  song has one entry; a Spotify song later matched to YouTube has two.
- `id`: stays the primary key; YouTube id unchanged, `soundcloud-<id>`,
  `spotify-<id>`. When audio from another source is attached, `id` does not change;
  the new source is appended to `sources` (no file renames, no broken references).
- `file`: `null` until audio exists on the server.
- `match`: optional, `{status: proposed|confirmed|rejected, youtube_id, score}`.

Audio state is derived, never stored in git:

| State | Rule |
| --- | --- |
| `none` | `file` is null, or the file is missing on the server |
| `server` | the file exists on the server |
| `phone` | the phone holds a local copy (known by the phone only) |

| Piece | Lives in |
| --- | --- |
| Catalog records | git (`library.json`), served by `GET /library` |
| Covers | git LFS repo |
| Server audio | music_root on perkunas |
| Phone audio, phone state | app sandbox + a local index; never in git |
| Spotify client id and secret | git-ignored server env |

## Sync and offline rules

- The phone pulls the whole catalog (tiny) on launch and on pull-to-refresh, and
  keeps the last copy for offline use. Covers are cached on first view.
- The server is the writer of the catalog; the phone edits go through the API
  when online and queue when offline.
- Audio state `phone` is local to the device and survives catalog syncs; a catalog
  sync that drops a song never deletes a phone file silently (the owner is asked).
- Playback uses local files only, as today.

## Risks

- **Spotify API limits and terms**: client-credentials access is limited to public
  catalog data and has rate limits; use is for a personal app; no audio, no
  redistribution; keep client id and secret server-side only.
- **Wrong matches**: search-based YouTube matches may pick live, remix, cover or
  lyric versions; mitigated by an owner confirm and duration comparison.
- **ToS and legal**: downloading from YouTube or SoundCloud may violate their terms;
  unchanged from today, personal use, never distributed.
- **Metadata quality**: Spotify and YouTube titles, years and artists disagree;
  the owner edits before Save, and `manual` fields are never overwritten by a re-fetch.
- **Catalog vs audio drift**: a file deleted on the server leaves a stale state;
  derived state and a periodic check keep rows honest.

## Open questions

- Id for manual entries and how a later attached source is shown.
- Does "On server" need its own filter, or is "On phone" and "No audio" enough?
- Should unconfirmed bulk matches expire?
- Storage limit and eviction on the phone (keep favourites, free the rest)?
- Spotify Liked Songs OAuth: worth the extra token handling?
