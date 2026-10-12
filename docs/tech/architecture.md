# Architecture

Status: Accepted · 2026-10-12

```text
browser (web UI)  --same origin, X-API-Token-->  server (FastAPI + yt-dlp)  -->  YouTube
iPhone (SwiftUI, deferred)  --http, X-API-Token-->  same server
  audio/<id>.m4a  <-- /files/<id> --  downloads/<id>.m4a
  library.json + covers  <-- local clones of data-storage / data-storage-lfs (ADR-0005, planned)
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

## Library storage (planned, ADR-0005; not implemented)

Today `library.json` and `covers/` sit in `AUDIO_DATA_DIR` on the server
disk. Planned: the server keeps its own clones of the private repos
`alexisayenko/data-storage` (`audioplayer/library.json`) and
`alexisayenko/data-storage-lfs` (`audioplayer/covers/<id>.jpg`, Git LFS).
Reads come from the local clone. A write takes the single-writer lock,
runs `pull --rebase`, writes `library.json` atomically, commits
(`audioplayer: add|edit|delete <id>`) and pushes. If the push fails the
local commit is kept, retried with backoff, and a warning is shown in
the UI; the write is never lost. Auth: one write deploy key per repo,
outside the repos (`~/.config/`, `chmod 600`). History is permanent, so
`library.json` holds no secrets or personal data. Planned: it carries
`settings.music_root` (`<servername>://<path>/`), resolved by the server
via a local name -> mount path/host config outside the repo; songs hold
relative audio file names only (replaces `AUDIO_DOWNLOAD_DIR`). Each save costs a push
(~1-2 s). The server never uses `C:\Alex\data-storage` on the PC.

## Server (`server/`)

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | liveness, no auth |
| `GET /search?q=&limit=` | `ytsearch` via yt-dlp, flat results |
| `POST /download {video_id}` | fetch m4a (itag 140, no ffmpeg needed), return metadata |
| `GET /files/{video_id}` | stream the stored m4a |
| `GET /library`, `GET /tags` | songs with tags; tag counts |
| `POST /preview {url}` | yt-dlp metadata, no download |
| `POST /songs`, `GET /songs/{id}/status` | add song (background download), poll progress |
| `PATCH /songs/{id}`, `DELETE /songs/{id}` | edit metadata/tags; remove record, audio, cover |
| `GET /covers/{video_id}` | cover jpg (`covers/<id>.jpg`) |
| `GET /` | web UI (`web/`, static, public) |

Full contract: [`../product/screens.md`](../product/screens.md).

All API routes except `/health` need header `X-API-Token` equal to
`AUDIO_API_TOKEN`. `/files/{id}` and `/covers/{id}` also accept
`?token=<token>`, compared with `hmac.compare_digest`, since `<audio>`
and `<img>` cannot send headers; the token therefore can appear in URLs
and access logs, so keep logs private and use HTTPS. The static UI
files are served without auth.
Video ids are validated against `^[A-Za-z0-9_-]{11}$` (blocks path
traversal and yt-dlp option injection).

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
`AUDIO_DATA_DIR` (default `.`, holds `library.json` and `covers/` until
ADR-0005 is implemented, after which they live in the git clones),
`AUDIO_WEB_DIR` (default `../web`).

## Web UI (`web/`)

Plain HTML, CSS and ES modules; no build step, no framework, no CDN.
`index.html` + `style.css` + `js/` (`api`, `store`, `player`, `library`,
`add`, `settings`, `app`). Hash routes `#/library`, `#/add`,
`#/settings`. One `<audio>` element drives the mini-player, the
full-screen Player and the Media Session lock-screen controls. The token
is kept in `localStorage` (`audioplayer.token`). Mounted by FastAPI at
`/` after all API routes, so it never shadows them.

## App (`ios/`)

Deferred: the web interface comes first. The scaffold below exists and does not yet use the library endpoints.

- `LibraryStore` — tracks as `Documents/library.json`, audio in `Documents/audio/`.
- `APIClient` — search, download (POST then file fetch).
- `PlayerService` — `AVPlayer`, `.playback` audio session, `MPNowPlayingInfoCenter`
  and `MPRemoteCommandCenter`; `UIBackgroundModes: audio`.
- Server URL and token are entered in the Settings tab.

```sh
brew install xcodegen
cd ios && xcodegen && open AudioPlayer.xcodeproj
```

Set `DEVELOPMENT_TEAM` in `ios/project.yml`, then Product → Archive →
upload to App Store Connect. Use **internal** testers (no Beta App
Review). TestFlight builds expire after 90 days; re-upload.

## Known gaps

- iOS code was written without compiling; expect small build fixes on
  first open in Xcode (2026-10-12).
- `NSAllowsArbitraryLoads` is on because the server is plain http on a
  private address; tighten if the server gets TLS.
- No CI (template rule: manual workflows only; none added yet).
