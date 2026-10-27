# Screen flow

Where each screen and dialog sits, how the user gets from one to the next, and
how a song's audio moves between none, server and phone. Diagrams only; the
rules behind them live in [`../specs/`](../specs/README.md), the written
multi-screen paths in [`journeys.md`](journeys.md).

Last verified against code: `origin/main` at `8195bfd0` (2026-10-27). Every
node below was read from the source named in its section; nothing is planned or
invented. When the code changes a route, a sheet or a state, change the diagram
in the same commit.

## How to read

- GitHub renders the `mermaid` blocks; in an editor use a Mermaid preview.
- Rectangles are screens or pages; rounded boxes (`([...])`) are entry points;
  hexagons (`{{...}}`) are menus and switches; diamonds are decisions.
- A solid arrow is a tap or a click. A dotted arrow is something the app does
  by itself (a redirect, a sync, a timer).
- Names in quotes are the visible English labels (UI language is English).
- "Sheet" is an iOS bottom sheet; "dialog" is a web `<dialog>`.
- Each section ends with the source files it was read from.

## 1. iOS app

### 1.1 Shell

There is no bottom tab bar and no `TabView`. `RootView` keeps six pages alive
at once and shows one; a left drawer switches between them. The mini player is
a floating bar over every page except Now playing.

```mermaid
flowchart LR
  Launch(["App launch"]) --> Library
  Menu{{"Left drawer<br/>menu button, or swipe from the left edge on a root screen (a pushed screen keeps the back swipe)"}}
  Menu --> Library["Library"]
  Menu --> Playback["Now playing"]
  Menu --> Playlists["Playlists"]
  Menu --> Stats["Statistics"]
  Menu --> Tools["Tools"]
  Menu --> Settings["Settings"]
  Menu -->|"account row at the bottom"| Settings
  Mini["Mini player bar<br/>shown while a song is loaded<br/>and the keyboard is down"]
  Mini -->|"tap the song row"| Playback
  Mini -->|"top grabber"| Expanded["Now Playing sheet<br/>drag down to close"]
  Tools --> BPM["Live BPM card<br/>microphone"]
  Tools --> Metro["Metronome card"]
  Stats --> StatTabs["Tabs Songs, Genres<br/>and Listening when signed in"]
```

Sources: `ios/Sources/Views.swift` (`AppTab`, `RootView`, `MiniPlayer`),
`Drawer.swift`, `ToolsView.swift`, `StatisticsView.swift`.

### 1.2 Library, albums and the Add sheet

`LibraryHome` keeps the Songs list and the Albums grid alive side by side.
The "Songs | Albums" switch exists only when signed in. The iOS Library has no
Drafts mode; Drafts are web-only (section 2.2).

```mermaid
flowchart TD
  Songs["Library: Songs<br/>search, filter chips, sort"]
  Albums["Library: Albums grid<br/>search, sort, On phone"]
  Songs <-->|"Songs / Albums switch, signed in only"| Albums
  Songs -->|"plus button"| Add["Add sheet"]
  Add -->|"signed in"| AddIn["Link field, preview, form"]
  Add -->|"signed out"| AddAnon["Anonymous add<br/>link only"]
  AddIn -->|"Search YouTube by title"| Search["Search screen<br/>pushed inside the sheet"]
  Search -->|"tap a result"| AddIn
  Songs -->|"tap title, artist or state"| Details["Song Details<br/>pushed screen"]
  Albums -->|"tap an album"| AlbumPage["Album page<br/>tracks, status, play, shuffle"]
  AlbumPage -->|"tap a track"| Details
  AlbumPage -->|"Download album"| Plan["Download album sheet<br/>cost, limits, wait"]
  Plan -->|"Download"| Run["Progress card on the album page"]
  Songs -->|"long-press menu, Edit"| Edit["Song edit sheet"]
  Songs -->|"long-press menu, Add to playlist"| Picker["Playlist picker sheet"]
  Songs -->|"Sort"| Sort["Sort sheet"]
  Songs -->|"filter chip"| Facet["Filter sheet"]
  Details -->|"Edit"| Edit
  Details -->|"Add to playlist"| Picker
  Details -->|"Share link"| Share["Share sheet"]
  Details -->|"Delete from library"| Confirm["Confirmation dialog"]
```

