# Decisions

Tech decisions, newest last. Supersede by strikethrough and a new entry
below, never by deleting.

## ADR-0001 Components, server, hosting, storage

Status: Accepted · 2026-10-12

### Components

| Component | Status | Home |
| --- | --- | --- |
| iOS app | built | `ios/` |
| Download server (FastAPI + yt-dlp) | built | `server/` |
| Web interface | built | `web/`, served by FastAPI (ADR-0003) |
| Data storage | git repos (ADR-0005); plain files only when `AUDIO_DATA_REPO` is unset | `server/app/library.py` |

### Backend server is required

The phone cannot run yt-dlp. The app calls the server for `/preview`,
`/songs`, `/library`, `/files` and the other library endpoints (~~`/search`,
`/download` only~~: that was the scaffold; see ADR-0007). ~~The server runs on an always-on machine (e.g.
`alex-hetzner`).~~ Superseded by ADR-0004: it runs on the home server
`perkunas`. Known risk: YouTube may block datacenter IPs (a home IP
avoids this).

### Network exposure: Cloudflare Tunnel (planned, not set up)

Cloudflare Workers cannot run yt-dlp. Expose the server at an HTTPS URL
with Cloudflare Tunnel (`cloudflared`), optionally behind a Cloudflare
Access service token on top of the existing `AUDIO_API_TOKEN`. This
replaces Tailscale. Concrete setup: ADR-0004.

### Storage

