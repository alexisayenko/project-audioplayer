# Android app

Build spec for a native Kotlin Android app that does the iOS app's job on an Android phone: songs picked on the server reach the phone and play offline with the screen locked. Status: accepted and built in source (ADR-0051, [task-0127](../tasks/task-0127.md); owner 2026-11-11: "accept everything"). The app in `android/` builds (debug and an unsigned release), its unit tests pass and its screens are checked from JVM screenshots; it has never run on a phone or an emulator, so every line below is "built, not run on a device" unless it says otherwise. Section 11 lists where the build differs from this plan. It describes how the iOS flows (read from `ios/Sources/` and the specs it links, 2026-11-09) map to Android. It does not restate the iOS requirements: the linked specs ([ios](ios.md), [library](library.md), [playback](playback.md), [add-song](add-song.md), [catalog](catalog.md), [api](api.md), [storage-and-sync](storage-and-sync.md)) stay the source for detail; where this file and an accepted spec disagree, the accepted spec wins until ADR-0051 is accepted.

Requirement IDs in this file use the area `AND` and the format of the [specs README](README.md); they are assigned only to the Android-specific decisions. Statuses: "built, not run on a device" means the code exists and is unit-tested or screenshot-checked, nothing more. Screens are described as "iOS reference" (what to copy, by link) and "Android" (what changes).

## 0. Concept

- What it is: the iOS app for an Android phone. The same server (`https://electrophone.cc`), the same account, the same catalog and audio files, the same Library, Playback, Add/Edit and Settings, built natively in Kotlin with Jetpack Compose, Media3 and WorkManager, with the Electrophone look from the shared design tokens.
- What it is not: not a web wrapper, not a cross-platform rewrite, not a streaming client like the Mac app (ADR-0029), not a Play Store product. No social or discovery features. The later screens (Playlists, Albums, Statistics, Tools, Drafts, visualizer, Genres map, share links, anonymous add) come only after the core job is verified on a device.
- Who it is for: the owner and the people with an Android phone who sign in with Google (open signup within quotas, ADR-0012); Apple sign-in on Android is a later phase. Question NA in [task-0127](../tasks/task-0127.md) names the first user and the Android version.
- How it relates to the others: the server does not change for v1 (one new Android OAuth client in Google Cloud, no new endpoint); the data shapes are the iOS ones (`library.json`, `phone-index.json`, song state `onServer` plus local file); the look comes from the same `tokens.json` through the same script (ADR-0009); the web stays catalog-only; the Mac stays streaming-only.
- Key principle (CLAUDE.md): playback and offline reliability beat features. A screen earns a place in v1 only if it helps download, store or play songs. Offline playback never depends on sign-in (IOS-014 applies unchanged).

- AND-001 MUST: the Android app downloads audio to the phone and plays it from the phone's own files; it never streams a song from the server (as iOS, IOS-016c), unlike the Mac (ADR-0029). Status: built, not run on a device
- AND-002 MUST: signed out, the app lists and plays the songs already on the phone and reads nothing from the server (IOS-014, IOS-016a, IOS-016b apply). Status: built, not run on a device
- AND-003 MUST: the server API, the data files and the design tokens are shared with iOS as they are; a change the Android app needs is made in the shared place (server, `tokens.json`, the sync script), never as an Android-only fork. Status: built, not run on a device

## 1. Scope and priority

Key principle check: P0 to P2 is v1; P3 and later wait for a device-verified v1.

| Screen / feature | v1 | Priority | Why |
| --- | --- | --- | --- |
| Sign in with Google, signed-out local library | yes | P0 | the server flows need an account; offline playback does not |
| Library (list, search, filter chips, sort, song details, row download state) | yes | P1 | the catalog and the way to start playing |
| Catalog sync (`GET /catalog`, ETag) | yes | P1 | part of Library |
| Per-song download: progress, retry, hourly-limit pause, background | yes | P1 | the key principle: songs on the phone |
| Playback (Now playing, queue, notification and lock screen, headset, resume, shuffle, repeat, play log) | yes | P1 | the core job |
| Add song and Edit song (one shared form: paste or share a link, Fetch, preview, pills) | yes | P2 | how songs get in and stay correct |
| Settings (account, storage, auto-download, mobile data) | yes | P2 | account and download behaviour |
| YouTube text search in Add | question NE | P3 | iOS keeps it secondary (IOS-023) |
| Playlists | later | P3 | lists, not reliability; iOS has them (task-0058) |
| Albums and Download album | later | P3 | bulk download, after per-song download is proven (task-0120) |
| Apple sign-in on Android | later | P3 | needs a server redirect endpoint (question NC) |
| Statistics, Tools (Live BPM, metronome) | later | P4 | analysis and utilities |
| Drafts | later | P4 | catalog entry, no playback gain |
| Visualizer, Genres map, Music theory | later | P4 | listening pleasure and reference, no reliability gain |
| Share links, anonymous add (`/anon/*`) | out of v1 | P4 | web-side features; guests are out |

