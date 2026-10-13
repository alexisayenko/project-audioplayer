# Screens and library model

Status: web UI and the server endpoints below are implemented
(2026-10-12, `web/`, `server/`); the iOS app (`ios/`) implements the same tab flow (ADR-0007, [`../specs/ios.md`](../specs/ios.md)). The web UI is served by FastAPI from
the same origin as the API at `play.isayenko.net` (no CORS, token-protected
API), see ADR-0003 in [`../tech/decisions.md`](../tech/decisions.md). The
iOS app mirrors the web flow with Library, Playback and
Settings tabs (Add is a sheet from the Library header; YouTube text search is a secondary screen inside it; Library is the phone only, filtered by four category chips and a bottom sheet), see [`../tech/architecture.md`](../tech/architecture.md).

Scope: the web UI is for managing the library and listening online only,
with no offline storage or audio cache. Offline listening ("download to
device") is the iOS app: Add and Library work as below, plus downloads to
the phone, a phone-only Library (no server list; the server is the download pipe behind Add), and the Electrophone look
([style guide](../ui-ux/style-guide.md)). iOS differences are listed in
[`../specs/ios.md`](../specs/ios.md); layouts below are the web's.

## Concept: tags replace playlists

A song has zero or more tags (free-form strings), so it belongs to
several "playlists" at once. A tag view is just a filter on the
library. There is no separate playlist entity.

## Navigation

Web (Electrophone screens, web v16 artboards, ADR-0009 amendment): three
destinations, **Library**, **Playback** and **Settings**; adding a song is the
accent "Add song" button in the Library header, which opens the Add dialog
(`#/add` still works and opens Library with the dialog). A signed-out visitor sees
only Settings (Sign in with Google, Sign in with Apple; no token field); once
signed in, Settings shows the email and Sign out. Navigation is a 220px rail
(>= 720px), a 64px icon rail (480-719px) or a floating tab bar (< 480px). A
persistent player bar (cover, title, shuffle, previous, play/pause, next, repeat,
time, volume) sits at the bottom of Library and Settings and opens Playback on
tap; on Playback itself it is hidden. Library is a table of the server library
(index, cover, title, artist, album, year, time, a "..." menu; columns drop right
to left on narrower screens until it is the phone song row) with four category chips (Tags, Genres,
Years, Countries) that open a filter sheet. Playback leads with the cover
(title and artist on it), a seek bar, the transport tray, a volume row and the
queue card beside it. The iOS Settings screen shows Account, Downloads (read-only audio quality, "Download new songs automatically", "Use mobile data"), and Storage, then the version line; the iOS Add sheet ends with "Add to library" and "Add and download to iPhone". The iOS app has its own tab bar with the same three destinations (its Playback has no volume row and its titles carry no eyebrow) (see
[`../specs/ios.md`](../specs/ios.md)).

## Screens

### 1. Add song

Web: a centred 560px dialog over Library (bottom-aligned sheet on phones): title "Add from YouTube", Cancel, a link field with a Fetch button, then the preview (88px cover, title, artist, album, year, duration), an "Edit details" button that expands the fields, the suggested tags as chips with a + chip that opens the tag editor, and one "Save to library" button. Saving closes the dialog; the download continues as a row "Downloading NN%" at the top of Library (and a toast when it is saved or fails).

1. User pastes a YouTube URL (cleaned to the canonical link on paste, drop, bulk input and blur; surrounding text is dropped).
2. App asks the server for a metadata preview (cover, title, artist,
   album, year, and suggested `genre:`, `country:` and `lang:` tags from yt-dlp, MusicBrainz and Wikidata, plus suggested Wikipedia links for the song and the band).
3. User edits any field and assigns tags in the shared tag editor (suggested tags, existing tags grouped by prefix, `key:value` allowed; incomplete leftover text such as `mood:` is ignored).
   BPM is optional: left empty it is detected on the server after the
   download (placeholder "Detected after saving"); a typed value is kept as is.
   Two optional inputs, Wikipedia (song) and Wikipedia (band), hold the links; "Fill from Wikipedia links" suggests tags and the year from them (year fills an empty Year, or asks first when it differs).
4. Save starts the download on the server, then the app fetches the file.
5. Shows progress while downloading and a clear error on failure
   (bad URL, unavailable video, server unreachable, already in library).

### 2. Library

Manages all songs.

- One row per song in a single list card (web: table with a header row): index, cover, title, artist, album, year, duration and a "..." menu with Play now, Add to playlist and Edit song (the Edit dialog also holds Delete). Clicking the title plays the song and keeps the user on Library. The playing row has an accent wash. Tags and BPM are not shown in rows (filter by tag chips; BPM is on Playback and in Edit). Sort is the text button under the chips ("Recently added", Title, Artist, Year, BPM); a line on the right reads "N songs match · selected tags" when filtered.
- Search box (title, artist, album, tags). With a tag filter or search text active, an "Add all N to playlist" button appends all listed songs to the queue (toast "Added X songs (Y already in queue)"; a tag filter becomes a playlist chip, search-only adds are manual); hidden when nothing is filtered.
- `decade:` tags are derived from Year by the server and show as "the 90s"; the tag editor previews the chip as Year changes.
- Filter by tag (chips grouped by prefix: Genre, Decade, Country, Language, then others; plain tags under Tags; `country:` and `lang:` values show as names, e.g. Lithuania, Russian); sort (added date, title, artist, year, BPM; songs without BPM last).
- Edit dialog has the two Wikipedia inputs and "Fill from Wikipedia links" (same behaviour as Add), uses the same tag editor and has a BPM input (whole numbers) and a Re-detect button (re-runs detection on the stored file).
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
|  [tag] [tag] ...  BPM  Source Wikipedia(s) |
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
   there is none); title, "Author, Album, year", tag chips, BPM and up to three
   links (new tab) are overlaid at the bottom on a dark gradient
   scrim (legible in light and dark). Links: Source (`source_url`), Wikipedia (song) and Wikipedia (band) (`wikipedia_song`, `wikipedia_artist`); each shows only when set. Empty: "Nothing playing".
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
- Player bar over Library and Settings with short controls; tap
  opens Playback. Web Playback has no 5-second skip keys (Left/Right arrow keys seek 5 s); the repeat key cycles off, whole list, one song; the favourite button of the artboard is not built (no such feature).