Sources: `AlbumsView.swift` (`LibraryHome`, `LibraryMode`), `LibraryView.swift`,
`AddSheet.swift`, `AnonAddSheet.swift`, `SearchView.swift`, `SongDetailsView.swift`,
`AlbumDetailView.swift` (`AlbumDownloadSheet`, `AlbumRunCard`), `SongEditView.swift`,
`PlaylistPickers.swift`, `ShareSheet.swift`, `LibrarySortSheet`/`LibraryFilterSheet`.

### 1.3 Now playing and Playlists

```mermaid
flowchart TD
  Playback["Now playing<br/>cover, seek bar, transport, Up next"]
  Playback -->|"more menu, Queue"| Queue["Queue sheet<br/>jump, remove, clear"]
  Playback -->|"more menu, Add songs by tag"| Tags["Tag picker sheet"]
  Playback -->|"more menu, Song details"| Edit["Song details sheet<br/>the shared song form"]
  Playback -->|"more menu, Add to playlist<br/>or Save queue as playlist"| Picker["Playlist picker sheet"]
  Playback -->|"more menu, Share link"| Share["Share sheet"]
  Playlists["Playlists list"]
  Playlists -->|"plus"| NewPl["New playlist alert"]
  Playlists -->|"long-press, Rename"| Rename["Rename alert"]
  Playlists -->|"long-press, Delete"| Del["Delete confirmation"]
  Playlists -->|"tap a playlist"| PlPage["Playlist page<br/>pushed"]
  PlPage -->|"menu, Add songs"| Pick["Song picker sheet"]
  PlPage -->|"menu, Edit order"| Order["Edit mode: reorder, remove"]
  PlPage -->|"Download N missing songs"| Fetch["Downloads the songs<br/>that are not on the phone"]
  PlPage -->|"tap a track"| Details["Song Details"]
  Playlists -->|"signed out: Sign in"| Settings["Settings"]
```

Sources: `PlaybackView.swift`, `PlaylistsView.swift`, `PlaylistDetailView.swift`,
`PlaylistPickers.swift`, `SongListScreen.swift`.

### 1.4 Signed in and signed out

"Signed in" means a Google or Apple session, or a legacy token saved by an old
build (`ServerLink.hasCredentials`). Signed out the app keeps a local library of
the songs on the phone and reads nothing from the server.

| Screen | Signed in | Signed out |
| --- | --- | --- |
| Library | Server catalog, Songs / Albums switch, chips "Never listened" and "Downloaded" | Phone songs only, no switch, no server catalog; empty state offers Add and Sign in |
| Add sheet | Link, preview, form, search by title | Link only, account-free download (`AnonAddSheet`) |
| Albums, album page | Yes | Not mounted |
| Playlists | List, page, create, edit | A "Sign in" button that opens Settings |
| Statistics | Songs, Genres, Listening | Songs, Genres on phone songs |
| Song edit, downloads from the server | Yes | Needs sign-in |
| Settings | Account card with Sign out, downloads, storage | Sign in with Apple and Google buttons, storage |
| Playback | From files on the phone | Same |

Sources: `LibraryView.swift`, `AlbumsView.swift`, `PlaylistsView.swift`,
`SettingsView.swift`, [`../specs/ios.md`](../specs/ios.md) (IOS-014, IOS-016a to IOS-016d).

## 2. Web

### 2.1 Routes

The router is `hashchange` in `web/js/app.js`. The sidebar groups Library
(Songs, Albums, Drafts), Now playing, Playlists, Genres map, Statistics, Studio,
a Help group (Music theory, About, Features) and Settings.

