# Specs

What the product MUST do, derived from the code (`server/app/`, `web/js/`, `ios/Sources/`)
and checked against [`../product/screens.md`](../product/screens.md),
[`../tech/decisions.md`](../tech/decisions.md) and
[`../tech/architecture.md`](../tech/architecture.md).

## Specs vs ADRs

- **ADRs** ([`../tech/decisions.md`](../tech/decisions.md)) say **why**
  a choice was made and what it replaced.
- **Specs** (this folder) say **what** the system does, as testable
  requirements. When a spec and an ADR disagree, fix the one that is
  wrong in the same commit; the code is the tiebreaker.

## Conventions

Each requirement is one line:

`ID MUST|SHOULD: statement. Status: implemented | planned | to-confirm`

- IDs are `<AREA>-<NNN>`, stable, never reused. Areas: `DATA`, `API`,
  `TAG`, `ADD`, `LIB`, `STO`, `PLY`, `IOS`, `WEB`, `NFR`, `CAT`, `GEN`, `STA`, `VIZ`, `SHARE`, `YTC`, `PLS`.
- **MUST** is mandatory; **SHOULD** is desirable and may be waived with a reason.
- **implemented**: verified in code (last full pass 2026-10-14); "(not browser-verified)" means read in code and unit-tested, not yet checked in a browser. **proposal**: an idea under discussion. **planned**: decided, not
  built. **to-confirm**: behaviour exists or is proposed but nobody has
  decided it is intended.

## Index

| File | Area | Content |
| --- | --- | --- |
| [data-model.md](data-model.md) | DATA | Song record, `library.json`, validation, migration |
| [api.md](api.md) | API | Every HTTP endpoint, auth, errors |
| [tags.md](tags.md) | TAG | Tag semantics, normalisation, genre and Wikipedia/Wikidata suggestions, filter grouping |
| [add-song.md](add-song.md) | ADD | URL and paste cleaning, preview, Wikipedia links, save, download, BPM, duplicates, errors |
| [library.md](library.md) | LIB | Library screen and song card |
| [storage-and-sync.md](storage-and-sync.md) | STO | Git store, audio location, write path, sync states, env vars |
| [playback.md](playback.md) | PLY | Playback screen, play queue, persistence, mini-player, Media Session |
| [catalog.md](catalog.md) | CAT | Catalog vs audio (server and web implemented, later sources planned), audio state, Spotify metadata, Get audio with YouTube match (ADR-0010) |
| [ios.md](ios.md) | IOS | iOS app: tabs, Settings and sign-in, Add, Library Phone/Server, offline playback, look, build number |
| [web.md](web.md) | WEB | Web UI: sign-in with Google and Apple, session cookie, signed-out screen, sidebar, dialogs, Download, Auto-download, mini-player layout |
| [genres.md](genres.md) | GEN | Genres map: genre graph from Wikidata with Discogs families, `GET /genres/graph`, force-graph page and outline (ADR-0014) |
| [stats.md](stats.md) | STA | Song stats: year x BPM scatter plot page (`#/stats`), colour groups, selection, zoom, table view (ADR-0016) |
| [visualizer.md](visualizer.md) | VIZ | Audio visualizer: lazy Web Audio graph, Mirrored spectrum, Ring, Terrain and Synthwave terrain (styles, lookahead, camera flight, 60 fps pacing), background and full-screen modes, controls, performance and flash safety (task-0023) |
| [terrain-concept.md](terrain-concept.md) | VIZ | Terrain visualizer concept in plain language for designers (companion to VIZ-043 to VIZ-067 and VIZ-074) |
| [../product/concept-digital-phosphor-led.md](../product/concept-digital-phosphor-led.md) | VIZ | Digital phosphor LED display (Ice Blue Mirror 2) concept in plain language for designers (companion to VIZ-104, VIZ-105) |
| [terminology.md](terminology.md) | all | Glossary: one name per thing and its aliases (now line, relief, parts, camera, quality, overlay, share link, baselines) |
| [share.md](share.md) | SHARE | Share link: song id, start time and visualizer settings in a hash route, share dialog, tap-to-play gate (task-0028) |
| [macos-gui.md](macos-gui.md) | MAC | Native macOS app: web-matching GUI, pages in or out of v1, streaming only, Settings, shortcuts (task-0046, ADR-0028) |
| [youtube-connect.md](youtube-connect.md) | YTC | Connect YouTube: Google OAuth, playlist and Liked videos import as catalog songs, refresh token storage, limits (task-0032, ADR-0020 proposed) |
| [playlists.md](playlists.md) | PLS | Playlists: top-level menu item, folders and playlists, import from YouTube, SoundCloud and Spotify links and files, export to M3U8, CSV and JSON, Refresh, guest view, quotas (task-0034, ADR-0022) |
| [non-functional.md](non-functional.md) | NFR | Auth, hosting, scale, browsers, offline, CPU |
