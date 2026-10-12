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
| Data storage | built on server disk; ~~server disk~~ moving to git repos (ADR-0005, planned) | `server/app/library.py` |

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
- Implemented in `server/app/library.py`: `library.json` and `covers/` live in `AUDIO_DATA_DIR`, audio in `AUDIO_DOWNLOAD_DIR`. ~~Covers on server disk~~ move to git LFS under ADR-0005 (planned).

## ADR-0002 Tags replace playlists; song fields

Status: Accepted · 2026-10-12

- A song has zero or more free-form tags; a "playlist" is a tag filter.
  There is no playlist entity.
- Song fields: `artist`, `title`, optional `album`, `year`, `genre`,
  plus `source_url`, `cover`, `tags[]` and technical `id`, `duration`,
  `added_at`.
- Screens, record layout and API: [`../product/screens.md`](../product/screens.md).

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

Status: Accepted, implementation planned (not done) · 2026-10-12 ·
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
- Sub-decision (planned): `library.json` is `{settings:{music_root},
  songs:[...]}`. `music_root` is `<servername>://<path>/` (e.g.
  `perkunas://data/music/`); songs reference audio only by relative file
  name (`<video_id>.m4a`), so relocating the music changes one value.
  The server resolves `<servername>` through its own local config
  (name -> mount path/host, outside the repo): no credentials or IPs in
  the JSON. Migration from the bare `{songs:[...]}` / `AUDIO_DOWNLOAD_DIR`
  implementation is open.
- Cost: each save is a git push (~1-2 s), acceptable at a few hundred
  songs; revisit if edits become frequent.