## Song fields

| Field | Key | Notes |
| --- | --- | --- |
| Author | `artist` | editable |
| Composition name | `title` | editable |
| Album | `album` | editable, optional |
| Year of release | `year` | editable, optional |
| Tempo | `bpm` | whole number 20-300, or `null`; auto-detected with aubio on add, editable, heuristic (ADR-0002) |
| Source URL | `source_url` | where it was downloaded from |
| Wikipedia (song) | `wikipedia_song` | optional Wikipedia/Wikidata link, editable |
| Wikipedia (band) | `wikipedia_artist` | optional, same rule |
| Cover image | `cover` | jpg file, see below |
| Tags | `tags[]` | plain or namespaced `key:value` strings (`genre:<name>`, `country:<code>`, `lang:<code>`) |
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
      "bpm": 113,
      "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "wikipedia_song": "https://en.wikipedia.org/wiki/Never_Gonna_Give_You_Up",
      "wikipedia_artist": "https://en.wikipedia.org/wiki/Rick_Astley",
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
- ~~Today audio is at `downloads/<id>.m4a` on the server.~~ Per user since ADR-0012: `<music_root>/users/<uid>/<id>.m4a`. Covers are
  `covers/<id>.jpg` (downloaded from the yt-dlp thumbnail at save time).
- Storage (ADR-0005, implemented; plain files when `AUDIO_DATA_REPO` is unset):
  `library.json` is `audioplayer/library.json` in the git repo
  `alexisayenko/data-storage`, covers are `audioplayer/covers/<id>.jpg`
  in `alexisayenko/data-storage-lfs`; every change is a commit. Keep
  secrets and personal data out of the file, history is permanent.
- Optional fields may be `null`. Tags are trimmed and deduplicated
  case-insensitively; `key:value` tags are stored lowercased, plain tags
  keep their case; a half-empty `key:` or `:value` is dropped. There is no `genre` field: an old `genre` value is
  migrated on load to the tag `genre:<value>`.
- Storage rules (atomic writes, single writer, no SQLite, git-backed
  store) are in
  [`../tech/decisions.md`](../tech/decisions.md).

## API surface the screens need

Implemented. The web UI uses only the session cookie; the owner's iOS app and scripts use `X-API-Token` (header), except that `/files/{id}`
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
iOS secondary text search; the web UI does not use them.

## Open questions

- (Resolved for iOS) `/search` stays as a secondary text search under Add;
  the web UI is paste-only. Open: the row download there still uses the
  legacy `/download` (API-018).
- (Resolved) The web UI mirrors all three screens: Add, Library, Player
  (the Playback tab, also opened from the persistent mini-player bar).
