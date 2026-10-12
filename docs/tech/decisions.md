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
| Web interface | in progress | `web/`, served by FastAPI (ADR-0003) |
| Data storage | partly built (audio files only) | server disk |

### Backend server is required

The phone cannot run yt-dlp. The app calls the server for `/search`,
`/download` and `/files`. The server runs on an always-on machine (e.g.
`alex-hetzner`). Known risk: YouTube may block datacenter IPs.

### Network exposure: Cloudflare Tunnel (planned, not set up)

Cloudflare Workers cannot run yt-dlp. Expose the server at an HTTPS URL
with Cloudflare Tunnel (`cloudflared`), optionally behind a Cloudflare
Access service token on top of the existing `AUDIO_API_TOKEN`. This
replaces Tailscale.

### Storage

- Audio on server disk: `downloads/<id>.m4a`.
- One `library.json`: song records with metadata and tags (tags replace
  playlists), see [`../product/screens.md`](../product/screens.md).
- No SQLite: a few hundred songs.
- Writes are atomic (temp file + rename), single writer (the server,
  under a lock). Web and phone go through the API.
- Revisit at tens of thousands of songs or multi-user.
- `library.json` on the server is not implemented yet.

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
