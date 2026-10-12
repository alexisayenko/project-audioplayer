# iOS app

Code: `ios/Sources/` (SwiftUI, iOS 17, iPhone only). Same API as the web UI;
screen flow matches it (ADR-0007). Status values reflect code read on
2026-10-12; "implemented" means built into the app, not yet proven on a
device unless a line says so.

## Shell and navigation

- IOS-001 MUST: the app has three tabs, Library, Playback, Settings (web `#/library`, `#/playback`, `#/settings`); Add is not a tab: a + button in the Library header opens the AddSheet (ADR-0009). The queue length is shown on Playback ("Queue (N)"), not as a tab badge. Status: implemented
- IOS-002 MUST: a mini-player bar sits above the tab bar on the other tabs and opens the Playback tab on tap; it is hidden on Playback. Status: implemented
- IOS-003 MUST: the app runs on iPhone only, portrait only. Status: implemented

## Settings and auth

- IOS-010 MUST: Settings has the artboard's cards in order, Account (Sign in with Apple and Google; signed in: the email, the provider and Sign out), Downloads (Audio quality as a read-only "High · 192 kbps", the server's fixed bitrate, with no chevron until a real choice exists; "Download new songs automatically" switch, default on; "Use mobile data" switch, default off), Storage (size of `Documents/audio`, song count, a bar against the phone's capacity, "Remove all downloads" after a confirmation, phone copies only), then a "Private server" disclosure row (collapsed; URL, API token with a Paste row, Test connection against `GET /tags` showing "Connected · N ms, token accepted" and the server status LED), then the version line from the bundle ("· TestFlight" on TestFlight builds, "· Debug" in debug builds). The design has no server card; the disclosure is the one addition. Status: implemented (not verified on a device)
- IOS-017 MUST: "Use mobile data" (UserDefaults `useMobileData`) governs file downloads only: with it off, `GET /files/{id}` uses a session with cellular, expensive and constrained access disabled and the Library toast says "Mobile data is off for downloads. Turn on Use mobile data in Settings." API calls are never blocked. "Download new songs automatically" (`downloadNewAutomatically`) decides whether "Add to library" also copies the song to the phone; off saves it on the server only, with the toast "Saved. Not downloaded to this iPhone" (the Library stays phone-only until the catalog tasks land, so that song is not listed yet). Status: implemented
- IOS-011 MUST: the API token is kept in the Keychain and never appears in a stored URL or in the library file. Status: implemented
- IOS-012 MUST: Settings offers Sign in with Apple and Sign in with Google (owner only, ADR-0006); the ID token goes as `Authorization: Bearer`, the Google refresh token is kept in the Keychain and refreshes silently. Status: implemented (not yet tested live on a device)
- IOS-013 MUST: an expired Apple token cannot refresh silently; Settings shows "Expired, sign in again" and the API token is the fallback. Status: implemented
- IOS-016 MUST: the app's Google client id is a separate OAuth client from the web one; the server accepts both (API-007). Status: implemented
- IOS-014 MUST: signing in is never required to play downloaded songs. Status: implemented
- IOS-015 MUST: client IDs come from the git-ignored `ios/Config/Secrets.xcconfig`; none is in the repo. Status: implemented

## Add

- IOS-020 MUST: Add is a sheet (AddSheet) over Library, opened from the + in the Library header. It pastes a YouTube or SoundCloud link, cleans it to the canonical form, and calls `POST /preview`. Status: implemented
- IOS-061 MUST: Add accepts SoundCloud track links (ADD-060..066): the URL port in `TagLogic.swift` (`classifySoundcloud`, `cleanUrl`, `cleanPasted`) matches `urlclean.py`, `Preview.source` and `Track.source` (derived from the id) feed a source label in the preview line; server errors (`unsupported`, `preview_only`, `not_found`, `private`) arrive as `detail` text and are shown in the sheet unchanged, including "Preview only — SoundCloud Go+ track, can't be downloaded in full.". A source tag in Library rows and Playback is left to the design system. Status: implemented (URL port checked with a swiftc script; live SoundCloud add not tested on a device)
- IOS-021 MUST: the preview is editable (title, artist, album, year, BPM, Wikipedia links) with the tag editor and suggested tags, including `decade:` tags (ADD, TAG specs); "Fill from Wikipedia links" calls `POST /lookup/wikipedia`. Status: implemented
- IOS-022 MUST: "Add to library" (primary, + glyph) calls `POST /songs`; with "Download new songs automatically" on it also hands the download to `ServerLink` (polls `GET /songs/{id}/status`, then fetches `GET /files/{id}`) so it outlives the sheet, and the song's Library row shows "Downloading NN%". "Add and download to iPhone" (text button under it) always downloads. "Download to iPhone" and "Play now" are offered for a song already saved. The old "Save and play when ready" is gone with the new artboard. Link errors show a one-line message with a red circle icon under a red-ringed field and a disabled "Add to library": Unsupported link / Private track / Track not found; "preview_only" shows the Preview only notice (the server sends no metadata with it, so the artboard's preview card is not shown). Return dismisses the keyboard on Fetch. Status: implemented (not yet tested live on a device)
- IOS-023 SHOULD: text search (`GET /search`) stays secondary: the link "Search YouTube by title" in the AddSheet pushes the search screen; tapping a result opens the same preview, and the row's download button uses the legacy `POST /download` (file only, no library record, no tags). Status: implemented

