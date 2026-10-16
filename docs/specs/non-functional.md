# Non-functional requirements

ADRs: ADR-0003 (web), ADR-0004 (hosting), ADR-0001 (storage scale).

## Auth

- NFR-001 MUST: `AUDIO_API_TOKEN` is the owner's credential (Alex's; it acts as the owner user, `OWNER_EMAIL`, quota-exempt); every other caller is a user who signed in with a verified Google or Apple identity (open signup, ADR-0012; token verification ADR-0006). ~~One shared secret, no user accounts, owner-only OAuth.~~ Status: implemented
- NFR-002 MUST: the web UI authenticates with the session cookie only and never stores or sends the API token (WEB-005); it deletes a leftover `localStorage` key `audioplayer.token` on load. Status: implemented
- NFR-003 MUST: without a session the UI routes to Settings, where Sign in with Google or Apple is the only way in. Status: implemented
- NFR-004 SHOULD: put Cloudflare Access (service token) in front of the tunnel as a second layer. Status: planned
- NFR-005 MUST: the token is never logged by the app; operators keep access logs private (token appears in `?token=` URLs). Status: implemented

## Hosting

- NFR-010 MUST: run as a plain systemd service (FastAPI, yt-dlp, ffmpeg, aubio) in LXC 106 `tools` on `perkunas`; no Docker, no new LXC. Status: implemented (deployed 2026-10-13)
- NFR-011 MUST: public at `https://electrophone.cc` through the existing Cloudflare Tunnel ingress to `http://192.168.0.10:<port>`; the web UI is served by FastAPI from the same origin (no CORS). Status: implemented
- NFR-012 MUST: Tailscale is not used. Status: implemented
- NFR-013 SHOULD: update `yt-dlp` on a schedule (YouTube breaks it often): a weekly systemd timer on LXC 106 runs `pip install -U yt-dlp` (see [deploy.md](../tech/deploy.md)). Status: implemented

## CPU and resources

- NFR-020 MUST: the service is limited to about 2 cores (perkunas throttles at 100 C under sustained all-core load; LXC 106 also hosts Immich). Status: planned
- NFR-021 SHOULD: heavy work (yt-dlp, ffmpeg and aubio BPM decode) runs off the request path (background task or thread pool) and is bounded by timeouts (ffmpeg 120 s, git 120 s, MusicBrainz 5 s). Status: implemented
- NFR-022 MUST: BPM detection works without crashing the server if `ffmpeg` or `aubio` is missing (BPM stays `null`). Status: implemented
- NFR-023 SHOULD: the WebGL terrain visualizer ([task-0023](../tasks/task-0023.md) phase 2) stays within about 8% CPU on a mid-range phone and keeps the GPU light (square-cell level-of-detail tiers of at most about 31000 grid vertices, DPR cap 1.5, uniform and upload caching, bloom only at the top quality level; the 72x56 grid of phase 2 is gone, VIZ-043, VIZ-062); it draws at 60 fps with a frame-pacing governor and falls back to the 2D bars and ring without WebGL. Status: planned (not measured on a phone)
- NFR-024 SHOULD: the 2D visualizer ([visualizer.md](visualizer.md)) stays below about 8% CPU on a mid-range phone at 30 fps (Terrain draws at 60, VIZ-061): the loop runs only while enabled, playing, visible and on screen, DPR is capped at 2 and a frame governor lowers quality; reduced motion turns it off and the beat pulse is limited to 3 flashes per second (WCAG 2.3.1). Status: implemented (not measured)

## Scale and performance

- NFR-030 MUST: designed for a few hundred songs per user and tens of users; no database, a user's library is one JSON file loaded per request and returned whole by `GET /library` (~~one user~~, ADR-0012). Status: implemented
- NFR-031 SHOULD: revisit storage at tens of thousands of songs in total or hundreds of users (a git commit per write, one repo for all users). Status: planned
- NFR-032 MUST: the Library list renders the full filtered set client-side with lazy-loaded covers (no pagination). Status: implemented
- NFR-033 MUST: concurrent writes of one user are serialised by a per-user lock and the git cycle of all users by one global lock; read endpoints take the user lock briefly. Status: implemented

## Browsers and offline

