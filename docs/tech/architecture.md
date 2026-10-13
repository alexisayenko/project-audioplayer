# Architecture

Status: Accepted · 2026-10-12

```text
browser (web UI)  --same origin, session cookie or X-API-Token-->  server (FastAPI + yt-dlp)  -->  YouTube
iPhone (SwiftUI)  --http, Bearer ID token or X-API-Token-->  same server
  audio/<id>.m4a  <-- /files/<id> --  <music_root>/users/<uid>/<id>.m4a   (per user, ADR-0012)
  users/<uid>/{profile,library}.json + covers  <-- local clones of data-storage / data-storage-lfs (ADR-0005, ADR-0012)
```

## Why a server

iOS cannot run `yt-dlp`. The server extracts the audio; the app only
talks to it and plays local files. The web interface is built
first and served by FastAPI itself (same origin, no CORS) at
`play.isayenko.net`.

## Deployment

Runs as a systemd service in the existing `tools` LXC 106 (Debian 13,
`192.168.0.10`) on home server `perkunas`: no new LXC, no Docker, ~2
cores max (the CPU throttles at 100 C; the LXC also hosts Immich).
Public via the perkunas Cloudflare Tunnel: ingress
`play.isayenko.net` -> `http://192.168.0.10:<port>`; live at
`https://play.isayenko.net`. Audio sits on a ZFS dataset on pool-3
(e.g. `/data/music`, single disk, no redundancy) bind-mounted into the LXC.
See [`decisions.md`](decisions.md) (ADR-0001, ADR-0003, ADR-0004,
ADR-0005).

### Deploy

The service is `audioplayer.service`, running from `/opt/audioplayer`
inside LXC 106 `tools` (`192.168.0.10`). Deploy with:

```sh
ssh claude@192.168.0.10 'sudo /usr/local/sbin/audioplayer-deploy'
```

Or run `scripts/deploy.sh` (same command, then prints the deployed revision and the HTTP status of the web index). `scripts/check.sh` runs the web tests, the rule-ID check and the server tests first.

The script runs `git pull --ff-only`, `pip install`, restarts the
service and checks `/health`.

## Library storage (ADR-0005, implemented)

Layout since ADR-0012 (one library per user, `<uid>` = first 16 hex of
`sha256(lowercased email)`): data repo `audioplayer/users/<uid>/profile.json`
(email, provider, created_at: the only place an email is stored) and
`library.json`; LFS repo `audioplayer/users/<uid>/covers/<id>.jpg`; audio
`<music_root>/users/<uid>/<id>.m4a`. ~~`audioplayer/library.json`,
`audioplayer/covers/<id>.jpg`, `downloads/<id>.m4a`~~ (single-user layout; migrated
under the owner once on 2026-10-13, code removed).

Without `AUDIO_DATA_REPO` (dev/tests) the same `users/<uid>/...` tree is plain
files in `AUDIO_DATA_DIR`. Otherwise the server keeps its own clones of the private repos
`alexisayenko/data-storage` and `alexisayenko/data-storage-lfs` (Git LFS).
Reads come from the local clone. A write takes the user's lock, then the one
global git lock, runs `pull --rebase`, writes `library.json` atomically, commits
(`audioplayer: <uid8> add|edit|delete|bpm <id>`) and pushes. If the push fails the
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
| `GET /library`, `GET /catalog`, `GET /tags` | songs with tags; catalog with derived `audio_state`; tag counts |
| `GET /genres` | genre autocomplete list: the user's own genres, then built-ins |
| `POST /preview {url}` | yt-dlp metadata plus suggested genre/country tags, year, Wikipedia links (MusicBrainz, Wikidata) and `remixer` (the title comes back already cut of its remix bracket), no download |
| `POST /metadata` | album, year and `genre:`/`country:` tags from source links, MusicBrainz, the Wikipedia infobox and Wikidata, plus `suggest` (infobox artist and title hint) and per-service `services` for the Add form icons (API-048); response keys: album, year, tags, suggest, services |
| `POST /lookup/wikipedia` | suggested tags and year from user-edited Wikipedia links |
| `POST /songs`, `GET /songs/{id}/status` | add song: with `audio:true` (default) a background download, with `audio:false` a catalog-only entry (what the web sends); poll progress |
| `PATCH /songs/{id}`, `DELETE /songs/{id}`, `DELETE /songs/{id}/audio` | edit metadata/tags/bpm/remixer; remove record, audio, cover; remove only the audio |
| `POST /songs/{id}/bpm/detect` | re-detect BPM (aubio) from the stored m4a |
| `GET /covers/{video_id}` | cover jpg (`covers/<id>.jpg`) |
| `GET /` | web UI (`web/`, static, public) |

