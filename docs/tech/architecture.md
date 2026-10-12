# Architecture

Status: Accepted · 2026-10-12

```text
browser (web UI)  --same origin, session cookie or X-API-Token-->  server (FastAPI + yt-dlp)  -->  YouTube
iPhone (SwiftUI)  --http, Bearer ID token or X-API-Token-->  same server
  audio/<id>.m4a  <-- /files/<id> --  downloads/<id>.m4a
  library.json + covers  <-- local clones of data-storage / data-storage-lfs (ADR-0005)
```

## Why a server

iOS cannot run `yt-dlp`. The server extracts the audio; the app only
talks to it and plays local files. The web interface is built
first and served by FastAPI itself (same origin, no CORS) at
`play.isayenko.net`.

## Deployment (planned, not deployed)

Runs as a systemd service in the existing `tools` LXC 106 (Debian 13,
`192.168.0.10`) on home server `perkunas`: no new LXC, no Docker, ~2
cores max (the CPU throttles at 100 C; the LXC also hosts Immich).
Public via the perkunas Cloudflare Tunnel: ingress
`play.isayenko.net` -> `http://192.168.0.10:<port>`; at cutover the
interim Pages CNAME `play` -> `play-76g.pages.dev` is replaced by the
tunnel CNAME. Audio sits on a ZFS dataset on pool-3 (e.g.
`/data/music`, single disk, no redundancy) bind-mounted into the LXC.
Until cutover a placeholder page sits on Cloudflare Pages.
See [`decisions.md`](decisions.md) (ADR-0001, ADR-0003, ADR-0004,
ADR-0005).

## Library storage (ADR-0005, implemented; not deployed)

Without `AUDIO_DATA_REPO` (dev/tests) `library.json` and `covers/` are
plain files in `AUDIO_DATA_DIR`. Otherwise the server keeps its own clones of the private repos
`alexisayenko/data-storage` (`audioplayer/library.json`) and
`alexisayenko/data-storage-lfs` (`audioplayer/covers/<id>.jpg`, Git LFS).
Reads come from the local clone. A write takes the single-writer lock,
runs `pull --rebase`, writes `library.json` atomically, commits
(`audioplayer: add|edit|delete|bpm <id>`) and pushes. If the push fails the
local commit is kept, retried with backoff, and a warning is shown in
the UI; the write is never lost. Auth: one write deploy key per repo,
outside the repos (`~/.config/`, `chmod 600`). History is permanent, so
`library.json` holds no secrets or personal data. It carries
`settings.music_root` (`<servername>://<path>/`), resolved by the server
via a local name -> mount path/host config outside the repo; songs hold
relative audio file names only (replaces `AUDIO_DOWNLOAD_DIR`). Each save costs a push
(~1-2 s). The server never uses `C:\Alex\data-storage` on the PC.

## Server (`server/`)

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | liveness + git `sync` state (`ok`/`pending`/`error`), no auth |
| `GET /search?q=&limit=` | `ytsearch` via yt-dlp, flat results |
| `POST /download {video_id}` | fetch m4a (itag 140, no ffmpeg needed), return metadata |
| `GET /files/{video_id}` | stream the stored m4a |
| `GET /library`, `GET /tags` | songs with tags; tag counts |
| `POST /preview {url}` | yt-dlp metadata plus suggested genre/country/lang tags, year and Wikipedia links (MusicBrainz, Wikidata), no download |
| `POST /lookup/wikipedia` | suggested tags and year from user-edited Wikipedia links |
| `POST /songs`, `GET /songs/{id}/status` | add song (background download), poll progress |
| `PATCH /songs/{id}`, `DELETE /songs/{id}` | edit metadata/tags/bpm; remove record, audio, cover |
| `POST /songs/{id}/bpm/detect` | re-detect BPM (aubio) from the stored m4a |
| `GET /covers/{video_id}` | cover jpg (`covers/<id>.jpg`) |
| `GET /` | web UI (`web/`, static, public) |