```mermaid
flowchart TD
  Entry(["Page load or hash change"]) --> Auth{"Signed in<br/>or guest?"}
  Auth -->|"no"| Login["Login screen<br/>Sign in with Google or Apple"]
  Auth -->|"yes"| Router{"Route"}
  Router -->|"#/library"| Songs["Library: Songs"]
  Router -->|"#/library/albums"| AlbumList["Library: Albums"]
  Router -->|"#/library/albums/ID"| AlbumPage["Album page"]
  Router -->|"#/library/drafts"| Drafts["Library: Drafts"]
  Router -->|"#/playback"| Playback["Now playing"]
  Router -->|"#/playlists"| Playlists["Playlists"]
  Router -->|"#/playlists/ID"| Playlist["Playlist page"]
  Router -->|"#/genres"| Genres["Genres map"]
  Router -->|"#/stats"| Stats["Statistics<br/>tabs Songs, Listening, Genres"]
  Router -->|"#/studio"| Studio["Studio: Modify"]
  Router -->|"#/theory, #/about, #/features"| Help["Music theory, About, Features"]
  Router -->|"#/settings"| Settings["Settings"]
  Router -.->|"#/studio/tools, #/studio/analyze,<br/>#/studio/simple, #/studio/synthesize"| Site["studio.electrophone.cc<br/>separate site"]
  Router -.->|"#/play/..., share link"| Songs
  Router -.->|"#/add"| Songs
  Router -.->|"#/genres-rework, #/genres2"| Genres
  Router -.->|"unknown route"| Songs
```

Behind the diagram:

- `#/play/...` opens the Library, then the "shared link" dialog, then Playback.
  `#/add` opens the Library and the Add dialog.
- On the first load a bare `#/library` jumps to the last used Library view
  (Songs, Albums or Drafts), kept in `localStorage`.
- Guests exist only when the server runs with `PUBLIC_VIEW=1`; they see a
  read-only Library and no Albums or Drafts menu items. By default a signed-out
  visitor sees only the login screen.
- `#/genres-classic` is a registered route with no menu link.
- After sign-in the app goes to `#/library`; Sign out lives in Settings, Account.

Sources: `web/js/app.js`, `nav-library.js`, `studio-redirect.js`, `share-hash.js`,
`login.js`, `signin.js`, `web/index.html`.

### 2.2 Dialogs from the Library

```mermaid
flowchart TD
  Songs["Library: Songs"] -->|"Add song"| AddSong["Add dialog<br/>link, preview, song form"]
  Songs -->|"tap a row"| Card["Song card dialog"]
  Card -->|"Edit"| EditSong["Edit dialog<br/>shared song form"]
  Card -->|"Share link"| ShareD["Share dialog"]
  Card -->|"Add to playlist"| PlPicker["Playlist picker"]
  Card -->|"Download to server"| Fetch["Audio fetch<br/>progress ring on the row"]
  Songs -->|"filter chip"| Filter["Filter sheet"]
  AlbumList["Library: Albums"] -->|"Add album"| AddAlbum["Add album dialog"]
  AlbumList -->|"tap an album row"| AlbumCard["Album card dialog"]
  AlbumCard -->|"Edit"| EditAlbum["Edit album dialog"]
  AlbumCard -->|"Link a song"| LinkPop["Link a song popup"]
  Drafts["Library: Drafts"] -->|"Add to drafts"| Paste["Pasted lines and links<br/>become drafts"]
  Drafts -->|"Add to Library"| AddSong
  Genres["Genres map"] -->|"genre card, reference track"| AddSong
```

In the web, a tap on an album row opens the album card dialog. The Album page
(`#/library/albums/ID`) is reached by creating an album from a YouTube video
(section 4.3) or by its address; no list link points to it.

The Add dialog also accepts a YouTube playlist link (a list of videos to tick
and add) and a bare video id; an unsupported link shows its error under the
field. Add album is covered in section 4.3.

