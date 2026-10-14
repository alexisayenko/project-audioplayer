# Changelog

What shipped, newest first. One line each; the web UI and server are live at https://play.isayenko.net. Why: [tech/decisions.md](tech/decisions.md); runbook: [tech/deploy.md](tech/deploy.md).

## 2026-10-14

- Web: Library, queue, mini-player, Playback details, page title and Media Session show the Remix & additional production value in parentheses after the title (LIB-112, PLY-130); the Library Track column is 300px wide (220-300px at 900-1099px, LIB-110); build artefacts (`__pycache__`, `.coverage`, `*.bak*`) are git-ignored.
- Web and server: title cleaning also removes 'Original Mix', 'Original Version' and 'Original' when they are a whole segment ('Rover (Original Mix)' gives 'Rover'); with other words ('(Tiësto Original Mix)') and for Extended Mix, Radio Edit, Remix and the like nothing changes (ADD-077, ADR-0015).
- Server: bugs fixed -- `HEAD /files/{id}` now works, SoundCloud ids accept ASCII digits only, Discogs no longer fuzzy-matches titles shorter than 3 characters, a non-object AcoustID reply is handled, `AUDIO_WEB_DIR` is read at call time (API-061, DATA-001, ADD-079).
- Server: refactor -- `main.py` split into routers (`routes/`), shared state in `deps.py`, repeated helpers moved to `jsonio`, `httpjson`, `safepath`, `ratelimit`, `timeutil`, `tags`, `links`, `downloads`, `schemas`, `web`; JSON files are written atomically with mode 0600 (NFR-071, ADR-0017).
- Web: refactor -- `player` and `library` split into `player-*` and `library-*` modules, `storage.js` and `constants.js` shared; fixes for country codes (one `canonicalCountry`, TAG-059), the hidden tag pool and token removal.
- Tests: server suite grown to about 1550 tests at 99% line coverage; 59 web test files at about 84% coverage, UI modules tested through a DOM shim; `scripts/check.sh` runs them all (ADR-0017).
- Web and server: title cleaning now matches noise word by word, so '[HD 1080p]' and '(Official Music Video HD)' are removed while '(Official Remix)' and '(The New Song)' stay (ADD-077).
- Web and server: new "Genres map" page (sidebar item after Playback): your genres as a movable, "alive" force graph coloured by Discogs family, with parents and subgenres from Wikidata (cached on the server, works offline), an outline list, search, and "Show N songs in Library" including subgenres; the sidebar brand and collapse toggle now share one line (GEN-001..030, API-080, DATA-060, WEB-050, ADR-0014). The map now fills the whole page with a collapsible outline panel, a family legend and non-overlapping labels; node colours no longer stay grey and families resolve for common roots such as dance, house and trance music (GEN-020..023).
- Web and server: promo noise such as "[Free Download]" is removed from the title when adding a song (shared rules in `titleclean.py` and `title-clean.js`, hint "Cleaned: removed ... - Restore", `title_raw` in `POST /preview`); the Title offers 'Move "X" to Artist?'; optional `scripts/clean-titles.py` for old titles, backup written outside the data git repo (ADD-077..080).
- Server and web: "Identify from audio" in the song form fingerprints the saved audio (Chromaprint `fpcalc`, AcoustID) to find the exact MusicBrainz recording, adds Discogs styles, and offers genres, countries, year and links as suggestions; runs once after each download; off until `ACOUSTID_API_KEY`, `DISCOGS_TOKEN` and `fpcalc` are set on the server; new optional `discogs_url` on the song (API-070, API-071, DATA-050, ADD-090, TAG-070, NFR-070, ADR-0013).
- Web: Library rows without server audio get a Download icon button next to the source logo that fetches the audio to the server (LIB-111).
- Web: Library Track column is a fixed width and Genres takes the rest (LIB-110); with Auto-download off Next, Previous and auto-advance skip songs without audio with one "Skipped N not downloaded" toast, stop with "No more downloaded songs in the playlist" and shuffle only draws playable songs (PLY-125).
- Web and server: a track being downloaded shows live progress: Library rows get a progress ring and a bottom line (Queued, Downloading N%, Converting, Failed - click to retry), queue rows and the mini-player show the same text; the status endpoint gains `state`, `percent`, `speed`, `eta` and `error_code` (LIB-098..100, PLY-123, PLY-124, ADD-076, API-062).
- Web: Title, Artist and Remix & additional production share one pill tokenizer: pills come from Enter or a spaced ' - ', ' | ', ' / ' only, commas, ampersands and unspaced slashes never split, and a stored string is unchanged by opening and saving (WEB-039, ADD-071; the tag editor and iOS are unchanged); lookups treat ' - ' and the legacy ', ' as artist separators locally (ADD-079).
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