Full contract: [`../product/screens.md`](../product/screens.md).

All API routes except `/health` need either an owner OAuth ID token
(`Authorization: Bearer`, see below) or header `X-API-Token` equal to
`AUDIO_API_TOKEN`. `/files/{id}` and `/covers/{id}` also accept
`?token=<token>`, compared with `hmac.compare_digest`, since `<audio>`
and `<img>` cannot send headers; the token therefore can appear in URLs
and access logs, so keep logs private and use HTTPS. The static UI
files are served without auth.
The web UI signs in with Google or Apple (ID token to `POST /auth/session`,
then an HttpOnly `__Host-session` cookie, 12 h; ADR-0006, API-020..024), so
its audio and cover URLs carry no token; cookie writes need `X-Requested-With`.
Video ids are validated against `^[A-Za-z0-9_-]{11}$` (blocks path
traversal and yt-dlp option injection).

System dependencies (BPM detection, ADR-0002): `ffmpeg` on PATH (decodes m4a
to PCM) and, because `aubio==0.4.9` has no wheel for current Python, a C
toolchain with Python headers to build it (Debian: `apt install ffmpeg
python3-dev build-essential`). With GCC 14 (Debian 13) the build needs
`CFLAGS="-Wno-error=incompatible-pointer-types" pip install -r requirements.txt`.
If ffmpeg or aubio is missing, BPM stays `null` and downloads still work.

```sh
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest                                   # tests stub yt-dlp
AUDIO_API_TOKEN=$(openssl rand -hex 32) uvicorn app.main:app --host 0.0.0.0
pip install -U yt-dlp                    # run daily (cron); YouTube breaks it often
```

Then open `http://<host>:8000/`, go to Settings, paste the token. Env:
`AUDIO_API_TOKEN` (required), `AUDIO_DOWNLOAD_DIR` (default `downloads`),
`AUDIO_DATA_DIR` (default `.`, plain-file `library.json` and `covers/` when
`AUDIO_DATA_REPO` is unset), `AUDIO_DATA_REPO` / `AUDIO_COVERS_REPO` /
`AUDIO_GIT_SSH_KEY` (git store, ADR-0005), `AUDIO_MUSIC_ROOT` /
`AUDIO_HOSTS` / `AUDIO_HOSTS_FILE` (audio location),
`AUDIO_WEB_DIR` (default `../web`), `AUDIO_TAG_LOOKUP` / `AUDIO_GENRE_LOOKUP` (default on, `0`
disables the outbound HTTPS tag and link lookups to `musicbrainz.org`, `wikidata.org`
and `*.wikipedia.org`), `AUDIO_MB_USER_AGENT` (default
`audioplayer/0.1 (alex.isayenko@gmail.com)`, sent to all three hosts; Wikimedia requires a descriptive one).

Server modules (`server/app/`): `main` (routes, jobs), `library` (records, derived `decade:` tags,
tag normalisation), `extractor` (yt-dlp), `genre_lookup` (MusicBrainz
suggestions), `wiki_lookup` (Wikipedia links, Wikidata facts, link validation), `langcodes` (ISO 639 mapping), `bpm` (aubio), `gitstore`
(git sync).

## Web UI (`web/`)

Plain HTML, CSS and ES modules; no build step, no framework, no CDN.
`index.html` + `style.css` + `js/` (`api`, `store`, `dom`, `player`, `library`,
`queue-logic`, `tagname`, `tag-editor`, `wiki-links`, `url-clean`, `tag-input`, `add`, `settings`, `app`). Hash routes `#/library`, `#/add`,
`#/playback`, `#/settings`. One `<audio>` element drives the mini-player, the
Playback tab and the Media Session lock-screen controls. The token
is kept in `localStorage` (`audioplayer.token`). Mounted by FastAPI at
`/` after all API routes, so it never shadows them.

## App (`ios/`)

