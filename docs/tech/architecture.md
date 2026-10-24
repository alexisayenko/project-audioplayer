# Architecture

Status: Accepted · 2026-10-12

```text
browser (web UI)  --same origin, session cookie or X-API-Token-->  server (FastAPI + yt-dlp)  -->  YouTube
iPhone (SwiftUI)  --http, Bearer ID token or X-API-Token-->  same server
  audio/<id>.m4a  <-- /files/<id> --  <music_root>/users/<uid>/<id>.m4a   (per user, ADR-0012)
  users/<uid>/{profile,library}.json + covers  <-- local clones of data-storage / data-storage-lfs (ADR-0005, ADR-0012)
  <music_root>/.plays/<uid>/play-history.csv   (listening history, outside git; copied daily into users/<uid>/, task-0056)
```

## Playback ownership: agreed target, not implemented (ADR-0043)

The current iOS `PlayerService` owns one `AVPlayer` and its queue; Library and
Song Details invoke it too. Library Play currently replaces the queue with
matching downloaded songs. The accepted target introduces a separate
single-song audition context, while the dock remains a view/controller of the
queue context; both audio outputs may be audible simultaneously.

Audition exposes only Play/Pause and is owned by the visible Library row or
Song Details view. Navigation, row visibility loss, details dismissal,
backgrounding, device locking and exit stop audition without stopping the
queue. The queue retains background/lock playback and offline operation;
there is no new playback server, remote queue or queue-sync requirement.
This is an ownership boundary inside the client, not a client/server split.