- Audio on server disk: `downloads/<id>.m4a`.
- ~~One `library.json` on server disk~~ (superseded by ADR-0005, planned;
  today's implementation still does this): song records with metadata
  and tags (tags replace playlists), see
  [`../product/screens.md`](../product/screens.md).
- No SQLite: a few hundred songs.
- Writes are atomic (temp file + rename), single writer (the server,
  under a lock). Web and phone go through the API.
- Revisit at tens of thousands of songs or multi-user.
- Implemented in `server/app/library.py`: in plain-file mode (no `AUDIO_DATA_REPO`) `library.json` and `covers/` live in `AUDIO_DATA_DIR`, audio in `AUDIO_DOWNLOAD_DIR`. ~~Covers on server disk~~ live in the git LFS repo under ADR-0005 (needs `git-lfs` installed on the server; the repo's `.gitattributes` decides tracking).

## ADR-0002 Tags replace playlists; song fields

Status: Accepted · 2026-10-12

- A song has zero or more free-form tags; a "playlist" is a tag filter.
  There is no playlist entity.
- Song fields: `artist`, `title`, optional `album`, `year`,
  plus `source_url`, `cover`, `tags[]` and technical `id`, `duration`,
  `added_at`.
- Sub-decision (2026-10-12): there is no dedicated `genre` field. Tags
  may be namespaced `key:value` (`genre:synthwave`, `mood:chill`) or
  plain; genre is the tag `genre:<name>`. `key:value` tags are
  lowercased and trimmed, tags dedupe case-insensitively, and the UI
  groups filter chips by prefix. An old `genre` value migrates on load
  to `genre:<value>`. yt-dlp's `genre` (never YouTube categories) becomes a suggested
  `genre:` tag at preview. One mechanism covers any future facet
  without a schema change.
- Screens, record layout and API: [`../product/screens.md`](../product/screens.md).

- Sub-decision (genre lookup): `/preview` also asks MusicBrainz
  (`server/app/genre_lookup.py`, free, no key) for genres. It cleans
  artist/title noise, accepts a recording match only at score >= 90 with a
  loosely matching artist, reads recording genres+tags (falling back to the
  artist's), and returns the top 3 by votes as `genre:<name>`. These merge
  with the yt-dlp suggestion, de-duplicated, ~~max 4 tags~~ (superseded by the
  per-namespace caps in the country and language sub-decision); the Add
  screen pre-fills them. Limits: global ~1 request/s, 5 s timeout, in-memory cache,
  any error gives no tags (never breaks `/preview`). `AUDIO_GENRE_LOOKUP=0`
  disables it. Caveat: MusicBrainz tags are community-voted and sparse for
  obscure tracks; treat them as suggestions.

- Sub-decision (country and language, 2026-10-12): country and language are namespaced tags, not fields: `country:<ISO 3166-1 alpha-2>` and `lang:<ISO 639-1>` (639-3 only when no 2-letter code exists), normalised lowercase on the server (`langcodes.py` maps 639-3 to 639-1; unknown shapes are kept). The MusicBrainz lookup also suggests country (matched artist) and language (linked works; `mul`, `zxx`, `und` ignored), as does yt-dlp `language`; preview caps are genre 3, country 1, lang 2. The web shows names via `Intl.DisplayNames` with the raw tag in the tooltip. `AUDIO_TAG_LOOKUP` is the switch, `AUDIO_GENRE_LOOKUP` stays as an alias. Cost: one extra MusicBrainz call (artist) per uncached preview.

- Sub-decision (tag editor, 2026-10-12): Add and the Library Edit dialog share one tag editor (`web/js/tag-editor.js`): removable chips for the current tags, a Suggested row, and the known tags grouped by prefix, filtered by the text typed. Enter or comma commits typed text as a tag, and so does Save, but only a complete tag: `mood:` and `:x` are ignored in the UI and dropped by the server (`clean_tag`), never saved as `mood`. The pure check is `web/js/tag-input.js`, with a node test.

- Sub-decision (clean source URLs, 2026-10-12): `source_url` is always the canonical `https://www.youtube.com/watch?v=<id>`; share parameters (`si`, `t`, `list`, `utm_*`, `fbclid`, `gclid`, `pp`, `feature`) are dropped, the `t` start offset included. The same rules live in `server/app/urlclean.py` and `web/js/url-clean.js` (cleaned on paste, drop, bulk input, blur and submit; `cleanPasted` extracts the first link from pasted text, so share messages with trailing text work); old records are cleaned on load.

- Sub-decision (decade tags, 2026-10-12): the decade is the derived namespaced tag `decade:<NN>s` (`decade:90s`) for years 1950-2029, not a field. The server replaces a song's `decade:*` tags with the derived one on create, PATCH and load (migration) whenever the year is in range, and leaves them untouched otherwise, so the rule is deterministic and the year stays the single source. UI shows "the 90s" in a Decade group after Genre; the editor previews the chip, the server decides. Cost: manually typed decade tags on songs with a year are overwritten.
- Sub-decision (Wikipedia links, 2026-10-12): a song has up to three links on the Playback card: Source (`source_url`), Wikipedia of the song (`wikipedia_song`) and of the band (`wikipedia_artist`), both optional URL fields validated by host (`*.wikipedia.org`, `wikidata.org/wiki/Q..`; others dropped). They are suggested from MusicBrainz url-rels at preview and editable in Add and Edit. Wikidata over scraping: genre, country, language and year come from structured Wikidata claims (`Special:EntityData`, one batched `wbgetentities` for English labels), not from parsing article text, because claims are stable, licensed CC0, language-independent and need no fragile HTML heuristics. `POST /lookup/wikipedia` re-derives suggestions from user-edited links; suggestions never auto-assign. Cost: 2-6 extra outbound calls per uncached preview, all failure-tolerant and behind `AUDIO_TAG_LOOKUP`.

- Sub-decision (BPM): `bpm` (integer or `null`) is detected automatically
  when a song is added and is user-editable. `server/app/bpm.py` decodes
  the saved m4a with ffmpeg to mono 44.1 kHz PCM, feeds it to aubio's
  tempo tracker and takes the median of aubio's running BPM estimate at
  each detected beat, folded into 70-180 BPM and rounded to a whole number (BPM is stored as an integer; old fractional values are rounded on load).
  Detection runs in the download job after the file is saved; any failure
  is logged and stored as `bpm: null`, the download never fails. Re-detect
  via `POST /songs/{id}/bpm/detect`; `PATCH` accepts 20-300 or `null`; a
  BPM typed in Add is kept and skips detection. Caveat: BPM is a
  heuristic. Octave errors (half or double tempo) are possible and the
  70-180 folding can be wrong for very slow or very fast songs; a pure
  click track measured within ~2.5 BPM. Treat the value as a hint and
  correct it by hand. Cost: new runtime deps `aubio`, `numpy` and the
  `ffmpeg` binary (see `architecture.md`).

## ADR-0003 Web first, served by FastAPI at play.isayenko.net

Status: Accepted · 2026-10-12

- The web interface is built first; the mobile app is deferred. ~~Deferred~~: the iOS app now exists and matches the web flow (ADR-0007).
- FastAPI serves the static UI from the same origin as the API, so no
  CORS. The API stays protected by `AUDIO_API_TOKEN`.
- Domain: `play.isayenko.net`, reaching FastAPI through Cloudflare
  Tunnel (see ADR-0001). This resolves the open web-hosting question:
  FastAPI serves it, not Cloudflare Pages.
- Interim: a hello-world page is published on `play.isayenko.net` via
  Cloudflare Pages. When the real UI ships, the DNS record is repointed
  to the Tunnel and the Pages page is dropped.
- Scope: the web build manages the library and plays online only. No
  offline or local storage and no service-worker audio cache (iOS Safari
  evicts it and limits quota). Offline listening belongs to the iOS app
  (`ios/`, SwiftUI), built later against the same API, with a "download
  to device" option.
- Sub-decision (queue): the "current playlist" is a client-side play
  queue (song ids + current index in `localStorage`, no server state), not
  the filtered library list. Library cards offer Play now (insert after the
  current song, or move it there) and Add (append, duplicates ignored). The
  Player is a regular Playback tab with an "Up next" list. Revisit if the
  queue must sync across devices.
- Sub-decision (Playback layout): Playback is four stacked blocks (song
  details, song play controls, playlist controls, current playlist), see
  [`../product/screens.md`](../product/screens.md). Shuffle, loop-one,
  loop-all and the tag selection are client-side: flags and the queue
  (each item remembers whether it was added manually or by which tags) live
  in `localStorage`; the pure logic is `web/js/queue-logic.js` with a node
  test. No server state or endpoints.

## ADR-0004 Hosting on perkunas, LXC 106 `tools`

Status: Planned, not deployed · 2026-10-12 · Supersedes the "always-on
machine / `alex-hetzner`" wording in ADR-0001

- Host: home server `perkunas` (Proxmox NUC), inside the existing
  `tools` LXC 106 (Debian 13, `192.168.0.10`, privileged). No new LXC,
  no Docker.
- Run: FastAPI + yt-dlp + ffmpeg, serving `web/`, as a plain systemd
  service. Limit it to ~2 cores: perkunas CPU throttles at 100 C under
  sustained all-core load. LXC 106 also hosts Immich.
- Public access: add an ingress rule `play.isayenko.net` ->
  `http://192.168.0.10:<port>` to the existing perkunas Cloudflare
  Tunnel. `isayenko.net` DNS and registrar are at Cloudflare. At cutover
  the interim Pages CNAME `play` -> `play-76g.pages.dev` is replaced by
  the tunnel CNAME.
- Data: audio lives on a ZFS dataset on pool-3 (e.g. `/data/music`),
  bind-mounted into LXC 106. Pool-3 is a single disk with no
  redundancy; acceptable because YouTube is the source and audio can be
  re-downloaded. ~~`library.json` and `covers/` on the same dataset,
  needing a backup~~: superseded by ADR-0005, they live in git repos.
- Tailscale is not used.

## ADR-0005 Library metadata lives in the data-storage git repos

Status: Accepted, implemented in `server/` (git store, `music_root`, sync status; not yet deployed) · 2026-10-12 ·
Supersedes the `library.json`-on-server-disk and covers-on-server-disk
parts of ADR-0001 and the matching data wording in ADR-0004

- Metadata: private repo `alexisayenko/data-storage`, file
  `audioplayer/library.json`. Every library change (add, edit, tag,
  delete) is committed directly to that repo; the repo is the live
  store, not a backup of a file on disk.
- Covers (jpg): sibling repo `alexisayenko/data-storage-lfs` (Git LFS),
  `audioplayer/covers/<id>.jpg`. Same project folder name in both repos.
- Audio (m4a) stays on perkunas (pool-3 dataset bind-mounted into
  LXC 106); it is in neither repo.
- The server (LXC 106 `tools`) keeps its own clones of both repos and
  never touches `C:\Alex\data-storage` on the PC.
- Single writer with a lock. Write path: lock -> `pull --rebase` ->
  write `library.json` atomically (temp file + rename) -> commit
  (`audioplayer: add <id>` / `edit <id>` / `delete <id>` / `bpm <id>`) -> push.
- Reads are served from the local clone for speed.
- Push failure: keep the local commit, retry with backoff, show a
  warning in the UI, never lose the write.
- Auth: one deploy key per repo with write access, stored outside the
  repos (`~/.config/<service>/`, `chmod 600`). No credentials in repos.
- History is permanent: no secrets or personal data in `library.json`.
- Sub-decision (implemented): `library.json` is `{settings:{music_root},
  songs:[...]}`. `music_root` is `<servername>://<path>/` (e.g.
  `perkunas://data/music/`); songs reference audio only by relative file
  name (`<video_id>.m4a`), so relocating the music changes one value.
  The server resolves `<servername>` through its own local config
  (name -> mount path/host, outside the repo): no credentials or IPs in
  the JSON. A bare `{songs:[...]}` file is migrated on load (per-song
  `file` filled in; `music_root` seeded from `AUDIO_DOWNLOAD_DIR` on the
  next save). A plain local path also works as `music_root` (dev).
- Implementation: `server/app/gitstore.py` (env `AUDIO_DATA_REPO`,
  `AUDIO_COVERS_REPO`, `AUDIO_GIT_SSH_KEY`; unset repo = plain files for
  dev/tests), hosts map via `AUDIO_HOSTS` / `AUDIO_HOSTS_FILE`.
  Sync state `ok` / `pending` / `error` is in `GET /health` (`sync`);
  the web UI shows a warning when it is not `ok`.
- Cost: each save is a git push (~1-2 s), acceptable at a few hundred
  songs; revisit if edits become frequent.

## ADR-0006 Owner-only OAuth sign-in (Apple, Google)

Status: Accepted, implemented in `server/` and `ios/`; not yet tested live on a device · 2026-10-12

- Decision: besides `X-API-Token`, the server accepts
  `Authorization: Bearer <OIDC ID token>` from Sign in with Apple or Google,
  and only for the owner. No accounts, sessions or user table.
- Verification (`server/app/oauth.py`): signature (RS256) against the
  provider JWKS (Apple `appleid.apple.com/auth/keys`, Google
  `googleapis.com/oauth2/v3/certs`, cached 1 h), then `iss`, `aud`
  (`APPLE_AUDIENCE` / `GOOGLE_CLIENT_ID`), `exp`. Allowed: `email` ==
  `ALLOWED_EMAIL` (default `alex.isayenko@gmail.com`) with
  `email_verified`, or an Apple `sub` listed in `ALLOWED_APPLE_SUB`
  (Apple may hide or relay the email). Bad token 401, other person 403.
- Why not drop the API token: it stays as a working fallback (web UI,
  Apple tokens that expired offline). Both go through `require_token` and
  `require_token_or_query`; the iOS app sends the Bearer header for files
  and covers, so no token appears in URLs when signed in.
- iOS: ID token and Google refresh token live in the Keychain. Google
  signs in with `ASWebAuthenticationSession` (code + PKCE, no SDK) and
  refreshes silently; Apple cannot refresh without a server-side code
  exchange, so an expired Apple token shows "sign in again" and the API
  token is used meanwhile.
- Reliability: playing downloaded songs reads local files only, so it
  never needs a sign-in or an unexpired token.
- Secrets: no client IDs in the repo. Server env vars, and
  `ios/Config/Secrets.xcconfig` (git-ignored) for the Google iOS client ID.

## ADR-0007 iOS app: Vega 108 look, web-matching screen flow

Status: Accepted, implemented in `ios/`; not yet run on a device · 2026-10-12 ·
Supersedes the scaffold app (Library, Search, Settings, Now Playing, no
library endpoints) and the "mobile app deferred" part of ADR-0003

- Screen flow: the app mirrors the web UI, one tab per hash route:
  Library, Add, Playback, Settings. The mini-player opens Playback. Text
  search (`/search`) survives only as a secondary screen under Add. Same
  endpoints and library model as the web, so a song added on either shows
  on both. Spec: [`../specs/ios.md`](../specs/ios.md).
- Offline model: the phone keeps its own copy (`Documents/audio/`,
  `Documents/library.json`); Library has a Phone / Server switch, the server
  list is `GET /library` with per-song and "Download all" fetches. Playing
  never touches the network.
- Look: skeuomorphic, after the Soviet Vega 108 Stereo turntable: walnut
  bars, black panel, chrome knobs, piano keys, LEDs, Cyrillic panel labels,
  rotating platter and a tonearm that follows progress; the icon is the
  whole turntable. Tokens in `Theme.swift`, components in `Components.swift`;
  sketches and prompts in `docs/ui-ux/`.
- Why: one mental model across web and phone, and a distinctive look for a
  one-user app. Cost: custom components need their own accessibility and
  Dynamic Type care; the web UI keeps its plain style (no cross-platform
  visual parity).
- Cover tokens are never persisted: server covers are stored as
  `/covers/<id>` and fetched with the auth header at request time; old
  stored `?token=` values are scrubbed on load.

## ADR-0008 Distribution: internal TestFlight

Status: Accepted, in use · 2026-10-12

- App Store Connect record "Gramophone Offline", bundle
  `com.alexisayenko.audioplayer`, SKU `gramophone-ios`, iPhone only, one
  internal TestFlight group ("Alex"). Internal testers need no Beta App
  Review. No public release; the app may break YouTube's ToS.
- Build numbers are date-based (`CURRENT_PROJECT_VERSION` = `YYYYMMDD`,
  uploaded so far: 20261012, 20261013). App Store Connect rejects a repeated
  or lower number, so the next upload needs a strictly higher one: the
  next day's date, or the last number plus one for a second build in a day.
- Upload: `xcodebuild archive`, then `xcodebuild -exportArchive` with
  `destination=upload` in the export options, using the account signed in to
  Xcode (cloud-managed signing, team in `project.yml`). No ASC API key, no
  CI workflow (manual only; see `ci-cd.md`).
- TestFlight builds expire after 90 days; re-upload.