SwiftUI, iOS 17, iPhone only, XcodeGen (`project.yml`). Tabs Library, Add,
Playback, Settings, like the web (ADR-0007, spec [`../specs/ios.md`](../specs/ios.md)).
Sources in `ios/Sources/`:

- `Views` (tab shell, mini-player), `LibraryView`, `AddView` (+ `SearchView`
  as secondary text search), `SongEditView`, `PlaybackView`, `SettingsView`.
- `Theme`, `Components` — Vega 108 look (walnut bars, panel rows, piano
  buttons, LEDs, platter and tonearm); see
  [`../ui-ux/style-guide.md`](../ui-ux/style-guide.md).
- `LibraryStore` — phone library, `Documents/library.json` and `Documents/audio/`.
  `ServerLibrary` — cached `GET /library`, per-song and "Download all".
- `APIClient` — preview, `POST /songs` + status polling, `/files`, PATCH,
  BPM detect, Wikipedia lookup, delete; auth header added per request.
- `AuthService`, `Keychain` — Sign in with Apple / Google (ADR-0006) and
  token storage.
- `PlayerService` — `AVPlayer`, `.playback` audio session, queue, shuffle and
  repeat, `MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`;
  `UIBackgroundModes: audio`.
- Server URL (default `https://play.isayenko.net`) and token are set in Settings.

```sh
brew install xcodegen
cd ios && cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig  # fill in, git-ignored
xcodegen && open AudioPlayer.xcodeproj
```

### TestFlight

ADR-0008. App Store Connect record "Gramophone Offline" (bundle
`com.alexisayenko.audioplayer`, SKU `gramophone-ios`), internal group "Alex".

1. Raise `CURRENT_PROJECT_VERSION` in `ios/project.yml` above every build
   already uploaded (date-based; last uploaded 20261013), then `xcodegen`.
2. `xcodebuild archive` the `AudioPlayer` scheme (Release, generic iOS device).
3. `xcodebuild -exportArchive` with export options `method=app-store-connect`,
   `destination=upload`; it signs and uploads with the account signed in to
   Xcode (Settings > Accounts), cloud-managed signing, no API key.
4. Wait for processing in App Store Connect, add the build to the group.

Builds expire after 90 days; re-upload.

## Known gaps

- The iOS app builds and has been uploaded to TestFlight; Add, edit, download
  and sign-in flows against the live server are not yet tested on a device.
- Server covers are not stored on the phone: blank offline after a relaunch.
- `NSAllowsArbitraryLoads` is on in `project.yml`; the server is now HTTPS
  at `play.isayenko.net`, so it can be tightened once that is deployed.
- No CI (template rule: manual workflows only; none added yet).

## Owner-only OAuth sign-in

See ADR-0006. The iOS app signs in with Apple (`SignInWithAppleButton`) or
Google (`ASWebAuthenticationSession`, code + PKCE) from Settings and sends
the ID token as `Authorization: Bearer`. `server/app/oauth.py` verifies it
(JWKS signature, `iss`, `aud`, `exp`) and allows only the owner.

Server env: `ALLOWED_EMAIL` (default `alex.isayenko@gmail.com`),
`ALLOWED_APPLE_SUB`, `APPLE_AUDIENCE=com.alexisayenko.audioplayer`,
`GOOGLE_CLIENT_ID`. A provider without its audience set is rejected.

iOS setup (done): Sign in with Apple capability on the App ID
`com.alexisayenko.audioplayer` (entitlement is in `project.yml`); a Google
OAuth client of type iOS with that bundle id; copy
`ios/Config/Secrets.example.xcconfig` to `Secrets.xcconfig` and fill in the
client ID and its reversed form, then `xcodegen`.

Apple `sub`: sign in with Apple once in the app, decode the token payload
(`sub`), or read the 403 case in the server log; put it in
`ALLOWED_APPLE_SUB` so a hidden or relayed email still passes.

Google Cloud project `gramophone-offline`: OAuth consent screen External in
Testing with the owner as the only test user, one OAuth client of type iOS.
A new client can take hours to start working. Values stay out of the repo.
