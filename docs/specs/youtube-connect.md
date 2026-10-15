# Connect YouTube

Planned (task-0032). Import the signed-in user's YouTube playlists and Liked videos into the catalog as songs without audio. Decision: ADR-0020 (accepted). Nothing here is built.

Code (planned): `server/app/routes/yt.py`, `server/app/ytauth.py`, `server/app/ytimport.py`, `web/js/youtube-connect.js`.

## Flow

1. Settings > "YouTube" card > Connect. The browser goes to `GET /yt/connect`, then to Google's consent page, then back to `https://electrophone.cc/yt/callback`.
2. The page lists the user's playlists plus "Liked videos" as a checklist; the user ticks the lists and presses Import.
3. The server fetches the videos, creates catalog songs (metadata only, no audio) and the page shows progress, then a summary (added, skipped, duplicates).

## Scope and limits

- Only the official YouTube Data API v3 is used (scope `youtube.readonly`). The YouTube Music private library is not reachable: only playlists and Liked videos (virtual playlist `LL`) are.
- Quota: about 1 unit per API call of 10,000 units a day for the project; one import of N videos costs about N/50 calls (`playlistItems.list`, 50 per page) plus one `videos.list` per 50.

## Requirements

CW, CX and CY are decided (Alex, 2026-10-16; task-0032); phase 3 (all users, Google verification) stays future.

