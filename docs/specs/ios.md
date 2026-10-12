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

- IOS-010 MUST: Settings holds the server URL (default `https://play.isayenko.net`) and the API token, with a Paste button and a Test connection button that authenticates against `GET /tags` and shows "Connected · N ms, token accepted" with the server status LED. Status: implemented (not verified on a device)
- IOS-011 MUST: the API token is kept in the Keychain and never appears in a stored URL or in the library file. Status: implemented
- IOS-012 MUST: Settings offers Sign in with Apple and Sign in with Google (owner only, ADR-0006); the ID token goes as `Authorization: Bearer`, the Google refresh token is kept in the Keychain and refreshes silently. Status: implemented (not yet tested live on a device)
- IOS-013 MUST: an expired Apple token cannot refresh silently; Settings shows "Expired, sign in again" and the API token is the fallback. Status: implemented
- IOS-016 MUST: the app's Google client id is a separate OAuth client from the web one; the server accepts both (API-007). Status: implemented
- IOS-014 MUST: signing in is never required to play downloaded songs. Status: implemented
- IOS-015 MUST: client IDs come from the git-ignored `ios/Config/Secrets.xcconfig`; none is in the repo. Status: implemented

## Add

- IOS-020 MUST: Add is a sheet (AddSheet) over Library, opened from the + in the Library header. It pastes a YouTube link, cleans it to the canonical form, and calls `POST /preview`. Status: implemented
- IOS-021 MUST: the preview is editable (title, artist, album, year, BPM, Wikipedia links) with the tag editor and suggested tags, including `decade:` tags (ADD, TAG specs); "Fill from Wikipedia links" calls `POST /lookup/wikipedia`. Status: implemented
- IOS-022 MUST: "Save to iPhone" calls `POST /songs`, then hands the download to `ServerLink` (polls `GET /songs/{id}/status`, then fetches `GET /files/{id}`) so it outlives the sheet; the sheet closes and the song's Library row shows "Downloading NN%". "Save and play when ready" does the same and starts playback when the file arrives; "Download to iPhone" and "Play now" are offered for a song already saved. Status: implemented (not yet tested live on a device)
- IOS-023 SHOULD: text search (`GET /search`) stays secondary: the link "Search YouTube by title" in the AddSheet pushes the search screen; tapping a result opens the same preview, and the row's download button uses the legacy `POST /download` (file only, no library record, no tags). Status: implemented

## Library

- IOS-030 MUST: Library is the phone only: it lists the downloaded songs, with no Phone / Server switch and no server list; the phone never browses `GET /library` (that stays for the web UI). A row shows the duration, or "Downloading NN%" while its file arrives from the server. The server status LED lives in the AddSheet header and Settings, not on Library. Status: implemented
- IOS-031 MUST: the server is only the download pipe behind Add (save, then copy to the phone with progress). There is no "Download all", no per-row On iPhone / Download state. Status: implemented
- IOS-032 MUST: Library filters with four category chips in one row (Tags, Genres, Years, Countries; plain, `genre:`, `decade:`, `country:`; `lang:` and other keys fold into Tags). A chip opens a bottom filter sheet with that category's values and counts, multi-select (any of within a category, all across categories), Clear, and a button "Show N songs"; a chip with a selection shows the selected count. Search and sort (recently added, title, artist, year) as in LIB specs. Status: implemented
- IOS-033 MUST: a row's ⋯ menu offers Edit, Play next, Add to queue and Delete from library (removes the phone copy only, after a confirmation). Status: implemented
- IOS-034 MUST: the song edit screen saves with `PATCH /songs/{id}`, re-detects BPM, fills from Wikipedia links and deletes the song (`DELETE` on the server, then the phone copy). Status: implemented (not yet tested live on a device)

## Playback and offline

- IOS-040 MUST: playback uses local files only, with `AVPlayer`, background audio and lock-screen controls (`MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`). Status: implemented
- IOS-041 MUST: Playback leads with the cover (title and artist on it; no deck, platter, tonearm or LED), a seek bar, a transport tray (shuffle, previous, play/pause, next, repeat off/all/one), position, volume and an Up next card; the full queue (jump, remove, clear) and add-by-tag open from the Queue link and the ⋯ menu, which also holds Edit song (opens the song edit screen), back and forward 5 seconds, and Clear queue. Status: implemented (not verified on a device)
- IOS-042 MUST: downloaded songs live in `Documents/audio/` and `Documents/library.json`; cover tokens are never persisted, the auth header is added at request time and stored values are scrubbed on load. Status: implemented
- IOS-043 SHOULD: server covers show offline. Status: planned (covers are fetched on demand and held only in a memory cache, so they are blank offline after a relaunch)

## Look

- IOS-050 MUST: the UI follows the Electrophone design system (ADR-0009, [`../ui-ux/style-guide.md`](../ui-ux/style-guide.md)); all colours, sizes and radii come from `DS.*` in the generated `DesignTokens.swift`, components are in `Components.swift`, no hex or literal colour in other files; day and night follow the system appearance. Status: implemented
- IOS-051 MUST: the app icon is the record on the platter from the design system (cyan label with teal stripes on a vinyl disc, paper frame, copper rim), 1024 x 1024 without alpha. Status: implemented

## Distribution

- IOS-060 MUST: the build number (`CURRENT_PROJECT_VERSION` in `ios/project.yml`) is date-based and strictly higher than any build already uploaded to App Store Connect (ADR-0008). Status: implemented
