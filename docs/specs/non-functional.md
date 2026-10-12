# Non-functional requirements

ADRs: ADR-0003 (web), ADR-0004 (hosting), ADR-0001 (storage scale).

## Auth

- NFR-001 MUST: one shared secret `AUDIO_API_TOKEN` protects the whole API; no user accounts; owner-only OAuth ID tokens are accepted as well (ADR-0006). Status: implemented
- NFR-002 MUST: the web UI stores the token in `localStorage` key `audioplayer.token` and sends it as `X-API-Token`; audio and cover URLs carry it as `?token=`. Status: implemented
- NFR-003 MUST: without a token the UI routes to Settings; Settings "Save and test" verifies by loading the library. Status: implemented
- NFR-004 SHOULD: put Cloudflare Access (service token) in front of the tunnel as a second layer. Status: planned
- NFR-005 MUST: the token is never logged by the app; operators keep access logs private (token appears in `?token=` URLs). Status: implemented

## Hosting

- NFR-010 MUST: run as a plain systemd service (FastAPI, yt-dlp, ffmpeg, aubio) in LXC 106 `tools` on `perkunas`; no Docker, no new LXC. Status: planned (not deployed)
- NFR-011 MUST: public at `https://play.isayenko.net` through the existing Cloudflare Tunnel ingress to `http://192.168.0.10:<port>`; the web UI is served by FastAPI from the same origin (no CORS). Status: planned (UI served same-origin: implemented)
- NFR-012 MUST: Tailscale is not used. Status: implemented
- NFR-013 SHOULD: run `pip install -U yt-dlp` on a daily schedule (YouTube breaks it often). Status: planned

## CPU and resources

- NFR-020 MUST: the service is limited to about 2 cores (perkunas throttles at 100 C under sustained all-core load; LXC 106 also hosts Immich). Status: planned
- NFR-021 SHOULD: heavy work (yt-dlp, ffmpeg and aubio BPM decode) runs off the request path (background task or thread pool) and is bounded by timeouts (ffmpeg 120 s, git 120 s, MusicBrainz 5 s). Status: implemented
- NFR-022 MUST: BPM detection works without crashing the server if `ffmpeg` or `aubio` is missing (BPM stays `null`). Status: implemented

## Scale and performance

- NFR-030 MUST: designed for a few hundred songs, one user; no database, the whole library is one JSON file loaded per request and returned whole by `GET /library`. Status: implemented
- NFR-031 SHOULD: revisit storage at tens of thousands of songs or multiple users. Status: planned
- NFR-032 MUST: the Library list renders the full filtered set client-side with lazy-loaded covers (no pagination). Status: implemented
- NFR-033 MUST: concurrent writes are serialised; read endpoints take the same lock briefly. Status: implemented

## Browsers and offline

- NFR-040 MUST: the web UI is plain HTML, CSS and ES modules, no build step, no framework, no CDN; it targets current evergreen browsers incl. iOS Safari (uses `<dialog>`, ES modules, Media Session). Status: implemented
- NFR-041 MUST: the web UI is online only: no service worker, no offline storage, no audio cache. Offline listening is an iOS-app feature. Status: implemented
- NFR-042 MUST: the layout works at phone width. Status: to-confirm (not verified in this pass)
- NFR-043 MUST: the iOS app (`ios/`, SwiftUI) is deferred; its scaffold does not use the library endpoints. Status: planned
