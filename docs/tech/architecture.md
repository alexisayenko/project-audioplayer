# Architecture

Status: Accepted · 2026-10-12

```text
browser (web UI)  --same origin, X-API-Token-->  server (FastAPI + yt-dlp)  -->  YouTube
iPhone (SwiftUI, deferred)  --http, X-API-Token-->  same server
  library.json + audio/<id>.m4a  <-- /files/<id> --  downloads/<id>.m4a
```

## Why a server

iOS cannot run `yt-dlp`. The server extracts the audio; the app only
talks to it and plays local files. Run it on an always-on machine (YouTube
may bot-challenge datacenter IPs). The web interface is built
first and served by FastAPI itself (same origin, no CORS) at
`play.isayenko.net`. Exposure via Cloudflare Tunnel is planned, not set
up; until then a placeholder page sits on Cloudflare Pages and the
server is reached locally or over Tailscale. See
[`decisions.md`](decisions.md) (ADR-0001, ADR-0003).

## Server (`server/`)

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | liveness, no auth |
| `GET /search?q=&limit=` | `ytsearch` via yt-dlp, flat results |
| `POST /download {video_id}` | fetch m4a (itag 140, no ffmpeg needed), return metadata |
| `GET /files/{video_id}` | stream the stored m4a |

All but `/health` need header `X-API-Token` equal to `AUDIO_API_TOKEN`.
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

## App (`ios/`)

Deferred: the web interface comes first. The scaffold below exists.

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