- YTC-001 MUST: Settings has a "YouTube" card for signed-in users with a Connect button; when connected it shows the connection state, Import and Disconnect. Guests and signed-out visitors do not see it and every `/yt/*` route answers 401 for them. Status: planned
- YTC-002 MUST: phase 1 is owner-only (CW, decided 2026-10-16): `/yt/*` answers 403 `yt_not_available` for any user who is not the owner, and the card is hidden for them. Opening it to all users needs Google verification of the `youtube.readonly` scope (phase 3). Status: planned
- YTC-003 MUST: `GET /yt/connect` (authenticated) redirects (302) to Google's OAuth endpoint with scope `https://www.googleapis.com/auth/youtube.readonly`, `access_type=offline`, `include_granted_scopes=true`, `prompt=consent`, `response_type=code`, the redirect URI `https://electrophone.cc/yt/callback` and a signed `state`. Status: planned
- YTC-004 MUST: `state` is signed with `AUDIO_SESSION_SECRET` (HMAC), carries the uid, a random nonce and an expiry of 10 minutes, and is also set as a short-lived `HttpOnly`, `Secure`, `SameSite=Lax` cookie; `GET /yt/callback` accepts the code only when the state signature, expiry, uid and cookie all match (CSRF), else 400 `bad_state`. Status: planned
- YTC-005 MUST: `GET /yt/callback` exchanges the code for tokens, stores the refresh token (YTC-020), then redirects to `/#/settings` with `?yt=connected`; a Google error (`error=access_denied`) redirects with `?yt=denied` and stores nothing. Status: planned
- YTC-006 MUST: `GET /yt/status` answers `{connected: bool, can_connect: bool}`; it never includes a token. `can_connect` is false for non-owners in phase 1. Status: planned
- YTC-007 MUST: `GET /yt/playlists` answers the user's playlists `[{id, title, count, thumbnail}]` (`playlists.list?mine=true`, paged) plus the virtual `{id:"LL", title:"Liked videos"}` first; 409 `yt_not_connected` when no token; 401 `yt_reauth` when Google rejects the refresh token (the stored token is then deleted and the card shows Connect). Status: planned
- YTC-008 MUST: the web shows the lists as a checklist (checkbox, title, video count) with Select all and an Import button disabled while nothing is ticked. Status: planned
- YTC-010 MUST: `POST /yt/import` takes `{playlist_ids:[...]}` and starts one background job per user (a second start while one runs answers 409 `yt_import_running`); it answers 202 `{job_id}`; `GET /yt/import/{job_id}` answers `{state: queued|running|done|error, total, done, added, skipped, duplicates, limited}` for polling. Status: planned
- YTC-011 MUST: each video becomes a catalog song with `audio_state: none`: `title` and `artist` from the video title and channel through the existing cleaning (`titles.split_artist_title`, including the Topic channel rule "Artist - Topic" giving the artist, ADD-002), `cover` from `https://i.ytimg.com/vi/<id>/hqdefault.jpg` stored as the cover URL only (no download of the image during import), `source_url` and `sources[]` the `https://www.youtube.com/watch?v=<id>` link. No audio is fetched, nothing is added to the download queue. Status: planned
- YTC-012 MUST: duplicates are detected on the YouTube video id against the user's library (song `id`, `sources[]`, including songs added through other paths); a duplicate is counted in `duplicates` and left unchanged; the same video in two ticked lists is added once. Status: planned
- YTC-013 MUST: private, deleted and region-blocked videos (placeholders "Private video" / "Deleted video", or missing from `videos.list`) are skipped and counted in `skipped`. Status: planned
- YTC-014 MUST: the 500-song cap (`USER_MAX_SONGS`) is respected: the import stops adding when the library reaches it, the remaining videos are counted in `skipped`, `limited` is `"library_full_songs"` and the summary says so. The owner is exempt from the per-user caps (API-041) and so is not stopped at 500. Status: planned
- YTC-015 MUST: a metadata-only import does not count toward the hourly add limit (`USER_ADDS_PER_HOUR`, API-041): it is a catalog write, like `audio:false` (API-043); instead one import job per user at a time and at most 6 imports per hour (429 `yt_import_rate`), and the songs are written in batches of 50 in one git transaction per batch, not one per song. Status: planned
- YTC-016 MUST: the page shows progress (done / total) while the job runs, then a summary "Added N, skipped M, duplicates K" (and the cap note when `limited`); closing the page does not stop the job. Status: planned
- YTC-017 MUST: songs imported get a tag-free record (no `genre:` or `country:` guesses); the user enriches them through "Get metadata" or "Identify from audio" later. Status: planned
- YTC-020 MUST: the refresh token is stored per user, encrypted with Fernet (key derived from `AUDIO_SESSION_SECRET` with HKDF, a fixed info string), in `/var/lib/audioplayer/secrets/<uid>.json`, directory `0700`, file `0600`, written atomically. This path is outside the git-synced data dir and outside the music root; the token is never written to a library, backup or log. Status: planned
- YTC-021 MUST: tokens, codes, the client secret and any Google response body that contains them are never logged, never returned to the browser, never put in an error message or a URL; the access token lives only in memory for its lifetime. Status: planned
- YTC-022 MUST: the OAuth client is a new Google "Web application" client; `GOOGLE_YT_CLIENT_ID` and `GOOGLE_YT_CLIENT_SECRET` are read from `/etc/audioplayer/env` (mode 600); when either is unset `GET /yt/status` answers `can_connect: false` and the card shows "Not configured". This client is separate from `GOOGLE_WEB_CLIENT_ID` (sign-in). Status: planned
- YTC-023 MUST: `DELETE /yt/connect` revokes the token at `https://oauth2.googleapis.com/revoke`, deletes the secret file and answers 204 (idempotent); the file is deleted even if the revoke call fails (the response then carries `revoked:false`). Songs already imported stay. Status: planned
- YTC-024 MUST: deleting the user's account data or library (if ever offered) also deletes the secret file. Status: planned
- YTC-025 MUST: a consent screen in "Production, unverified" mode (CX, decided 2026-10-16) gives refresh tokens that do not expire after 7 days, with a cap of 100 users and an "unverified app" warning page on the first consent; "Testing" mode is not used because it expires the refresh token after 7 days. Status: planned
- YTC-030 SHOULD: after an import the user may keep each imported list as an Electrophone playlist (phase 2; CY, decided 2026-10-16): the server stores `{playlist_id, title, video_ids[], imported_at}` per user and the card shows "Refresh" for each, which imports only the difference (new videos; removed videos are not deleted from the library). Playlist storage and Refresh are owned by [Playlists](playlists.md) (PLS-042, PLS-040, ADR-0022); this requirement only says YTC imports create them. Status: planned
- YTC-031 SHOULD: "Refresh" counts as an import for YTC-015 and shows the same progress and summary. Status: planned
- YTC-040 MUST: Google API failures map to short errors: 403 `quotaExceeded` to 503 `yt_quota` (message "YouTube quota used up for today, try tomorrow"), 5xx or timeouts to 502 `yt_upstream` after 2 retries with backoff; an import that fails midway keeps the songs already written. Status: planned
- YTC-041 MUST: outgoing calls use a 10 s timeout, a fixed `User-Agent`, and only the hosts `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com`; the Google endpoints are configurable by env (`GOOGLE_OAUTH_BASE`, `YT_API_BASE`) so tests can use a fake server. Status: planned
- YTC-050 MUST NOT: the iOS app does not offer Connect YouTube before phase 3; the iOS app only sees the imported songs through `GET /catalog` like any catalog entry. Status: planned
- YTC-051 MUST: every item carries its duration. `playlistItems.list` gives none, so after each page the server calls `videos.list?part=contentDetails&id=<up to 50 ids>` (1 quota unit per call, already counted in Scope and limits) and parses the ISO-8601 `duration` (`PT1H2M10S`) to seconds; imported songs store `duration`. Live streams, premieres and videos with a missing or zero duration have unknown duration and count as long. Status: planned
- YTC-052 MUST: items longer than the cap `LONG_SONG_SECONDS` (default 300 s = 5 minutes, one constant shared with ADD-081, owner-configurable later) are marked 'Long (1:02:10)' in the selection list and are UNCHECKED by default; short items are checked. Status: planned
- YTC-053 MUST: a long video is never imported silently: the confirm step before Import states how many long items are selected and asks 'Import N long videos anyway?' with a per-item checkbox and an 'Include all long videos' toggle; unconfirmed long items are not imported and are counted in `skipped`. Status: planned