## 2. Shared foundations

### 2.1 Look (design tokens)

iOS reference: ADR-0009, [brand README](../brand/README.md), `docs/brand/tokens.json` (groups meta, color with themes and tokens, type, spacing, radius, shadow, stroke, state, motion, elevation, overlay, icon, control, component, opacity), `scripts/sync-design-system.py` (generates `ios/Sources/DesignTokens.swift` and `web/tokens.css`, has `--check`; a token may carry `platform: ios | web`; `on_ios` skips web tokens and `on_web` skips iOS tokens; shadow tokens reach iOS only when marked `platform: ios`).

Android:

- AND-010 MUST: `scripts/sync-design-system.py` gets a third output, `android/app/src/main/kotlin/com/alexisayenko/audioplayer/android/ui/DesignTokens.kt`: an `object DS` with `Color` values per theme (light and dark, chosen with `isSystemInDarkTheme()` through one `LocalDS` composition local), `Dp` for spacing, radius, stroke, control and component sizes, `TextStyle` (sp sizes, weights, line heights, letter spacing) for the type scale, `Float` for opacity and motion durations in milliseconds. The file carries the generated-file header and is never hand-edited; `--check` compares it like the other two. Status: built, not run on a device
- AND-011 MUST: the platform rule extends to `android`: a token with `platform: android` reaches only the Kotlin file; `platform: ios` and `platform: web` tokens are skipped on Android; a token without `platform` reaches all three. `on_ios` and `on_web` are updated to skip `android` tokens. Shadow tokens are skipped on Android unless marked `platform: android`; cards use the `elevation` group through Compose `shadow(elevation)` instead. Status: built, not run on a device
- AND-012 MUST: the UI is Compose foundation plus the shared `DS` tokens; `MaterialTheme` defaults (colour scheme, shapes, type) are never read. Material 3 components are used only where their look is fully overridable (drawer sheet, bottom sheet, snackbar host, pull to refresh) and get `DS` values; the rest (keys, pills, chips, rows, cards, the seek bar) are drawn from foundation to match the iOS controls. Status: built, not run on a device
- AND-013 MUST: type uses the system default sans (Roboto or the OEM font) at the token sizes; no SF Pro and no bundled font in v1, unless the design system names one. The system font scale is honoured without a cap, like iOS Dynamic Type (IOS-122). Status: built, not run on a device
- AND-014 MUST: icons are the web set `web/js/icons.js` (68 names, 24 grid, stroke 1.8, some filled) as Compose `ImageVector`s or VectorDrawables with the same names; the pipeline (a generator script or a hand port) is question ND. Never Material icons. Status: built, not run on a device
- AND-015 SHOULD: the app honours "Remove animations" (animator duration scale 0) and the high-contrast text setting as far as Android exposes them, mirroring IOS-123 and IOS-127. Status: not built (animations ignore the system setting)

### 2.2 Navigation shell

iOS reference: IOS-001 (a left drawer with Library, Now playing, Playlists, Statistics, Tools, Settings; Library lands first; no bottom tab bar; Add is a + in the Library header), IOS-002 (the collapsed mini-player bar on every destination except Playback, expandable to the Now Playing sheet), IOS-120 (system back on every pushed screen), IOS-003 (portrait only).

Android:

- AND-016 MUST: the shell copies the iOS drawer: a `ModalNavigationDrawer` opened by the menu button at the leading edge of each root screen or an edge swipe, items Library, Now playing, Settings in v1 (Playlists, Statistics, Tools appear when built), the account row at the bottom opens Settings; Library is the landing destination. No bottom navigation bar. Status: built, not run on a device
- AND-017 MUST: the mini-player bar shows on every destination except Playback while a song is loaded; a tap opens Playback; it hides while the soft keyboard is up. Status: built, not run on a device
- AND-018 MUST: system back (gesture and button, predictive back enabled) closes the drawer or an open sheet first, then pops the screen, then leaves the app; it never exits from a nested screen in one step. Edge-to-edge drawing with the system bar insets applied through `WindowInsets`. Status: built, not run on a device
- AND-019 MUST: the layout is portrait, locked in the manifest like iOS (IOS-003); because Android 16 and later ignore orientation locks on large screens, every screen is a single column that stretches without breaking; no tablet layout in v1. Status: built, not run on a device