Sources: `web/js/library.js`, `add.js`, `add-preview.js`, `playlist-import.js`,
`song-card.js`, `edit-dialog.js`, `albums.js`, `drafts.js`, `genre-references.js`,
`lazy-ui.js`.

## 3. macOS app (ElectrophoneMac)

One window with a sidebar and a detail pane; the transport bar is pinned to the
bottom of the detail pane. It streams from the server and keeps no audio on the
Mac. The pages follow the web layout.

```mermaid
flowchart LR
  Window(["Window"]) --> Library
  Sidebar{{"Sidebar<br/>one row per page"}}
  Sidebar --> Library["Library"]
  Sidebar --> Playback["Playback"]
  Sidebar --> Playlists["Playlists<br/>placeholder, coming soon"]
  Sidebar --> Genres["Genres map"]
  Sidebar --> SongStats["Song stats"]
  Sidebar --> Theory["Music theory"]
  Sidebar --> Settings["Settings"]
  Sidebar -->|"account button at the bottom"| SignIn["Sign-in sheet"]
  Library -->|"Sign in, when signed out"| SignIn
  Settings -->|"Sign in or Sign in again"| SignIn
  Library -->|"Add Song menu item, or drop a link"| Form["Song form sheet<br/>Add from link, Edit, Delete"]
  Library -->|"click a song"| Card["Song card sheet"]
  Card -->|"Edit"| Form
  Library -->|"filter chip"| Filter["Filter sheet"]
  SongStats -->|"click a point"| Card
  Playback -->|"add by tag"| TagPick["Tag picker sheet"]
  Viz["Visualizer overlay<br/>Mirrored spectrum, Ring"] -.->|"V toggles, M cycles the mode"| Playback
```

Menu shortcuts: Library `Cmd-1`, Playback `Cmd-2`, Settings `Cmd-,`, Add Song in
the File menu, Show or Hide Visualizer `V`. Tools (Live BPM, metronome) and the
Albums mode are iPhone features and are not in the Mac app.

Sources: `ios/MacSources/MacNavigation.swift`, `MacRootView.swift`, `MacSidebar.swift`,
`MacCommands.swift`, `MacSongFormSheet.swift`, `MacSignInSheet.swift`, `MacVisualizer.swift`,
`Pages/*.swift`, [`../specs/macos-gui.md`](../specs/macos-gui.md).

## 4. Key flows

### 4.1 Sign-in and signed out

iPhone:

```mermaid
flowchart TD
  L1(["Launch"]) --> C1{"Session<br/>or legacy token?"}
  C1 -->|"no"| Local["Signed out:<br/>local library, plays offline"]
  Local -->|"Settings: Sign in with Apple or Google"| T1["ID token"]
  T1 --> V1{"Server accepts it?<br/>Apple is checked with GET /tags"}
  V1 -->|"401"| Fail1["Signed out again<br/>Sign in failed"]
  V1 -->|"403"| Deny["Signed in, red dot<br/>Not allowed on this server"]
  V1 -->|"ok"| Sync["Catalog sync"]
  C1 -->|"yes"| Sync
  Sync --> Full["Server catalog, Albums,<br/>Playlists, Listening"]
  Full -->|"Sign out"| Local
  Full -.->|"Apple token expired"| Exp["Settings: Expired, sign in again"]
```

Web:

```mermaid
flowchart TD
  W1(["Web load"]) --> R1["Restore the session"]
  R1 --> S1{"Signed in?"}
  S1 -->|"yes"| Lib["Library"]
  S1 -->|"no"| G1{"Public view on<br/>and guest allowed?"}
  G1 -->|"yes"| Guest["Read-only Library<br/>banner with a link to Settings"]
  G1 -->|"no"| Login["Login screen"]
  Login -->|"Google or Apple button"| Tok["ID token to the server"]
  Tok -->|"ok"| Lib
  Tok -->|"error"| Err["Error message under the buttons"]
  Guest -->|"sign in"| Tok
  Lib -->|"Settings, Sign out"| Login
```