- NFR-040 MUST: the web UI is plain HTML, CSS and ES modules, no build step, no framework; the only external scripts are Google Identity Services and the Apple JS SDK, loaded on Settings for sign-in (WEB-002); it targets current evergreen browsers incl. iOS Safari (uses `<dialog>`, ES modules, Media Session). Status: implemented
- NFR-041 MUST: the web UI is online only: no service worker, no offline audio storage, no audio cache; `localStorage` holds only UI state, queue and flags (`web/js/storage.js`) (a user-initiated "Download" is a plain browser file save to the device, WEB-034, not an offline cache) (so nothing authenticated outlives sign-out, API-024). Offline listening is an iOS-app feature. Status: implemented
- NFR-042 MUST: the layout works at phone width. Status: to-confirm (not verified in this pass)
- NFR-043 MUST: the iOS app (`ios/`, SwiftUI) uses the same API and plays downloaded songs offline; its requirements are in [ios.md](ios.md). Status: implemented

## Quotas, limits and privacy (ADR-0012)

- NFR-050 MUST: per-user limits, enforced before a download starts: `USER_MAX_SONGS` 500, `USER_MAX_BYTES` 5 GB (real file sizes), `USER_ADDS_PER_HOUR` 20, `USER_MAX_CONCURRENT_DOWNLOADS` 1; server-wide `GLOBAL_MAX_CONCURRENT_DOWNLOADS` 2 and `POOL_MAX_BYTES` 150 GB (audio under `music_root/users`). The owner is exempt from the per-user limits, not from the pool and global caps. Refusals and codes: API-041..045. Status: implemented
- NFR-051 MUST: `SIGNUP_OPEN=0` stops new accounts at once (existing users and the owner keep working). Status: implemented
- NFR-052 MUST: a user can read, change, stream and delete only their own songs, covers and job status; another user's id answers 404; the user id is never taken from the client (API-040, API-047). Status: implemented
- NFR-053 MUST: privacy: a user's email is stored only inside `audioplayer/users/<uid>/profile.json` of the private data repo (with provider, creation time and, for Apple, the opaque `sub`); it is never in a path, file name or commit message. Git history is permanent: deleting a user later does not erase the email from history. The operator (Alex) can read every user's library and profile. Status: implemented
- NFR-054 SHOULD: `/search`, `/preview` and `/lookup/wikipedia` are not limited per user (they use external services, not storage); add a limit if abused. Status: planned
- NFR-055 MUST: hourly counters live in memory; a restart relearns them from `added_at` of the current songs. Status: implemented
- NFR-056 MUST: audio fetches for songs already in the catalog (`POST /songs/{id}/audio`, API-060, used by the web "Auto-download songs" setting, PLY-110) count against `USER_ADDS_PER_HOUR` like any add, so auto-download cannot exceed the hourly quota; the owner is exempt. A metadata-only `POST /songs` (`audio:false`) records nothing (it is still refused when the hourly limit is already reached); only the audio fetch or an add with audio records, once per song. The client downloads one song at a time, polls with backoff (1 s, 2 s, 3 s, then 5 s) and on 429 pauses until `retry_after_minutes` has passed before trying again, so a long queue never hammers the server. Status: implemented
- NFR-071 MUST: JSON data files that hold per-user state (profile, `library.json`, the genre ontology and graph caches) are written crash-safely by `server/app/jsonio.write_json_atomic` (temp file in the same directory, fsync, rename), so a failed write leaves the old file intact; the temp file is created with mode 0600, so the resulting file is readable by the server user only. Status: implemented
- NFR-070 MUST: identification (API-070, API-071) is optional and off by default: it needs `ACOUSTID_API_KEY` plus `fpcalc` (Debian package `libchromaprint-tools`) for the fingerprint source and `DISCOGS_TOKEN` for Discogs; missing, it is skipped with one info line in the log and no error. Keys live only in the server env file (`/etc/audioplayer/env`, never in git, logs, responses or tests). Only a fingerprint leaves the server, never audio. Limits: `fpcalc` runs under `nice` with a 60 s timeout on the first 120 s of audio; AcoustID at most 2.5 requests/s; Discogs at most 50 requests/min across all users (8 s timeout, in-memory cache only, no stored dumps or images, per its terms); MusicBrainz keeps its 1 request per 1.1 s. An identification is not an add and does not count against `USER_ADDS_PER_HOUR`; each user sees only their own songs' results. Status: implemented

## Public guest view (ADR-0018)

