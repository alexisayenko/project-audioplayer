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
| Web interface | not built | undecided |
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

### Open: web interface hosting

Static page on Cloudflare Pages vs served by FastAPI. Undecided.