Full contract: [`../product/screens.md`](../product/screens.md).

All API routes except `/health` need either an OAuth ID token of any verified
user (`Authorization: Bearer`, see below; open signup, ADR-0012) or header
`X-API-Token` equal to `AUDIO_API_TOKEN` (the owner). Every route resolves to one
user and touches only that user's data. `/files/{id}` and `/covers/{id}` also accept
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

Then open `http://<host>:8000/`, sign in with Google or Apple (scripts send `X-API-Token`). Env:
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
suggestions), `wiki_lookup` (Wikipedia links, Wikidata facts, link validation), `titles` (title cut: channel prefix, remix to `remixer`, feat normalisation, lookup strings), `genre_filter` (deny-list and canonical genre tags), `genres` (built-in genre list for `GET /genres`), `metadata` (`POST /metadata`), `langcodes` (ISO 639 mapping, stored `lang:` tags only), `bpm` (aubio), `gitstore`
(git sync), `oauth`, `session`, `users`, `limits`, `jobs` (ADR-0006, ADR-0012).

## Web UI (`web/`)

Plain HTML, CSS and ES modules; no build step, no framework, no CDN.
`index.html` + `style.css` + `js/` (`api`, `store`, `dom`, `player`, `library`,
`queue-logic`, `tagname`, `tag-editor`, `wiki-links`, `url-clean`, `tag-input`, `song-form` (the one form of the Add and Edit dialogs), `song-payload`, `token-field` + `tokens` (Title, Artist and Remix token pills), `chip-field`, `chip-split`, `genre-suggest`, `genre-cell`, `metadata-apply`, `service-icons`, `track-sub`, `library-match`, `limits`, `add`, `edit-dialog`, `settings`, `app`; most have a `*.test.mjs`). Hash routes `#/library`,
`#/playback`, `#/settings` (a signed-out visitor is sent to `#/settings`) and `#/add` (opens Library with the Add dialog over it; `wantsAdd` in `web/js/app.js`); Add and Edit are dialogs. The web is catalog-only: it saves entries with `audio:false` and plays and deletes only audio already on the server (ADR-0010). One `<audio>` element drives the mini-player, the
Playback tab and the Media Session lock-screen controls. The web UI uses the session cookie only. Mounted by FastAPI at
`/` after all API routes, so it never shadows them.

## App (`ios/`)

SwiftUI, iOS 17, iPhone only, XcodeGen (`project.yml`). Three tabs, Library, Playback,
Settings; Add is a sheet from the Library header (ADR-0009, spec [`../specs/ios.md`](../specs/ios.md)).
Sources in `ios/Sources/`:

- `Views` (`AppTab`, tab shell, mini-player), `LibraryView`, `LibraryFilter`
  (category chips + filter sheet), `AddSheet` (+ `SearchView` as secondary text
  search), `SongEditView`, `PlaybackView`, `SettingsView`.
- `SongFormView` + `SongFormState` (the one song form of the Add sheet and `SongEditView`), `TokenField` + `Tokens` (token pills), `GenreSuggest`, `TagLogic`, `WikiLink`, `ServiceIcons`.
- `DesignTokens` (generated `DS.*`), `Components` — Electrophone look; see
  [`../ui-ux/style-guide.md`](../ui-ux/style-guide.md).
- `ServerLink` — server reachability, `ServerSong`, and downloads that outlive
  the Add sheet (progress shown on the Library row).
- `LibraryStore` — phone library, `Documents/library.json` and `Documents/audio/`.
- `APIClient` — preview, `POST /songs` + status polling, `/files`, PATCH,
  BPM detect, Wikipedia lookup, delete; auth header added per request.
- `AuthService`, `Keychain` — Sign in with Apple / Google (ADR-0006) and
  token storage.
- `PlayerService` — `AVPlayer`, `.playback` audio session, queue, shuffle and
  repeat, `MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`;
  `UIBackgroundModes: audio`.
- The server URL defaults to `https://play.isayenko.net`; Settings has sign-in only (a legacy-token Reset row shows only when a stale token is saved).