- NFR-080 MUST: guest abuse is bounded per client IP in memory (reset by a restart): `GUEST_REQ_PER_MIN` 240, `GUEST_AUDIO_MB_PER_HOUR` 1024, `GUEST_MAX_STREAMS` 3; 429 `guest_limit` with `Retry-After` (API-093). The caps limit one visitor, not a crowd. Status: implemented
- NFR-081 MUST: privacy: guests get no email, uid, provider, quota data, server path or other user's data (API-091); the owner's profile stays private. The anonymous allow-list is fixed and tested (API-090). The guest song scrub (`guest.SONG_KEYS`) drops the top-level `file` name, and guest streaming returns 404 for a video id that is not in the owner's catalog (no `<video_id>.m4a` fallback). Status: implemented.
- NFR-082 MUST: kill switches: `PUBLIC_VIEW=0` (no anonymous access at all) and `PUBLIC_AUDIO=0` (metadata only); both take effect on restart (ADR-0018, [deploy.md](../tech/deploy.md)). Status: implemented
- NFR-083 SHOULD: watch the copyright, bandwidth and Cloudflare-terms exposure of public audio streaming (ADR-0018); turn `PUBLIC_AUDIO` off first. Status: planned

## Hostnames (ADR-0019)

- NFR-090 MUST: the app is hostname-agnostic: the web uses relative URLs and `location.origin`; no code embeds a hostname. `PUBLIC_HOSTS` (default any host), `CANONICAL_HOST` (default unset) and `OAUTH_REDIRECT_URIS` configure the migration to electrophone.cc. `web/js/signin-error.js` no longer names a host (the sign-in error text only names the current origin). Known gap: the iOS default server in `ios/Sources/Endpoints.swift` is hardcoded (a client default, low).
- NFR-091 MUST: with `CANONICAL_HOST` set, GET and HEAD on another host answer 308 to `https://<CANONICAL_HOST><path+query>`; `/health`, `/robots.txt`, `/legal` and non-GET/HEAD methods are never redirected. Unset: no redirect.
- NFR-092 MUST: absolute URLs (the Apple web redirect in `GET /auth/config`) come from `OAUTH_REDIRECT_URIS`, `APPLE_WEB_REDIRECT_URI`, or a Host listed in `PUBLIC_HOSTS`; a Host outside `PUBLIC_HOSTS` is replaced by the canonical or first public host. `X-Forwarded-Host` counts only from a loopback or LAN peer.
- NFR-093 MUST: the session cookie stays host-only (no `Domain`, `Secure`, `HttpOnly`, `SameSite=Strict`); a new host needs a new sign-in.
- NFR-094 MUST: the public site is not indexed: every response sends `X-Robots-Tag: noindex, nofollow, noarchive`, `GET /robots.txt` answers `User-agent: *` and `Disallow: /`, `index.html` has `<meta name="robots" content="noindex,nofollow">`; `/health`, `/robots.txt` and `/legal` are never redirected to the canonical host. Status: implemented
- NFR-095 MUST: a fixed copyright note ("A private personal library. All music and artwork belong to their authors and rights holders, who are credited on each song. Audio is streamed for private listening and cannot be downloaded. To have a song removed, contact the owner.") is shown in the guest view and in Settings; text in `server/app/legal.py`, not configurable; env `LEGAL_CONTACT` (optional email or https URL) turns the last sentence into a link. Status: implemented
- NFR-110 MUST: BPM backfill is gentle on the box: one job server-wide, songs one after another in a background thread at `nice` 10 (so its ffmpeg runs niced too) with `AUDIO_BACKFILL_SLEEP` seconds (default 0.2) between songs, 60 s per song, one library write per `AUDIO_BACKFILL_BATCH` songs (default 10). Status: implemented (real CPU and thermal effect on perkunas not measured)
- NFR-111 MUST: a save (add, edit, delete, tag) returns in under 1 s regardless of the GitHub round-trip time: the request writes atomically and commits locally, and never pulls or pushes (ADR-0026). Status: planned
- NFR-112 MUST: `audioplayer-gitsync.timer` runs `git push` every 60 s (`Persistent=true`) for each data repo with unpushed commits, without a lock and without a pull; a rejected push stops that repo, sets `error` and alerts, and nothing merges automatically; 5 consecutive push failures alert. Status: planned
- NFR-113 MUST: `GET /health` and the Settings sync card API return `sync: {state: ok|pending|stale|error, unpushed, oldest_unpushed_age_s, last_push_at}`: `pending` while the oldest unpushed commit is younger than the stale threshold, `stale` when older, threshold = timer interval + 30 s (default 90 s); the age is measured from that commit's time, so a server with nothing unpushed is `ok`. Guests get only `ok` or `degraded`, no counts or times. Status: planned
- NFR-114 MUST: only the `audioplayer` server user commits to the data repos (single writer); the data repos are not edited by hand or from another host. Status: planned
