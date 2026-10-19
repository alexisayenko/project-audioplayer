# Decisions

Tech decisions, newest last. Supersede by strikethrough and a new entry
below, never by deleting.

| ADR | Title | Status |
| --- | --- | --- |
| 0001 | Components, server, hosting, storage | Accepted (hosting wording superseded by 0004, storage by 0005 and 0012) |
| 0002 | Tags replace playlists; song fields (incl. canonical countries, historical `country:su`) | Accepted |
| 0003 | Web first, served by FastAPI (incl. file download, queue, Playback layout) | Accepted |
| 0004 | Hosting on perkunas, LXC 106 `tools` | Accepted, deployed 2026-10-13 |
| 0005 | Library metadata in the data-storage git repos | Accepted, implemented; amended by 0010 and 0012 |
| 0006 | OAuth sign-in (Apple, Google) | Accepted; owner-only gate superseded by 0012 |
| 0007 | iOS app look and screen flow | Accepted; look superseded by 0009 |
| 0008 | Distribution: internal TestFlight | Accepted |
| 0009 | Electrophone design system as single source of truth | Accepted |
| 0010 | Catalog and audio are separate (incl. web auto-download setting) | Accepted, implemented |
| 0011 | Multi-source song ids | Accepted |
| 0012 | Open signup and per-user storage | Accepted, live |
| 0013 | Music-database lookups: MusicBrainz, Discogs, AcoustID fingerprint identification | Accepted; MusicBrainz live, Discogs and AcoustID implemented, awaiting keys on the server |
| 0014 | Genres map: genre graph from Wikidata with Discogs families | Accepted, implemented |
| 0015 | Pill separators and promo-noise cleaning | Accepted, implemented on the web |
| 0016 | Web player chrome: fixed mini-player, queue menu, collapsible sidebar, draggable scrubber | Accepted, implemented |
| 0017 | Server module structure and test strategy | Accepted, implemented |
| 0020 | Connect YouTube: read-only playlist import by Google OAuth | Proposed |
| 0021 | Genre families follow Discogs genres | Accepted; outline and vocabulary amended by 0023 |
| 0023 | Canonical genre vocabulary | Accepted, planned (task-0035) |

The web "Download" file save is a sub-decision of ADR-0003; the web "Auto-download songs" setting is one of ADR-0010. The 2026-10-13 form, token-pill and metadata decisions have no number (section "2026-10-13 decisions", above ADR-0013). The identification (AcoustID, Discogs) decision is the sub-decision of ADR-0013; per-user open signup is ADR-0012.

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

Known gap: the superseded `/search` and `/download` are still served by `server/app/routes/legacy.py`.

### Network exposure: Cloudflare Tunnel (live since 2026-10-13, ADR-0004)

Cloudflare Workers cannot run yt-dlp. Expose the server at an HTTPS URL
with Cloudflare Tunnel (`cloudflared`), optionally behind a Cloudflare
Access service token on top of the existing `AUDIO_API_TOKEN`. This
replaces Tailscale. Concrete setup: ADR-0004.

### Storage

