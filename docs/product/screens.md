# Screens and library model

Status: web UI and the server endpoints below are implemented
(2026-10-12, `web/`, `server/`); the iOS app is not updated and is
deferred. The web UI is served by FastAPI from
the same origin as the API at `play.isayenko.net` (no CORS, token-protected
API), see ADR-0003 in [`../tech/decisions.md`](../tech/decisions.md). The
iOS app is deferred; it currently has Library, Search and Settings tabs,
see [`../tech/architecture.md`](../tech/architecture.md).

Scope: the web UI is for managing the library and listening online only,
with no offline storage or audio cache. Offline listening ("download to
device") is an iOS-app feature, built later against the same API.

The screens below apply to the web UI first; "tab bar" and "mini-player"
describe the layout to mirror in the app later.

## Concept: tags replace playlists

A song has zero or more tags (free-form strings), so it belongs to
several "playlists" at once. A tag view is just a filter on the
library. There is no separate playlist entity.

## Navigation

Tab bar with **Library**, **Add**, **Playback** and **Settings** (server URL and
token are still needed). Playback is the Player screen as a regular tab; it
shows the queue length as a badge when the queue is non-empty. A mini-player
bar sits above the tab bar on the other tabs and opens Playback on tap.

## Screens

### 1. Add song

1. User pastes a YouTube URL.
2. App asks the server for a metadata preview (cover, title, artist,
   album, year, and a suggested `genre:` tag, from yt-dlp where available).
3. User edits any field and assigns tags (existing tags suggested; `key:value` allowed).
   BPM is optional: left empty it is detected on the server after the
   download (placeholder "Detected after saving"); a typed value is kept as is.
4. Save starts the download on the server, then the app fetches the file.
5. Shows progress while downloading and a clear error on failure
   (bad URL, unavailable video, server unreachable, already in library).

### 2. Library

Manages all songs.

- One card per song: square cover on the left; title, then one line
  "Author, Album, year" (missing parts omitted); duration top-right with a
  BPM badge when known; two icon buttons, Play now and Add to current
  playlist; a row of tag chips along the bottom (`key:value` tags keep a
  highlighted key prefix). Clicking the card body opens the Edit dialog,
  which also holds Delete. Play now keeps the user on Library.
- Search box (title, artist, album, tags).
- Filter by tag (chips grouped by prefix: Genre, Mood, ...; plain tags under Tags); sort (added date, title, artist, year, BPM; songs without BPM last).
- Edit dialog has a BPM input and a Re-detect button (re-runs detection on the stored file).
- Edit metadata and tags of a song; Delete a song (server file, cover and
  record) from the Edit dialog.

### 3. Player (Playback tab)

Four stacked blocks in a centered column (max 720px). The page itself does
not scroll; block 4 takes the remaining height and scrolls inside.

```
+--------------------------------------------+
| 1. SONG DETAILS                            |
|  large cover fills the card                |
|                                            |
|  ......................................    |
|  Title of the composition   (on a scrim)   |
|  Author, Album, year                       |
|  [tag] [tag] [tag] ...  BPM  Source link   |
+--------------------------------------------+
| 2. SONG PLAY CONTROLS                      |
|  |<   (<5)   [ > ]   (5>)   >|    1:05 / 3:33
|  ---o------------------------ (thin scrub) |
+--------------------------------------------+
| 3. PLAYLIST CONTROLS                       |
|  [shuffle] [loop 1] [loop all] Clean playlist
|  (tag1 x) (tag2 x)  [+]         N songs    |
+--------------------------------------------+
| 4. CURRENT PLAYLIST          (scrolls) |###|
|  [cover] Title              M:SS  [>] [=]  |
|          Author, Album, year               |
|          [tags ...]                        |
|  [cover] ... (current row highlighted)     |
|  ...                                       |
+--------------------------------------------+
```

Wireframes (`wireframes/`): current is the detailed v3
([whole screen](wireframes/playback-v3-detailed.png),
[controls](wireframes/playback-v3-controls.png),
[rows](wireframes/playback-v3-rows.png),
[scrollbar](wireframes/playback-v3-scrollbar.png)); the row mirrors the
Library card ([`library-row.png`](wireframes/library-row.png)). Earlier
drafts, both SUPERSEDED:
[v1 three blocks](wireframes/playback-v1-three-blocks.png),
[v2 four blocks](wireframes/playback-v2-four-blocks.png).

![Playback v3, current](wireframes/playback-v3-detailed.png)

1. **Song details**: the cover fills the whole card (placeholder colour when
   there is none); title, "Author, Album, year", tag chips, BPM and a Source
   link (`source_url`, new tab) are overlaid at the bottom on a dark gradient
   scrim (legible in light and dark). Empty: "Nothing playing".
2. **Song play controls**, one row: previous song, back 5 s, play/pause
   (also space), forward 5 s, next song, and "M:SS / M:SS" on the right. A
   thin scrubber under the row keeps seeking possible. No volume slider
   (device volume is used).
3. **Playlist controls**, one row (wraps on narrow screens):
   - Shuffle toggle (`aria-pressed`).
   - Loop one song toggle and loop whole list toggle, mutually exclusive
     (turning one on turns the other off; both off = stop at the end).
   - **Clean playlist**: removes all selected tags (chips) together with the
     songs those tags contributed; see rules below.
   - Chips = the currently selected tags, each with an x; **+** opens the tag
     picker; song count on the right.
4. **Current playlist**: rows look like Library cards (cover, title,
   "Author, Album, year", duration, play button, tags line) plus a menu
   button (Move up, Move down, Remove). Tap a row to play it; the current
   song is highlighted. The list has a persistent, slim, styled scrollbar
   ([wireframe](wireframes/playback-v3-scrollbar.png)). Empty: "Queue is
   empty - add songs from Library".

#### Queue and tag rules

- The queue is the "current playlist", client-side only (`localStorage`,
  restored on reload without auto-play; songs deleted from the library are
  dropped). Each item records `manual` (added one by one) and the tags that
  brought it in.
  - Play now: inserts the song right after the current one and plays it; if
    already queued it is moved there. It counts as manual.
  - Add (Library): appends to the end; a manual duplicate is ignored (toast
    "Already in queue"). A song already queued only via a tag becomes manual.
    If the queue was empty the song is queued but not played.
  - Move/Remove apply to upcoming rows only (disabled for the current and
    earlier songs).
- **Tag picker** (+): all tags grouped by prefix with counts, multi-select;
  already selected tags show as selected. Confirming adds every song that has
  ANY picked tag (union) to the end of the queue, dedupes, and shows the
  picked tags as chips. Deselecting a selected tag in the picker removes it
  like the chip's x.
- **Removing a tag** (chip x, or Clean playlist for all chips) removes the
  songs it contributed only if they are upcoming (after the current song),
  not manual, and not held by another remaining chip. The current song keeps
  playing; played songs and songs added manually stay. Manual wins if a song
  is both manual and tag-derived.
- **Order of play**: sequential by default. Shuffle on: next picks a random
  song not yet played in this round; when all have played it stops, or with
  loop whole list reshuffles; previous walks back through the songs actually
  played. Shuffle off restores sequential order from the current song.
  Loop one song replays the current song when it ends (the Next button still
  advances). Loop whole list wraps from the last song to the first. Shuffle
  and loop state persist in `localStorage`. The logic is pure and tested:
  `web/js/queue-logic.js`, `node web/js/queue-logic.test.mjs`.
- Mini-player bar over Library, Add and Settings with short controls; tap
  opens Playback.

## Song fields

| Field | Key | Notes |
| --- | --- | --- |
| Author | `artist` | editable |
| Composition name | `title` | editable |
| Album | `album` | editable, optional |
| Year of release | `year` | editable, optional |
| Tempo | `bpm` | number 20-300 with 1 decimal, or `null`; auto-detected with aubio on add, editable, heuristic (ADR-0002) |
| Source URL | `source_url` | where it was downloaded from |
| Cover image | `cover` | jpg file, see below |
| Tags | `tags[]` | plain or namespaced `key:value` strings (genre is `genre:<name>`) |
| Id | `id` | YouTube video id (technical) |
| Duration | `duration` | seconds (technical) |
| Added at | `added_at` | ISO 8601 UTC (technical) |

## `library.json` record

```json
{
  "settings": {
    "music_root": "perkunas://data/music/"
  },
  "songs": [
    {
      "id": "dQw4w9WgXcQ",
      "file": "dQw4w9WgXcQ.m4a",
      "title": "Never Gonna Give You Up",
      "artist": "Rick Astley",
      "album": "Whenever You Need Somebody",
      "year": 1987,
      "bpm": 113.0,
      "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "cover": "covers/dQw4w9WgXcQ.jpg",
      "duration": 213,
      "added_at": "2026-10-12T09:30:00Z",
      "tags": ["80s", "workout", "genre:pop", "mood:chill"]
    }
  ]
}
```

- `settings.music_root` (implemented, ADR-0005): `<servername>://<path>/`,
  the one place that says where audio lives. Songs reference audio only
  by relative `file` name (`<video_id>.m4a`); moving the music to another
  host or path means changing this one value. The server resolves
  `<servername>` via its own local config (name -> mount path/host,
  outside the repo), so the JSON holds no credentials or IPs.
- An old bare `{songs:[...]}` file is migrated on load; `AUDIO_DOWNLOAD_DIR`
  is only the fallback when no `music_root` is set. `AUDIO_MUSIC_ROOT`
  overrides it locally.
- Today audio is at `downloads/<id>.m4a` on the server. Covers are
  `covers/<id>.jpg` (downloaded from the yt-dlp thumbnail at save time).
- Storage (ADR-0005, implemented; plain files when `AUDIO_DATA_REPO` is unset):
  `library.json` is `audioplayer/library.json` in the git repo
  `alexisayenko/data-storage`, covers are `audioplayer/covers/<id>.jpg`
  in `alexisayenko/data-storage-lfs`; every change is a commit. Keep
  secrets and personal data out of the file, history is permanent.
- Optional fields may be `null`. Tags are trimmed and deduplicated
  case-insensitively; `key:value` tags are stored lowercased, plain tags
  keep their case. There is no `genre` field: an old `genre` value is
  migrated on load to the tag `genre:<value>`.
- Storage rules (atomic writes, single writer, no SQLite, git-backed
  store) are in
  [`../tech/decisions.md`](../tech/decisions.md).

## API surface the screens need

Implemented. All need `X-API-Token` (header), except that `/files/{id}`
and `/covers/{id}` also accept `?token=` because `<audio>` and `<img>`
cannot send headers. The static web UI files at `/` are public; they
contain no data.

| Endpoint | Purpose | Screen |
| --- | --- | --- |
| `GET /library` | all songs, with tags | Library, Player |
| `POST /preview {url}` | yt-dlp metadata, no download | Add |
| `POST /songs {url, metadata, tags}` | save metadata and start download | Add |
| `GET /songs/{id}/status` | download progress or error | Add |
| `PATCH /songs/{id}` | update metadata, tags, `bpm` (20-300 or `null`) | Library |
| `POST /songs/{id}/bpm/detect` | re-detect BPM from the stored file, returns the song (422 if undetectable) | Library |
| `DELETE /songs/{id}` | remove record, audio, cover | Library |
| `GET /files/{id}` | stream m4a (Range supported) | Player |
| `GET /covers/{id}` | cover image | all |
| `GET /tags` | known tags with counts | Add, Library |

`POST /songs` returns 202 and downloads in the background; poll
`GET /songs/{id}/status` (`downloading` with `progress` 0..1, `done`, or
`error` with a message). The record is written to `library.json` only
when the download succeeds, so the library lists playable songs only.
Duplicates return 409. BPM detection runs after the file is saved; if it fails the song is saved with `bpm: null`. Old records without `bpm` load fine. If the cover fetch fails the song is still saved
with `cover: null`. `POST /download` and `GET /search` still exist for the
iOS scaffold; the web UI does not use them.

## Open questions

- Does the existing `/search` (YouTube search) endpoint and Search tab
  stay, or is URL paste the only way to add songs?
- (Resolved) The web UI mirrors all three screens: Add, Library, Player
  (the Playback tab, also opened from the persistent mini-player bar).
