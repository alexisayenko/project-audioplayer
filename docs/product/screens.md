# Screens and library model

Status: planned; being built web-first (2026-10-12), so treat nothing
here as implemented until marked. The web UI is served by FastAPI from
the same origin as the API at `play.isayenko.net` (no CORS, token-protected
API), see ADR-0003 in [`../tech/decisions.md`](../tech/decisions.md). The
iOS app is deferred; it currently has Library, Search and Settings tabs,
see [`../tech/architecture.md`](../tech/architecture.md).

The screens below apply to the web UI first; "tab bar" and "mini-player"
describe the layout to mirror in the app later.

## Concept: tags replace playlists

A song has zero or more tags (free-form strings), so it belongs to
several "playlists" at once. A tag view is just a filter on the
library. There is no separate playlist entity.

## Navigation

Tab bar with **Library** and **Add**, plus **Settings** (server URL and
token are still needed). The Player is not a tab: a mini-player bar sits
above the tab bar on every tab and opens the full-screen Player on tap.
Chosen as the simplest iOS-native option.

## Screens

### 1. Add song

1. User pastes a YouTube URL.
2. App asks the server for a metadata preview (cover, title, artist,
   album, year, genre, from yt-dlp where available).
3. User edits any field and assigns tags (existing tags suggested).
4. Save starts the download on the server, then the app fetches the file.
5. Shows progress while downloading and a clear error on failure
   (bad URL, unavailable video, server unreachable, already in library).

### 2. Library

Manages all songs.

- List rows: cover, title, artist.
- Search box (title, artist, album, tags).
- Filter by tag; sort (added date, title, artist, year).
- Tap = play, queue is the current filtered and sorted list.
- Edit metadata and tags of a song.
- Delete a song (server file, cover and record).

### 3. Player

- Full screen: cover, title, artist, scrubber, play/pause, prev/next.
- Queue = the list that was filtered when playback started (for example
  one tag).
- Mini-player bar over Library (and Add) with the same controls in short
  form; tap opens the full Player.

## Song fields

| Field | Key | Notes |
| --- | --- | --- |
| Author | `artist` | editable |
| Composition name | `title` | editable |
| Album | `album` | editable, optional |
| Year of release | `year` | editable, optional |
| Style / genre | `genre` | editable, optional |
| Source URL | `source_url` | where it was downloaded from |
| Cover image | `cover` | file on server, see below |
| Tags | `tags[]` | free-form strings |
| Id | `id` | YouTube video id (technical) |
| Duration | `duration` | seconds (technical) |
| Added at | `added_at` | ISO 8601 UTC (technical) |

## `library.json` record

```json
{
  "songs": [
    {
      "id": "dQw4w9WgXcQ",
      "title": "Never Gonna Give You Up",
      "artist": "Rick Astley",
      "album": "Whenever You Need Somebody",
      "year": 1987,
      "genre": "Pop",
      "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "cover": "covers/dQw4w9WgXcQ.jpg",
      "duration": 213,
      "added_at": "2026-10-12T09:30:00Z",
      "tags": ["80s", "workout"]
    }
  ]
}
```

- Audio stays at `downloads/<id>.m4a`; covers at `covers/<id>.jpg`
  (downloaded from the yt-dlp thumbnail at save time).
- Optional fields may be `null`. Tags are stored as typed; compare
  case-insensitively.
- Storage rules (atomic writes, single writer, no SQLite) are in
  [`../tech/decisions.md`](../tech/decisions.md).

## API surface the screens need

All need `X-API-Token`. Planned unless marked existing.

| Endpoint | Purpose | Screen |
| --- | --- | --- |
| `GET /library` | all songs, with tags | Library, Player |
| `POST /preview {url}` | yt-dlp metadata, no download | Add |
| `POST /songs {url, metadata, tags}` | save metadata and start download | Add |
| `GET /songs/{id}/status` | download progress or error | Add |
| `PATCH /songs/{id}` | update metadata and tags | Library |
| `DELETE /songs/{id}` | remove record, audio, cover | Library |
| `GET /files/{id}` (existing) | stream m4a | Player |
| `GET /covers/{id}` | cover image | all |
| `GET /tags` | known tags with counts (optional; derivable from `/library`) | Add, Library |

`POST /download {video_id}` exists today and is superseded by
`POST /songs`.

## Open questions

- Does the existing `/search` (YouTube search) endpoint and Search tab
  stay, or is URL paste the only way to add songs?
- Does the web UI mirror all three screens? Assumed yes (Add, Library,
  Player) since it is the first client.