- ~~Audio on server disk: `downloads/<id>.m4a`.~~ Per user since ADR-0012: `<music_root>/users/<uid>/<id>.m4a`.
- ~~One `library.json` on server disk~~ (superseded by ADR-0005, then ADR-0012: one library per user;
  today's implementation still does this): song records with metadata
  and tags (tags replace playlists), see
  [`../product/screens.md`](../product/screens.md).
- No SQLite: a few hundred songs.
- Writes are atomic (temp file + rename), single writer (the server,
  under a lock). Web and phone go through the API.
- ~~Revisit at tens of thousands of songs or multi-user.~~ Multi-user arrived with ADR-0012 (per-user libraries, quotas); revisit the JSON store at tens of thousands of songs overall.
- Implemented in `server/app/library.py`: in plain-file mode (no `AUDIO_DATA_REPO`) `library.json` and `covers/` live in `AUDIO_DATA_DIR`, audio in `AUDIO_DOWNLOAD_DIR`. ~~Covers on server disk~~ live in the git LFS repo under ADR-0005 (needs `git-lfs` installed on the server; the repo's `.gitattributes` decides tracking).

## ADR-0002 Tags replace playlists; song fields

Status: Accepted · 2026-10-12

- A song has zero or more free-form tags; a "playlist" is a tag filter.
  There is no playlist entity.
- Sub-decision (2026-10-14): `country:` and `lang:` tag values are canonicalised to ISO codes (alpha-2 / 639-1) from an embedded table with aliases, on write and on load, so `usa`, `United States` and `us` are one filter entry. `country:` accepts only known countries (422 `unknown_country`); legacy unmapped values stay and are flagged; `lang:` unknown values stay free ([tags.md](../specs/tags.md) TAG-056, TAG-057).
- Sub-decision (historical countries, 2026-10-14): the Soviet Union is a first-class predefined `country:su` (name "Soviet Union", aliases `ussr`, `cccp`, `sssr`), marked `historical` in the country table so future flag assets can be drawn as images (no emoji flag exists for a former state). It is accepted on write and not flagged unknown; MusicBrainz `SU` maps to it, other pseudo-codes (`XU`, `XW`) are still dropped. Candidates, add on request: `yu` Yugoslavia, `cs` Czechoslovakia, `dd` East Germany ([tags.md](../specs/tags.md) TAG-058).
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

- Sub-decision (decade tags, 2026-10-12): the decade is the derived namespaced tag `decade:<NN>s` (`decade:90s`) for years 1950 up to next year (the range grows with the clock, BJ1: `max_year()`), not a field. The server replaces a song's `decade:*` tags with the derived one on create, PATCH and load (migration) whenever the year is in range, and leaves them untouched otherwise, so the rule is deterministic and the year stays the single source. UI shows "the 90s" in a Decade group after Genre; the editor previews the chip, the server decides. Cost: manually typed decade tags on songs with a year are overwritten.
- Sub-decision (Wikipedia links, 2026-10-12): a song has up to three links on the Playback card: Source (`source_url`), Wikipedia of the song (`wikipedia_song`) and of the band (`wikipedia_artist`), both optional URL fields validated by host (`*.wikipedia.org`, `wikidata.org/wiki/Q..`; others dropped). They are suggested from MusicBrainz url-rels at preview and editable in Add and Edit. Wikidata over scraping: genre, country, language and year come from structured Wikidata claims (`Special:EntityData`, one batched `wbgetentities` for English labels), not from parsing article text, because claims are stable, licensed CC0, language-independent and need no fragile HTML heuristics. `POST /lookup/wikipedia` re-derives suggestions from user-edited links; suggestions never auto-assign. Cost: 2-6 extra outbound calls per uncached preview, all failure-tolerant and behind `AUDIO_TAG_LOOKUP`. The same fetch also reads the song page's `album` and `released` year (TAG-048); a single has no `album` parameter, so the infobox gives no album (the song's own title is never used as one).
- Sub-decision (infobox genres, 2026-10-13): the one exception to "claims, not article text" is the infobox `genre` parameter of the song's (else the artist's) English Wikipedia page, read by a deterministic wikitext parser (no AI), because Wikidata `P136` is often missing or coarser than the infobox (Crazy by Gnarls Barkley lists seven genres). Its genres come first and are all kept; everything else still comes from claims (TAG-045 to TAG-047). Cost: one extra Wikipedia API call per uncached page, failure-tolerant and behind `AUDIO_TAG_LOOKUP`. The same fetch also gives `POST /metadata` a `suggest` hint (song page's infobox artist and name, TAG-049); Artist and Title are never auto-filled.
- Sub-decision (one tag rule, 2026-10-13): `POST /preview` and `POST /lookup/wikipedia` now use the same genre filter and caps as `POST /metadata` (`metadata.finalize_tags`: 8 genres, 1 country, song's own genres first; superseded 2026-10-19 by ADR-0035: all four lookups use `metadata.resolve`, finalize_tags stays only for the playlist import) instead of the old 3-genre cap without filter (TAG-023, TAG-055).
- Sub-decision (security findings fixed in code, 2026-10-13): `oauth.verify_identity` no longer reads the unverified `iss` claim to pick a provider; it tries Google, then Apple (only providers with a configured audience), each with full JWKS signature, `iss`, `aud` and `exp` checks, and accepts the first that verifies, so every failure is the same 401 `bad token`. Also fixed: `Math.random` element ids in the web chip field (counter), the sync script's output paths (guarded to stay inside the repo), and the `http://` literal in `wiki_lookup.clean_link` (scheme rewrite via `urllib.parse`).

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
  offline audio storage in the web and no service-worker audio cache (iOS Safari
  evicts it and limits quota); `localStorage` holds only UI state, queue and flags (`web/js/storage.js`). Offline listening belongs to the iOS app
  (`ios/`, SwiftUI), built later against the same API, with a "download
  to device" option.
- Sub-decision (2026-10-14, download to device): the web may offer "Download", a normal browser file save of the audio (`GET /files/{id}?download=1`, `Content-Disposition: attachment`, filename `Artist - Title.m4a`), triggered by a plain `<a download>`. It is not an offline cache: no service worker, no stored copy, no change to "online only" playback (API-061, WEB-034).
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

Status: Accepted, deployed 2026-10-13 · 2026-10-12 · Supersedes the "always-on
machine / `alex-hetzner`" wording in ADR-0001

- Host: home server `perkunas` (Proxmox NUC), inside the existing
  `tools` LXC 106 (Debian 13, `192.168.0.10`, privileged). No new LXC,
  no Docker.
- Known gap: iOS still sets `NSAllowsArbitraryLoads: true` (`ios/project.yml`, `ios/Sources/Info.plist`), though the server is reached over HTTPS only; not yet tightened.
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

Status: Accepted, implemented in `server/` (git store, `music_root`, sync status; deployed 2026-10-13) · 2026-10-12 ·
Supersedes the `library.json`-on-server-disk and covers-on-server-disk
parts of ADR-0001 and the matching data wording in ADR-0004
Amended by ADR-0026 (Accepted, built, not deployed): saves commit locally and a systemd timer only pushes; the git-per-save history is kept.
Amended by ADR-0027 (Accepted, built, not deployed): the timer also fast-forwards commits that exist on GitHub. Amended by ADR-0028: it also rebases its own unpushed commits over foreign commits outside the owned paths.
Amended by ADR-0010 (Accepted): the store also holds catalog records that have no audio yet.
Amended by ADR-0012 (Accepted): the file layout below is per user (`audioplayer/users/<uid>/...`); the rest (git as live store, lock, retry, no secrets) stands.

- Metadata: private repo `alexisayenko/data-storage`, ~~file~~
  ~~`audioplayer/library.json`~~ `audioplayer/users/<uid>/library.json` (ADR-0012). Every library change (add, edit, tag,
  delete) is committed directly to that repo; the repo is the live
  store, not a backup of a file on disk.
- Covers (jpg): sibling repo `alexisayenko/data-storage-lfs` (Git LFS),
  ~~`audioplayer/covers/<id>.jpg`~~ `audioplayer/users/<uid>/covers/<id>.jpg`. Same project folder name in both repos.
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

Amended by ADR-0012: the "only for the owner" gate is replaced by open signup with per-user storage; the token verification below stands.

Amended: the iOS token UI is removed (Settings has no server or token fields). The server still accepts the API token for the owner and for scripts and `-serverURL`/`-token` launch-argument testing; iOS users authenticate by Sign in with Apple or Google.

Amended: the web token fallback is removed (WEB-005). The web UI authenticates with the session cookie only; the API token remains for the owner on iOS and scripts.

Status: Accepted, implemented in `server/` and `ios/`; not yet tested live on a device · 2026-10-12

- Decision: besides `X-API-Token`, the server accepts
  `Authorization: Bearer <OIDC ID token>` from Sign in with Apple or Google,
  ~~and only for the owner. No accounts, sessions or user table.~~ (ADR-0012: any verified identity is a user; the owner is Alex.)
- Verification (`server/app/oauth.py`): signature (RS256) against the
  provider JWKS (Apple `appleid.apple.com/auth/keys`, Google
  `googleapis.com/oauth2/v3/certs`, cached 1 h), then `iss`, `aud`
  (`APPLE_AUDIENCE` / `GOOGLE_CLIENT_ID`), `exp`. ~~Allowed: `email` ==
  `ALLOWED_EMAIL` (default `alex.isayenko@gmail.com`) with
  `email_verified`, or an Apple `sub` listed in `ALLOWED_APPLE_SUB`
  (Apple may hide or relay the email). Bad token 401, other person 403.~~
  ADR-0012: any `email_verified` identity is admitted (bad token 401);
  `OWNER_EMAIL` (alias `ALLOWED_EMAIL`) and `ALLOWED_APPLE_SUB` now only mark
  the owner.
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
- Amendment 2026-10-12, web sign-in: the web UI signs in with Google Identity
  Services and the Apple JS SDK (popup), loaded from their CDNs on the
  Settings screen only. The ID token is sent once to `POST /auth/session`;
  the server verifies it as above and sets an HttpOnly, Secure,
  SameSite=Strict cookie `__Host-session` (HMAC-signed, 12 h, key from
  `AUDIO_SESSION_SECRET` or derived from `AUDIO_API_TOKEN`). The cookie is
  accepted by `require_token` and `require_token_or_query`, so `<audio>` and
  `<img>` work with no token in any URL; ID tokens never go in query strings.
  Cookie-authenticated unsafe methods need header `X-Requested-With:
  audioplayer` and a same-host `Origin` (CSRF). Sessions are stateless, so
  logout deletes the cookie but cannot revoke a copy; rotate the secret to
  revoke all. `GOOGLE_CLIENT_ID` and `APPLE_AUDIENCE` are now comma lists
  (iOS client plus web client; bundle id plus Services ID); the web client
  ids may also be given as `GOOGLE_WEB_CLIENT_ID` / `APPLE_WEB_CLIENT_ID`,
  which `GET /auth/config` publishes (public, not secret). Signed-out
  visitors see only Settings. No service worker or cache exists; API
  responses carry `Cache-Control: no-store`, files and covers `private,
  no-cache`, so nothing authenticated survives sign-out. The web client must
  not reuse the iOS client id.

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
  uploaded so far: 20261012, 20261013, 20261021, 20261022, 20261023, 20261024, 20261025). App Store Connect rejects a repeated
  or lower number, so the next upload needs a strictly higher one: the
  next day's date, or the last number plus one for a second build in a day.
- Upload: `xcodebuild archive`, then `xcodebuild -exportArchive` with
  `destination=upload` in the export options, using the account signed in to
  Xcode (cloud-managed signing, team in `project.yml`). No ASC API key, no
  CI workflow (manual only; see `ci-cd.md`).
- TestFlight builds expire after 90 days; re-upload.
- Rename (2026-10-12): the user-facing app name is now "Electrophone" (display name, web UI, docs). The ASC record, Google Cloud project `gramophone-offline` and SKU `gramophone-ios` keep their original names as external resources; bundle id, target and scheme names are unchanged.

## ADR-0009 Look: the Electrophone design system is the single source of truth

Status: Accepted · 2026-10-12 · Supersedes the look part of ADR-0007
Partly superseded by ADR-0010 (Accepted 2026-10-13): the "Library is the phone" bullet (phone-only Library, no Download all) is replaced; the rest stands. The text below is kept as history.

- Direction: "Warm analog / Quiet glass" (origin: `docs/ui-ux/mockups2/`, prompt B
  in `docs/ui-ux/design-prompts.md`): warm paper and charcoal grounds, a copper
  rim, flat glass slabs for controls, one cyan accent, day and night themes. The
  Vega 108 skeuomorphic look (ADR-0007) is retired; its sketches stay in
  `docs/ui-ux/vega-108/` as history.
- Source of truth: the "Electrophone" Design System artifact on claude.ai
  (`docs/brand/README.md` has the link). Every colour, text style, spacing
  step, radius, shadow and component guideline lives there. The repository
  holds a committed export, `docs/brand/tokens.json`, and generated consumers:
  `ios/Sources/DesignTokens.swift` and `web/tokens.css`, produced by
  `scripts/sync-design-system.py`. Generated files are never edited by hand;
  code never defines its own colour, size or radius.
- Workflow: change the system → export `project/tokens.json` to
  `docs/brand/tokens.json` → `python3 scripts/sync-design-system.py` → commit
  the three files together. Screens are designed in the "Electrophone
  Screens" Design artifact before they are built.
- Library filtering changes with the look: four category chips (Tags, Genres,
  Years, Countries) open a filter sheet; no flat scrolling tag row.
- Library is the phone (superseded by ADR-0010; was: supersedes the Phone / Server switch of ADR-0007):
  the server is only the download pipe behind Add; the phone never browses
  a server library. The web UI keeps `GET /library`.
- Three destinations, not four: Library, Playback, Settings. Add is an
  action on Library (a + button opening a sheet), not a tab, on both
  surfaces.
- Playback shows the song's cover with its title on it; the decorative
  deck (platter, tonearm, LED) is dropped.
- The web UI follows the same system (supersedes "the web UI keeps its
  plain style" in ADR-0007): sidebar rail, table library, bottom player bar.
- Why: one place to decide the look, shared by iOS and web, editable without
  touching code; the previous look was defined only in `Theme.swift`, so docs,
  mockups and code drifted within a day.
- Cost: the artifact is outside the repo (no CI pull; the export is manual),
  and `Theme.swift`/`Components.swift`/views must be migrated (task-0005).

Amendment 2026-10-13 (web v16): navigation is three destinations, Library,
Playback, Settings, on both platforms; adding a song is an accent action on
Library that opens an Add sheet (a dialog on the web), not a tab, and its
download continues as a "Downloading NN%" row. Playback leads with the cover;
the deck, tonearm and LED are gone. Contrast substitutes for the system's failing
pairs are listed in `docs/ui-ux/style-guide.md`. Web assets are served under
`/_v/<version>/` so a deploy is a new URL (WEB-017); the page itself revalidates.

## ADR-0010 The catalog and the audio are separate: Library lists every song, audio is fetched on demand

Status: Accepted, implemented: server (task-0006), web (catalog-only) and the iOS Library (task-0009 client part) · 2026-10-13 · Supersedes the "Library is the phone" part of
ADR-0009 and the matching IOS-030..032 wording; amends ADR-0005 (what the store
holds). Concept: [`docs/product/concept-catalog-and-audio.md`](../product/concept-catalog-and-audio.md).

- Two parts. The **catalog** is metadata only (title, artist, album, year, tags,
  cover, source links; a few KB per song) and stays in the git store of ADR-0005.
  The **audio** is files, fetched on demand, kept on the server and on the phone.
- Two activities: populate the catalog from any source (YouTube, SoundCloud and
  Spotify links, text search, manual entry; playlists later) and get audio + listen.
- Audio state per song: `none` -> `server` -> `phone`. It is derived (server: file
  present; phone: local copy present), not hand-edited. Library lists the whole
  catalog, rows show the state, a filter "On phone" narrows it.
- The catalog is synced to the phone (tiny) so Library works offline. Downloaded
  songs play offline and never depend on the server (key principle unchanged).
- Add becomes "add to catalog". A Spotify track link yields metadata only via the
  Spotify Web API (free developer app, client credentials; client id and secret
  only in the git-ignored server env). Audio is never taken from Spotify (DRM).
  Public playlists later; the user's Liked Songs needs a one-time OAuth login,
  a separate optional step.
- "Get audio" is a separate action, per song or in bulk. For a Spotify-only song
  the server proposes a YouTube match, the user confirms (live, remix and lyric
  videos are the usual wrong matches), then it downloads like any YouTube song.
  SoundCloud Go+ preview-only tracks are refused.
- IDs: YouTube ids unchanged; SoundCloud `soundcloud-<id>` (ADR-0011);
  metadata-only Spotify songs `spotify-<id>`. When audio is attached
  the record keeps both ids and source urls.
- Reverses: ADR-0009 "the phone never browses a server library" and "no Download
  all"; revives the earlier server-library idea in a better form. Also touches
  the Add flow (ADR-0007/0009 screens), to be redrawn in the design system.
- Sources considered later (proposal tasks, unverified facts): Apple Music links, ShazamKit Listen, Shazam history import, SoundHound; order after Spotify: Apple Music -> ShazamKit Listen -> Shazam import (task-0012..0015, CAT-040..048).
- Why: the owner's favourites are a list he wants to grow from anywhere (a
  Spotify link, a friend's tip) without paying the download and storage cost up
  front; the catalog is worth keeping even when audio is missing.
- Cost: a record can exist without a file (DATA-005 changes), a Spotify developer
  app and its terms become a dependency, wrong YouTube matches need a human
  confirm, and catalog vs audio can drift (see concerns).
- Web (2026-10-13): the web UI is catalog-only: it saves entries with `audio:false`, shows songs without server audio as a greyed row with an Open on YouTube/SoundCloud link (no "Not on the server" label), never queues them, and plays/deletes only audio already on the server (WEB-015, WEB-023); the iOS "Add and download to iPhone" is the only path that puts audio on the server.
- Implementation: server P1 (task-0006) is implemented: `file` may be `null`, `sources` list, derived `audio_state` (`none`/`server`), `GET /catalog`, metadata-only `POST /songs`, `DELETE /songs/{id}/audio`. Old records are not migrated; state is derived at read time. Remaining specs are `planned` (CAT-*), tasks task-0007.. (phases P2..P6).

- Auto-download on the web (2026-10-14): the web gets a client setting "Auto-download songs" (default off). On, songs without server audio may be queued and their audio is fetched in the background through the new `POST /songs/{id}/audio` (state `none` to `server`; PLY-110..116, API-060); one fetch counts as one add against `USER_ADDS_PER_HOUR` (owner exempt, NFR-056), so the existing quotas still bound the cost; the client runs one download at a time and pauses on `hourly_limit`. Off, nothing is fetched automatically and a song without audio shows "Not downloaded" with a Download button. This amends the Web bullet above ("never queues them") only for the on case.
- A metadata-only `POST /songs` (`audio:false`) does not record against `USER_ADDS_PER_HOUR`; only the audio fetch (`POST /songs/{id}/audio`) or an add with audio records, once, so a song never costs two adds. (After a restart the counter re-learns from the songs' `added_at`, which can count metadata-only songs of the last hour.)

## ADR-0011 Multi-source song ids: YouTube unchanged, SoundCloud as `soundcloud-<track id>`

Status: Accepted · 2026-10-13 · Extends ADR-0001 (yt-dlp server) and DATA-001.

- Context: Add must take SoundCloud track links next to YouTube. A song id is
  also its file name (`<id>.m4a`), cover name and URL path parameter.
- Decision: YouTube ids stay exactly as they are (no migration of
  `library.json`). SoundCloud songs use `soundcloud-<numeric track id>`; at 12+
  characters it cannot collide with an 11-character YouTube id. An optional
  `source` field (`youtube` default when absent, `soundcloud`) is written on new
  SoundCloud records; `source_of(id)` derives it from the id everywhere else
  (server, web, iOS). Every id validator accepts both forms.
- The numeric track id is only known after yt-dlp resolves the link, so the
  server resolves it at preview and at save. Short `on.soundcloud.com` links are
  followed once server-side (https, `soundcloud.com` hosts only).
- Go+ tracks that only offer the 30 s preview are refused (`preview_only`).
- Cost: SoundCloud covers come from `*.sndcdn.com` artwork instead of a derivable
  URL, and the artist may be the uploading label. See [concerns](../concerns.md).

## ADR-0012 Open signup and per-user storage

Status: Accepted, implemented in `server/` and `web/` (live; iOS client mostly done, the `queued` job status remains: [task-0016](../tasks/task-0016.md)) · 2026-10-13 · Supersedes the single-library layout of ADR-0001 and ADR-0005, and the owner-only gate of ADR-0006

- Decision (Alex): anyone who signs in with a verified Google or Apple
  identity gets their own library and storage on Alex's server, in Alex's
  private data repos. Alex stays the owner: exempt from the per-user
  quotas, owner of the legacy library. The key principle is unchanged:
  playback and offline reliability beat features. Still no social,
  sharing, recommendations or public release; the iOS app stays on
  TestFlight internal testing, the web UI is the open front door.
- Identity: the verified ID token (ADR-0006 verification is unchanged).
  `uid` = first 16 hex of `sha256(lowercased email)`; Apple tokens without
  an `email` claim use `sha256(sub)` (the profile records the Apple `sub`,
  so a later token without email maps to the same user). Apple private-relay
  emails are fine. An email must be `email_verified`. The uid is always
  computed server-side from the token or the signed session cookie, never
  taken from a request.
- Owner: `OWNER_EMAIL` (`ALLOWED_EMAIL` is a deprecated alias, default
  `alex.isayenko@gmail.com`; first entry only), plus an Apple `sub` in
  `ALLOWED_APPLE_SUB`. The static `X-API-Token` (and `?token=` on files and
  covers) authenticates as the owner only.
- Signup: `SIGNUP_OPEN=1` (default) creates the profile on first sign-in;
  `SIGNUP_OPEN=0` admits only existing users and the owner (403
  `signup_closed`).
- ~~`audioplayer/library.json`, `audioplayer/covers/<id>.jpg`, audio at
  `<music_root>/<id>.m4a`~~ (ADR-0001, ADR-0005) become, per user:
  data repo `audioplayer/users/<uid>/profile.json` (email, provider,
  created_at, Apple sub) and `.../library.json` (same shape, ADR-0010
  catalog model unchanged); LFS repo `audioplayer/users/<uid>/covers/<id>.jpg`;
  audio `<music_root>/users/<uid>/<id>.m4a`. No shared pool: the same song
  in two libraries is two files. `music_root` stays one server-wide value
  (env `AUDIO_MUSIC_ROOT`, else the owner's `settings.music_root`).
- Writes: one lock per user for library writes, one global lock for the git
  pull --rebase / commit / push cycle; commit messages `audioplayer: <uid8>
  add|edit|delete|delete audio|bpm <id>` and `audioplayer: <uid8> signup`.
  Retry and backoff on failed pushes are unchanged.
- Migration: the legacy single-user layout was migrated once on 2026-10-13; the migration code and its marker were then removed.
- Guardrails (env, owner exempt from the per-user ones, not from the pool):
  `USER_MAX_SONGS=500`, `USER_MAX_BYTES=5GB` (real file sizes),
  `USER_ADDS_PER_HOUR=20`, `USER_MAX_CONCURRENT_DOWNLOADS=1` (extra adds get
  status `queued`), `GLOBAL_MAX_CONCURRENT_DOWNLOADS=2`, `POOL_MAX_BYTES=150GB`
  (audio under `music_root/users`), `SIGNUP_OPEN`. Checked before anything
  is downloaded (queued jobs count against the song limit and re-check bytes
  when they start); deleting a song frees its quota. Errors:
  429 `hourly_limit` (+`retry_after_minutes`, `Retry-After`), 403
  `library_full_songs` / `library_full_bytes`, 503 `server_full`, 403
  `signup_closed`. `GET /me` and `GET /me/usage` report profile and usage.
- Risks and costs:
  - Business and legal docs (`docs/business/`, `docs/release/legal-draft.md`) are still TODO placeholders while open signup is live.
  - Strangers' emails are stored in `profile.json` in the private data repo;
    git history is permanent, so removing a user later leaves the email in
    history (paths never contain it). See privacy in
    [non-functional](../specs/non-functional.md).
  - Legal exposure of the YouTube/SoundCloud downloads (ToS) now extends to
    other people's use of Alex's server and IP; a ban of the home IP would
    hit the owner's playback too.
  - Disk: bounded by `POOL_MAX_BYTES`, but a full pool also blocks the
    owner's new downloads. Open signup is limited by a verified identity
    only; many throwaway Google accounts can each take 5 GB, so the pool cap
    is the real ceiling. `SIGNUP_OPEN=0` is the kill switch.
  - Each new user and each write is a git commit and push: repo growth and
    push latency scale with users. `/search`, `/preview` and `/lookup/wikipedia`
    are not rate limited per user (they cost external requests, not storage).
  - Hourly counters are in memory (re-learned from `added_at` after a restart).
  - The shared server holds everyone's session secret; sessions are
    stateless (ADR-0006 amendment).

## 2026-10-13 decisions: shared song form, token pills, title cut, metadata

Consolidated from the notes written during the day; where an earlier note was reversed, only the final decision is kept. Rules: specs under `docs/specs/`.

Add and Edit

- One shared song form on both platforms, not separate Add and Edit forms and not a compact preview card: after Fetch the full form opens. Reason: one set of rules to test and no drift between Add and Edit. Web WEB-033, WEB-022, LIB-050; iOS IOS-070, IOS-020. Only the BPM row and the Get metadata sources differ.
- The web is catalog-only: it saves entries with `audio:false` and plays or deletes only audio already on the server; audio reaches the server only through the iOS "Add and download to iPhone" flow (ADR-0010; WEB-015, WEB-023, IOS-030, IOS-035).
- The Add link field also accepts a bare 11-character YouTube video id (WEB-018, IOS-062).
- Four service icons (YouTube, SoundCloud, Wikipedia, Spotify) sit beside "Get metadata"; their brand colours are `brand-*` tokens (design system v19). One `POST /metadata` call returns per-service `services.<name>.{found,url}` (API-048). Spotify is shown but permanently inactive: it is not a metadata source for now.
- "Fill from Wikipedia links" button removed: the two Wikipedia link inputs feed "Get metadata" (ADD-051, ADD-055). "Wikipedia says" is a hint, never auto-filled (artist and title are never auto-filled).
- Languages dropped: `lang:` tags are not suggested by `/preview`, `/lookup/wikipedia` or `/metadata` and the UIs do not show them; stored `lang:` tags are kept and still normalised.
- BPM is a read-only label on web and iOS (LIB-052, IOS-069); it is detected on the server after the download or by Re-detect.

Title, Artist, Remix

- `remixer` is an optional free-text field ("Remix & additional production", data-model, API-049). It replaces the earlier tap-to-apply remix hint and the "Original track" field (dropped): a strict deterministic cut (ADD-070) removes the first bracket containing "remix" from the title and puts its text in `remixer`; with no such bracket, the first non-first segment split by a spaced " | ", " - ", " – ", " — " that contains "remix" is cut verbatim, and only when at least two segments remain ("Daft Punk - Around The World Remix" keeps its title). MusicBrainz is not used for remix or remixer: remixes are not linked there and name matching hits the wrong artist.
- Title, Artist and Remix are shown as token pills (view of the one plain string, saved unchanged) instead of an X clear button on every field (web WEB-028, ADD-071/072, iOS IOS-065). Pills move between the three fields and within one by drag and drop, using the standard system drag (WEB-029, ADD-074, IOS-066); the clear-button rules (WEB-027, IOS-064) are superseded.
- Version info such as "(Live from the Royal Albert Hall)" stays in the saved and shown title; it is stripped only from lookup queries (`titles.lookup_title`); there is no Version field (ADD-073).
- feat/ft/featuring credits are kept in the saved title and artist and normalised to "feat." (`titles.normalize_feat`; not after a number, bare ft/feat only before a capital or digit), and stripped only for lookups (ADD-075). A credit's cut stops at its own separator (closing bracket, " - ", " | ", a bullet or the next bracket), so the rest of the title survives (`titles._strip_feat`, linear scan). Deterministic cue: with no channel-prefix split, a feat word left of the first spaced dash makes the left part the artist (ADD-075).
- feat names take part in the MusicBrainz artist match (TAG-054, `titles.lookup_credits`): the recording credited to the primary artist and all featured names wins; a Wikipedia song page whose infobox artist differs is ignored in `wiki_lookup.suggest`.

Genres

- The genre autocomplete list is served by the server, `GET /genres` (API-050, TAG-053): the user's own genres, then built-ins, so web and iOS share one source (web WEB-024, iOS IOS-067).
- In `POST /metadata`, suggested `genre:` tags (caps 8 genres, 1 country; the form shows 12/1) pass a deterministic deny-list and canonicalisation (`genre_filter`, TAG-055) before the caps (`/preview` and `/lookup/wikipedia` keep the simpler cap of 3 genres, no filter): nationalities, roles, MusicBrainz meta tags, years and decades, languages, places and filler words are dropped, " music" is stripped and built-in spellings win. Stored user tags are never touched.

## ADR-0013 Music-database lookups: MusicBrainz now, Discogs later

Status: Accepted for MusicBrainz (already live as a source, now the named policy); Discogs and audio fingerprinting implemented, awaiting keys on the server (see Sub-decision) · 2026-10-14

- Current state: `POST /metadata` ([API-048](../specs/api.md)) merges, under one 15 s cap, yt-dlp source info, a MusicBrainz match of artist+title (`server/app/genre_lookup.py`: genres, artist country, first release year, album, the matched recording's page for the MusicBrainz icon; score >= 90, at most 3 genres, descriptive `User-Agent` from `AUDIO_MB_USER_AGENT`, one request per 1.1 s, per-query cache), the English Wikipedia infobox and Wikidata (`server/app/wiki_lookup.py`). `POST /preview` applies the same genre filter, `GET /genres` (API-050) serves the user's own genres plus a built-in list, and BPM is detected locally from the audio (ADR-0002). Spotify is not used. The Add and Edit form never auto-fills from a lookup beyond the preview prefill; "Get metadata" results are suggestions ([add-song](../specs/add-song.md)).
- Decision (Alex): MusicBrainz is the standing music-database source for metadata suggestions; Discogs is added later as a second source for genre, style and year.
- MusicBrainz: free, no key, only a descriptive `User-Agent` (app name and contact) and about 1 request/second. Core data is CC0. Tags are community-voted and noisy, so they stay suggestions the user confirms in the shared song form.
- Discogs (later): free personal access token, about 60 requests/minute with it. It returns genres plus finer styles (progressive house, vocal trance), which fits the electronic catalog. Its terms restrict reuse of images and bulk data, so use it only to suggest genre, style and year; no image caching, no stored dumps.
- Constraints for every lookup source:
  - Server-side only; clients never hold tokens or call the databases.
  - The Discogs token follows the secrets rule: a `chmod 600` env file on the server, outside the repo, never in git.
  - Optional suggestions on Add/Edit. Playback and offline reliability never depend on them (key principle); a failure or timeout is skipped silently and the result is what we return today.
  - Results cached per query and requests rate-limited per source, so the limits above hold.
  - Nothing is applied server-side; the user confirms in the form.
- The MusicBrainz icon in the song link row (web and iOS) is lit by the same lookup and links to the matched recording (`services.musicbrainz`, API-048); the link is stored on the song as the optional `musicbrainz_url` (DATA-009), like the Wikipedia links, so the icon stays lit when the song is reopened. The Discogs icon stays inert with no API call and no token.
- Consequences:
  - One more optional external dependency and a per-source cache and limiter to maintain; Discogs adds a secret to deploy.
  - Suggested tags can be wrong or noisy; the confirm step carries the quality, not the source.
  - Sources merge in a fixed precedence, so adding Discogs needs an update to API-048 and the tags spec.
- Sub-decision (Alex, 2026-10-14): fingerprint-first identification. The most reliable way to name a track is its audio, not its messy title: Chromaprint `fpcalc` fingerprints the saved file and the AcoustID service returns the MusicBrainz recording (`server/app/acoustid_lookup.py`); that recording then supplies genres, country, languages, year and the Wikipedia links, and the title-based MusicBrainz match is only the fallback. Discogs (`server/app/discogs_lookup.py`) is searched with the matched artist and title and its finer styles are preferred for `genre:`. `server/app/identify.py` merges the sources (API-070). Rules: all of it is suggestions, never auto-applied or overwriting user data; every key is optional and a missing key or `fpcalc` switches the source off quietly; only the fingerprint leaves the server; keys stay in the server env file (NFR-070). The Discogs link is stored like the MusicBrainz one (`discogs_url`, DATA-050). Not yet verified against the live services: that needs `ACOUSTID_API_KEY`, `DISCOGS_TOKEN` and `fpcalc` on the server ([deploy](deploy.md#identification-keys)).
- Rejected:
  - Client-side calls: would put the Discogs token in the app and web bundle and break per-source rate limiting.
  - Spotify API: needs app credentials and is not used (ADR-0010); its terms limit reuse of metadata.
  - Scraping: brittle, against site terms, and not needed while free APIs exist.


## ADR-0014 Genres map: genre graph from Wikidata with Discogs families

Status: Accepted (Alex, 2026-10-14) · implemented

- Decision: a "Genres map" page shows the user's `genre:` tags as an Obsidian-style force graph with an outline list beside it. Genres form a directed acyclic graph (many parents, many siblings), not a tree, so the model carries `parents[]` and a separate weaker `related` edge. Spec: [genres.md](../specs/genres.md), endpoint API-080.
- Source of relations: Wikidata, because it already holds `subclass of` for music genres and the app already uses it for facts ([ADR-0013](#adr-0013-music-database-lookups-musicbrainz-now-discogs-later)). Each tag is resolved by label search (exact English label or alias, restricted to music genres) and its ancestors are fetched by `subclass of` in batches of 50. The resolved slice is cached in one server-wide JSON file for 30 days and never holds user data; requests never wait for Wikidata (a background worker fills the cache, the page polls), so the page works offline from the cache and degrades to the user's own tags when there is none.
- Families: colours come from the Discogs top-level genres (Electronic, Rock, Pop, Hip Hop, Jazz, Funk / Soul, Classical, Reggae, Latin, Blues, Folk, World, & Country, Stage & Screen, Non-Music, Children's, Brass & Military, plus "Other"), through a small hand-made map from Wikidata ids and labels in `server/app/data/discogs-families.json`; the closest matching ancestor wins. Discogs itself is not called.
- Deviations from the brief, kept on purpose: the module is `server/app/genre_graph.py` (`genres.py` already serves the autocomplete list); the weak `related` edge uses `influenced by` (P737), because P7937 is "form of creative work" and Wikidata has no usable "stylistic origin" property; counts are computed per user on the server and recomputed in the browser from the loaded library.
- Rendering: canvas with a purpose-written simulation, no CDN or library; reduced-motion gets a static layout.
- Consequences: one more cache file on the server and a background thread on first use; Wikidata labels can differ from the user's wording (the node keeps the user's own values in `tags`, so Library filters stay exact); genres Wikidata does not know stay as loose nodes.
- Rejected: a tree (a genre such as synthpop has two parents); fetching Wikidata per request (slow, rude to the service); a client-side library such as d3 from a CDN (no external dependencies, ADR-0003); storing the ontology in the per-user git repos (it is not user data).


## ADR-0015 Pill separators and promo-noise cleaning

Status: Accepted (Alex, 2026-10-14) · implemented on the web

- Title, Artist and Remix & additional production use ONE tokenizer (`web/js/tokens.js`): pills come from Enter or from the exact separators ' - ' (also en and em dash), ' | ', ' / ', ' // ' with spaces on both sides; commas, semicolons, `&`, `feat.` and unspaced `/`, `|`, `-` never split ('Tyler, The Creator', 'AC/DC', 'A-ha'). Edited pills are joined with ' - '; an unedited stored string is kept verbatim. The tag editor keeps its comma rules. iOS is not changed (gap documented in ADD-071).
- Lookups cope with legacy 'A, B' artists locally (whole string first, then the first part), so no data migration is needed.
- Promo noise ('[Free Download]', '(Official Video)') is removed by one function with identical rules on server and web, only on Add, with a Restore hint; the server is authoritative. Existing songs are not rewritten; an optional script does it on request.
- Rejected: a heuristic for artist commas (wrong in both directions); stripping every bracket (it would lose Extended Mix, Remastered, Live).
- Amendment (2026-10-14, Alex): 'Original Mix', 'Original Version' and 'Original' are noise when they are a whole segment (a bracket group, or a trailing segment under the usual ' - ' rule), so 'Rover (Original Mix)' gives 'Rover'. With any other word or a name ('(Tiësto Original Mix)', '(Original Mix Extended)') they stay, and Extended Mix, Radio Edit, Club Mix, Remix, Live and the like are still never removed.


## ADR-0016 Web player chrome: fixed mini-player, queue menu, collapsible sidebar, draggable scrubber

Status: Accepted (Alex, 2026-10-14) · implemented on the web, layout not yet checked in a browser

- Mini-player: a fixed 720px bar (never stretching), centred right of the sidebar, as a raised separate surface (border, shadow, margin) instead of a full-width strip that blended into the list. Two rows: song and transport, then time, progress and volume. It carries icon buttons for the playing song: Edit details, Show in list (scroll and highlight the row, filters kept) and an Add to current playlist toggle. Library is not width-limited. Spec: PLY-117..119, LIB-096, LIB-097, WEB-038.
- Playlist toggle: Library rows and the mini-player show whether the song is in the queue (selected state, click removes), so the queue is visible from the list. Spec: LIB-095, PLY-119.
- Queue menu: every row, played and current included, offers Edit song, Download, Move up/down and Remove; edits keep the current song current by identity, not position, and removing the playing song advances. Spec: PLY-042, PLY-046. Playback song details drop the "..." menu for Download and Edit icon buttons (PLY-072, PLY-102).
- Sidebar: collapsible to a 64px icon rail, remembered per browser (`web/js/sidebar-state.js`). Spec: WEB-037.
- Scrubber: the Playback seek bar and the mini-player progress are one pointer-event slider (`scrubber.js`, pure maths in `scrub.js`), drag with a time bubble, keyboard and `role="slider"`, disabled until a duration is known. Spec: PLY-120..122.
- Song stats page (sub-note): a fifth sidebar destination, `#/stats`, plots year against BPM on a canvas from the songs already in the store (no server change). Two stacked canvases (base redrawn on change, overlay for hover/selection) and a spatial grid keep about 5000 dots smooth without a render loop; a table view is the accessible fallback. Spec: STA-001..030.
- Library row interactions (sub-note): the row is a button-and-card pair instead of a play target. The title button and any empty part of the row open a read-only song card (native `<dialog>`, so focus trap, Esc and inert background come for free; the Edit dialog stacks on top of it and the card repaints from the store). Play moved to the cover, a native button whose pure state model (`row-cover.js`) picks play, pause, resume or download; the current song's state is persistent and semi-opaque, other rows reveal it on hover or focus, and `@media (hover: none)` hides it so a touch tap on the cover plays and a tap elsewhere opens the card. One list-level click handler decides, no per-row listeners. Spec: LIB-120..124, PLY-131, ADD-100.
- Visualizer (sub-note): the audio graph is created lazily, on the first user gesture that enables the visualizer, and the element is routed through it only once the context runs, so plain playback never depends on it (`createMediaElementSource` is irreversible); the analyser drives a 2D canvas visualizer (bars and ring, no WebGL in phase 1) whose loop runs only while playing, visible and on screen. Spec: VIZ-001..035.


## ADR-0017 Server module structure and test strategy

Status: Accepted (Alex, 2026-10-14) · implemented

- `server/app/main.py` only builds the app (middleware, exception handlers, router includes). Routes live in `server/app/routes/`, one `APIRouter` per area: health, auth, me, legacy, files, catalog, genres, lookup, songs, analyze, removal, backfill, legal. Shared state, per-user paths, transactions and the auth and quota dependencies live in `deps.py`; code and tests use `deps.X`, never `main.X`.
- One helper for each repeated job instead of copies: `jsonio` (crash-safe JSON writes), `httpjson` (JSON over HTTP with User-Agent and timeout), `safepath`, `ratelimit`, `timeutil`, `tags`, `links`, `downloads`, `schemas`, `web`, `guest`, `hosts`, `session`, `legal`, `limits`. The web side follows the same rule: `storage.js` (guarded `localStorage`), `constants.js` (breakpoints, timings), and large UI modules split by job (`player-*`, `library-*`, `song-form-*`, `token-drag`, `genre-view`).
- Tests: server line coverage about 99% (`coverage run -m pytest`, measured over `app/*`); web line coverage about 96% (`node --experimental-test-coverage --test web/js/*.test.mjs`, test files excluded), with UI modules tested through a small DOM shim (`web/js/test-dom.mjs`) and a `*.test.mjs` for most modules. 28 of 96 `web/js` modules have no same-named test file (e.g. `storage`, `constants`, `token-drag`, `library-*`, `player-media`, `stats-chart`, `viz-*`) but are exercised through other tests. The shared title-cleaning fixture drives both the Python and the JavaScript implementation. Network, git, `yt-dlp` and `fpcalc` are always faked; no test reaches a real service.
- Coverage is measured manually (last measured 2026-10-14: server about 99%, web about 96%); it is not enforced by `scripts/check.sh`, and `server/requirements-dev.txt` has no coverage tooling (install `coverage` in a throwaway venv).
- `scripts/check.sh` is the gate: every web test file, duplicate requirement IDs, the server test suite. It never deploys.
- Rejected: one big `main.py` with tests patching `main` (every refactor broke unrelated tests); a web build step to bundle modules (the no-build rule of ADR-0003 stays).

## ADR-0018 Public read-only guest view

Status: Accepted (Alex, 2026-10-14; BB2: guests may stream the audio)

- Decision: a web visitor who is not signed in sees the owner's library (the account `PUBLIC_VIEW_EMAIL`, default the owner's email) read-only: Library, Playback, Genres map and Song stats, with a banner "Viewing Alex's library (read-only)". Add, edit, delete, download-to-server, identify and the Settings controls are not shown and their routes stay 401 for anonymous callers. Settings shows only sign-in plus a note. Signing in switches the page to the visitor's own library (ADR-0012); an authenticated non-owner never sees the owner's songs.
- Server: one dependency, `deps.read_user`, is used by a fixed allow-list of GET routes: `/library`, `/tags`, `/genres/graph`, `/catalog`, `/files/{id}` (stream and HEAD only), `/covers/{id}` and `/me` (`/health` was already public). Everything else keeps `require_token`; `test_route_auth.py` pins the allow-list. Guest responses go through `guest.scrub_song` (a whitelist of song fields; `audio.file` and any unknown field are dropped); `/me` answers `{guest, public_view, audio, owner_label}` with no email, uid or usage. Responses on the allow-list carry `Cache-Control: private, no-cache` and `Vary: Cookie, Authorization` for everyone, never `public`.
- Guardrails (in memory, per client IP): 240 requests/min, 1024 MB of audio/hour (Range requests count the bytes they serve), 3 concurrent streams; refusals are 429 `{"error": "guest_limit", "retry_after_minutes"}` with `Retry-After`. Guests cannot use `?download=1` (403 `guest_download_disabled`). The client IP is `CF-Connecting-IP` only when the TCP peer is loopback or a private LAN address (the cloudflared host); a header from any other peer is ignored.
- Kill switches: `PUBLIC_VIEW=0` restores the old behaviour (anonymous gets 401 everywhere); `PUBLIC_AUDIO=0` keeps the metadata public but answers 403 for the audio (`guest_audio_disabled`), and the web then opens the song's YouTube or SoundCloud link instead of playing.
- Risks Alex accepted or must watch: (1) copyright: the audio is downloaded from YouTube, so streaming it to the public widens the ToS and copyright exposure of an app that is not meant for distribution; `PUBLIC_AUDIO=0` is the first step if a complaint arrives. (2) Bandwidth: the home uplink and the Cloudflare Tunnel carry guest audio; the per-IP caps bound one visitor, not a crowd or many IPs. (3) Scraping: a guest can read the whole catalog and stream every file within the caps; the limits slow this down, they do not prevent it. (4) Cloudflare's terms restrict serving large non-HTML media through the proxy on the free plan; heavy guest streaming may breach them, a reason to turn `PUBLIC_AUDIO` off or move audio off the tunnel. (5) IP trust: if the server ever listens publicly, or behind another proxy on a LAN address, `CF-Connecting-IP` could be spoofed to dodge the caps.
- The guest scrub drops the top-level `file` name as well as `audio.file`, and guest streaming returns 404 for songs not in the owner's catalog (no `<video_id>.m4a` fallback). Known gap: business and legal docs (`docs/business/`, `docs/release/legal-draft.md`) are still TODO placeholders while guest streaming is live.
- Rejected: a separate public share link or token (the owner would have to hand it out and rotate it); guest downloads; per-guest accounts; a static export of the catalog (no audio, no live state).


### Public guest view: copyright note and no-index (BQ1, 2026-10-14)

- A fixed note (NFR-095) sits in the footer of the guest view and Settings; per-song credit is the artist and source links on the song card. `LEGAL_CONTACT` (optional; a dedicated alias, not a personal address) turns "contact the owner" into a link. `GET /legal` serves it (public, 5 min cache) because the guest `/me` keys are frozen.
- No-index (NFR-094): `X-Robots-Tag` on every response, `/robots.txt` disallows all, meta robots in `index.html`.


## ADR-0019 Domain migration to electrophone.cc: dual host, then a canonical redirect

Status: Accepted (Alex, 2026-10-14)

- Decision: serve the same app on `play.isayenko.net` and `electrophone.cc` (two tunnel hostnames to one service) until the new host is proven, then set `CANONICAL_HOST=electrophone.cc` so GET/HEAD on any other host answer 308 to the same path and query. Runbook: [domain-migration.md](domain-migration.md).
- Server, all env, defaults unchanged: `PUBLIC_HOSTS` (validated hostnames; absolute URLs are only built from these), `CANONICAL_HOST` (unset = no redirect; `hosts.EXEMPT_PATHS` = `/health`, `/robots.txt`, `/legal` and non-GET/HEAD methods are never redirected), `OAUTH_REDIRECT_URIS` (the Apple web redirect per host). `X-Forwarded-Host` is read only when the peer is loopback or LAN, like `CF-Connecting-IP`.
- Sessions: the cookie has no `Domain`, so it is host-only and each host has its own sign-in; users sign in again on the new host. The CSRF check (custom header plus an Origin equal to the Host) holds on every host.
- Sign-in: Google and Apple consoles must list the new origin and return URL (add, never replace); a rejected address shows "This address is not registered with ... sign-in yet".
- Rejected: a cookie `Domain` shared across both hosts (not possible across different registrable domains); a redirect on every method (it would break a POST in flight).
- Amendment 2026-10-14 (owner): `play.isayenko.net` is removed entirely, with no redirect. Its DNS record is deleted and electrophone.cc is the only hostname; the dual-host and redirect steps above are historical. Installed iOS builds that still store the old URL are rewritten to the default by `Settings.init`.

## ADR-0020 Connect YouTube: read-only playlist import by Google OAuth

Status: Accepted (Alex, 2026-10-16; task-0032; scope: owner-only first, Google verification deferred)

- Decision: a signed-in user can connect a Google account with the scope `youtube.readonly` (separate Web-application OAuth client, redirect `https://electrophone.cc/yt/callback`, `access_type=offline`) and import chosen playlists and Liked videos as catalog songs without audio (ADR-0010), deduplicated on the YouTube video id. Spec: [youtube-connect.md](../specs/youtube-connect.md).
- Security: the refresh token is encrypted (Fernet, key derived from `AUDIO_SESSION_SECRET`) in `/var/lib/audioplayer/secrets/<uid>.json` (0600), outside the git-synced data dir, never logged; client id and secret live in `/etc/audioplayer/env`; the OAuth `state` is signed and bound to the user.
- Quotas (ADR-0012): a metadata-only import does not use the hourly add limit but is limited to 6 per hour and stops at the 500-song cap; the owner is exempt as before.
- Decided (Alex, 2026-10-16): CW owner only first (phase 3, all users, waits for Google verification); CX Production, unverified consent (no 7-day refresh expiry, 100-user cap; delegated to the recommendation); CY songs plus an Electrophone playlist per imported list with Refresh (delegated to the recommendation).
- Rejected: scraping YouTube Music (no official API for the private library); storing the token in the library repo (git history is permanent).

## ADR-0021 Genre families follow Discogs genres

Status: Accepted (Alex, 2026-10-16; DF1; task-0033)

- Context: the Genres map groups and colours nodes by a top-level family. The families were assigned from a hand-made keyword and Wikidata map (GEN-008), which leaves many nodes in Other and is hard to review.
- Decision: the families are the 15 Discogs genres (Blues, Brass & Military, Children's, Classical, Electronic, Folk, World, & Country, Funk / Soul, Hip Hop, Jazz, Latin, Non-Music, Pop, Reggae, Rock, Stage & Screen) plus Other. A reviewed table `server/data/genre_families.json`, seeded from the Discogs styles, maps nodes to families; the rest inherit from ancestors, then the umbrella rule, then Other. Spec: GEN-037 to GEN-042 in [genres.md](../specs/genres.md).
- Consequences: one stable, public taxonomy with a style-to-genre mapping already made; most nodes get a family without keywords. Brass & Military, Children's and Non-Music are rare and are hidden when empty. The table is data to maintain in git. The family palette (16 colours) must be added to the design system and re-exported (ADR-0009). Existing colour assignments migrate by family name.
- Rejected: the Apple Music genre list (51 entries, regional and use-case noise); AllMusic (no API); MusicBrainz genres (flat, no top level); Wikidata (no common root, the current source of loose nodes); the current keyword families (many nodes end in Other).
- Amended 2026-10-16: the open point of the outline is decided in ADR-0023 (Discogs style as the second outline level, strict canonical vocabulary); the family table becomes part of the vocabulary files there.

## ADR-0022 Playlists

Status: Accepted (Alex, 2026-10-16; task-0034)

- Context: the catalog (ADR-0010) lists every song and the play queue is transient. Alex wants named, organised, importable and exportable lists, and Connect YouTube (ADR-0020) and Spotify import (CAT-015) both need somewhere to put imported lists.
- Decision: Playlists is a top-level feature that owns the playlist data model. Each user's playlists and folders are stored in the git-synced store as `playlists.json` next to `library.json` (DATA-110): opaque server-generated ids, a tree via `parent_id` (depth cap 5) with user-defined `position` among siblings, entries are `{song_id, added}` references (a song may be in many playlists; no audio or metadata is copied, so the 500-song cap is untouched). A smart playlist is the same entity with `smart: true` and `rules` and no stored entries, evaluated live. Imports (YouTube and SoundCloud links via yt-dlp, Spotify public links via client credentials, Connect YouTube, M3U8/CSV/JSON files) create playlists with a remembered `source` and a diff Refresh; export is M3U8 (default), CSV and JSON. Playlists are visible to guests like the library (ADR-0018). Phasing: placeholder menu item, then web CRUD, hierarchy and export, then import and Refresh, then iOS, smart playlists and sharing.
- Consequences: YTC-030 no longer has its own storage; the UI word "playlist" stops meaning the queue ("Add to queue", "Add to playlist..." picker). A new file to migrate and back up. Guests see every playlist until a private flag exists.
- Rejected: a playlist table in a database (breaks the git-synced store, ADR-0001-style sync); storing songs inside playlists (duplicates and drifts from the catalog); one flat list without folders; a separate store per import source.

## ADR-0023 Canonical genre vocabulary

Status: Accepted (Alex, 2026-10-16; DK1, DM1; task-0035; server side built 2026-10-16: vocabulary files, strict writes, migration review, `style` per graph node; web picker and hybrid outline built and deployed 2026-10-16)

- Context: genre tags are free text, so the library collects spelling variants, vague tags and non-genres, and the Genres map outline is full of Wikidata umbrella categories (GEN-036). ADR-0021 fixed the families only.
- Decision: (1) The genre vocabulary is strict: the 15 Discogs genres, about 550 Discogs styles (`server/data/genre_styles.json`, style to genre) and a reviewed extras file for real genres Discogs lacks (`server/data/genre_extras.json`, each with family and parent: electronic, dance, singer-songwriter, darksynth, neurofunk, melodic techno, nu-nrg, uplifting trance, darkwave and the like). Any other `genre:` value is rejected on write with HTTP 422 and a "did you mean" list; the genre input is a picker over the list, no free text; ALIASES map spellings to canonical names, RETAGS fold vague tags; the startup migration maps existing tags and writes unmappable ones to a review file instead of deleting them; the list is data, loaded once and checked by tests. (2) The outline is hybrid: Discogs genre (family), then the Discogs style, then Wikidata's finer subgenres (Electronic > Trance > Progressive trance); a Wikidata node hangs on its style or its nearest ancestor that is one, and the Wikidata umbrella chain never appears; the GEN-036 skip list is a fallback only. Specs: GEN-046 to GEN-050 in [genres.md](../specs/genres.md), TAG-077 to TAG-084 in [tags.md](../specs/tags.md). Builds on ADR-0021.
- Consequences: one reviewable taxonomy; the Library genre filter and the map share it; a new file or two to maintain in git; the Discogs list is imported once and refreshed by hand (TAG-084, terms checked); clients (web, later iOS) must offer a picker; the keyword and Wikidata-derived tags that are not in the list need an alias, a retag or an extras entry first. A tag Discogs does not know must be added to the extras file before it can be used.
- Built (phases 1 and 2, 2026-10-16): `server/data/genre_styles.json` (512 styles under the 15 genres, each checked against the public Discogs search) and `genre_extras.json` (65 extras); `genre_families.json` is retired; the review file is `backups-genre-merge/review-<uid>.json` (not under `AUDIO_DATA_DIR`, so it is never git-synced); Discogs styles that TAG-073 drops or TAG-075 retags are left out of the list.
- Rejected: keeping free text with soft suggestions (variants return); Wikidata as the vocabulary (no common root, umbrella noise); Discogs styles only without extras (loses real genres such as electronic, singer-songwriter, neurofunk); deleting unmappable tags in the migration (silent data loss); a style-less two-level outline (the style level is what users browse by).
- Amended 2026-10-19 by ADR-0030: the words are renamed (a Discogs style is a genre of ours, a Discogs genre is a family) and the relations become `parents` lists; the text above keeps the old words as the historical record. `genre_styles.json` is now `genre_discogs.json`.

## ADR-0024 Structured credits and versions

Status: Accepted (Alex, 2026-10-16; task-0036; built and deployed 2026-10-16)

- Context: songs stored flat strings (`artist` joined by `&`, `,`, `feat.`; `remixer` as a name, a remix title or a mixing credit; `year` sometimes an upload year), which cannot express a cover, a live version or a second main artist, and the iOS app decodes those keys.
- Decision: the stored song has `title`, `artists`, `featured`, `released`, an optional `version {kind, name, by, year, of}` and an immutable `raw`. The four legacy keys are derived in every response (`credits.project`) and accepted in requests as a conversion to the structure, with a no-op rule for values equal to the projection, so the iOS app is unchanged. Structure keys in a request shadow the legacy keys of their group. One idempotent startup migration (backup in `backups-credits/`, review file, lazy conversion at load) converts old songs without splitting any credit: one `artists` entry per existing pill, `version.by` empty, `kind` remix. Splitting is a suggestion (`credits_split`) the user applies in the form. Decision AR: `released` comes only from Wikipedia, MusicBrainz, Discogs; a version never gets a MusicBrainz or Discogs id. Design: [metadata-model-design](metadata-model-design.md). Specs: DATA-120 to DATA-139, API-120 to API-135, IOS-072 to IOS-074.
- Consequences: one editable source of truth; all readers go through `credits.py`; the catalog revision changes once; rollback of the server needs the pre-migration backup and loses later edits; migrated songs have empty `by` until a person accepts a suggestion; old `year` values that were upload years cannot be told apart.
- Rejected: parsing credits automatically in the migration (ambiguous, would rewrite user data); keeping the legacy fields stored beside the structure (two sources of truth); appending the version to `title` for old clients (gives `title` two meanings); filling `by` from the remixer pills (credited text is not a person).

## ADR-0025 Data model v2 and the song versions concept

Status: Accepted (Alex, 2026-10-16: "ok, I like it"; the country and Artist-table parts are superseded by [ADR-0031](#adr-0031-countries-stay-on-the-song-the-artist-table-is-removed); task-0043 built on branch worktree-agent-a9ef527b632364730, not deployed; the cover rule, the mashup kind and the `of` list of ADR-0024 are built, not deployed). Builds on ADR-0024. Spec: DATA-144 to DATA-155 in [data-model.md](../specs/data-model.md#data-model-v2-final-model-approved-2026-10-16). Concept in plain words: [concept-songs-versions-and-credits.md](../product/concept-songs-versions-and-credits.md). Terminology research: [ddex-terminology.md](ddex-terminology.md).

- Context: the ADR-0024 names drifted (`artists`, `released`, `version.kind/by/of`, singular `album`, composite `raw`), `decade:`, `lang:` and `country:` were stored as tags although they are facts derived from other fields, and the model could not say who a cover, a remix or a mashup is "by". One final model now, so the data changes shape only once.
- Decision, shape: `Song {id, title (base title only), mainArtists[], featuredArtists[], releaseYear, albums[], genres[], tags[], version?, sources[], audio, rawTitle}` and `Artist {name, countries[]?}`. Nouns, not adjectives (`releaseYear`, `mainArtists`, `featuredArtists`, `albums[]`); `albums[0]` is the original album when known.
- Decision, version: a version is a derivation block `{type, name, artists[], releaseYear, originalArtists[]?}` and exists only when the song is not the plain original. `type` is the DDEX `VersionType` idea with our own values: remix, cover, mashup, live, acoustic, extended, instrumental, remaster, edit, other. `name` is the credited text exactly as written. Nothing about a source (ids, genres, albums, links, years) is ever applied to a version.
- Definitions, who is credited where:
  - Cover: someone else re-performs the song. The performer is a MAIN artist; the original artist goes in `version.originalArtists` (one name). Display `Teemid - Crazy (cover)`, details "Cover of Gnarls Barkley".
  - Remix: a reworking of the original recording. The original artist stays a MAIN artist; the remixer goes in `version.artists`.
  - Mashup: a new work made from several songs. Its makers are the MAIN artists; the sources go in `version.originalArtists` (several names).
  - Live, acoustic, extended, instrumental, remaster, edit: the same artist and no new credited person, unless a remixer or mixer is credited (then `version.artists`).
  - `originalArtists` exists only for cover and mashup and is optional and nullable (absent when unknown or for any other type).
- Decision, derived and removed: `decade` is computed at runtime from `releaseYear` (and `version.releaseYear`), so `decade:` tags go; `lang:` tags are discarded and no longer looked up; `country:` moves from the song to the Artist table, filled by a MusicBrainz or Wikipedia lookup of the main artists and editable. The legacy fields `artist`, `remixer`, `remix_year`, `year`, `album` stay derived in every response, so the iOS app, which reads only those, is unchanged.
- Decision, release year (decision AR, unchanged): `releaseYear` comes only from Wikipedia, MusicBrainz or Discogs, never from the upload date; the upload year feeds only a marked suggestion for `version.releaseYear` ([details](metadata-model-decisions-AR.md)).
- Decision, lookups (task-0042): album-first source ranking and the version genre rule (TAG-088 to TAG-094): a version never inherits the original's genres, a hint may show them; the `rejected_genres` guard remembers genres the user removed so a lookup does not bring them back; a MusicBrainz artist credit (with its join phrases) replaces the title-parsed main/featured split as a suggestion, so a title "Gisele Bündchen - Heart of Glass ft. Bob Sinclar" becomes two main artists when MusicBrainz credits "Gisele & Bob Sinclar"; cover detection follows the recording's work and suggests `cover` with the work's original artist when it differs from the credited artists. All are suggestions to confirm, never applied silently; a title that says "(X Cover)" wins (ADD-126).
- DDEX adopted only where it fits: the two display-artist role names (`MainArtist`, `FeaturedArtist`, as list names) and `VersionType` (as `version.type`). Facts verified from the official allowed-value file (AVS 12): the `DisplayArtistRole` values `Artist` and `Composer` are deprecated; `VersionType` has no cover, mashup, acoustic, extended or remaster; a cover is a relation (`ResourceRelationshipType` `IsCoverOf`; also `IsSlowedDownOf`, `IsSpedUpOf`, `IsEditedVersionOf`); a mashup is a work-level type (`MusicalWorkType` Mashup); `ContributorRole` defines Remixer, RemixedArtist and Mixer; the genre lists are 17 `ClassifiedGenre` plus 483 `SubGenre` values and contain no dark or forest psytrance and no liquid drum and bass. Everything else is Electrophone-specific.
- Rejected: full DDEX (works, releases, parties, contributors per role): over-engineering for a flat personal library, no screen shows those facts, every entity adds migrations, forms and lookups, and DDEX has no cover type and no "year of the original" on a cover; a Work entity, a recording chain or tree and a full Artist entity (freeze BT1: deferred, revisit when a feature needs works or artist identities, DATA-155); keeping `decade:`, `lang:` and `country:` tags (stored copies drift from `releaseYear` and the artist); adjective field names; `originalArtists` on every version (only cover and mashup have a source song); applying the original's ids, album or genres to a version.
- Migration safety: one idempotent startup migration per user, after the credits migration, with a one-time backup (`backups-model2`, outside the git tree like `backups-credits`) and a review file for countries that cannot be assigned safely; a dry run on a copy of the live library must show the derived legacy fields (`artist`, `remixer`, `year`, `remix_year`, `album`) identical for every song, and any difference aborts the run; old key names are accepted on input during a transition; `rawTitle` replaces `raw` only when that check holds; the Artist table is built from main-artist names without auto-splitting; tag removal is counted per prefix.
- Release safety lesson: the metadata work went to a branch before `main`, so an unfinished state never reached production, and the deploy checks compare every song (not a sample) before and after. Rollback of the server across the migration needs the backup and loses later edits.
- Consequences: one set of final names; the web, API, stats, filters and share links that read decade, lang and country tags move to computed values or the Artist table (list in task-0043); the API gains artist endpoints; old code cannot read the migrated file.

## ADR-0026 Per-save local commit; a timer pushes

Status: Accepted, built, not deployed (Alex, 2026-10-16, BZ1; [task-0021](../tasks/task-0021.md); design and contract: [git-sync-design](git-sync-design.md)). Amends ADR-0005: git-per-save history is kept; only the timing of push and pull changes.

- Context: every save runs `git pull --rebase`, a commit and `git push` for both data repos inside the git lock, so a save takes about 10 s over SSH to GitHub and the request waits for the network.
- Decision, single writer: only the `audioplayer` server user commits to `data-storage` and `data-storage-lfs` (the code repo is separate). Assumption to verify with Alex: nobody edits the data repos by hand or from another host. Everything below depends on it.
- Amended by ADR-0027: commits stay single-writer, but the timer now also fast-forwards from GitHub; a diverged repo is the error case instead of any foreign commit.
- Decision, saves: the server writes `library.json` and covers atomically (temp file in the same directory, then rename) under the existing lock, then `git add` and `git commit` of the changed files under the same lock, with the same per-save message as today (for example `edit: <artist> - <title>`), and returns. No pull and no push in a request. A local commit costs tens of milliseconds. Pull happens only at server startup (the existing resync).
- Decision, push: a systemd timer `audioplayer-gitsync.timer` (every 60 s, `Persistent=true`) starts `audioplayer-gitsync.service`, the CLI `python -m app.gitsync`, which only runs `git push` for each repo that has unpushed commits (the covers repo only when it has some). It takes no lock: a push does not touch the working tree, so saves never wait on the timer, and a save landing during a push is just another commit pushed next tick. Audio never goes into git.
- Decision, rejected push: a non-fast-forward rejection means the single-writer rule was broken. The timer stops pushing that repo, sets `sync.state = error` (`/health`, Settings card), alerts, and nothing merges or rebases automatically. Manual runbook in [deploy.md](deploy.md#git-sync-timer): fetch, inspect, rebase by hand, restart the timer.
- Decision, sync state: the server exposes `sync: {state, unpushed, oldest_unpushed_age_s, last_push_at}` in `/health` and the Settings sync card API. `ok` = no unpushed commits and a clean tree; `pending` = unpushed commits and the oldest is younger than the stale threshold (normal, no mark); `stale` = the oldest unpushed commit is older than the threshold; `error` = a rejected push or 5 consecutive push failures. The age is the committer time of the oldest unpushed commit against now (not against the last push), so an idle server with nothing to push never goes stale. Guests get only `ok` or a generic `degraded`, no counts and no times.
- Decision, threshold (a choice made here): the stale threshold is the timer interval plus 30 s, default 90 s with the 60 s interval. Alex asked for a mark after 1 minute without a successful push; a threshold of exactly 60 s equals the tick interval, so a single slow or skipped tick (a push takes several seconds, systemd jitter) would flash the mark on a healthy system. 90 s still warns within a minute and a half and one skipped tick does not flip it. The threshold is derived from the interval, never a separate number.
- Decision, UI: `stale` shows a warning mark on the Settings sync card with the text "last pushed N min ago" and the unpushed count, and a small dot on the Settings navigation item; `error` shows a stronger mark and the same dot. Tokens-only warning style (ADR-0009), an accessible label ("Sync is behind: N changes not pushed" / "Sync failed"), and the marks clear on their own when a push succeeds. A failing push retries every tick; an alert is raised after 5 consecutive failures (alert channel open).
- Decision, startup: if the previous run left unpushed commits or a dirty tree, the server commits the tree, fetches and fast-forwards only (never a rebase or merge; a diverged repo is `rejected`), then pushes before the migrations run and the server accepts writes. The earlier text "pull only at startup (the existing resync)" was wrong: `resync` only detected unpushed commits and never pulled (correction 2026-10-16, git-sync-design C4).
- Decision, clients: web and iOS NEVER talk to GitHub. They call the server API; only the timer talks to GitHub. Older text that says a change "is committed to the repo" describes the stored result, not a client action.
- Decision, rollout: the old synchronous path stays behind `GIT_SYNC_MODE=request|timer` (default `timer` after the build, `request` kept as the rollback; the app shows `pending`, then `stale`, until root installs the timer) for one release, then it is removed. This is option 1 of task-0021 with a timer as the worker instead of a debounced thread.
- Consequences: saves return in well under 1 s (NFR-111); per-save history is kept (no autosave messages, no journal); the migration backup folders (`backups-credits/`, `backups-genre-merge/`) lie outside the tracked `audioplayer/` tree and are never committed or pushed (correction 2026-10-16, git-sync-design C5); every user's `users/<uid>/` files are pushed in the same pass.
- Risks and mitigations: (1) the durability window before the push is about 1 minute and a local commit does not protect against loss of the disk: short interval, `Persistent=true`, a final push on clean shutdown, a push at startup, and the stale mark makes a stuck push visible; (2) a broken single-writer rule: the rejected push stops that repo, alerts and never merges silently; (3) deploy ordering: the deploy user `claude` cannot write `/etc/systemd`, so root installs the unit files once (or the sudo-enabled deploy helper does) before `GIT_SYNC_MODE=timer` is set; (4) rollback: set `GIT_SYNC_MODE=request`, `systemctl disable --now audioplayer-gitsync.timer`, restart the server; leftover commits are pushed by one manual `python -m app.gitsync`.
- Rejected: a background push thread inside the server (a worker bug loses wakeups, shares a process with requests); a timer that pulls and rebases (needs a lock, makes saves wait, merges silently under a broken single-writer rule); dropping the per-save pull only (keeps the push in the request); a timer that commits snapshots with "autosave" messages and a journal (loses per-save history); SSH `ControlMaster` alone (saves the handshake, not the round trips); the GitHub contents API (rewrite, API limits, no LFS parity); a database now (a separate decision in task-0021).
- Open: the alert channel for 5 failures; verify the single-writer assumption with Alex.

## ADR-0027 Inbound fast-forward in the sync timer; amends ADR-0026

Status: Accepted, built, not deployed (Alex, 2026-10-17, CI1). Amends ADR-0026 (single writer, "the timer takes no lock and never pulls") and the wording of NFR-114.

- Context: ADR-0026 made any change made outside the server a hard error. Alex wants to fix data in GitHub (edit a file in `data-storage`, or push from another clone) and have the server pick it up within a minute, without a restart or an SSH session.
- Decision, single writer for commits: only the `audioplayer` server user creates commits on the server's clone, and the server never merges or rebases. Inbound changes are allowed in exactly one form: a fast-forward of commits that already exist on `origin`.
- Decision, timer pass: `python -m app.gitsync` (every 60 s) runs, per repo (`data-storage`, `data-storage-lfs`): `git fetch`; if `origin` is ahead and the local branch has no unpushed commits, `git merge --ff-only`; if local is ahead only, the existing push; if both have new commits (diverged), it neither pulls nor pushes, sets `sync.state = error` ("data diverged: GitHub and the server both have new commits; resolve by hand"), logs at ERROR every run and clears itself once the repos agree again (not sticky, no `--clear-rejected`). A push rejected because `origin` moved after the fetch becomes the same diverged state instead of the sticky `rejected` flag. Never a rebase, a merge commit or a force.
- Decision, lock: the pull rewrites `library.json` under the running server, so saves and the pull share one cross-process `flock` on `<GIT_SYNC_STATE_FILE>.write.lock`, on top of the in-process lock. `deps.tx` (via `GitSync.transaction()`), `commit()`, the cover write in `downloads.py` and the startup recovery take it blocking (30 s cap, then the save fails with "git write lock busy"); the timer takes it non-blocking with a 0.5 s wait only around the fast-forward (the fetch and the push run outside it) and, if busy, skips the pull and retries next minute. A save never starts while files are being rewritten, and the timer holds the lock only for the local git steps (about 0.2 s in a rehearsal on WSL over a 9p mount, less on ext4).
- Decision, validation: before the fast-forward every changed `library.json` and `profile.json` is read from the incoming commit (`git show`) and must parse and pass the library loader (`library.normalize`); if not, nothing is applied (state `error`, "inbound change invalid (path)", ERROR log naming the file, retried every run until GitHub is fixed). After the merge the files on disk are checked again and, if that fails, `git reset --hard` returns to the previous HEAD (safety net; not reachable by content alone).
- Decision, freshness: the server holds no in-memory copy of a library or profile (every request reads the file), so a pulled change is visible on the next request; no mtime check is needed. A request that reads a library while git rewrites it can see a missing file for a few milliseconds and return an empty list once; it never writes it back (writes hold the lock).
- Decision, state: the state file gains `last_pull_at` and per repo `behind`, `inbound_error`; `/health` owner form gains `inbound: {enabled, last_pull_at, behind}` (additive, API-144). `GIT_SYNC_INBOUND=0` (default `1`) turns the whole step off and restores ADR-0026 behaviour exactly (sticky `rejected`), for rollback.
- Startup: the existing fetch and fast-forward goes through the same validation and lock; a diverged repo is logged and shown as `error` by the first timer pass instead of being marked `rejected`.
- Consequences: data can be corrected in GitHub in about a minute. A fix and a server save inside the same minute make the repos diverge: the operator rebases by hand (runbook in [deploy.md](deploy.md#fixing-data-from-github-inbound-fast-forward)). Editing the same data by hand on GitHub is only safe as a fast-forward of the server's last pushed commit, which GitHub's web editor and a normal `git push` from a current clone both produce.
- Rejected: pulling with `--rebase` or merge (silent merges of hand edits, conflicts in `library.json`); pulling inside the request (puts the network back into a save, NFR-111); a pull without a lock (a save could write a file git is replacing); validating only after the merge (a bad file would be live for the validation window).

## ADR-0028 Rebase over foreign commits outside the owned paths; amends ADR-0027 and NFR-114

Status: Accepted, built, not deployed (Alex, 2026-10-17, CU1). Amends ADR-0027 (a repo where both sides have new commits is always an error; the server never rebases) and the wording of NFR-114.

- Context: the data repo (`data-storage`, branch `main`) is also written by another app, `moodtracker`, which pushes commits under `moodtracker/users/<id>/...` from outside the server. Whenever it pushed between two timer passes while the server had unpushed commits, the pass saw "diverged", stopped with exit 2 and `data diverged: GitHub and the server both have new commits; resolve by hand`, and stayed that way until someone rebased by hand.
- Decision, ownership: there is still exactly one writer for the owned paths. The server owns the paths under `GIT_SYNC_OWNED_PREFIXES` (comma-separated, default `audioplayer/`; both repos: `data-storage` holds `audioplayer/users/<uid>/{library,profile}.json`, `data-storage-lfs` holds `audioplayer/users/<uid>/covers/`, and saves stage exactly `audioplayer/` in both, so the one default fits; keep the variable equal to what saves stage). Other apps may write any other path of the same repo. Nobody else may write an owned path.
- Decision, rule: when the local branch has unpushed commits and `origin` has new commits, the timer takes the paths touched by every GitHub-only commit (`git log --name-only --no-renames -m` over `merge-base..@{u}`) and by every local-only commit. If no GitHub-only commit touches an owned path, and no path is touched on both sides, it runs `git rebase @{u}` on the local commits and then pushes (plain push, never a force, never a merge commit; a local merge commit refuses the rebase). Only local, unpushed commits are rewritten; nothing already on GitHub is rewritten. If a GitHub-only commit touches an owned path (or a path both sides changed), the result is the same error as before (ADR-0027) and nothing changes.
- Decision, safety: the rebase runs under the same cross-process write lock as saves (`try_exclusive`, 0.5 s wait; busy means skip and retry next minute), so a save never starts mid-rebase; the fetch and the push stay outside the lock. On any rebase failure (conflict or anything unexpected) the timer runs `git rebase --abort`, restores the exact previous `HEAD` (`git reset --hard <old>` if needed) and sets the diverged error as before. After a successful rebase every `library.json` and `profile.json` in the rebased tree must parse and pass `library.normalize` (read from the tree); otherwise `HEAD` is restored and the state is `error` "inbound change invalid after rebase (path)". A stuck sticky `rejected` flag is cleared by a successful rebase.
- Decision, fast-forward: when only GitHub is ahead, the validation of ADR-0027 applies only to changed files under an owned prefix; a push that touches only other paths is fast-forwarded without reading any `library.json`.
- Decision, race: if the push is rejected because the other app pushed again after the fetch and the new commits are outside the owned paths, it is a push failure counted by the existing consecutive-failure logic (`FAILS_BEFORE_ERROR`, 5): the next run rebases again. A rejection caused by an owned-path change is the diverged error as before. The state file gains per repo `last_rebase_at` and `foreign_commits` (cumulative commits rebased over); `/health` owner `inbound` gains `foreign_commits` and `last_rebase_at` (additive, API-144). The pass logs INFO "rebased N local commits over M foreign commits (paths outside audioplayer/)".
- Decision, switches: `GIT_SYNC_REBASE_FOREIGN=0` (default `1`) restores ADR-0027 behaviour exactly (any divergence is an error); `GIT_SYNC_INBOUND=0` still turns the whole inbound step off and wins.
- Consequences: the other app's pushes no longer stop the server's sync; the server's history is rewritten only for commits that were never pushed. A real overlap (someone edited our files) still needs an operator ([deploy.md](deploy.md#fixing-data-from-github-inbound-fast-forward)).
- Rejected: merge commits (they would enter the shared history); rebasing when GitHub touches owned paths (silent conflict in `library.json`); a force push (could drop the other app's commits); a separate repo for the other app (not under our control); skipping the lock (a save could write a file mid-rebase).

## ADR-0029 Native macOS target with the web GUI, streaming only in v1

Status: Accepted, built (builds only; not tested with a real account) (Alex, 2026-10-17, task-0047).

- Context: Alex wants the app on the Mac with the same look and pages as the web UI. The key principle (playback and offline reliability) still ranks above features.
- Decision, target: a second XcodeGen target `ElectrophoneMac` (macOS 14, SwiftUI, AVPlayer) in `ios/`, sharing the iOS models, `APIClient`, `AuthService`, `PlayerService`, `LibraryStore` and the generated `DesignTokens.swift`; Mac-only views live in `ios/MacSources/`. The layout follows the web (sidebar, library table, song card, bottom transport bar), see [macos-gui.md](../specs/macos-gui.md).
- Decision, streaming only: the Mac plays audio from the server (`GET /files/{id}`, Bearer header) like the web and never downloads audio to the device in v1; the catalog sync does not auto-download. "Download" in the Mac UI means asking the server to fetch audio, as on the web. Offline reliability is still the iOS app's job; a Mac cache can follow (spec open question B).
- Decision, scope: Library, Playback, Add and Edit, Settings and sign-in only; no placeholder pages (MAC-001). Amended 2026-10-17: Playlists (the web's placeholder), Genres map, Song stats, Music theory and a Mirrored spectrum / Ring visualizer were added at Alex's request; they are untested on a real UI.
- Consequences: no Mac icon yet, the Google client id may need a Mac OAuth client, the visualizer tap is unverified on the real stream (needs Range support on `/files`), and the share link, song info and Genres map rework are later.
- Rejected: Mac Catalyst (the iPhone layout would be scaled, not rebuilt as the web grid, and the playback and sidebar controls would stay touch-first); a web view wrapper (no media keys or Now Playing integration without extra native code, no Keychain sign-in, and the app would depend on the browser engine's background audio rules).

## ADR-0030 Genre terminology: all levels are genres, level 1 is a family; genres have parents

Status: Accepted (Alex, 2026-10-19), amends ADR-0023; built, not deployed.

- Context: ADR-0023 used Discogs's words: the 11 level-1 names were "genres" and everything below them "styles", while the song field and the tags are all called `genre`. That made "genre" mean two things (a node of any level, and the level-1 group) and put a Discogs word ("style") into the UI, the docs, the data keys and the code.
- Decision, words: every node of the vocabulary is a genre. Level 1 is a **family** (the 11 of GEN-037, plus "Other" on the map), level 2 a sub-genre, level 3 a sub-sub-genre; the word "style" is not used for a genre anywhere. It stays only where it quotes Discogs: the Discogs API (`styles` in a release, the `style=` search parameter, `discogs_lookup.py`), and one sentence in the docs: Discogs genre (Discogs calls it a style). The stored song data does not change: `genres[]` and `genre:<name>` hold bare genre names as before.
- Decision, data shape: a genre has `parents`, a list, replacing `parent`, `also_under` and `also_in_genres` (GEN-057). `parents[0]` is the primary parent (a family or another genre) and decides the level (2 under a family, else 1 + the level of that parent, hard cap three levels), the family and the default outline position; the other entries are extra parents, drawn as cross-links (a family among them lists the genre in that family's tree too). An optional `family` chooses among the families of a level 3 genre's primary parent (the disco children). Validation: every parent resolves, no cycle, parents unique, no level 4.
- Decision, files and keys: `genre_styles.json` becomes `genre_discogs.json` (its content is the Discogs genres, so the old name would keep the old word; the file is only read by `genre_vocab.py` and tests, so the rename is safe): `genres` (the 11 level-1 names) becomes `families`, `styles` becomes `genres` (name to its parents, a list of families, replacing `also_under`). `genre_extras.json` keeps its name; `parent` and `family` become `parents` (family stays only as the override). `genre_levels.json` keeps its name; its `genres` block becomes `families`, `genre` becomes `family` (derived from `parents[0]`, stored only as an override), `parent` and `also_under` and `also_in_genres` become `parents`. `genre_parents.json` (manual Wikidata edges) already lists parents and is unchanged. Python: `resolve_styles`, `node_style`, `_nearest_style`, `is_style` become `resolve_anchors`, `own_anchor`, `_nearest_anchor`, `is_below_family`.
- Decision, HTTP payload: `GET /genres/vocabulary` serves `level` `family` or `genre` (was `genre` or `style`), `parents` (a list) instead of `parent` and `also_under`, `levels[genre]` with `family`, `parents` and `level` instead of `genre`, `parent`, `also_under` and `also_in_genres`, and `family_synonyms` (was `genre_synonyms`). The iOS and macOS apps do not decode this endpoint (checked in `ios/Sources` and `ios/MacSources`), so the web and the server change together, with no compatibility fields. `GET /genres/graph` nodes gain `anchor`; `style` stays with the same value because the macOS app (`GenData.swift`, `GenWire`) decodes it and cannot be rebuilt on the Windows machine; remove `style` with the next macOS build.
- Consequences: behaviour is unchanged: a snapshot of the tree, counts per family, cross-links, outline rows and radial layouts taken from the old data is identical to the tree built from `parents` (`web/js/genre-parents.test.mjs`, `server/tests/test_genre_parents_snapshot.py`). Old task files and ADRs keep the old words as history. Two owner data edits ride on the same change, applied after the proof: `spacesynth` gets parents `synthwave`, `italo disco` (level 3 under synthwave, italo disco a cross-link; it was level 2 with `also_under` italo disco), and a new approved extra `space disco` (parents `disco`, family Electronic, level 3).
- Rejected: keeping `level: "style"` in the payload next to the new values (nothing decodes it); calling level 1 "top-level genre" (it clashes with the genre field of a song); keeping the file name `genre_styles.json` (it is not a risk to rename: no script reads it); deriving the family without the override (the disco children would move from Electronic to Funk / Soul and change the map).

- Note 2026-10-19 (owner decision DB1): the 23 Discogs genres filed under two families but kept under one in our data now list the second family as an extra parent (disco already did), and an optional boolean `fusion` on a genre marks a blend of two families (12 genres) whose extra family parents the Genres map shows only when its "Fusion genres" toggle is on; the other 12 multi-family genres always show them (GEN-061). No change to levels, families or counts.
- Note 2026-10-19 (owner decisions DH2, DI1, DJ1): a genre may carry `related` (associations and influences: a list of genre keys or family names; no effect on the tree, levels, families, counts or colours; served in `levels[genre].related` when non-empty); 22 reviewed association links moved from `parents` to `related` (gospel changes family to Folk, World, & Country; `fusion` dropped on trap and acid jazz). Genres display in lowercase (families keep capitals), and the key `soviet wave` became `sovietwave`, migrated in stored tags at startup. Electronic genres got a `subfamily` (eight names declared in `genre_levels.json`, DY1), `edm` became a genre and eurobeat a synonym of eurodance (EDM, ED1). Nine reviewed Rock extras were added (DN3) and electro got the synonyms electro-funk and electrofunk (DO1). Details in [genre-levels.md](genre-levels.md).
- Note 2026-10-19 (owner decision DR1): the Rock tree is drafted: Rock has 41 level 2 and 69 level 3 genres (after the removal of lo-fi, 2026-10-20), parents follow the Wikipedia lead sentences, a level 3 parent (hardcore punk, extreme metal, death-doom, neo-psychedelia, ...) is only ever an extra parent so the three-level cap holds, death metal, black metal, post-punk and industrial rock stay level 2 with a cross-link, four more blends of rock with another family are fusion genres (folk metal, folk punk, rap metal, electronic rock), 20 genres with an unsure review stay at `[Rock]` and provisional. Details and the full outline: [genre-levels.md](genre-levels.md#rock-tree-dr1), GEN-067.

- Note 2026-10-19: see [genre-terminology.md](genre-terminology.md) for the glossary (ADR-0034).

## ADR-0036 Credit display setting: featured artists are credits, the title shape is a per-user preset

Status: Accepted (Alex, 2026-10-18, decision DR); planned, nothing built. Amends ADR-0024 and ADR-0025 (which keep their data shape; `featuredArtists` already existed) and supersedes ADD-075 (feat credits kept in the saved title) once built. Spec: CRD-001 to CRD-054 in [credits.md](../specs/credits.md), WEB-104, DATA-162, DATA-163, API-148. Work: [task-0048](../tasks/task-0048.md).

- Context: sources disagree on where a featured artist goes. YouTube and Apple Music write `Artist - Title (feat. X)`; Spotify and MusicBrainz write `Artist feat. X - Title`. The library stored whichever string it was given (ADD-075 kept "(feat. X)" in the title), so the same credit appeared in two places, search and sort saw the title with the credit in it, and the display could not follow a preference.
- Decision, storage: a featured artist is a credit in the Featuring role (`featuredArtists`), a "with" collaborator in the With role (`withArtists`, new), never part of the stored `title`. Roles: Primary, Featuring, With, Remixer, Original; the others are reserved. The parser (ADD-115, extended) moves the credit out of the title on import for every common form (`A - T (feat. C)`, `A feat. C - T`, `T feat. C - A`, `A & B`, `A x B`, `A vs. B`, `(with C)`), leaving a clean title.
- Decision, display: a per-user setting "Credit display" with two presets, `apple` (default) `Artist A & Artist B - Title (feat. Artist C) [Version]` and `spotify` `Artist A & Artist B feat. Artist C - Title [Version]`. The Version slot is identical in both and always follows the title; its bracket kind is kept from the source (`version.brackets`). Formatting follows the Apple Music Style Guide v2.4 (feat. lowercase with a period, several as `A, B & C`; remixes: original artist stays the artist, remixer named in the version text, sections 2.13, 2.9, 3.14, informative). The preset applies to every surface that shows a song name and is a view only: search, sort and filters ignore it. It is stored with the user's settings, returned by `GET /me` and changed by `PATCH /me/settings`.
- Decision, migration: existing titles with an unambiguous `(feat. X)` / `feat. X` group are parsed once, idempotently, with the old title kept in `legacyTitle` until Alex verifies; ambiguous songs go to a review file; the usual dry run, backup and one commit per user apply. The derived legacy `artist` key is the same under both presets, so the iOS app is unchanged until its own task.
- Consequences: one stored form per credit, so sort by title and search by featured artist work; one display function with two presets and a test table; a second migration after model v2 (so it ships after task-0043 is deployed); the iOS title shows without the feat group until iOS adopts the setting (its artist line carries it); `ADD-075` and the "(feat. X)" cases in `titles.py` and `credits-split` change when built.
- Rejected: storing the display shape in the title (two sources of truth); one fixed shape for everyone (the two shapes are both legitimate conventions); a preset per surface (confusing, no use case); sending the preset to the server on each request (the display is client-side and the legacy `artist` stays stable); splitting `&` or `,` in Primary during the migration (breaks real band names, DATA-122); a free-text format template (over-engineering for two shapes).

## ADR-0031 Countries stay on the song; the Artist table is removed

Status: Accepted (Alex, 2026-10-18: "for simplicity let's still have countries associated with songs; I don't want an RDBMS with dozens of tables/entities"); work in [task-0049](../tasks/task-0049.md). Supersedes the country and Artist-table parts of ADR-0025 (DATA-148, DATA-153, the country parts of DATA-147, DATA-152, DATA-156, DATA-157, DATA-158, DATA-159, DATA-160 and TAG-098, API-147). The rest of ADR-0025 (names, version block, runtime decade, no `lang:`) stands.

- Context: ADR-0025 moved `country:` out of songs into a table of `{name, countries[]}` keyed by artist name. It needed its own endpoints, a guest view, sync rules, an edit rule for songs with several main artists (DATA-160, refused with 422), and the migration dropped the countries of artists whose songs disagreed (Kate Bush gb vs fi, Kato us vs dk). Every user-visible fact (a song's country) now lived two hops from the song. Alex does not want a database with an entity per fact.
- Decision, storage: a song stores its countries as `country:<iso2>` tags in `tags` again, as before ADR-0025. A song may have several; there is no cap in storage, validation or the edit form. Values are canonical ISO 3166-1 alpha-2 codes, plus the historical `su`. `decade:` stays computed at runtime and `lang:` stays discarded.
- Decision, removal: no `artists` table in `library.json` or in `GET /library`, no `/artists` endpoints, no `countries` per artist, no rule that ties a country edit to the main artists; a country tag is an ordinary tag on `POST /songs` and `PATCH /songs/{id}` (so a song with several main artists can carry countries and edit them). `mainArtists` and `featuredArtists` are unchanged. Lookups (MusicBrainz, Wikipedia, Discogs, backfill) still suggest at most one country by default; a song that has several keeps all of them and the user may add more.
- Decision, migration: one idempotent startup migration `app.migrate_model3` per user, after `migrate_model2`, marks done with `settings.credits_schema: 3`. Per song the countries are: (a) a song with exactly one main artist whose table entry has countries gets those (they include edits made after model 2); else (b) the `country:` tags the song had in the pre-v2 backup `backups-model2/<uid>/library.json` (matched by id; the oldest numbered copy is the original); else (c) for several main artists, the union of their table countries; else none. Then the `artists` key is dropped. Dry run by default on the command line, backup `backups-model3/<uid>/library.json` (numbered, never overwritten), atomic write, one git commit per user, `updated_at` untouched, any anomaly aborts and leaves the file unchanged. A missing backup is not an error. Songs where the table and the backup disagree are listed in the report.
- Consequences: old code cannot read the migrated file (rollback is the backup plus the previous revision, [deploy.md](deploy.md#data-model-v3-migration-countries-back-on-songs)); the iOS app keeps working because it reads `tags` as before; `credits_schema` is 3 so clients refetch once; the Artist table code, its endpoints, the guest `artists` field and the edit refusal are deleted.
- Rejected: keeping the table and only restoring the dropped countries (still a second entity with sync rules); a per-song override on top of the table (two sources of truth); capping countries at one (a song can be both, e.g. a collaboration between countries); dropping the countries the model-2 migration could not assign (the backup still has them).

## ADR-0032 Drafts: a per-user draft list in its own file

Status: Accepted (Alex, 2026-10-18: decisions BG1, BH1, BI1); work in [task-0050](../tasks/task-0050.md).

- Context: Alex pastes "Artist - Title" lines and links of songs he wants later and wants quick preliminary details, kept as a list to come back to and add to the Library. These entries are not songs: they have no stable source id, no credits he has confirmed and no place in the catalog (ADR-0010) that iOS decodes.
- Decision, storage (BG1): server side, per user, in a separate file `users/<uid>/drafts.json` beside `library.json` (DATA-180), written atomically through `deps.tx` like every other user file, so it is committed and pushed with the library and syncs across devices. One commit per change, like songs; a paste is one commit because its lookups run before the transaction. No change to the song schema, `GET /library`, the catalog revision or the iOS contract; drafts are not in the public view (ADR-0018) and the routes use `require_token`, so guests get 401. The git sync's inbound check validates `drafts.json` like the other watched files.
- Decision, lookups (BH1): a draft with a YouTube or SoundCloud link gets a quick lookup, the single-link preview extraction without AcoustID, Discogs, MusicBrainz or Wikipedia: title, channel, length, upload year as a version-year suggestion (DATA-124), thumbnail. Two workers with a pause, 40 s per request, an hourly budget (API-185), stop at the first 429 or bot check; a failed or skipped lookup never fails the paste, the draft stays "Not fetched yet" with a per-row Refresh.
- Decision, UI (BI1): the Library gets a "Songs | Drafts N" switch instead of a new page or a rename of the Add dialog ("Add song" stays). Drafts replace the song list; search, chips and the list actions are hidden in that view (LIB-170). "Add to Library" opens the normal Add dialog and deletes the draft after a successful save (ADD-190).
- Consequences: a new per-user file to back up (it is in the data repo already); up to 500 drafts per user; a deleted draft is removed after a 6 s undo window, so a closed tab inside that window keeps it; "In library" is computed on every read, so it follows the library without a rewrite of the file.
- Rejected: drafts as songs with a flag in `library.json` (changes the schema the iOS app decodes, counts toward quotas, appears in the public view and every statistic); browser-only storage (no sync across devices); a non-synced server file (lost with the container, not shared with the Mac and iOS apps later); a separate database (breaks the git-synced store, ADR-0001); fetching with the full lookup chain (slow, rate-limited and unwanted for a rough list).

## ADR-0033 Genre sources: ids in a generated data file, links built in one place

Status: Accepted (owner plan 2026-10-19, step 1); built, not deployed. Spec: GEN-066.

- Context: the genre infobox should link each genre to Wikipedia, Apple Music, Spotify, Discogs and MusicBrainz, and the owner wants to know which catalogues really have each genre.
- Decision: `server/data/genre_sources.json` stores, per vocabulary key, only matches that are exact after normalisation (name or listed synonym) with ids and titles, never URLs; `genre_sources_review.json` holds the ambiguous candidates for the owner. It is built by a one-off script (`scripts/build-genre-sources.mjs`) from the MusicBrainz genre list, Apple's public iTunes genre list and Wikidata, and is optional at run time. Spotify has no genre catalogue, so nothing is stored for it. `GET /genres/vocabulary` rows gain `sources` and `source_links`; `genre_source_links` in `app/genre_sources.py` is the only URL builder, using search URLs where no page exists (Spotify, Apple Music, Discogs filters, unmatched Wikipedia).
- Consequences: counts and rules in [server/data/README.md](../../server/data/README.md#genre-sources-gen-066-adr-0033); Discogs links are unverified (bot check) and Apple has no resolving genre page, so its link is a search.
- Rejected: fuzzy matching (guesses); storing URLs (stale, two builders); Spotify genre pages (none exist).

## ADR-0034 Genre terminology and classification aspects

Status: Accepted for the terms (owner, 2026-10-19); Proposed for facets. Full text: [genre-terminology.md](genre-terminology.md).

- Context: "genre" means every level in Wikipedia but only the broad top level (with "style" below) in Discogs and most catalogues; music is also described along mixed axes, so families are uneven.
- Decision: the terms of ADR-0030 stand and are written down: every node is a genre, level 1 is a family, subfamily is a label on Electronic genres, `parents[]` means subgenre-of (first = placement), `related[]` is association only, `fusion` marks a blend, genres display lowercase and families capitalised, a Discogs style is our genre, and the Discogs API name `style` stays. Working model (ours, not a standard) of three axes plus a fourth, subjective one (mood: how does it feel? melancholic, uplifting, epic, calm, dreamy, aggressive; the listener's personal tag, not shared vocabulary a source can confirm; not built, no data model yet): genre by form (the genre tree, i.e. lineage: what kind of music is it?), genre by medium (what is it made with?), genre by purpose (what is it for?); acoustic and instrumental are medium and also version types (a piece that was always instrumental is a medium attribute, not a version), lo-fi is a production style (medium), beat is a format; "form" is our design word (musicology also uses it for structure) and "lineage" was the alternative considered; region, era and scene are secondary aspects mixed into the tree; the user-facing label stays "genre".
- Consequences: families are uneven and Electronic is a super-umbrella; subfamily shading handles it for now.
- Open (proposed): promote the Electronic subfamilies to families and keep "electronic" and "dance" as separate facets, or keep one family. Owner's preference: finish the release first, then decide. Next step: the facets (medium, purpose, mood).

## ADR-0035 Genre suggestion rule: apply on agreement of independent sources, suggest the rest

- Status: accepted 2026-10-19 (owner decision EH1, variant B of the design measured on 21 library songs); built, not deployed.
- Problem: songs carried too many genres that did not describe the recording (library: 1531 genre tags on 402 songs, 80 songs with more than 6). The old merge applied every genre one source listed (up to 8, Wikipedia song genres first, the artist infobox promoted to the song's own, families and their children side by side). Two thirds of the applied genres had a single source behind them; the noise came from Wikipedia's career-wide artist lists and from single entries such as industrial rock on Massive Attack "Angel".
- Decision: a genre is applied when two independent source groups agree on it (MusicBrainz, Wikipedia song page, Wikipedia artist page, Discogs, the link's own tags; a child counts for its ancestor on the primary parent chain), or when the Wikipedia song page alone names it, it is not an ambiguous name (freestyle, hardcore, soul, garage, industrial) and it shares a family with an applied genre. At most 5 are applied, most specific first; a non-family ancestor is dropped beside its child, family names stay. Everything else is returned as `genre_suggestions` with source badges and shown as dashed chips; a click adds one. A Discogs search hit counts half (needs another full source twice over), a master or a link counts fully. For a version only the link's own genres apply; the original's and the remixer's are suggestions marked so.
- One function (`metadata.resolve`, rule in `server/app/genre_suggest.py`) serves all four lookup endpoints; responses only gain `genre_suggestions`, so the iOS contract is unchanged.
- Why not strict agreement alone (variant A): it left synthpop and hi-nrg of Taylor Dayne "Tell It to My Heart" as suggestions. Why not scores (variant C): it applied industrial rock to Angel.
- Costs: lower recall (a song with one source gets nothing applied, for example a SoundCloud-only upload, and the user clicks suggestions); MusicBrainz and Wikipedia are not truly independent; the primary-parent tree can leak a family through a multi-parent genre; the Discogs search path and the weights are unmeasured.
- No migration: stored songs keep their genres; a read-only dry run that diffs the rule against the stored genres is possible later on request.
- Supersedes for what is applied: TAG-094's source ranking; amends TAG-088 to TAG-090, TAG-095, TAG-096. Requirements: TAG-099 to TAG-108, API-186, ADD-181.

## ADR-0037 Genre parents are equal: families by descent, level by shortest path, no depth cap

- Status: accepted 2026-10-19 (owner decisions BY1, BX, CB2); built, not deployed. Spec: GEN-070 to GEN-072; task: [task-0055](../tasks/task-0055.md). Amends ADR-0030 (the first parent no longer is primary; the hard cap of three levels is lifted on 2026-10-19), ADR-0035 (the suggestion rule uses every parent).
- Context: `parents[0]` decided level, family, colour and outline nesting; the other parents were cross-links, so a genre with two scenes (disco, synthpop, hip house) counted in one family and the family override of the disco children was a hack.
- Decision: `parents` is an unordered set. A genre belongs to every family it descends from (all level 1 ancestors) and a song counts in each of them. The level is per path; where one number is needed (sorting, validation) it is the shortest path depth to a family root (a genre under a family is level 2), so a genre under a family and under a level 2 genre is level 2. There is no depth cap; `genre_vocab.MAX_LEVEL` (12) only guards against bad data. The Outline and the radial rings nest a genre under each parent, the canvas draws it once with a line to each parent, a multi-family genre is a pie of equal segments in the family colours, and the Electronic family circle is not drawn (display constant `HIDDEN_FAMILY_NODES`). The `family` override is removed; nothing else in the data is deleted.
- Compatibility: `GET /genres/vocabulary` keeps `family` (now the first of `families` in the fixed family order), `parents` and `level`, and adds `families` (additive, the iOS contract is unchanged); the `GET /genres/graph` nodes gain `families`.
- Suggestion rule: ancestors and the shared-family test use all parents and all families (TAG-101, TAG-102, TAG-106); a Wikipedia-only genre is rescued when it shares any family with an agreed genre.
- Fusion toggle: with the map's "Fusion genres" switch off a fusion genre keeps its genre parents (else the first family listed in the data) and hides its other family parents; the data order is used only for that fallback.
- Consequences: more genres count in several families (583 family memberships over 536 genres); level changes of blends (hip house, trip hop, folk metal, folk punk, funk metal, rap metal are level 2); family counts in `_meta.counts` are by membership; the old snapshot test compares parent sets only.
- Data edits of the same day (owner): disco keeps both families and post-disco goes under disco; psytrance under trance (its branch reaches level 4); eurodance gets house, euro disco and Pop; darkwave gets Electronic, post-punk and new wave; synthpop gets new wave beside Electronic and Pop (fusion flag dropped: three families); industrial and ethereal are removed (REMOVED_GENRES, the stored tag is dropped at startup). Held back by the owner: the larger nesting proposal (CA1, BV).
- Rejected: keeping a primary parent only for colour (contradicts the decision); capping the pie at three families (the data has genres with four).
