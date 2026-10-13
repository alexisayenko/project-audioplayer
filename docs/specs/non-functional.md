# Non-functional requirements

ADRs: ADR-0003 (web), ADR-0004 (hosting), ADR-0001 (storage scale).

## Auth

- NFR-001 MUST: `AUDIO_API_TOKEN` is the owner's credential (dev/legacy); every other caller is a user who signed in with a verified Google or Apple identity (open signup, ADR-0012; token verification ADR-0006). ~~One shared secret, no user accounts, owner-only OAuth.~~ Status: implemented
- NFR-002 MUST: the web UI authenticates with the session cookie only and never stores or sends the API token (WEB-005); it deletes a leftover `localStorage` key `audioplayer.token` on load. Status: implemented
- NFR-003 MUST: without a session the UI routes to Settings, where Sign in with Google or Apple is the only way in. Status: implemented
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

- NFR-030 MUST: designed for a few hundred songs per user and tens of users; no database, a user's library is one JSON file loaded per request and returned whole by `GET /library` (~~one user~~, ADR-0012). Status: implemented
- NFR-031 SHOULD: revisit storage at tens of thousands of songs in total or hundreds of users (a git commit per write, one repo for all users). Status: planned
- NFR-032 MUST: the Library list renders the full filtered set client-side with lazy-loaded covers (no pagination). Status: implemented
- NFR-033 MUST: concurrent writes of one user are serialised by a per-user lock and the git cycle of all users by one global lock; read endpoints take the user lock briefly. Status: implemented

## Browsers and offline

- NFR-040 MUST: the web UI is plain HTML, CSS and ES modules, no build step, no framework; the only external scripts are Google Identity Services and the Apple JS SDK, loaded on Settings for sign-in (WEB-002); it targets current evergreen browsers incl. iOS Safari (uses `<dialog>`, ES modules, Media Session). Status: implemented
- NFR-041 MUST: the web UI is online only: no service worker, no offline storage, no audio cache (so nothing authenticated outlives sign-out, API-024). Offline listening is an iOS-app feature. Status: implemented
- NFR-042 MUST: the layout works at phone width. Status: to-confirm (not verified in this pass)
- NFR-043 MUST: the iOS app (`ios/`, SwiftUI) uses the same API and plays downloaded songs offline; its requirements are in [ios.md](ios.md). Status: implemented

## Quotas, limits and privacy (ADR-0012)

- NFR-050 MUST: per-user limits, enforced before a download starts: `USER_MAX_SONGS` 500, `USER_MAX_BYTES` 5 GB (real file sizes), `USER_ADDS_PER_HOUR` 20, `USER_MAX_CONCURRENT_DOWNLOADS` 1; server-wide `GLOBAL_MAX_CONCURRENT_DOWNLOADS` 2 and `POOL_MAX_BYTES` 150 GB (audio under `music_root/users`). The owner is exempt from the per-user limits, not from the pool and global caps. Refusals and codes: API-041..045. Status: implemented
- NFR-051 MUST: `SIGNUP_OPEN=0` stops new accounts at once (existing users and the owner keep working). Status: implemented
- NFR-052 MUST: a user can read, change, stream and delete only their own songs, covers and job status; another user's id answers 404; the user id is never taken from the client (API-040, API-047). Status: implemented
- NFR-053 MUST: privacy: a user's email is stored only inside `audioplayer/users/<uid>/profile.json` of the private data repo (with provider, creation time and, for Apple, the opaque `sub`); it is never in a path, file name or commit message. Git history is permanent: deleting a user later does not erase the email from history. The operator (Alex) can read every user's library and profile. Status: implemented
- NFR-054 SHOULD: `/search`, `/preview` and `/lookup/wikipedia` are not limited per user (they use external services, not storage); add a limit if abused. Status: planned
- NFR-055 MUST: hourly counters live in memory; a restart relearns them from `added_at` of the current songs. Status: implemented