```sh
brew install xcodegen
cd ios && cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig  # fill in, git-ignored
xcodegen && open AudioPlayer.xcodeproj
```

### TestFlight

ADR-0008. App Store Connect record "Gramophone Offline" (now Electrophone) (bundle
`com.alexisayenko.audioplayer`, SKU `gramophone-ios`), internal group "Alex".

1. Raise `CURRENT_PROJECT_VERSION` in `ios/project.yml` above every build
   already uploaded (date-based; last uploaded 20261020, 2026-10-13, matches `ios/project.yml`), then `xcodegen`.
2. `xcodebuild archive` the `AudioPlayer` scheme (Release, generic iOS device).
3. `xcodebuild -exportArchive` with export options `method=app-store-connect`,
   `destination=upload`; it signs and uploads with the account signed in to
   Xcode (Settings > Accounts), cloud-managed signing, no API key.
4. Wait for processing in App Store Connect, add the build to the group.

Builds expire after 90 days; re-upload.

## Known gaps

- The iOS app is on TestFlight (build 20261020); its server flows (Add and download, edit with the shared form, sign-in, token-pill drag) are not yet tested on a device. The web token-pill drag and the shared form are tested by node unit tests, not in a real browser.
- iOS handling of the ADR-0012 `queued` job status is not done: [task-0016](../tasks/task-0016.md).
- Server covers are not stored on the phone: blank offline after a relaunch.
- `NSAllowsArbitraryLoads` is on in `project.yml`; the server is now HTTPS
  at `play.isayenko.net`, so it can be tightened.
- No CI workflows (SonarCloud analyses `main` itself); local `scripts/check.sh` and `scripts/deploy.sh` ([ci-cd.md](ci-cd.md)).
- Open signup for Google still needs the consent screen published (see below).

## OAuth sign-in and per-user storage

See ADR-0006 (verification) and ADR-0012 (open signup). The iOS app signs in with Apple (`SignInWithAppleButton`) or
Google (`ASWebAuthenticationSession`, code + PKCE) from Settings and sends
the ID token as `Authorization: Bearer`. `server/app/oauth.py` verifies it
(tries Google, then Apple: JWKS signature, `iss`, `aud`, `exp`, verified email) and admits any user;
the first sign-in creates the profile (`SIGNUP_OPEN=0` closes that).

Server env: `OWNER_EMAIL` (alias `ALLOWED_EMAIL`, default `alex.isayenko@gmail.com`;
the owner is exempt from quotas), `SIGNUP_OPEN` (default `1`),
`ALLOWED_APPLE_SUB` (an Apple `sub` that is the owner), `APPLE_AUDIENCE=com.alexisayenko.audioplayer`,
`GOOGLE_CLIENT_ID`. A provider without its audience set is rejected.

iOS setup (done): Sign in with Apple capability on the App ID
`com.alexisayenko.audioplayer` (entitlement is in `project.yml`); a Google
OAuth client of type iOS with that bundle id; copy
`ios/Config/Secrets.example.xcconfig` to `Secrets.xcconfig` and fill in the
client ID and its reversed form, then `xcodegen`.

Apple `sub`: sign in with Apple once in the app, decode the token payload
(`sub`) and put it in `ALLOWED_APPLE_SUB` so a hidden or relayed email still
maps to the owner. Other users with a relay email are ordinary users.

Google Cloud project `gramophone-offline` (external name, pre-rename): OAuth consent screen External in
Testing with the owner as the only test user, one OAuth client of type iOS. Open signup for strangers needs the consent screen published (In production) and the web OAuth client; until then only listed test users can sign in with Google.
A new client can take hours to start working. Values stay out of the repo.

## Limits and environment (ADR-0012)

Env (all optional): `USER_MAX_SONGS` (500), `USER_MAX_BYTES` (5 GB),
`USER_ADDS_PER_HOUR` (20), `USER_MAX_CONCURRENT_DOWNLOADS` (1),
`GLOBAL_MAX_CONCURRENT_DOWNLOADS` (2), `POOL_MAX_BYTES` (150 GB), `SIGNUP_OPEN` (1),
`OWNER_EMAIL`. Code: `server/app/limits.py` (checks), `jobs.py` (download
queue), `users.py` (identity, owner, locks). Details and error codes: [`../specs/api.md`](../specs/api.md)
API-040..047, [`../specs/non-functional.md`](../specs/non-functional.md) NFR-050..055.
