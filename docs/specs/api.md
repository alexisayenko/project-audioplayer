# API

Code: `server/app/main.py`. Same origin as the web UI; JSON bodies; errors
are `{"detail": "<message>"}`.

## Auth

- API-001 MUST: every route except `GET /health` and the static UI requires header `X-API-Token` equal to env `AUDIO_API_TOKEN` (compared with `hmac.compare_digest`) or an owner OAuth ID token (API-007). Status: implemented
- API-002 MUST: `GET /files/{id}` and `GET /covers/{id}` also accept `?token=<token>` (the header wins when both are sent), because `<audio>` and `<img>` cannot send headers. Status: implemented
- API-003 MUST: wrong or missing token gives 401 `bad token`; `AUDIO_API_TOKEN` unset gives 503 `AUDIO_API_TOKEN is not set` (the API is closed, never open). Status: implemented
- API-004 MUST: static files at `/` are public, carry no data, and are served with `Cache-Control: no-cache`; API routes are registered first and are never shadowed. Status: implemented
- API-005 MUST: `{id}` path params must match `^[A-Za-z0-9_-]{11}$` (YouTube) or `^soundcloud-[0-9]{1,20}$` (SoundCloud), else 422 `invalid video id` (blocks path traversal and yt-dlp option injection). Status: implemented
- API-007 MUST: `Authorization: Bearer <ID token>` from Sign in with Apple or Google is accepted on every authenticated route, including `GET /files/{id}` and `GET /covers/{id}`. The server checks the RS256 signature against the provider JWKS (cached), `iss`, `aud` (`APPLE_AUDIENCE` / `GOOGLE_CLIENT_ID`, each a comma-separated list; `APPLE_WEB_CLIENT_ID` and `GOOGLE_WEB_CLIENT_ID` count too) and `exp`, and allows only a verified `email` equal to `ALLOWED_EMAIL` (default `alex.isayenko@gmail.com`) or an Apple `sub` in `ALLOWED_APPLE_SUB`. Invalid or expired token gives 401 `bad token`; a valid token of anyone else gives 403 `not the owner`. If `X-API-Token` is also sent it decides. Status: implemented
- API-008 MUST: a valid session cookie `__Host-session` (API-020) authenticates every route that accepts a header token, including `GET /files/{id}` and `GET /covers/{id}`, so no token is needed in a URL. Order: `X-API-Token`, then Bearer ID token, then cookie, then `?token=` (files and covers only). Status: implemented
- API-009 MUST: `GET`, `HEAD` and `OPTIONS` need nothing more; a cookie-authenticated `POST`, `PATCH` or `DELETE` needs header `X-Requested-With: audioplayer` and, when `Origin` is sent, an `Origin` host equal to `Host`, else 403 `missing or foreign CSRF header`. Header-authenticated requests are exempt. Status: implemented
- API-006 SHOULD: use HTTPS and keep logs private, since `?token=` appears in URLs. Status: implemented (via Cloudflare Tunnel once deployed; see [non-functional.md](non-functional.md))

## Web session

- API-020 MUST: `POST /auth/session` `{id_token}` verifies the ID token exactly as API-007, then answers 200 `{email, provider}` and sets cookie `__Host-session` (`HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`), a payload `{provider, email, exp}` signed with HMAC-SHA256. The key is env `AUDIO_SESSION_SECRET`, else derived from `AUDIO_API_TOKEN`; neither set gives 503. Errors: 401 `bad token`, 403 `not the owner`, 403 CSRF (API-009 applies). Status: implemented (not yet tested live with Google or Apple)
- API-021 MUST: `POST /auth/logout` deletes the cookie and answers 204 (CSRF header required). Sessions are stateless: a stolen cookie stays valid until it expires or the secret changes. Status: implemented
- API-022 MUST: `GET /auth/config` is public and returns `{google_client_id, apple_client_id, apple_redirect}` from `GOOGLE_WEB_CLIENT_ID`, `APPLE_WEB_CLIENT_ID` and `APPLE_WEB_REDIRECT_URI` (default `https://<Host>/`); empty string when unset. Client ids are not secrets. Status: implemented
- API-023 MUST: `GET /auth/me` returns `{method:"session"|"bearer"|"token", email}` for the current credentials, else 401. Status: implemented
- API-024 MUST: API responses carry `Cache-Control: no-store`; `/files` and `/covers` carry `private, no-cache`; static files `no-cache`. Status: implemented

## Endpoints

