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

The phone cannot run yt-dlp. The app calls the server for `/search`,
`/download` and `/files`. ~~The server runs on an always-on machine (e.g.
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
- Implemented in `server/app/library.py`: `library.json` and `covers/` live in `AUDIO_DATA_DIR`, audio in `AUDIO_DOWNLOAD_DIR`. ~~Covers on server disk~~ live in the git LFS repo under ADR-0005 (needs `git-lfs` installed on the server; the repo's `.gitattributes` decides tracking).

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
  to `genre:<value>`. yt-dlp genre/categories become a suggested
  `genre:` tag at preview. One mechanism covers any future facet
  without a schema change.
- Screens, record layout and API: [`../product/screens.md`](../product/screens.md).

- Sub-decision (genre lookup): `/preview` also asks MusicBrainz
  (`server/app/genre_lookup.py`, free, no key) for genres. It cleans
  artist/title noise, accepts a recording match only at score >= 90 with a
  loosely matching artist, reads recording genres+tags (falling back to the
  artist's), and returns the top 3 by votes as `genre:<name>`. These merge
  with the yt-dlp suggestion, de-duplicated, max 4 tags; the Add screen
  pre-fills them. Limits: global ~1 request/s, 5 s timeout, in-memory cache,
  any error gives no tags (never breaks `/preview`). `AUDIO_GENRE_LOOKUP=0`
  disables it. Caveat: MusicBrainz tags are community-voted and sparse for
  obscure tracks; treat them as suggestions.

- Sub-decision (BPM): `bpm` (number or `null`) is detected automatically
  when a song is added and is user-editable. `server/app/bpm.py` decodes
  the saved m4a with ffmpeg to mono 44.1 kHz PCM, feeds it to aubio's
  tempo tracker and takes the median of aubio's running BPM estimate at
  each detected beat, rounded to 1 decimal and folded into 70-180 BPM.
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

- The web interface is built first; the mobile app is deferred.
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
  (`audioplayer: add <id>` / `edit <id>` / `delete <id>`) -> push.
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
