# Changelog

What shipped, newest first. One line each; the web UI and server are live at https://play.isayenko.net. Why: [tech/decisions.md](tech/decisions.md); runbook: [tech/deploy.md](tech/deploy.md).

## 2026-10-14

- Web: the song Title is a single plain input, so a comma no longer splits it into pills ("Лондон, гуд бай"); Artist keeps pills (WEB-039).
- Web: the Playback and mini-player progress bars can be dragged, clicked and keyboard-operated with a time bubble while dragging (PLY-120..122).
- Web: mini-player bar is a fixed 720px, visually separated from the list, with Edit details, Show in list and an Add to current playlist toggle; Library rows stretch full width and show a playlist toggle that reflects the queue (LIB-095..097, PLY-117..119, WEB-038). On phones (< 480px) the mini-player keeps only the playlist toggle and Library rows (< 720px) keep their old columns, the toggle being reachable through the row menu.
- Web: the desktop sidebar can be collapsed to a thin icon rail with a toggle button; the choice is remembered (WEB-037).
- Web: the queue row menu now works on every row (Move up/down and Remove for played and current songs too, the current song stays current) and gains Edit song and Download (PLY-042, PLY-046).
- Web: Playback song details show Download and Edit song icon buttons instead of a "..." menu that duplicated Download (PLY-072, PLY-102).
- Web: BPM badge on the Library title line (LIB-019).
- Web: canonical country picker; the Soviet Union is a predefined historical country (`country:su`), shown by name; unknown countries are refused with 422 `unknown_country` (TAG-056..058).
- Web: "Auto-download songs" setting (Settings > Playback) fetches audio for catalog songs on demand through `POST /songs/{id}/audio`, bounded by the hourly add limit (ADR-0010, PLY-110..116).
- Web: "Play all N" button on the Library sort bar (LIB-092).
- Web and server: "Download" saves a song as `Artist - Title.m4a` via `GET /files/{id}?download=1` (WEB-034, API-061).
- Server and web: MusicBrainz and Discogs icons in the song link row, `musicbrainz_url` stored on the song; "mashup" and "mixed by" are cut like "remix".
- iOS: TestFlight builds 20261022 and 20261023.

## 2026-10-13

- Server and web: per-user storage with open signup (Google or Apple), quotas, `GET /me` and `GET /me/usage` (ADR-0012); existing library migrated under the owner.
- Server and web: deployed to perkunas LXC 106 behind the Cloudflare Tunnel at https://play.isayenko.net (ADR-0004), library in the `data-storage` git repos (ADR-0005), weekly yt-dlp update timer.
- Web: sign-in with Google and Apple through a session cookie; the API token field is gone (ADR-0006, API-020..024).
- Web and iOS: one shared song form for Add and Edit, Title, Artist and Remix token pills, read-only BPM, Wikipedia article names instead of links.
- Server: genre filtering and merging, `GET /genres`, `POST /metadata` with per-service icons, feat-credit artist matching; a bare YouTube id is accepted in the Add field.
- `scripts/check.sh` and `scripts/deploy.sh`; SonarCloud findings cleared.

## Earlier (web prototype to catalog UI)

- Web: Library cards with cover, tags, BPM and Wikipedia links; tag editor; decade tags derived from year (`decade:90s`, TAG-050); four-block Playback (details, controls, playlist controls, current playlist) with a client-side queue, shuffle, loop and Media Session.
- Web: catalog-only Add (metadata saved without audio, ADR-0010); SoundCloud links and ids (ADR-0011); canonical `source_url`; integer BPM.
- Server: catalog and audio state (`/catalog`, `audio_state`, `DELETE /songs/{id}/audio`).