| Method and path | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /health` | none | - | 200 `{status:"ok", sync:"ok"\|"pending"\|"error"}` | - |
| `GET /library` | header | - | 200 `{songs:[song]}` | 401/503 |
| `GET /tags` | header | - | 200 `[{tag,count}]` | 401/503 |
| `POST /preview` | header | `{url}` | 200 `{id, source, source_url, title, artist, album, year, tags, duration, thumbnail, in_library, wikipedia_song, wikipedia_artist, suggested_year}` (links and `suggested_year` are `null` when unknown; `year` is filled from `suggested_year` only when yt-dlp gave none) | 422 `{error:"unsupported"\|"preview_only", detail}`; 403 `{error:"private"}`; 404 `{error:"not_found"}`; 502 `preview failed: <short>` |
| `POST /lookup/wikipedia` | header | `{wikipedia_song?, wikipedia_artist?}` (user-edited links) | 200 `{tags:[...], year:int\|null}` suggestions from Wikidata, never applied server-side; empty on invalid links, lookup off or any failure | 401/503 |
| `POST /songs` | header | `{url, metadata:{title,artist,album,year,bpm,wikipedia_song,wikipedia_artist}, tags:[]}` | 202 `{id, status:"downloading"}` | 422 bad URL, `unsupported` / `preview_only` (same bodies as preview) or field range; 409 `already in library` / `already downloading` |
| `GET /songs/{id}/status` | header | - | 200 `{id, status:"downloading"\|"done"\|"error", progress:0..1, error}` | 404 `unknown song` |
| `PATCH /songs/{id}` | header | any of `title, artist, album, year, bpm (integer; fractions rounded), tags, wikipedia_song, wikipedia_artist` (invalid links become `null`) | 200 the updated song | 404 `unknown song`; 422 `title must not be empty` or field range |
| `POST /songs/{id}/bpm/detect` | header | - | 200 the updated song | 404 `unknown song` / `not downloaded`; 422 `could not detect BPM`; 503 music_root server not configured |
| `DELETE /songs/{id}` | header | - | 204 | 404 `unknown song` |
| `GET /files/{id}` | header, cookie or `?token=` | - | 200 audio (`audio/mp4`, Range supported via `FileResponse`) | 404 `not downloaded`; 503 music_root server not configured |
| `GET /covers/{id}` | header, cookie or `?token=` | - | 200 `image/jpeg` | 404 `no cover` |
| `GET /search?q=&limit=` | header | `q` min 1 char, `limit` 1..25 (default 10) | 200 `[{id,title,artist,duration,thumbnail}]` | 422 |
| `POST /download` | header | `{video_id}` | 200 metadata plus `file_url` (synchronous download to `AUDIO_DOWNLOAD_DIR`, does not touch the library) | 422 invalid id; 502 `download failed: ...` |
| `GET /auth/config` | none | - | 200 `{google_client_id, apple_client_id, apple_redirect}` | - |
| `POST /auth/session` | CSRF header | `{id_token}` | 200 `{email, provider}` + cookie | 401, 403, 503 |
| `POST /auth/logout` | CSRF header | - | 204, cookie deleted | 403 |
| `GET /auth/me` | any | - | 200 `{method, email}` | 401 |
| `GET /` and static | none | - | web UI | - |

- API-010 MUST: `POST /songs` returns 202 immediately and downloads in the background; the song is written to `library.json` only when the download succeeds. Status: implemented
- API-011 MUST: `POST /songs` accepts any YouTube watch, `youtu.be`, shorts, embed, live or `music.` URL, or a bare 11-char id, and a SoundCloud track link (`soundcloud.com/<artist>/<track>`, private `/s-<secret>`, `on.soundcloud.com/<code>`). Status: implemented
- API-012 MUST: `GET /songs/{id}/status` answers from the in-memory job first, else `done` if the song is in the library, else 404. Status: implemented
- API-013 MUST: job state is in memory; a server restart forgets in-flight jobs and past errors. Status: implemented
- API-014 MUST: a failed job (`status:"error"`, message with yt-dlp noise stripped, max 300 chars) can be retried with a new `POST /songs`. Status: implemented
- API-015 MUST: `PATCH` applies only the keys sent; `title`/`artist`/`album` are trimmed (empty becomes `null`, empty title is 422); `tags` is normalised; `tags: null` is ignored. Status: implemented
- API-016 MUST: `DELETE` removes the record, the cover and the audio file, and drops the job entry. Status: implemented
- API-017 MUST: every write endpoint (`POST /songs` job, PATCH, DELETE, bpm/detect) runs under the single-writer lock and, with the git store, commits `audioplayer: add|edit|delete|bpm <id>`. Status: implemented
- API-025 MUST: song ids are `^[A-Za-z0-9_-]{11}$` (YouTube) or `soundcloud-<numeric track id>` (SoundCloud, always longer than 11 characters, so no collision); `source_of(id)` gives `youtube`/`soundcloud`; `POST /download` stays YouTube-only. Status: implemented
- API-026 MUST: refusals of `POST /preview` and `POST /songs` for links are JSON `{"error": <code>, "detail": <message>}` with codes `unsupported` (422), `preview_only` (422), `not_found` (404), `private` (403), `failed` (502); clients show `detail`. Status: implemented
- API-018 SHOULD: keep `/search` and `/download` only for the iOS secondary text search (IOS-023); the web UI does not use them. `/download` bypasses the library and tags, so the row download should be replaced by the preview flow. Status: to-confirm
- API-019 MUST: `/health` reports `sync` as `ok` whenever no git store is configured. Status: implemented
