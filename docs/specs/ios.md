# iOS app

Code: `ios/Sources/` (SwiftUI, iOS 17, iPhone only). Same API as the web UI;
screen flow matches it (ADR-0007). Status values reflect code read on
2026-10-12; "implemented" means built into the app, not yet proven on a
device unless a line says so.

## Shell and navigation

- IOS-001 MUST: the app has four tabs, Library, Add, Playback, Settings, matching web `#/library`, `#/add`, `#/playback`, `#/settings`; Playback shows the queue length as a badge. Status: implemented
- IOS-002 MUST: a mini-player bar sits above the tab bar on the other tabs and opens the Playback tab on tap. Status: implemented
- IOS-003 MUST: the app runs on iPhone only, portrait only. Status: implemented

## Settings and auth

- IOS-010 MUST: Settings holds the server URL (default `https://play.isayenko.net`) and the API token, with a Paste button and a Test connection button that authenticates against `GET /tags`. Status: implemented
- IOS-011 MUST: the API token is kept in the Keychain and never appears in a stored URL or in the library file. Status: implemented
- IOS-012 MUST: Settings offers Sign in with Apple and Sign in with Google (owner only, ADR-0006); the ID token goes as `Authorization: Bearer`, the Google refresh token is kept in the Keychain and refreshes silently. Status: implemented (not yet tested live on a device)
- IOS-013 MUST: an expired Apple token cannot refresh silently; Settings shows "Expired, sign in again" and the API token is the fallback. Status: implemented
- IOS-014 MUST: signing in is never required to play downloaded songs. Status: implemented
- IOS-015 MUST: client IDs come from the git-ignored `ios/Config/Secrets.xcconfig`; none is in the repo. Status: implemented

## Add

- IOS-020 MUST: Add pastes a YouTube link, cleans it to the canonical form, and calls `POST /preview`. Status: implemented
- IOS-021 MUST: the preview is editable (title, artist, album, year, BPM, Wikipedia links) with the tag editor and suggested tags, including `decade:` tags (ADD, TAG specs); "Fill from Wikipedia links" calls `POST /lookup/wikipedia`. Status: implemented
- IOS-022 MUST: Save and download calls `POST /songs`, polls `GET /songs/{id}/status` about once a second, then fetches `GET /files/{id}` to the phone ("Download to phone" is also offered before saving). Status: implemented (not yet tested live on a device)
- IOS-023 SHOULD: text search (`GET /search`) stays as a secondary screen under Add; tapping a result opens the same preview, and the row's download button uses the legacy `POST /download` (file only, no library record, no tags). Status: implemented

## Library

- IOS-030 MUST: Library has a Phone / Server switch. Phone lists downloaded songs; Server lists `GET /library`, cached for offline viewing, with a reachability line. Status: implemented
- IOS-031 MUST: on the Server list a song can be downloaded per song (swipe) or all missing ones with "Download all N" (progress shown). Status: implemented
- IOS-032 MUST: tag chips filter, search and sort as in LIB specs; with a filter or search active "Add all N" appends the listed songs to the queue. Status: implemented
- IOS-033 MUST: swipe offers Play next, Queue, Edit and, for a downloaded song, Delete (removes the phone copy only). Status: implemented
- IOS-034 MUST: the song edit screen saves with `PATCH /songs/{id}`, re-detects BPM, fills from Wikipedia links and deletes the song from the server (`DELETE`); a phone copy stays. Status: implemented (not yet tested live on a device)

## Playback and offline

- IOS-040 MUST: playback uses local files only, with `AVPlayer`, background audio and lock-screen controls (`MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`). Status: implemented
- IOS-041 MUST: Playback shows a rotating platter and a tonearm that follows progress, shuffle, repeat off/all/one, and the queue with tag chips (add by tag, remove by tag, Clean), as in PLY specs. Status: implemented
- IOS-042 MUST: downloaded songs live in `Documents/audio/` and `Documents/library.json`; cover tokens are never persisted, the auth header is added at request time and stored values are scrubbed on load. Status: implemented
- IOS-043 SHOULD: server covers show offline. Status: planned (covers are fetched on demand and held only in a memory cache, so they are blank offline after a relaunch)

## Look

- IOS-050 MUST: the UI follows the Vega 108 look in [`../ui-ux/style-guide.md`](../ui-ux/style-guide.md) (ADR-0007); tokens in `Theme.swift`, components in `Components.swift`. Status: implemented
- IOS-051 MUST: the app icon is the whole turntable seen from above. Status: implemented

## Distribution

- IOS-060 MUST: the build number (`CURRENT_PROJECT_VERSION` in `ios/project.yml`) is date-based and strictly higher than any build already uploaded to App Store Connect (ADR-0008). Status: implemented