[ADR-0043](decisions.md#adr-0043-persistent-queue-and-ephemeral-visible-song-audition),
[requirements and open implementation choices](../specs/playback.md#two-independent-playback-contexts-adr-0043),
[task-0085](../tasks/task-0085.md). Code and platform audio lifecycle handling
are unchanged by this documentation; web/macOS parity is not implemented.

## Why a server

iOS cannot run `yt-dlp`. The server extracts the audio; the app only
talks to it and plays local files. The web interface is built
first and served by FastAPI itself (same origin, no CORS) at
`electrophone.cc`.

## Deployment

Runs as a systemd service in the existing `tools` LXC 106 (Debian 13,
`192.168.0.10`) on home server `perkunas`: no new LXC, no Docker, ~2
cores max (the CPU throttles at 100 C; the LXC also hosts Immich).
Public via the perkunas Cloudflare Tunnel: ingress
`electrophone.cc` -> `http://192.168.0.10:<port>`; live at
`https://electrophone.cc`. Audio sits on a ZFS dataset on pool-3
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

Full runbook (paths, backup, rollback, verification): [deploy.md](deploy.md). The script runs `git pull --ff-only`, `pip install`, restarts the
service and checks `/health`.

### Startup sequence (task-0071, CV1; built, not deployed)

`_startup` (`server/app/main.py`) does only the cheap checks (`legal.check_startup`, `genre_vocab.check`) and starts a background worker (`server/app/readiness.py`), so uvicorn accepts connections at once. The worker runs, in this order: git recovery (`deps.SYNC.recover_on_startup()`, when a data repo is configured), `migrate_model2`, `migrate_model3`, `migrate_tags`, `migrate_removals`, `migrate_renames`, `migrate_retired`, `migrate_version_norm`, `migrate_sources`, `features.record_startup`. The module-level `readiness` object (`idle` -> `starting` -> `ready` | `failed`, `overdue` after the cap) is thread-safe and holds the current step. An outermost ASGI middleware answers 503 `starting` for every request except the allow-list (`/health`, `/robots.txt`, `/legal`, the page and its static files), so no route touches user data while a migration rewrites it; `/health` reports `ready` and `startup`. A failing step is logged and skipped, a worker crash or the `AUDIO_STARTUP_MAX_S` cap releases the gate. Details: API-188, [deploy.md](deploy.md#restart).

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
(`audioplayer: <uid8> add|edit|delete|bpm <id>`, or `detect bpm for N songs` for the BPM backfill) and pushes. If the push fails the
local commit is kept, retried with backoff, and a warning is shown in
the UI; the write is never lost. Auth: one write deploy key per repo,
outside the repos (`~/.config/`, `chmod 600`). History is permanent, so
`library.json` holds no secrets or personal data. It carries
`settings.music_root` (`<servername>://<path>/`), resolved by the server
via a local name -> mount path/host config outside the repo; songs hold
relative audio file names only (replaces `AUDIO_DOWNLOAD_DIR`). Each save costs a push
(~1-2 s). The server never uses `C:\Alex\data-storage` on the PC.

Built, not deployed (ADR-0026, task-0021): data flow is clients -> server API -> files on disk; the server commits each save locally and never talks to GitHub inside a request, and a systemd timer (`audioplayer-gitsync`, every minute) only pushes (single writer; pull only at server startup). Web and iOS never talk to GitHub. The paragraph above describes the `GIT_SYNC_MODE=request` rollback path.

## Server (`server/`)

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | liveness + git `sync` state (`ok`/`degraded` for everyone, the full object with counts for the owner), no auth |
| `GET /search?q=&limit=` | `ytsearch` via yt-dlp, flat results |
| `POST /download {video_id}` | synchronous YouTube-only m4a fetch (`bestaudio[ext=m4a]`, fallback itag 140; no ffmpeg), under the download caps; returns metadata, does not touch the library |
| `GET /files/{video_id}` | stream the stored m4a |
| `GET /library`, `GET /catalog`, `GET /tags` | songs with tags; catalog with derived `audio_state`; tag counts |
| `GET /genres` | genre autocomplete list: the user's own genres, then built-ins |
| `GET /genres/graph` | the user's genre graph for the Genres map: nodes, parent and related edges, `ontology`, `pending` (API-080, ADR-0014); Wikidata is read by a background worker into `genre-ontology.json`, never during the request |
| `POST /preview {url}` | YouTube or SoundCloud link: yt-dlp metadata plus suggested genre/country tags, year, Wikipedia links (MusicBrainz, Wikidata) and `remixer` (the title comes back already cut of its remix bracket), no download |
| `POST /metadata` | album, year and `genre:`/`country:` tags from source links, MusicBrainz, the Wikipedia infobox and Wikidata, plus `suggest` (infobox artist and title hint) and per-service `services` for the Add form icons (API-048); response keys: album, year, tags, suggest, services |
| `POST /lookup/wikipedia` | suggested tags and year from user-edited Wikipedia links |
| `POST /songs`, `GET /songs/{id}/status` | add song: with `audio:true` (default) a background download, with `audio:false` a catalog-only entry (what the web sends); poll progress |
| `PATCH /songs/{id}`, `DELETE /songs/{id}`, `DELETE /songs/{id}/audio` | edit metadata/tags/bpm/remixer; remove record, audio, cover; remove only the audio |
| `POST /songs/{id}/audio` | fetch audio for a catalog song (auto-download, API-060): 202 `downloading`/`queued`, 200 `done` when the audio is already there; same hourly counter and storage caps as add |
| `GET /files/{id}?download=1` | the audio as a `Content-Disposition: attachment` file named `Artist - Title.m4a` (API-061); Range works |
| `POST /songs/{id}/bpm/detect` | re-detect BPM (aubio) from the stored m4a |
| `GET /songs/{id}/identify`, `POST /songs/{id}/identify` | audio identification suggestions (API-070, API-071, ADR-0013): the last result kept 24 h, or run it now (Chromaprint + AcoustID, Discogs, MusicBrainz, Wikidata); suggestions only, nothing is written |
| `GET /covers/{video_id}` | cover jpg (`covers/<id>.jpg`) |
| `GET /auth/config`, `POST /auth/session`, `POST /auth/logout`, `GET /auth/me` | web sign-in: public client ids; ID token to session cookie; clear cookie; current credentials |
| `GET /me`, `GET /me/usage` | profile (`email`, `provider`, `owner`, `created_at`); quota usage (`max_*` null for the owner) |
| `GET /me/backfill/bpm`, `POST /me/backfill/bpm`, `DELETE /me/backfill/bpm` | BPM detection for the user's songs without one: status, start (202; 409 if already running), cancel |
| `GET /legal`, `GET /robots.txt` | legal page and robots rules, public |
| `GET /`, `GET /_v/<version>/...` | web UI (`web/`, static, public): `index.html` with assets rewritten to a content-versioned URL and `modulepreload` hints for tier 1 and the tier-2 module list as JSON (API-051, WEB-119, WEB-121) |

Full contract: [`../specs/api.md`](../specs/api.md).

All API routes except `/health`, `/auth/config`, `/auth/session`, `/auth/logout` (the last two need only the CSRF header), `/legal` and `/robots.txt` need either an OAuth ID token of any verified
user (`Authorization: Bearer`, see below; open signup, ADR-0012) or header
`X-API-Token` equal to `AUDIO_API_TOKEN` (the owner). Anonymous guests may read `/library`, `/tags`, `/genres/graph`, `/catalog`, `/files`, `/covers` and `/me` through `deps.read_user` (ADR-0018, `guest.READ_PATHS`). Every route resolves to one
user and touches only that user's data. `/files/{id}` and `/covers/{id}` also accept
`?token=<token>` (the owner's `AUDIO_API_TOKEN` only), compared with `hmac.compare_digest`, since `<audio>`
and `<img>` cannot send headers; the token therefore can appear in URLs
and access logs, so keep logs private and use HTTPS. The static UI
files are served without auth.
The web UI signs in with Google or Apple (ID token to `POST /auth/session`,
then an HttpOnly `__Host-session` cookie, 30 days, renewed on any signed-in request; ADR-0006, API-020..024), so
its audio and cover URLs carry no token; cookie writes need `X-Requested-With`.
Video ids are validated against `^[A-Za-z0-9_-]{11}$` (blocks path
traversal and yt-dlp option injection).

System dependencies: `ffmpeg` on PATH (SoundCloud downloads are transcoded to m4a with it; BPM detection, ADR-0002, decodes m4a to PCM with it) and, because `aubio==0.4.9` has no wheel for current Python, a C
toolchain with Python headers to build it (Debian: `apt install ffmpeg
python3-dev build-essential`). With GCC 14 (Debian 13) the build needs
`CFLAGS="-Wno-error=incompatible-pointer-types" pip install -r requirements.txt`.
If ffmpeg or aubio is missing, BPM stays `null` and YouTube downloads still work (SoundCloud downloads need ffmpeg).

```sh
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest                                   # tests stub yt-dlp
AUDIO_API_TOKEN=$(openssl rand -hex 32) uvicorn app.main:app --host 0.0.0.0
pip install -U 'yt-dlp[default]'                    # run daily (cron); YouTube breaks it often
```

Then open `http://<host>:8000/`, sign in with Google or Apple (scripts send `X-API-Token`). Env:
`AUDIO_API_TOKEN` (required), `AUDIO_DOWNLOAD_DIR` (default `downloads`),
`AUDIO_DATA_DIR` (default `.`, plain-file `library.json` and `covers/` when
`AUDIO_DATA_REPO` is unset), `AUDIO_DATA_REPO` / `AUDIO_COVERS_REPO` /
`AUDIO_GIT_SSH_KEY` (git store, ADR-0005), `AUDIO_MUSIC_ROOT` /
`AUDIO_HOSTS` / `AUDIO_HOSTS_FILE` (audio location),
`AUDIO_WEB_DIR` (default `../web`), `AUDIO_SESSION_SECRET` (cookie signing key; else derived from `AUDIO_API_TOKEN`), `GOOGLE_WEB_CLIENT_ID` / `APPLE_WEB_CLIENT_ID` / `APPLE_WEB_REDIRECT_URI` (web sign-in, served by `/auth/config`; the two client ids are also accepted as token audiences), `AUDIO_TAG_LOOKUP` / `AUDIO_GENRE_LOOKUP` (default on, `0`
disables the outbound HTTPS tag and link lookups to `musicbrainz.org`, `wikidata.org`
and `*.wikipedia.org`), `AUDIO_MB_USER_AGENT` (default
`audioplayer/0.1 (alex.isayenko@gmail.com)`, sent to all three hosts; Wikimedia requires a descriptive one).
Optional identification (API-070): `ACOUSTID_API_KEY`, `ACOUSTID_MIN_SCORE` (default `0.9`), `AUDIO_FPCALC` (path of Chromaprint `fpcalc`, default `fpcalc`) and `DISCOGS_TOKEN`; each source is off while its credential or binary is missing.

Server modules (`server/app/`, structure: ADR-0017): `main` (builds the app: middleware, exception handlers, includes the routers), `routes/` (one `APIRouter` per area: `health`, `auth`, `me`, `legacy`, `files`, `catalog`, `genres`, `lookup`, `songs`, `analyze`, `removal`, `backfill`, `legal`, `playlists`; 14 routers), `playlists` (flat per-user playlists in `playlists.json`: validation, caps, the text export; `drafts` and `genre_layout` are the sibling per-user stores), `deps` (shared state, per-user paths, transactions, auth and quota dependencies; use `deps.X`, not `main.X`), `schemas` (request bodies), `links` (pasted links to song ids, short upstream error text), `downloads` (job bookkeeping, download workers, metadata-only add), `web` (index.html with versioned asset URLs, static mount; `AUDIO_WEB_DIR` read at call time), `ratelimit` (outbound lookup limiters), `httpjson` (one JSON-over-HTTP helper with User-Agent and timeout), `jsonio` (crash-safe JSON writes), `safepath` (paths that cannot leave their base), `tags` (`namespace:value` helpers), `timeutil` (UTC timestamp format), `library` (records, derived `decade:` tags,
tag normalisation), `extractor` (yt-dlp), `genre_lookup` (MusicBrainz
suggestions), `acoustid_lookup` (fpcalc + AcoustID), `discogs_lookup` (Discogs genres, year), `identify` (merge and 24 h cache), `wiki_lookup` (Wikipedia links, Wikidata facts, link validation), `titles` (title cut: channel prefix, remix to `remixer`, feat normalisation, lookup strings), `genre_filter` (deny-list and canonical genre tags), `genres` (built-in genre list for `GET /genres`), `genre_graph` (Wikidata ontology cache and the user's genre graph, `data/discogs-families.json`), `titleclean` (promo-noise cleaning, same rules as `web/js/title-clean.js`), `countrycodes` (canonical ISO 3166-1 countries and the historical `su`), `metadata` (`POST /metadata`), `langcodes` (ISO 639 mapping, stored `lang:` tags only), `bpm` (aubio), `urlclean` (link cleaning, SoundCloud and catalog-id classification), `gitstore`
(git sync), `oauth`, `session`, `users`, `limits`, `jobs`, `problems` (coded refusals), `guest` (anonymous read-only allow-list, ADR-0018), `hosts` (`PUBLIC_HOSTS`, `CANONICAL_HOST`, `OAUTH_REDIRECT_URIS`), `session` (cookie signing), `legal` (`/legal`, `/robots.txt`), `limits` (per-user quotas), `backfill` (BPM detection for a user's songs) (ADR-0006, ADR-0012).

## Web UI (`web/`)

Plain HTML, CSS and ES modules; no build step, no framework, no CDN.
`index.html` + `style.css` + `js/` (`api`, `store`, `dom`, `player`, `library`,
`queue-logic`, `tagname`, `tag-editor`, `wiki-links`, `url-clean`, `tag-input`, `song-form` (the one form of the Add and Edit dialogs), `song-payload`, `token-field` (pills) + `tokens` (the shared pill tokenizer, ADR-0015), `title-clean` (promo-noise cleaning), `bpm-label`, `countries` + `countries-data` (canonical country picker), `edit-dialog`, `menu`, `playable`, `reveal` (Show in list), `row-actions`, `sidebar-state` (collapsible rail), `autodl` + `dl-queue` + `dl-progress` + `dl-ring` (auto-download queue, live progress), `identify-block` + `identify-plan` (Identify from audio), `genres` + `genre-data` + `genre-view` + `genre-graph` + `genre-sim` (Genres map: data, outline, canvas, force simulation), `icons`, `scrub` + `scrubber` (draggable seek bars), `chip-field`, `chip-split`, `genre-suggest`, `genre-cell`, `metadata-apply`, `service-icons`, `track-sub`, `library-match`, `limits`, `add`, `settings`, `app`, `download` (file download of a song), `storage` (safe `localStorage` wrapper) and `constants` (breakpoints, timings), `player-ui` (DOM helpers, queue rows) + `player-media` (Media Session, volume) + `player-tag-picker` (tag picker) + `side-mini` (sidebar mini-player and rail play button), all split out of `player`, `library-data` (filter and sort state) + `library-rows` (row rendering) + `library-toolbar` (filter sheet), split out of `library`, `song-form-title` + `song-form-bpm` (Title and BPM parts of `song-form`), `token-drag` (drag-reorder of pills), `row-cover` (play/pause cover buttons of Library rows, Playback, the mini-player and the Now playing list), the audio visualizer (`audio-graph`, `viz-*`: 2D bars and ring, WebGL Terrain with its lookahead timeline Worker, Camera flight, frame pacing, style and camera panels; module list in [WEB-064](../specs/web.md), rules in [visualizer.md](../specs/visualizer.md)) and the share link (`share` pure URL build and parse, `share-ui` dialog, `share-open` opening a link, [share.md](../specs/share.md)); `test-dom.mjs` is the DOM shim for the UI tests; most have a `*.test.mjs`). Hash routes `#/library`,
`#/playback`, `#/play/<songId>?v=1&...` (a share link; opens Playback, [share.md](../specs/share.md)), `#/genres` (Genres map, [genres.md](../specs/genres.md)), `#/stats` (Statistics), `#/settings` (a signed-out visitor is sent to `#/settings`) and `#/add` (opens Library with the Add dialog over it; `wantsAdd` in `web/js/app.js`); Add and Edit are dialogs. The web is catalog-only: it saves entries with `audio:false` and plays and deletes only audio already on the server (ADR-0010). One `<audio>` element drives the mini-player, the
Playback tab and the Media Session lock-screen controls. The web UI uses the session cookie only. Mounted by FastAPI at
`/` after all API routes, so it never shadows them.

**Web loading (no build step).** `GET /` is generated from the files: `server/app/web.py` walks the import graph from `js/app.js`. Tier 1 is its static closure (about 56 modules): `index.html` preloads exactly those with `modulepreload`, and they paint the Library list and the shell. Everything a click needs but the first paint does not (song card, Add/Edit and the song form, share, tag picker, filter sheet, Drafts, the routes, the visualizer) sits behind a dynamic `import()`, mostly through `web/js/lazy-ui.js` (a pending note next to the control, an inline error). Tier 2 is every module reachable only through those `import()` calls (about 123): `GET /` lists them in `<script type="application/json" id="tier2-modules">` and `web/js/prefetch.js` warms them with runtime `modulepreload` links, 6 at a time in idle slots, after the first rows, `load` and the first 12 covers, never on data saver or 2g. Both lists come from the graph, so a new import cannot leave them stale; `server/tests/test_web_preload.py` guards the split. Specs: WEB-117..WEB-122.

## App (`ios/`)

SwiftUI, iOS 17, iPhone only, XcodeGen (`project.yml`). Five destinations in a left drawer, Library, Now playing,
Playlists, Statistics, Settings; Add is a sheet from the Library header (ADR-0009, spec [`../specs/ios.md`](../specs/ios.md)).
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
  BPM detect, delete; auth header added per request.
- `AuthService`, `Keychain` — Sign in with Apple / Google (ADR-0006) and
  token storage.
- `PlayerService` — `AVPlayer`, `.playback` audio session, queue, shuffle and
  repeat, `MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`;
  `UIBackgroundModes: audio`.
- The server URL defaults to `https://electrophone.cc`; Settings has cards Account (Apple/Google sign-in), Downloads (read-only quality, auto-download and mobile-data switches; a "Custom server · Reset" row only for a non-default server or a stale token) and Storage, then the version line; no server or token field.

```sh
brew install xcodegen
cd ios && cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig  # fill in, git-ignored
xcodegen && open AudioPlayer.xcodeproj
```

### TestFlight

ADR-0008. App Store Connect record "Gramophone Offline" (now Electrophone) (bundle
`com.alexisayenko.audioplayer`, SKU `gramophone-ios`), internal group "Alex".

1. Raise `CURRENT_PROJECT_VERSION` in `ios/project.yml` above every build
   already uploaded (date-based; last uploaded 20261031, 2026-10-23, matches `ios/project.yml`), then `xcodegen`.
2. `xcodebuild archive` the `AudioPlayer` scheme (Release, generic iOS device).
3. `xcodebuild -exportArchive` with export options `method=app-store-connect`,
   `destination=upload`; it signs and uploads with the account signed in to
   Xcode (Settings > Accounts), cloud-managed signing, no API key.
4. Wait for processing in App Store Connect, add the build to the group.

Builds expire after 90 days; re-upload.

## Known gaps

- The iOS app is on TestFlight (build 20261031 uploaded 2026-10-23; Apple processing); its server flows (Add and download, edit with the shared form, sign-in, token-pill drag) are not yet tested on a device. The web token-pill drag and the shared form are tested by node unit tests, not in a real browser.
- iOS handling of the ADR-0012 `queued` job status is not done: [task-0016](../tasks/task-0016.md).
- Server covers are kept offline on the phone since build 20261026 (not yet checked on a device).
- `NSAllowsArbitraryLoads` is on in `project.yml`; the server is now HTTPS
  at `electrophone.cc`, so it can be tightened.
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
`ALLOWED_APPLE_SUB` (an Apple `sub` that is the owner), `APPLE_AUDIENCE=com.alexisayenko.audioplayer,com.alexisayenko.audioplayer.mac`,
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

## Anonymous temp staging (ADR-0042)

Signed-out devices get a song through `/anon/*` without an account: the job runs on the same download scheduler, the audio lands in `<music_root>/.anon/<job-id>/` (outside `users/`, outside git, not in the pool), the phone fetches it with Range and confirms with the SHA-256, and the server deletes it at once (else a sweeper after 1 h; failed or queued jobs after 15 min; the folder is emptied on start). Job state is in memory; the device is a signed token, never a uid and never a library. Env and limits: [deploy.md](deploy.md#anonymous-downloads), API-207..215.

## Listening history storage (task-0056)

The play history is the one per-user file that is NOT written through git on every change: a play must never cost a commit. The live file is `play-history.csv` at `$AUDIO_PLAYS_DIR/<uid>/` (default `<music root>/.plays/<uid>/`, beside the audio pool and `.peaks/`, so it is a directory the service user already writes), with `batch-keys.json` (last 200 batch keys) next to it and `.last-sync` (time of the last copy) in the root. Once a day a background thread (`AUDIO_PLAYS_SYNC=0` turns it off) copies changed files to `users/<uid>/play-history.csv` in the data repo, one commit `sync listening history`. The outside directory is the source of truth and must be part of the audio dataset backups; the in-repo copy is only a snapshot up to a day old. Contract: API-196 to API-198 in [api.md](../specs/api.md).