## Library

- IOS-030 MUST (superseded when ADR-0010 is accepted, see CAT-030..033): Library is the phone only: it lists the downloaded songs, with no Phone / Server switch and no server list; the phone never browses `GET /library` (that stays for the web UI). A row shows the duration, or "Downloading NN%" while its file arrives from the server. The server status LED lives in the AddSheet header and Settings, not on Library. Status: implemented
- IOS-031 MUST (superseded when ADR-0010 is accepted, see CAT-020, CAT-030): the server is only the download pipe behind Add (save, then copy to the phone with progress). There is no "Download all", no per-row On iPhone / Download state. Status: implemented
- IOS-032 MUST (list scope changes with ADR-0010, filters stay; see CAT-031): Library filters with four category chips in one row (Tags, Genres, Years, Countries; plain, `genre:`, `decade:`, `country:`; `lang:` and other keys fold into Tags). A chip opens a bottom filter sheet with that category's values and counts, multi-select (any of within a category, all across categories), Clear, and a button "Show N songs"; a chip with a selection shows the selected count. Search and sort (recently added, title, artist, year) as in LIB specs. Status: implemented
- IOS-033 MUST: a row's ⋯ menu offers Edit (opens the song sheet), Play next, Add to queue and Delete from library (removes the phone copy only, after a confirmation). Status: implemented
- IOS-034 MUST: the song sheet (a content-height bottom sheet: Cancel, "Song", Save) shows the cover, duration · BPM · size · format and the added date, edits title, artist, album, year and BPM, tags (removable pills and a + that opens the tag editor) and links (Wikipedia and YouTube pills; "Edit links" reveals the Wikipedia fields, "Fill from Wikipedia" and "Detect BPM"). Save calls `PATCH /songs/{id}`. "Remove from iPhone" deletes the phone copy only, after a confirmation; the song stays on the server. "Change cover" from the design is not built (the server has no cover upload). Status: implemented (not yet tested live on a device)

## Playback and offline

- IOS-040 MUST: playback uses local files only, with `AVPlayer`, background audio and lock-screen controls (`MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`). Status: implemented
- IOS-041 MUST: Playback leads with the cover (title and artist on it; no deck, platter, tonearm or LED), a seek bar, a transport tray (shuffle, previous, play/pause, next, repeat off/all/one), position and an Up next card (no volume row: the device buttons set the volume; no status line); the full queue (jump, remove, clear) and add-by-tag open from the Queue link and the ⋯ menu, which also holds Song details (opens the song sheet), back and forward 5 seconds, and Clear queue. Status: implemented (not verified on a device)
- IOS-042 MUST: downloaded songs live in `Documents/audio/` and `Documents/library.json`; cover tokens are never persisted, the auth header is added at request time and stored values are scrubbed on load. Status: implemented
- IOS-043 SHOULD: server covers show offline. Status: planned (covers are fetched on demand and held only in a memory cache, so they are blank offline after a relaunch)

## Look

- IOS-050 MUST: the UI follows the Electrophone design system (ADR-0009, [`../ui-ux/style-guide.md`](../ui-ux/style-guide.md)); all colours, sizes and radii come from `DS.*` in the generated `DesignTokens.swift`, components are in `Components.swift`, no hex or literal colour in other files; day and night follow the system appearance. Status: implemented
- IOS-051 MUST: the app icon is the record on the platter from the design system (cyan label with teal stripes on a vinyl disc, paper frame, copper rim), 1024 x 1024 without alpha. Status: implemented

## Distribution

- IOS-060 MUST: the build number (`CURRENT_PROJECT_VERSION` in `ios/project.yml`) is date-based and strictly higher than any build already uploaded to App Store Connect (ADR-0008). Status: implemented