### 2.3 Names, years and the shared-logic ports

iOS reference: IOS-108 (the Swift ports are checked against the shared case files in `server/tests/fixtures`: `token_cases.json`, `title_clean_cases.json`, `credit_title_cases.json`, `credits_split_cases.json`, `tag_cases.json`, `play_recorder_cases.json`, `ios_contract.json`).

Android:

- AND-020 MUST: the Kotlin ports of the shared logic (the one display-line formatter for names and years, title cleaning, token splitting, URL cleaning and the offline library match, tag normalisation, the play recorder, the shuffle ranker, the resume rule) are JVM unit tests fed by the same fixture files, read from `server/tests/fixtures` at test time (a Gradle test resource directory pointing at the repo path), never copied (question NG). Status: built, not run on a device

### 2.4 Networking and sign-in model

iOS reference: API-007 (Bearer ID token on every authenticated route including `GET /files/{id}` and `GET /covers/{id}`), IOS-012, IOS-016 (the app has its own Google client; the server accepts the comma lists `GOOGLE_CLIENT_ID` plus `GOOGLE_WEB_CLIENT_ID`), `ios/Sources/Endpoints.swift` (`/catalog`, `/songs`, `/songs/{id}`, `/songs/{id}/status`, `/songs/{id}/audio`, `/songs/{id}/cover`, `/files/{id}`, `/covers/{id}`, `/preview`, `/metadata`, `/search`, `/tags`, `/genres`, `/plays`, `/me/usage`, `/stats/listening`, `/playlists`, `/albums`, `/anon/*`).

Android:

- AND-021 MUST: one `ApiClient` (OkHttp, kotlinx.serialization) with the same endpoint table as `Endpoints.swift`, the same `Authorization: Bearer <id token>` header on every authenticated call, no session cookie, no `X-Anon-Token` in v1, the same error mapping (401 `bad token`, 429 `hourly_limit` with `retry_after_minutes`, 403 `library_full_*`, 503 `server_full`, 422 bodies). Reachability is reported by every call, never probed separately (IOS-119). Status: built, not run on a device
- AND-022 MUST: covers load through Coil with the Bearer header and are cached on disk for downloaded songs so they show offline (IOS-043). Status: built, not run on a device

### 2.5 State kept between runs

- AND-023 MUST: files in `filesDir`: `audio/` (the song files, section 4), `library.json`, `phone-index.json`, `library.json.good` with the iOS shapes (section 4). Preferences DataStore: the saved queue and position (section 5), shuffle, repeat, sort and filter state, "Use mobile data", "Download new songs automatically", the hourly-limit pause. Encrypted store: the Google credential (section 6). Nothing else is persisted. Status: built, not run on a device

## 3. Screens

### 3.1 Sign-in and signed-out state (P0)