Sources: `ios/Sources/AuthService.swift`, `ServerLink.swift`, `SettingsView.swift`,
`web/js/app.js`, `login.js`, `signin.js`, `guest.js`.

### 4.2 Add a song

On iOS the song can be downloaded to the phone. On the web it is saved to the
catalog and the audio can be fetched to the server afterwards ("Download to
server", or Auto-download in Settings); the web never stores audio in the
browser.

```mermaid
flowchart TD
  Start(["Plus button, Library"]) --> Who{"Signed in?"}
  Who -->|"no"| Anon["Anonymous sheet:<br/>paste a link"]
  Anon --> Job["Session, job on the server,<br/>poll, file with Range"]
  Job -->|"interrupted"| Keep["Job and partial file kept,<br/>resumes at launch or when the app is active"]
  Job -->|"ready"| Phone["Song on the phone"]
  Who -->|"yes"| Paste["Paste a link or video id,<br/>or Search YouTube by title"]
  Paste --> Fetch["Fetch"]
  Fetch -->|"already in library"| Known["Already in your library<br/>Fetch off, Play"]
  Fetch -->|"unsupported, private,<br/>not found, no network"| Err["Error under the field"]
  Fetch -->|"SoundCloud Go+ preview"| Prev["Preview only notice"]
  Fetch -->|"ok"| Form["Preview and shared form<br/>title, artist, remix, tags"]
  Form -->|"Add to library"| Cat["Saved to the catalog<br/>Not downloaded to this iPhone"]
  Form -->|"Add and download to iPhone,<br/>or Add to library with<br/>Download new songs automatically on"| Ingest["Row: Waiting, then Downloading"]
  Form -->|"save fails"| Err2["Message in the sheet,<br/>Add stays available"]
  Ingest --> Phone
```

```mermaid
flowchart TD
  WStart(["Add song, Library"]) --> WDlg["Add dialog:<br/>link, playlist link or video id"]
  WDlg --> WKind{"What was pasted?"}
  WKind -->|"already in library"| WKnown["Already in your library<br/>Show in library"]
  WKind -->|"mix or private playlist"| WMsg["Error message"]
  WKind -->|"YouTube playlist"| WImp["Tick videos, Add N songs<br/>one by one, counts toward the hourly limit"]
  WKind -->|"video or track link"| WPrev["Preview with progress steps"]
  WPrev -->|"error, Go+ preview only"| WErr["Message under the field"]
  WPrev -->|"ok"| WForm["Song form"]
  WForm -->|"Save to library"| WSaved["Saved to library, toast"]
  WForm -->|"check or save fails"| WErr2["Message in the dialog"]
  WSaved -.->|"Auto-download on"| WAudio["Audio fetch to the server"]
  WSaved -->|"later: Download to server"| WAudio
```

Sources: `ios/Sources/AddSheet.swift`, `AnonAddSheet.swift`, `AnonDownloader.swift`,
`ServerLink.swift`, `web/js/add.js`, `add-preview.js`, `playlist-import.js`,
`autodl.js`, [`journeys.md`](journeys.md).

### 4.3 Add an album

The Add album dialog (web, Library, Albums view) takes one address and routes
on its kind. Nothing is saved until Create.

```mermaid
flowchart TD
  AStart(["Add album, Albums view"]) --> AField["Address field"]
  AField --> AKind{"Address kind"}
  AKind -->|"playlist: mix or private"| AMsg["Error message"]
  AKind -->|"empty"| AEmpty["Paste a Discogs release,<br/>YouTube playlist or video address"]
  AKind -->|"YouTube playlist"| APl["Reading the playlist"]
  APl --> APlT["Track table, Create album<br/>and download N tracks"]
  APlT -->|"create"| APlDone["Dialog closes, toast,<br/>downloads start in the Albums view"]
  AKind -->|"YouTube video"| AVid["Video flow, see below"]
  AKind -->|"Discogs release or other"| ADisc["Release preview, genres,<br/>optional RYM link, tracks"]
  ADisc -->|"Create"| ADone["Dialog closes, toast Added"]
  ADisc -->|"409 already exists"| AExists["This album already exists<br/>with a link to open it"]
  AField -->|"lookup fails"| AErr["Error text under the field"]
```

From a YouTube video: preview, edit the track list, create, split progress,
album page.

```mermaid
flowchart TD
  V0(["Video address"]) --> V1["Reading the video"]
  V1 -->|"400, 404, 413, 429, 502"| VErr["Error text, back to the field"]
  V1 --> V2{"Track list found<br/>in chapters or description?"}
  V2 -->|"no, or 422"| VPaste["Paste page:<br/>No track list was found"]
  VPaste -->|"Read the track list"| VRead["Parse the pasted text"]
  VRead -->|"no tracks"| VBad["No tracks found in this text"]
  VBad --> VPaste
  VRead -->|"ok"| VTable
  V2 -->|"yes"| VTable["Track table<br/>start times, titles, ticks, Use existing"]
  VTable -->|"Paste a track list with lengths"| VLen["Use this list,<br/>Replace my edits, Scale to video length"]
  VLen --> VTable
  VTable -->|"Paste a track list instead"| VPaste
  VTable -->|"Create album"| VCreate{"Server accepts?"}
  VCreate -->|"409, 422, 429, 413,<br/>library or storage full"| VCErr["Message in the dialog,<br/>table stays editable"]
  VCreate -->|"ok, job id"| VProg["Creating the album:<br/>Waiting, Downloading the video audio,<br/>Cutting N of M tracks"]
  VProg -->|"done"| VDone["Toast, dialog closes"]
  VDone -.-> VPage["Album page<br/>#/library/albums/ID"]
  VProg -->|"job error"| VJob["Message with Try again<br/>and Open the album"]
  VProg -->|"4 polls fail"| VLost["Lost contact with the server<br/>Try again, Open the album"]
  VJob -->|"Try again"| VCreate
  VLost -->|"Try again"| VProg
```

Sources: `web/js/albums.js` (`openAddAlbum`), `album-video.js`, `album-video-model.js`,
`album-video-progress.js`, `album-tracklist-panel.js`, `album-youtube-flow.js`,
`album-draft-view.js`.

## 5. States

### 5.1 A song's audio

What the iPhone Library row shows. "Server" is the audio file on Electrophone's
server; "phone" is `Documents/audio/<id>.m4a`. The phone state is never stored
as a flag: it is whether the file exists.

```mermaid
stateDiagram-v2
    [*] --> NoAudio: saved in the catalog from a link
    [*] --> OnServer: the server already holds the audio
    NoAudio: None, row says No audio yet
    OnServer: Server, row says Download
    Waiting: Waiting, the server queue is busy
    Downloading: Downloading, server fetch then copy
    OnPhone: Phone, plays offline
    Failed: Failed, toast and the row is back to its old state
    Offline: Server but unreachable, row says Offline
    NoAudio --> Waiting: Get audio
    NoAudio --> Downloading: Get audio, server starts at once
    Waiting --> Downloading: server starts the fetch
    OnServer --> Downloading: Download, Download all, album plan, Add and download
    Downloading --> OnPhone: file copied to Documents/audio
    Downloading --> Failed: server error, 8 lost polls, copy fails, mobile data off
    Waiting --> Failed: server error
    Failed --> Downloading: tap Download again
    OnServer --> Offline: no network or server down
    Offline --> OnServer: Retry or pull to refresh succeeds
    OnPhone --> OnServer: Remove from iPhone
    OnPhone --> [*]: Delete from library
    OnServer --> [*]: Delete from library
    NoAudio --> [*]: Delete from library
```

Notes read from the code:

- Downloading spans two stages: 0 to 80 percent is the server fetching the
  source (`GET /songs/{id}/audio`, then status polls), 80 to 100 percent is the
  copy to the phone (`GET /files/{id}` in a background session, so it continues
  while the app is suspended and finishes after a relaunch).
- A song that is on the phone but gone from the server's catalog stays as
  local-only: it plays, but cannot be downloaded again and has no Remove from
  iPhone.
- The web has three of these states in the Library row: no audio (a Download to
  server button), fetching (progress ring), and audio on the server (queue
  button). Its Download in the song card saves a file to the browser's download
  folder; that is not a state.
- Anonymous adds (signed out) go straight from a link to Phone and never pass
  through the server library.

Sources: `ios/Sources/LibrarySongRow.swift`, `ServerLink.swift`, `BackgroundDownloader.swift`,
`AnonDownloader.swift`, `AudioFiles.swift`, `web/js/library-rows.js`, `row-actions.js`,
`autodl.js`, [`../specs/ios.md`](../specs/ios.md) (IOS-035, IOS-106, IOS-107),
[`../specs/library.md`](../specs/library.md) (LIB-111, LIB-180).

### 5.2 Offline behaviour (iPhone)

Offline playback never depends on sign-in or on the server.

```mermaid
stateDiagram-v2
    [*] --> SignedOut: no sign-in
    [*] --> Online: signed in and the server answers
    SignedOut: Signed out, local library only
    Online: Online, catalog synced
    Unreachable: Server unreachable, offline
    SignedOut --> Online: Sign in
    Online --> SignedOut: Sign out
    Online --> Unreachable: network error on a request
    Unreachable --> Online: Retry, pull to refresh, app becomes active, connection returns
    note right of Unreachable : Banner Offline. Your downloaded songs still play. Server-only rows say Offline. Downloads, Add and Edit wait.
    note right of SignedOut : No server calls except the anonymous add. Playback unaffected.
```

What keeps working with no connection, and what waits:

| Works offline | Waits for the server |
| --- | --- |
| Playing any downloaded song, lock-screen controls, queue, shuffle, repeat, resume after relaunch | Download, Get audio, Download album, Download missing songs |
| Library list, search, filters, sort and Song Details from the cached catalog (`library.json`, with `phone-index.json` as the offline index) | Adding or editing a song, playlists and albums (last answer is cached per account) |
| Finished plays are queued on disk (`plays/queue.json`) | Uploading plays: sent when a play ends, on pause, when the app is active, on sign-in and when connectivity returns |
| Interrupted anonymous downloads keep job and partial file | Continuing them: at launch, when active, and when the Add sheet opens, until the job expires |

The macOS app has no offline mode: it streams and stores no audio.

Sources: `ios/Sources/LibraryView.swift` (`offlineBanner`), `ServerLink.swift` (`reachable`,
`record`), `LibraryIndex.swift`, `PlaybackPersistence.swift`, `PlayQueue.swift`,
`BackgroundDownloader.swift`, `AnonDownloader.swift`,
[`../specs/ios.md`](../specs/ios.md) (IOS-016c, IOS-040, IOS-090, IOS-104, IOS-107).

## Not covered

- Settings contents (cards and fields), the Statistics and Genres map internals,
  Music theory, About, Features, and the standalone Studio site
  (studio.electrophone.cc).
- The visualizer and share-link screens beyond their entry points.
- Per-field validation, empty and loading states, toasts, and accessibility
  paths; error branches are shown only for the Add and Add album flows.
- The API and server job lifecycles (see [`../specs/api.md`](../specs/api.md)).
- The web "search YouTube by title" path in the Add dialog: the code supports a
  text query, but no screen passes one today.
- The hidden route `#/genres-classic` beyond its mention in section 2.1.
- Anything not yet in code: iOS Drafts and Artists modes, Mac Playlists.
- Whether any flow works on a real device: the diagrams show what the code
  does, not what has been run. See [`../specs/ios.md`](../specs/ios.md) for the
  status of each requirement.
