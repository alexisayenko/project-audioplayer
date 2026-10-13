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
- Sub-decision (Wikipedia links, 2026-10-12): a song has up to three links on the Playback card: Source (`source_url`), Wikipedia of the song (`wikipedia_song`) and of the band (`wikipedia_artist`), both optional URL fields validated by host (`*.wikipedia.org`, `wikidata.org/wiki/Q..`; others dropped). They are suggested from MusicBrainz url-rels at preview and editable in Add and Edit. Wikidata over scraping: genre, country, language and year come from structured Wikidata claims (`Special:EntityData`, one batched `wbgetentities` for English labels), not from parsing article text, because claims are stable, licensed CC0, language-independent and need no fragile HTML heuristics. `POST /lookup/wikipedia` re-derives suggestions from user-edited links; suggestions never auto-assign. Cost: 2-6 extra outbound calls per uncached preview, all failure-tolerant and behind `AUDIO_TAG_LOOKUP`. The same fetch also reads the song page's `album` and `released` year (TAG-048); a single has no `album` parameter, so the infobox gives no album (the song's own title is never used as one).
- Sub-decision (infobox genres, 2026-10-13): the one exception to "claims, not article text" is the infobox `genre` parameter of the song's (else the artist's) English Wikipedia page, read by a deterministic wikitext parser (no AI), because Wikidata `P136` is often missing or coarser than the infobox (Crazy by Gnarls Barkley lists seven genres). Its genres come first and are all kept; everything else still comes from claims (TAG-045 to TAG-047). Cost: one extra Wikipedia API call per uncached page, failure-tolerant and behind `AUDIO_TAG_LOOKUP`. The same fetch also gives `POST /metadata` a `suggest` hint (song page's infobox artist and name, TAG-049); Artist and Title are never auto-filled.

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

Status: Accepted, deployed 2026-10-13 · 2026-10-12 · Supersedes the "always-on
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

Status: Accepted, implemented in `server/` (git store, `music_root`, sync status; deployed 2026-10-13) · 2026-10-12 ·
Supersedes the `library.json`-on-server-disk and covers-on-server-disk
parts of ADR-0001 and the matching data wording in ADR-0004
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
  uploaded so far: 20261012, 20261013). App Store Connect rejects a repeated
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

Status: Accepted · 2026-10-13 (Alex decided to start the work; server side implemented in task-0006) · Supersedes the "Library is the phone" part of
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
- Web (2026-10-13): the web UI is catalog-only: it saves entries with `audio:false`, shows songs without server audio as "Not on the server" with an Open on YouTube/SoundCloud link, never queues them, and plays/deletes only audio already on the server (WEB-015, WEB-023); the iOS "Add and download to iPhone" is the only path that puts audio on the server.
- Implementation: server P1 (task-0006) is implemented: `file` may be `null`, `sources` list, derived `audio_state` (`none`/`server`), `GET /catalog`, metadata-only `POST /songs`, `DELETE /songs/{id}/audio`. Old records are not migrated; state is derived at read time. Remaining specs are `planned` (CAT-*), tasks task-0007.. (phases P2..P6).

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

Status: Accepted, implemented in `server/` and `web/` (iOS client changes listed in [task-0016](../tasks/task-0016.md), not done) · 2026-10-13 · Supersedes the single-library layout of ADR-0001 and ADR-0005, and the owner-only gate of ADR-0006

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

## Note 2026-10-13: languages dropped, Spotify skipped for now

`lang:` tags are no longer suggested by `/preview`, `/lookup/wikipedia` or the new `POST /metadata` (API-048) and the web UI no longer shows them; stored `lang:` tags are kept and still normalised. Spotify is not used as a metadata source for now.

Sub-decision 2026-10-13: the Add form shows four service icons (YouTube, SoundCloud, Wikipedia, Spotify) beside "Get metadata". Their brand colours are `brand-*` tokens in the design system (version 19), not hard-coded. One `POST /metadata` call returns per-service `services.<name>.{found,url}` for the UI. Spotify is shown but permanently inactive until an integration exists.

Note 2026-10-13: web saves metadata only; audio reaches the server only through the iOS download flow; existing server audio keeps playing and deleting on the web.

Decision 2026-10-13 (amended): songs get an optional free-text `remixer` ("remix & additional production"). A strict deterministic cut (ADD-070, API-049) replaces the earlier tap-to-apply hint: the first bracket containing the word remix is removed from the title and its text becomes `remixer`. The `original` (Original track) field is dropped. MusicBrainz was rejected for this: remixes are not linked or catalogued there and name matching hits the wrong artist (Sadrican finds Sadrican Sagdur).

Decision 2026-10-13: version info such as "(Live from the Royal Albert Hall)" stays in the saved and shown title and is stripped only from metadata lookup queries (`titles.lookup_title`); there is no separate Version field.