iOS reference: IOS-010, IOS-012, IOS-014, IOS-016a, IOS-016d (the Settings Account card with the provider buttons; signed out the Library lists only the phone's songs with the "No songs yet" text; nothing is read from the server), IOS "Adding songs without an account".

Android:

- AND-030 MUST: the Account card has one button in v1, "Sign in with Google" (Credential Manager, section 6); Apple is absent until question NC is answered. Signed in it shows the email and "Sign out". Status: built, not run on a device
- AND-031 MUST: signed out the app behaves as IOS-014 and IOS-016a to IOS-016d: local library only, no server reads, the empty-state text; the anonymous add of iOS is not in v1 (the + button signed out opens the sign-in prompt). Status: built, not run on a device

### 3.2 Library (P1)

iOS reference: IOS-030 to IOS-035 ([Library v5](../ui-ux/library-v5.md): rows with cover, title, "Artist · year", audio state and download control; pinned header with menu, title and +; one chip row Tags, Genres, Era, Countries, Never listened, Downloaded; sort; long-press menu Play next, Add to queue, Edit, Download or Get audio, Remove from iPhone), IOS-035 (catalog sync with `If-None-Match` on launch, on resume and on pull to refresh), IOS-117 (a row whose song is on the phone shows no download control), IOS-118 (search field and chips scroll with the list), IOS-124 (counts only after sync), IOS-130 (row text stays readable).

Android:

- AND-032 MUST: Library is a `LazyColumn` with the iOS row anatomy and states; the search field and chip row scroll with the list; pull to refresh runs the catalog sync; the long-press menu becomes a bottom sheet with the same actions ("Remove from phone" instead of "Remove from iPhone"). Status: built, not run on a device
- AND-033 MUST: the row download state is driven by WorkManager's `WorkInfo` for the song's unique work name (waiting, fetching on server, copying with percent, paused for the hourly limit with the minutes left, failed with Retry) and by the file's presence for "on phone"; the state is derived, never stored (ADR-0010). Status: built, not run on a device
- AND-034 MUST: the "Songs | Albums" switch (IOS-031), Drafts and Playlists entries are not shown until their phases are built; the Library has no empty placeholder tabs. Status: built, not run on a device

### 3.3 Song details (P1)

iOS reference: IOS-034 (the song sheet: cover, duration, BPM read-only, source icons, the shared form for editing), IOS-128 (Download listed once).

Android:

- AND-035 MUST: Song details is a `ModalBottomSheet` with the iOS content and actions (Download, Play next, Add to queue, Remove from phone, Edit); Edit opens the shared form (3.5) in the same sheet; there is no separate Edit screen. Status: built, not run on a device

### 3.4 Playback (P1)

iOS reference: IOS-040, IOS-041 (cover first, genre chips, seek bar, transport keys, "Queue (N)"), IOS-104 to IOS-106 and [playback.md](playback.md) sections Persistence, Media Session and Offline (the rules the apps share), IOS-125 (destructive actions ask first), IOS-129 (disabled keys without a song).

Android:

- AND-036 MUST: the Now playing screen is the iOS one; it reads one `PlayerState` flow from the `MediaController` connected to the playback service (section 5) and no playback logic lives in a composable. Status: built, not run on a device

### 3.5 Add song and Edit song (P2)

iOS reference: IOS-020 to IOS-023, IOS-061 to IOS-070 (Add as a sheet from the +; paste a YouTube or SoundCloud link, clean it, offline library match, Fetch `POST /preview`, editable preview with the tag editor; one `SongFormView` over one `SongFormState` for Add and Edit: Title, Artist and Remix as token pill fields, drag and drop between them, genre suggestions, Wikipedia link fields, BPM never typed), [add-song.md](add-song.md).

Android:

- AND-037 MUST: Add and Edit are one `SongForm` composable over one `SongFormState`, mirroring `SongFormView` and `SongFormState` field for field; the token pill field is a Compose port of `TokenField` (pills with edit and remove, Enter and the spaced " - ", " | ", " / " separators, drag between Title, Artist and Remix). Status: built, not run on a device
- AND-038 MUST: "Add to library" calls `POST /songs`; with "Download new songs automatically" on it also enqueues the download (section 4); the preview and the saved song match the iOS payload (`ios_contract.json`). The app registers as a share target for `text/plain` (ACTION_SEND from the YouTube or SoundCloud app) and opens Add with the link filled: the Android equivalent of pasting and the main way links arrive on a phone. Status: built, not run on a device
- AND-039 SHOULD: YouTube text search (`GET /search`, IOS-023) stays out of v1 unless question NE says otherwise. Status: as planned: search is not in v1

### 3.6 Settings (P2)

iOS reference: IOS-010, IOS-010a ("Open in Files"), IOS-017 ("Use mobile data" governs file downloads only), IOS-022 ("Download new songs automatically"), the Storage card, `GET /me/usage` (the quota line).

Android:

- AND-040 MUST: Settings has the cards Account (3.1), Library (songs, hours, the storage line from `GET /me/usage`, server host), Downloads ("Download new songs automatically", "Use mobile data", songs on this phone and bytes, "Remove all downloads" with a confirmation), About (version name and code, the legal note). Status: built, not run on a device
- AND-041 MUST: "Open in Files" has no v1 equivalent because `filesDir` is app-private and invisible to file managers; an export to the Music folder through MediaStore is a later option, not planned. Status: as planned: no export

### 3.7 Later screens

Playlists (PLS-102), Albums and Download album (the iOS "Albums" section, task-0120), Statistics (STT-100), Tools (IOS-091, task-0113), Drafts (ADR-0032), visualizer, Genres map, Music theory, share links and the anonymous add are not specified for Android here; each gets its AND lines when its phase opens, after v1 is verified on a device. Their order is question NF.

## 4. Downloads and storage

iOS reference: IOS-022, IOS-106 (the background `URLSession` copy), IOS-107 (`LibraryIndex`: `library.json` is the cached catalog with the ETag, schema 2; `phone-index.json` the id to file name map plus the records of the songs on the phone; `library.json.good` the last good copy; a broken catalog is kept as `library.json.corrupt-<stamp>`), IOS-075a (`AudioFiles`: "Artist - Title.m4a" names, legacy `<id>.m4a`), IOS-042, [catalog.md](catalog.md) CAT-005 and CAT-006, [api.md](api.md) API-041 to API-045, API-060 and API-318 (quotas `USER_MAX_SONGS`, `USER_ADDS_PER_HOUR` = 20, `USER_MAX_BYTES`, `USER_MAX_CONCURRENT_DOWNLOADS` = 1; 429 `hourly_limit` with `Retry-After`; a Range request for more than 768 KiB is answered with its first 768 KiB), [storage-and-sync.md](storage-and-sync.md).

- AND-050 MUST: the flow is the iOS one, client-paced, no server queue: state `none` to `server` by `POST /songs` (new song, `audio: true`) or `POST /songs/{id}/audio` (catalog song), then `GET /songs/{id}/status` every 1 to 2 s until `done` or `error`, then `GET /files/{id}` copied to the phone; state `server` to `phone` skips the first two steps. Status: built, not run on a device
- AND-051 MUST: every download is a WorkManager `CoroutineWorker` under the unique work name `download:<song id>` (`ExistingWorkPolicy.KEEP`), with the constraint `NetworkType.CONNECTED`, or `UNMETERED` while "Use mobile data" is off; it survives process death and reboot, retries with `BackoffPolicy.EXPONENTIAL` on network and 5xx errors, and reports progress through `setProgress`. Status: built, not run on a device
- AND-052 MUST: a 429 `hourly_limit` does not retry blindly: the worker reads `retry_after_minutes`, records the pause in DataStore (shown in the row and in Settings as "Paused: hourly limit, resumes in N min") and re-enqueues the song with `initialDelay` = that time; nothing counts twice and nothing queues forever silently. `library_full_songs` and `library_full_bytes` fail the work with the server's reason and no retry. Status: built, not run on a device
- AND-053 MUST: the copy is a plain `GET /files/{id}` (200, whole file) written to `audio/<name>.part`; a resume after an interruption sends `Range: bytes=<partial length>-` and loops over 206 answers (the server caps each at 768 KiB, API-318) until the file is complete; the final length is checked against the announced size, the file is renamed atomically, then `phone-index.json` is written; a failed or cancelled copy leaves no file under the final name. Status: built, not run on a device
- AND-054 MUST: while download work runs it is a foreground worker (`setForeground`, type `dataSync`) with one summary notification "Downloading N songs" and per-song progress; `POST_NOTIFICATIONS` is requested once on the first download (Android 13+); if denied the downloads still run, only the notification is missing. Status: built, not run on a device
- AND-055 MUST: at most one server fetch runs at a time (the server cap `USER_MAX_CONCURRENT_DOWNLOADS` = 1) and at most two file copies, as the iOS bulk download; a planner orders the queue and the workers take the next id, so WorkManager's own parallelism never exceeds the caps. Status: built, not run on a device
- AND-056 MUST: audio lives in `filesDir/audio/`, named as `AudioFiles.swift` names them, with the same legacy fallback; no storage permission is ever requested; the folder is excluded from Android auto backup (`dataExtractionRules`), the index files are included. Status: built, not run on a device
- AND-057 MUST: `library.json`, `phone-index.json` and `library.json.good` keep the iOS shapes and the iOS recovery rules (IOS-107: offline playback never depends on decoding the catalog cache; a corrupt catalog is renamed and the good copy or the phone index is used); the loader ignores unknown fields, so a server schema addition never breaks the phone. No Room, no SQLite. Status: built, not run on a device
- AND-058 MUST: catalog sync runs on launch, on return to the foreground and on pull to refresh with `If-None-Match`; a 304 changes nothing; a new catalog is written atomically (temp file, rename) after the good copy is refreshed. With "Download new songs automatically" on, songs that reach `server` state are enqueued. Status: built, not run on a device
- AND-059 MUST: "Remove from phone" deletes the file and its `phone-index.json` entry and never touches the server; "Remove all downloads" does the same for every song after a confirmation (IOS-125). Status: built, not run on a device

## 5. Playback and media session

iOS reference: IOS-040 (local files, background audio, lock-screen controls), IOS-104 (`PlaybackPersistence`: the queue, index, tags and position survive a relaunch; the position is written at most every 5 s while playing and at once on pause or seek; restored only when above 3 s and at least 5 s before the end, `minStart` 3, `endGuard` 5), IOS-105 (`ShufflePick`: weighted by the 30-day listen and skip counts, uniform fallback), IOS-115 (`PlayerService` owns the player and the queue), [playback.md](playback.md) "Media Session" and "Offline", the play log `POST /plays` (`play_recorder_cases.json`).

- AND-060 MUST: playback is Media3 ExoPlayer inside a `MediaSessionService` started in the foreground (`FOREGROUND_SERVICE_MEDIA_PLAYBACK`); the service owns the player and the queue; the UI connects through a `MediaController` and holds no playback state of its own. Status: built, not run on a device
- AND-061 MUST: the media notification and the lock screen show title, artist, album and cover with elapsed time and rate; the session exposes play, pause, toggle, next, previous and seek, and the custom commands skip back 10 s, skip forward 10 s, shuffle and repeat in the notification's custom layout; headset and Bluetooth buttons and Android Auto work through the session with no extra code. Status: built, not run on a device
- AND-062 MUST: audio focus is handled by the player (`setAudioAttributes(usage MEDIA, content MUSIC, handleAudioFocus = true)`): a call or another player pauses this one and playback resumes after a transient loss; `handleAudioBecomingNoisy` pauses on headphone unplug. Status: built, not run on a device
- AND-063 MUST: the queue is the whole play order as ExoPlayer media items from `file://` URIs; shuffle is a custom `ShuffleOrder` fed by the Kotlin port of `ShufflePick` (same weights, same uniform fallback, same fixture tests); repeat uses the player's repeat modes; both are persisted in DataStore. Status: built, not run on a device
- AND-064 MUST: the resume rule is the iOS one verbatim: `{ids, index, tags, position}` saved at most every 5 s while playing and at once on pause, seek and queue change; restored paused after a relaunch when the files exist, at the saved position only if it is above 3 s and at least 5 s before the end, else 0. Status: built, not run on a device
- AND-065 MUST: the play log posts `POST /plays` with the iOS payload, batched, queued on disk while offline or signed out and flushed on the next signed-in launch; listening never waits on it. Status: built, not run on a device
- AND-066 MUST: a song whose file is missing is skipped with a toast and never fetched during playback; nothing plays from the network. Status: built, not run on a device
- AND-067 SHOULD: the service stops itself after 10 minutes paused with the app in the background, so the notification does not linger. Status: built, not run on a device

## 6. Sign-in and tokens

iOS reference: IOS-012, IOS-013, IOS-015, IOS-016, API-007; server audiences from `server/app/oauth.py`: Google `GOOGLE_CLIENT_ID` plus `GOOGLE_WEB_CLIENT_ID`, Apple `APPLE_AUDIENCE` plus `APPLE_WEB_CLIENT_ID` (comma lists).

- AND-070 MUST: v1 sign-in is Google only, through Credential Manager (`GetGoogleIdOption`) with `serverClientId` = the existing web client id, so the ID token's `aud` is the web client id the server already accepts; no server change. The Google Cloud project still needs an Android OAuth client (package name `com.alexisayenko.audioplayer.android` plus the SHA-1 of the debug and release signing keys) for sign-in to be allowed on the device. Status: built, not run on a device
- AND-071 MUST: every request sends `Authorization: Bearer <id token>` as iOS does; there is no `POST /auth/session` and no cookie on Android. Status: built, not run on a device
- AND-072 MUST: a Google ID token lives about an hour; before expiry the app re-requests it silently (`filterByAuthorizedAccounts = true`, `autoSelectEnabled = true`); when that shows UI or fails, Settings shows "Expired, sign in again" (the IOS-013 wording). If silent renewal proves unreliable in phase 1, the fallback is AppAuth code plus PKCE with refresh tokens against an Android client id added to `GOOGLE_CLIENT_ID`, the iOS model. Status: built, not run on a device
- AND-073 MUST: the credential (ID token, its expiry, the account email) is stored in a DataStore file encrypted with an AES key from the Android Keystore; Jetpack Security's `EncryptedSharedPreferences` is deprecated and not used. Nothing is logged. Status: built, not run on a device
- AND-074 MUST: the client id comes from a git-ignored `android/local.properties` (or `~/.config/android/oauth.env` sourced by the build), never from the repo (IOS-015). Status: built, not run on a device
- AND-075 SHOULD (later phase, question NC): Apple sign-in on Android uses the web Services ID (`APPLE_WEB_CLIENT_ID`) in a Custom Tab with `response_mode=form_post` to a new server endpoint that redirects to an Android App Link on `electrophone.cc`, which hands the ID token to the app; `aud` is then the Services ID the server already accepts. Needs one small server endpoint and an `assetlinks.json`. Status: planned (later phase)

## 7. Distribution, signing, CI

iOS reference: IOS-060 (the iOS build number is date-based, ADR-0008; Android is not), [ios.md](ios.md) "Distribution" (TestFlight internal only), the owner's secrets rule (credentials in `~/.config/<service>/`, one file per credential, never in a repo or `~/.claude`).

- AND-080 MUST: no Play Store listing; a release build is a signed APK attached to a GitHub Release tagged `android-v<versionName>`, installed by sideload ("Install unknown apps"). Play internal testing is question NB. Status: not done: no release APK built yet
- AND-081 MUST: `versionCode` is a plain counter (default 1, `-PversionCode=N` or the first argument of `scripts/build-android-release.sh`), raised for every upload and strictly rising, as Google Play requires; it deliberately does not follow the iOS date-based number; `versionName` follows `MARKETING_VERSION`. Status: built, not run on a device
- AND-082 MUST: the release keystore is `~/.config/android/release.jks`, its passwords `~/.config/android/release-store-password.env` and `~/.config/android/release-key-password.env` (`chmod 600`), sourced by `scripts/build-android-release.sh` at build time; Gradle reads them from environment variables; none of it is in the repo; the debug keystore is the SDK's default. Losing the keystore means a new application id for existing installs, so it is backed up outside the Mac (the owner picks the place). Status: script built (`scripts/build-android-release.sh`); no keystore created
- AND-083 MUST: a GitHub Actions job (`.github/workflows/android.yml`, `ubuntu-latest`, Temurin JDK 17, Gradle cache) runs `./gradlew lint testDebugUnitTest assembleDebug` on every push that touches `android/`, `scripts/sync-design-system.py` or `docs/brand/tokens.json`; no Mac runner is needed. A signed release in CI is optional and needs the keystore as repository secrets (question NH). Status: built with JDK 21, not yet run on GitHub
- AND-084 MUST: `scripts/check.sh` gets an Android step as soon as `android/` exists: `./gradlew -q testDebugUnitTest` when a JDK is available, otherwise a clear "skipped: no JDK" line; the token `--check` already covers the Kotlin file through AND-010. Status: built, not run on a device
- AND-085 MUST: the YouTube ToS note applies as on iOS: the app is not for distribution beyond the owner's circle. Status: built, not run on a device

## 8. Toolchain and project layout

- AND-090 MUST: Android Studio (current stable) with its bundled JDK and SDK on the MacBook (Apple silicon: an arm64-v8a emulator image) and, when wanted, natively on the Windows machine (not through WSL; Gradle needs no Node). Nothing is installed today. Status: not done: built in a cloud Linux container with the command-line SDK; Android Studio is not installed on any machine
- AND-091 MUST: `minSdk` 28 (Android 9); `targetSdk` the current stable API level at phase 0, raised with each yearly release; question NA may move `minSdk`. Status: built, not run on a device
- AND-092 MUST: Gradle Kotlin DSL with a version catalog (`gradle/libs.versions.toml`); one module `app` in v1; Kotlin 2.x with the Compose compiler plugin; libraries: Compose foundation and runtime (Material 3 only for the overridable components of AND-012), Media3 `exoplayer` and `session`, WorkManager, DataStore, kotlinx.serialization, kotlinx.coroutines, OkHttp, Credential Manager with `googleid`, Coil. No Hilt or Koin in v1 (one module, manual wiring in `App`). Status: built, not run on a device
- AND-093 MUST: the application id and namespace are `com.alexisayenko.audioplayer.android` (the iOS bundle id `com.alexisayenko.audioplayer` plus a platform segment, as the Mac's `com.alexisayenko.audioplayer.mac`). Status: built, not run on a device

Tree sketch (v1):

```
android/
  settings.gradle.kts
  build.gradle.kts
  gradle/libs.versions.toml
  gradle/wrapper/
  gradlew, gradlew.bat
  README.md                         how to build, sign and sideload
  app/
    build.gradle.kts
    proguard-rules.pro
    src/main/AndroidManifest.xml
    src/main/kotlin/com/alexisayenko/audioplayer/android/
      App.kt                        wiring, no DI framework
      ui/DesignTokens.kt            GENERATED by scripts/sync-design-system.py
      ui/Theme.kt, ui/icons/        theme, icon set (question ND)
      ui/shell/                     drawer, mini-player bar, navigation
      ui/library/, ui/playback/, ui/songform/, ui/settings/, ui/signin/
      data/api/                     ApiClient, Endpoints, models
      data/store/                   LibraryIndex, AudioFiles, Prefs (DataStore)
      download/                     DownloadWorker, DownloadPlanner, HourlyLimit
      playback/                     PlaybackService, ShufflePick, QueueAdvance, PlaybackPersistence, PlayLog
      auth/                         GoogleSignIn, TokenStore
      logic/                        the ports of section 2.3
    src/test/kotlin/...             JVM tests, fixtures from server/tests/fixtures
    src/androidTest/kotlin/...      instrumented, optional
```

## 9. Testing

- AND-100 MUST: JVM unit tests cover the ports of section 2.3 against the shared fixtures, the download planner and the hourly pause with a fake clock (the iOS `AlbumTests` model), the resume rule, the weighted shuffle (distribution over many draws), the index loaders with the iOS sample files (`legacy_library_sample.json`, `ios_contract.json`) and corrupt input, and the API error mapping. Status: built, not run on a device
- AND-101 MUST: before a release APK is attached, a device checklist is run and recorded in task-0127: 30 minutes of locked-screen playback; headset and Bluetooth buttons; a call during playback; a download continued after the app is swiped away and after a reboot; a forced `hourly_limit` pause and its resume; airplane-mode playback of downloaded songs; a process kill and relaunch restoring the queue and position. Status: not done: no device run yet
- AND-102 SHOULD: instrumented tests exist only for the worker and the service lifecycle, added when the device checklist finds a regression twice; no UI test suite in v1. Status: partly: Robolectric tests for the worker, the service and app start; no instrumented tests
- AND-103 SHOULD: whether the fixtures are read in place or copied is question NG. Status: decided: read in place (NG1)

## 10. Open questions

The owner questions are in [task-0127](../tasks/task-0127.md) (NA to NH): the first user and Android version (`minSdk`), sideload or Play internal testing, Apple sign-in timing, the icon pipeline, YouTube search in Add, the order of the later phases, the shared contract fixtures, and `android/` in CI from day one. Open details that need no owner answer: Google silent renewal (the AND-072 fallback), the font (AND-013), which Material 3 components are safe under the token theme (AND-012), and OEM battery managers that kill background work beyond AOSP (the AND-101 checklist runs on the first user's actual phone).

## 11. Build notes (2026-11-11): where the build differs from the plan

- Toolchain: Gradle 9.9.1, AGP 9.5.1, Kotlin 2.4.21, `compileSdk` and `targetSdk` 37, `minSdk` 28, JDK 21 in CI (AND-083 said 17).
- On AND-011: the single-layer native shadows (`depth-*`, marked `platform: ios`) also reach `DesignTokens.kt` as `DS.Shadow` and are drawn with Compose `dropShadow`, so cards and floating slabs match iOS; the layered web shadows stay web only.
- On AND-014: the icons are generated by `scripts/export-android-icons.mjs` (ND1) from `web/js/icons.js`; 22 glyphs the web set lacks (menu, account, skip 10 s, sort, filter icons and others) are defined in that script as `ANDROID_EXTRA` and should move into the design system's icon set.
- On AND-023, AND-064: the saved queue, position, shuffle and repeat are JSON files under `filesDir/playback/`, not DataStore; the Library sort and filters are kept only while the app runs.
- On AND-063: ExoPlayer holds one song at a time; the app picks every next song itself (`QueueAdvance`, as iOS) instead of a custom `ShuffleOrder`, so the weighted shuffle, play history and missing-file skip behave as on iOS. Cost: no gapless transition.
- On AND-061: shuffle and repeat are offered to the notification as overflow commands and may not show there.
- On AND-073: the credential is an AES-GCM encrypted file in `noBackupFilesDir`, not a DataStore.
- On AND-072: the AppAuth fallback is not built.
- On AND-036, section 3.4: Now playing has skip 10 s keys in the tray and the whole queue as a card on the page (iOS: a two-row "Up next" card and a queue sheet).
- On AND-032: a tap anywhere on a downloaded song's row plays it; Song details is the first item of the long-press menu.
- On AND-037: "Get metadata", the service icons and "Detect BPM" of the iOS form are not built; genre suggestions come from the library's own tags.
- Listening counts (`GET /stats/listening`) are not read: "Never listened" keeps every song, "Last listened" sort is disabled and the shuffle is uniform plus the phone's own pending plays.
- Edit sends `PATCH /songs/{id}` with only the changed keys, as iOS does (the plan said PUT).
