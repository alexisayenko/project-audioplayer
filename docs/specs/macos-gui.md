# macOS app GUI

Build spec for a native SwiftUI macOS app whose GUI matches the web UI (`web/`, served at https://electrophone.cc). Status: Sign-in, Library, Playback, Add/Edit, Settings, Playlists (placeholder), Genres map, Song stats, Music theory and the visualizer (Mirrored spectrum, Ring) are built and compile; none of it is tested with a real account or seen on a real UI, and the visualizer tap is unverified on the real server stream (task-0047, ADR-0029). The MAC requirement statuses below still read "planned" until they are checked on a Mac. It describes what the web does today (read from `web/index.html`, `web/js/*`, `web/*.css` and the specs it links, 2026-10-17) and how that maps to a Mac app. It does not restate every requirement: the linked specs ([library](library.md), [playback](playback.md), [add-song](add-song.md), [web](web.md), [api](api.md), [share](share.md), [visualizer](visualizer.md), [stats](stats.md), [genres](genres.md), [playlists](playlists.md)) stay the source for detail; where this file and the code disagree, the code wins.

Requirement IDs in this file use the area `MAC` and the format of the [specs README](README.md); they are assigned only to the Mac-specific decisions. Pages are described as "Web reference" (what to copy) and "Mac" (what changes).

## 1. Scope and priority

Key principle (CLAUDE.md): playback and offline reliability beat features. A page earns a place in v1 only if it helps download, store or play songs.

| Page / feature | v1 | Priority | Why |
| --- | --- | --- | --- |
| Sign-in (Google, Apple) and signed-out gate | yes | P0 | nothing works without an account |
| Library (list, search, filters, sort, song card, row actions) | yes | P1 | the catalog and the way to start playing |
| Playback (Now playing, queue, dock, Media Session, keyboard) | yes | P1 | the core job |
| Add song and Edit song (shared form), delete, cover change | yes | P2 | how songs get in and stay correct |
| Settings (account, storage, sync, auto-download) | yes | P2 | account and download behaviour |
| Download progress, retry, hourly-limit pause | yes | P1 | part of Library and Playback rows |
| Settings: BPM detection, Metadata backfill, Download all | later | P3 | bulk maintenance, not playback |
| Visualizer: Mirrored spectrum and Ring (in-window overlay) | built, unverified | P3 | listening pleasure, no reliability gain |
| Visualizer Terrain / Synthwave (WebGL) | out of v1 | P4 | large, no reliability gain |
| Share link (copy a web URL) | later | P3 | cheap, only useful with web viewers |
| Guest read-only view (public library) | out of v1 | P4 | the Mac app is for signed-in users |
| Playlists | built (placeholder, as the web) | P4 | the web has only "Playlists are coming soon"; the Mac mirrors it |
| Genres map (rework not built) | built, unverified | P4 | browsing aid (GEN: "nothing here changes a song") |
| Song stats (year x BPM scatter) | built, unverified | P4 | analysis only |
| Music theory | built, unverified | P4 | static reference text |

The Library genre / decade / country / tag filter chips are part of Library and stay in v1; only the Genres map page is out.

MAC-001 MUST: v1 ships Sign-in, Library, Playback, Add/Edit and Settings (account, storage, auto-download) and nothing from the "out of v1" rows. Superseded for the pages: Playlists (placeholder, as on the web), Genres map, Song stats and Music theory were built afterwards at Alex's request and sit in the sidebar in the web's order (Playback, Playlists, Library, Genres map, Song stats, Music theory, Settings); the Genres map rework page is not built. Status: planned

## 2. Shared foundations

### 2.1 Look (design tokens)

- The look is defined only by the Electrophone design system (ADR-0009, [brand README](../brand/README.md)). Never hard-code a colour, size, radius or shadow; `scripts/sync-design-system.py` already generates `ios/Sources/DesignTokens.swift` (the `DS` enum, light and dark adaptive) from `docs/brand/tokens.json`, and `web/tokens.css`. The Mac target uses the same generated file (another agent is making it build on macOS); a missing token is added to the design system first.
- Palette (names, not values; values live in the tokens): `ground` (page), `surface` (cards, dock), `surface-sunken` (tracks, search field), `surface-key` (unlit transport key), `line` (hairlines), `ink`, `ink-muted`, `ink-faint` (decorative only), `accent` / `accent-ink` / `accent-strong` / `accent-tint` (the single accent, cyan), `copper` (rim on cover art and the placeholder disc), `ok`, `power`, `vinyl`, brand colours (YouTube, SoundCloud, Spotify, Wikipedia, MusicBrainz), `chart-0..15` (family colours). Day and night follow the system appearance (`prefers-color-scheme` on the web); never pure white or pure black.
- Type scale (SF Pro, `-apple-system`): display 34/41 bold (page titles), title 22/28 bold, headline 17/22 semibold, body 17, subhead 15/20 (+ strong 600), caption 13/18, micro 11, eyebrow 12 semibold with 2 px tracking, uppercase, time 13 medium monospace (SF Mono, tabular digits).
- Radii: key 12, card 20, tray 28, pill 999, sm 8, xs 4. Spacing 4/8/12/16/20/24/32. Hit target `--hit` 44 px (controls 36, small 28). Focus ring 2 px accent with 2 px offset on every interactive control. Shadows: card, float, key; accent glow on primary buttons.
- Page header pattern on every page: eyebrow "ELECTROPHONE" over a display title ("Library", "Now playing", "Settings"), optional right-aligned actions.
- Button shapes (WEB-099): playback actions (play, pause, previous, next, shuffle, repeat, Play now) are rounded-square keys (`.key`, radius key, soft raised, the play key "lit" with accent fill and glow); actions on a song's metadata (share, download, edit, playlist, info, links) are round 44 px icon buttons; text pills for Play all / Add all / Show in Library. Selected Shuffle / Repeat: transparent key with a 1 px inset accent ring, `accent-ink` icon, faint outer glow (PLY-132).
- Icons: the web has its own 24-grid, 1.8-stroke set in `web/js/icons.js` (names: prev, next, play, pause, shuffle, repeat, repeatOne, library, playlist, playlistAdd, playlistRemove, search, download, share, info, pencil, plus, check, warning, volume, volumeMute, equalizer, link, externalLink, mark (the brand mark), and nav icons for each page). On the Mac use SF Symbols where an equivalent exists and the web glyphs as vector assets for `mark`, the Repeat-one "1" loop (stroked numeral at least 9 units tall, PLY-134) and the service logos (`ServiceIcons.swift` exists on iOS).
- Cover art: square, radius card, copper rim; no cover or a failed load shows the placeholder (vinyl square with accent disc and the brand mark), never a broken image. Cover URL `GET /covers/{id}?v=<cover_v>`.

### 2.2 Shell layout

Web reference (`web/index.html`, `style.css`, WEB-012, WEB-037, WEB-038, PLY-117):

- Left sidebar rail: 220 px expanded (from 720 px window width), 64 px icon rail collapsed (or 480 to 719 px). A chevron toggle at the top (tooltip "Collapse sidebar" / "Expand sidebar", `aria-expanded`) collapses it; the choice persists (`electrophone.sidebarCollapsed`). Brand block: mark + "Electrophone" on one line (toggle right-aligned), caption "Offline music player" under it.
- Nav items in order: Library, Playback, Playlists, Genres map, Genres map rework, Song stats, Help (an expandable menu on the web, WEB-131; the Mac app still lists Music theory as its own item, the Help menu is not built there), Settings. Each: 20 px icon + label, active item highlighted with `aria-current="page"`. The default route is Library, the first item (WEB-012). A signed-out visitor sees only Settings and Help.
- Sidebar foot: server status output, a coloured LED plus text "Server online · electrophone.cc" or "Server unavailable"; from `GET /health` polled every 30 s (`SYNC_POLL_MS`). In the icon rail only the LED shows (tooltip carries the text).
- Stage (right of the rail): a banner strip for sync warnings (below), the page, and a footer with the copyright note (`GET /legal`) on Settings.
- Mini-player dock: fixed 720 px wide (less on narrow windows: stage width minus 16 px margins), 92 px high, centred in the stage, floating at the bottom with a 16 px margin, opaque raised surface, 1 px `line` border, strong shadow. Shown on every page while a song is loaded (including Playback, PLY-146). Pages reserve bottom padding for it. Hidden in the full-screen visualizer.
- Toast: transient message above the dock, bottom-centre, 3 s (6 s when it carries an action button). Texts quoted below are exact.
- Sync banner `#sync-warn` (WEB-094..097, owner only): shown for sync state `stale`, `error`, `degraded`, never for `pending`; hidden while the server is unreachable. Texts from `describeSync`: "last pushed N min ago, M changes not pushed", "no push recorded", "Git push timer not installed or not running, M changes not pushed", "Sync failed: push rejected | not reaching git | no upstream | data diverged, resolve by hand | inbound change invalid", "Sync is behind" (non-owner). The Settings nav item also gets a small warning dot (`data-sync`). Data: `GET /health` `sync` object (API-137).

Mac: see section 4. Window minimum 720 pt wide (the table layout needs it); there is no phone tab bar and no 480 px layout.

### 2.3 Names and years (the one formatter)

All song names come from one formatter (`web/js/credits.js`, LIB-134..150); port it as a single Swift type and use it everywhere (rows, dock, Now playing, queue, notifications, Now Playing info, window title).

- Song fields used: `title`, `mainArtists[]`, `featuredArtists[]`, `releaseYear`, `albums[]`, `genres[]`, `version {type, name, artists[], releaseYear, originalArtists[]}` (data model v2, DATA-144 to DATA-155), plus legacy `artist`, `remixer`, `year`, `remix_year`, `album`, `bpm`, `duration`, `tags[]`, `sources[]`, `source_url`, `audio_state` (`none`|`server`), `file`, `cover`, `cover_v`, `added_at`, link fields (`wikipedia_song/artist/album`, `spotify_url`, `musicbrainz_url`, `discogs_url`). A song without a `mainArtists` array is legacy-only and uses `artist` + `remixer`.
- `artistLine`: main artists joined `A`, `A & B`, `A, B & C`, then ` feat. ` and the featured joined the same way.
- `titleLine`: title plus ` (label)`; label = tokens of `version.name` joined by `, ` (each token hidden if its normalised text already appears in the title), else the lowercase `type` word (nothing for `other`, nothing if already in the title).
- `displayLine`: `artistLine - titleLine` (tooltips, accessibility labels, window title, Now Playing). A cover shows the covering artist first: `Artist B - Title (cover)`; a mashup `Maker A & Maker B - Title (mashup)`.
- Subtitle everywhere: `artistLine · year` (year omitted when none). Year shown = version year when the version has one, else `releaseYear`/`year`; the card fact row shows `2012 · original 1985` when they differ; a remaster shows the original year only and carries its version year in the title, "Song (2003 remaster)" (LIB-150).
- In rows the title is one line with the version label as a muted second span after a real space; if the title does not fit it ping-pong scrolls (hold 1.2 s, scroll, hold, back) with 12 px edge fades, only above 2 px overflow: always for the current row, others on hover or focus; reduced motion keeps the ellipsis (LIB-131).
- Sort by Artist: casefolded first main artist, then title; by Title: casefolded base title; text sorts are case- and accent-insensitive. Search haystack: title, main and featured artists, version name, version `artists`, `originalArtists`, `albums`, tags (case-insensitive substring on every keystroke).
- Tag display: `key:value` tags show key as a highlighted prefix; `decade:90s` (computed from `releaseYear`, never stored) shows "the 90s"; `country:LT` shows "Lithuania"; `lang:` tags are hidden everywhere. Categories: Tags, Genres (`genre:`), Years (`decade:`), Countries (`country:`).

### 2.4 State kept between runs

Web uses `localStorage`; the Mac uses `UserDefaults` with the same meaning (keys are suggestions, `ap2.*` on the web): queue `{items, index, tags}` (`ap2.queue`), shuffle (`ap2.shuffle`), repeat `off|all|one` (`ap2.repeat`), volume (`ap2.volume`), auto-download (`ap2.autodl`, default off), sidebar collapsed, visualizer mode / height / terrain style, panel open states. Library search, sort and filter selection persist while navigating between pages in one session, not across launches (LIB-004). Playback position is not persisted (PLY-063). Every storage access tolerates failure.

### 2.5 Networking and sign-in model

- Same origin API (`https://electrophone.cc`), JSON, errors `{detail}` or `{error, detail, ...}` ([api.md](api.md)). The web authenticates with the HttpOnly session cookie and sends `X-Requested-With: audioplayer` on every request; the iOS app sends `Authorization: Bearer <ID token>` (API-007, API-008, WEB-005). The Mac app should follow iOS (Bearer), see open question A (ambiguities).
- 401 on a signed-in session returns the app to the sign-in state (WEB-007). At launch the web checks `GET /auth/me`, retrying after 0.5, 1.5 and 3 s on a network error or 5xx so a deploy restart does not sign the user out; a 401 is final (WEB-100).
- Coded errors become readable sentences (`limits.js` `friendly`): `hourly_limit` "Hourly limit reached. Try again in N minute(s).", `library_full_songs` "Your library is full. Delete some songs to add more.", `library_full_bytes` "Your storage is full. Delete some songs to free space.", `server_full` "The server is out of storage right now. Try again later.", `signup_closed` "Sign-up is closed on this server.", network failure "Server unreachable", 401 "Not signed in (see Settings)".
- Catalog data: `GET /library` (web) or `GET /catalog` with `ETag` / `If-None-Match` and `since` (iOS) both return the same song objects; plus `GET /tags` (`[{tag, count}]`) for filter chips. The library loads once per session and refreshes after every add, edit, delete and BPM re-detect; the web patches a just-added song into its list instead of reloading (ADD-134).

## 3. Pages

### 3.1 Sign-in and signed-out gate (P0)

Web reference (Settings page, `settings.js`; WEB-001..007, WEB-020):

- Signed out (and no guest view): only Settings is reachable; every other route redirects to `#/settings`; Library, Playback and the dock are hidden.
- Account card: intro "Sign in to see your library, add songs and play them." and, only for providers the server enables in `GET /auth/config` (`google_client_id`, `apple_client_id`), rows "Sign in with Google" and "Sign in with Apple" (outline button "Sign in" with the Apple logo). If neither is configured: "Sign-in is not configured on the server."
- On success the web posts the ID token once to `POST /auth/session` (never stored, never in a URL), refreshes the library and goes to Library. Errors show inline in plain text, e.g. 403 `signup_closed` "Sign-up is closed on this server.", `unverified_email`, `no_email`; closing the Apple popup is silent.
- Signed in: "Signed in as **email**" with a "Sign out" outline button (`POST /auth/logout`, clears the in-memory library and stops playback).

Mac:

- MAC-002 MUST: while signed out the main window shows only the sign-in view (Account card, same texts, native Sign in with Apple button and a Google button); the sidebar is hidden or shows Settings only. Status: planned
- MAC-003 MUST: Mac sign-in reuses the iOS `AuthService` flows (Apple `ASAuthorization`, Google OAuth in `ASWebAuthenticationSession`, refresh token in the Keychain); the server must accept the Mac client ids (API-007 audiences are comma lists). In v1 the Mac streams from the server, so signing in is needed to play your library; offline playback without sign-in (IOS-014) arrives only if the Mac later keeps audio on disk (open question B). Status: planned
- A user whose Apple token expired sees "Expired, sign in again" like iOS (IOS-013).

### 3.2 Library (P1)

Web reference (`library.js`, `library-rows.js`, `library-toolbar.js`, `song-card.js`; LIB-001..150, WEB-011, WEB-031):

Header: eyebrow, display title "Library", right side "N songs" (caption) and the primary glowing button "Add song" (plus icon). `#/add` opens Library with the Add dialog. Below, in order:

1. Toolbar: search field with magnifier (placeholder "Search title, artist, album, remix or tag", `type=search`) and four category chips: Tags, Genres, Years, Countries. Each chip shows its value count (or the selected count when active, accent when on), is disabled when it has no values, opens the filter sheet.
2. Sort bar: sort menu styled as an accent text button with chevron (Recently added (default, `added_at` descending), Title, Artist, Year (version year, newest first, missing last), BPM (ascending, none last)); a status line "N songs match · selected names (up to 3)" only when a filter or search is active; button "Play all N" (visible whenever at least one song is listed); button "Add all N to queue" (visible only with a filter or search active).
3. Table group: header row (eyebrow style, hidden from accessibility) Track, Genres, Time; then the rows.
4. State area below: "Loading your library..." (status), on failure the error with a Retry button, empty library card "No songs yet" / "Paste a YouTube or SoundCloud link to save the song to your library." + "Add song"; no match row "No songs match. Clear the search or the filters."

Filter sheet (WEB-011, LIB-030, LIB-132): modal sheet titled with the category name, subtitle "N in your library · M selected", "Clear" link, pills (multi-select toggles) each with a count, a "not set" first entry (italic, dashed-circle icon, label "Songs with no genre / year / country") where songs exist, and the primary button "Show N songs" (live count while toggling). Values inside one category are OR, categories are AND. Escape or scrim closes without applying. Years are chronological, country names human ("Lithuania"), `lang:` hidden. "Not set" is the reserved token `genre:__unset__` / `decade:__unset__` / `country:__unset__`, never saved.

Row (one line, 76 px high from 720 px; cover 60 px): columns cover / Track / Genres / Time / playlist toggle / menu. Track: title line (with version span, one line, marquee) over muted "Artist · Year" (wraps to at most 2 lines, ellipsis), both with full-text tooltip; fixed 300 px from 1100 px wide (220 to 300 px between 900 and 1099). Genres (from 900 px): plain genre text; the BPM badge moved to the right end of the Track subtitle line (after the queue icon). Former text: BPM badge at the start (outlined rounded rectangle, rounded integer + tiny "BPM", mono digits, tooltip "Beats per minute (estimated)", aria "BPM 132", no badge and no reserved slot when none) as the first inline item before the `genre:` values joined ", " (no comma after the badge) on up to two lines; takes the remaining width (min 120). Time 64 px: `m:ss`; for a song without server audio the service logo link ("Open on YouTube / SoundCloud", new tab) plus a Download icon button (tooltip "Download to the server"). Queue toggle (32 px): "Add to queue" / selected (accent fill, check, "In queue - click to remove"); it reflects queue membership. Menu button (28 px, "More: <title>"): "Play now", "Add to queue" / "Remove from queue", "Download" (server audio only; the file save), "Edit song", "Share link"; rows without audio and auto-download off offer only "Edit song" (+ "Download to server" where the Download button is hidden). The labels here use "queue" for the play queue (renamed from "playlist" on the web, PLS-128). Since 2026-10-24 the web row has no queue toggle or "Add to playlist..." button at the end of the title line: both are small icon buttons stacked left of the cover, "Add to playlist..." on top, the queue button below (LIB-213); the Mac app shows this web row.

Row interaction:

- Cover is a real button (`aria-label` "Play <title>" / "Pause <title>" / "Download <title>"): hover or focus shows a translucent round play icon; click plays that song now and stays on Library. The current song's cover always shows Pause (playing) or Play (paused) at about 75% opacity on a dark round scrim. Where there is no hover (touch) taps play or pause.
- Clicking anywhere else in the row (not cover, toggle, menu, links) or the title button (`aria-label` "Open: <title>") opens the song card. The current row is highlighted. Greyed title and dimmed cover for songs without audio.
- Download ring (LIB-098/099): while a fetch is queued, running or failed the Time cell shows a 28 px ring: percent number inside with `aria-valuenow` and text "Downloading 42%"; Queued = dashed idle ring; Converting = indeterminate spinning arc; Failed = warning button "Failed - click to retry"; a 2 px line along the row's bottom edge repeats the percent. At 100% it holds 0.6 s, then the row refreshes. Ticks update in place without re-rendering the list.
- "Show in Library": clicking the dock title while on Library scrolls the playing row to the vertical centre and flashes it for 1.5 s; if filtered out, toast "Song is hidden by the current filters" with action "Show" (clears search and filters).

Buttons: "Play all N" REPLACES the queue with the listed songs that have audio (de-duplicated, list order), plays the first (random when Shuffle is on), stays on Library; toast "Playing N songs" + " (queue replaced)" when upcoming songs existed + ", M without audio skipped" (or ", M downloading" with auto-download). A tag filter becomes queue chips, search-only gives manual items. "Add all N to queue" appends without starting: toast "Added X songs (Y already in queue)" (+ ", M downloading"). With one filter value selected it becomes a chip.

Data / endpoints: `GET /library` (or `/catalog`), `GET /tags`, `GET /covers/{id}?v=`, `POST /songs/{id}/audio` and `GET /songs/{id}/status` for fetches, `GET /files/{id}?download=1` for saving a file.

Mac:

- MAC-010 MUST: Library is a SwiftUI `List` (keyboard navigation, selection, accessibility) with custom row cells and a custom column header row that reproduce the web grid (the same breakpoints inside the window: Genres column from 900 pt, fixed Track 300 pt from 1100 pt); a stock `Table` is not used because its look cannot match. Status: planned
- MAC-011 SHOULD: Return on a selected row plays it now, Space toggles play/pause globally, double-click plays now, single click opens the song card (web behaviour); right-click shows the row menu; the row menu is the same menu as the "..." button. Status: planned
- MAC-012 MUST: search lives in the toolbar (`.searchable`, focus with Cmd-F) with the web placeholder; sort is a toolbar menu; the four category chips and Play all / Add all stay in the content area under the header as on the web. Status: planned

### 3.3 Song card (P1)

Web reference (LIB-120..125, 142, 146, 149, 150): a read-only modal over Library (560 pt wide dialog on desktop). Contents:

- Cover left (about 48% of width, square, up to 420) with the display title and the "Artist · Year" line on its bottom edge over the Now playing gradient scrim (title clamps to 2 lines); no cover shows the same text as a plain block under. Album on its own muted line below the cover when present.
- Facts column right of the cover, labelled rows: Country, BPM (badge), Time, Status ("Downloaded to the server", "Not downloaded" or the fetch status); a "Year" row when the version has a year. No Decade row.
- Tag chips grouped Genre, Country and other keys; details block in order, each only when set: Version, Version name, Remix by, Remix year, "Cover of A" / "Mashup of S1, S2", First released.
- Stored link icons that open a new tab: YouTube, SoundCloud, Spotify, Wikipedia, MusicBrainz, Discogs (brand colours).
- Action row (one wrapping row, 44 px targets): "Play now" dock key (accent), then round icon buttons Share link, Download (server audio) or Download to server (no audio, none running), Edit, Add to queue / Remove from queue (the web also has "Add to playlist...", PLS-126; not on the Mac yet); "Close" text link at top right; Esc and scrim click close; focus returns to the row's title button.
- Stays in sync while open (repaints after library refresh, player and download changes; closes itself if the song is deleted).

Mac: present as a sheet or popover 560 pt wide; same content. Edit opens the Edit sheet on top.

### 3.4 Playback (P1)

Web reference (`#player`, `player.js`, `queue-logic.js`; PLY-001..148):

Layout: page head (eyebrow, "Now playing"), two columns from 900 px (one column below). Left column at most 420 wide: cover, action row, download note, details. Right column: queue card, filling the remaining width, scrolling inside itself (at most 78% of the viewport height).

Left column:

- Cover square with title (version span) and "Artist · Year" subtitle on a bottom scrim, vinyl placeholder with accent disc and brand mark, empty state text "Nothing playing". The cover is a button (toggle play/pause, round translucent icon centred, label "Pause <title>" / "Play <title>"); with no queue it is not a button. For a current song without audio it starts or requests the download instead.
- Action row (right-aligned, wraps): YouTube and SoundCloud icon links (only when the song has such a source; any other http(s) source gets a generic "Open source" link button), a round "W" link ("Song on Wikipedia", else "Album on Wikipedia", else "Artist on Wikipedia"; https only), Share link, Download (hidden without audio), "Song info" (opens the song card). No "..." menu and no edit button here.
- Download note (when current song has no audio): "Not downloaded" + "Download" button, "Queued for download", "Downloading N%", "Download limit reached - resumes in N min", or "Download failed" + Retry.
- Details: tag chips (wrap), "<n> BPM".

The transport, seek bar, times and volume are not on the page: they are the dock (below). Visualizer opens from the dock key.

Queue card:

- Header: "Queue" with "N songs" (when non-empty); links "Add by tag" (opens "Add songs by tag" picker: chips grouped Genre, Decade, Country, other keys, Tags with counts, multi-select, already-selected pre-picked, "Add songs" appends the union of playable songs carrying any picked tag; unpicking and applying removes) and "Clear" (removes every song after the current one and all tag chips; disabled with tooltip "Nothing upcoming to clear"; toast "Cleared N song(s)" or "Tag chips cleared").
- Chips for the tags that filled the queue, each with an x that removes the tag and the upcoming songs only it brought (toast "Removed N song(s)" / "Tag removed").
- Rows: position number, 60 px cover button (same as Library), title (button: plays it; on the current row toggles pause), artist, duration (rows without audio show their download state in place), "..." menu: Edit song, Download (audio only), Move up (disabled on first), Move down (disabled on last), Remove — for every row including played and current. Current row `aria-current`, marquee on current row, others on hover.
- Empty: "Queue is empty - add songs from Library".

Queue rules (copy exactly; `queue-logic.js`, PLY-023..056, 125, 046):

- Entries are manual (added one by one, Play now) or tag-derived (record which tags). Manual wins: adding a tag-derived song makes it manual; adding a manual duplicate toasts "Already in queue". Removing tags drops only upcoming, non-manual songs with no other selected tag.
- Play now inserts right after the current song (moves it there if queued), marks it manual, plays it. Adding to an empty queue selects the first song but does not play (toast "Queued"; "Added" otherwise). Library deletion drops songs from the queue; deleting the current one stops playback and moves to the nearest.
- Queue edits keep the current song current by identity; removing the current song while playing advances to the next playable and keeps playing (paused: cue it); if none, stop and rest on the last.
- Previous: more than 3 s played restarts the song, else previous; first song or no shuffle history restarts. Next disabled when nothing follows (no loop, no shuffle remainder). Natural end advances by the Next rules; end of queue stops.
- Shuffle: each song once per round in random order, Previous walks back through songs actually played, round end stops (Repeat all starts a new round); toggling shuffle resets the round. Repeat cycles off, whole list ("all"), one song ("one"); "one" repeats on natural end only, Next still advances.
- Without audio (auto-download off): Next, Previous, auto-advance and shuffle skip songs without server audio to the nearest playable one, one aggregate toast "Skipped N not downloaded"; none ahead: stops with "No more downloaded songs in the queue" (loop all wraps); shuffle with none: "No downloaded songs to shuffle". Playback failure: toast "Cannot play this song".
- Relative seeks clamp to 0..duration. Restore on launch: queue restored, current song loaded paused after the library loads; corrupt storage gives an empty queue.

Dock (mini-player, `#mini`, PLY-070, 117, 146, 148): two rows. Row 1: 66 px cover button (play/pause, same as Playback cover), title + artist button (`#mini-open`: on Library scroll to the playing row, elsewhere open Playback), key row: Visualizer (equaliser icon, `aria-pressed` follows full screen, tooltip "Visualizer (V)"), Shuffle, Previous, Play/Pause (lit), Next, Repeat. Row 2 (28 px): time "0:00 / 0:00" (mono), scrubber, volume (speaker mute + slider, 12 px thumb). Scrubber: 6 px visible bar, 28 px hit area, 16 px thumb with 1 px accent border, time bubble above while dragging; press jumps, drag continues outside the bar, seek once on release; keyboard: Left/Down and Right/Up 5 s, Shift 15 s, Home, End; disabled (dimmed) while duration is unknown. Title shows with version span and marquee; tooltip `displayLine`. Dock states for songs awaiting audio replace the artist line with "Downloading 42%", "Converting", "Queued", "Download failed" + Retry.

Auto-download (PLY-110..116; Settings checkbox, default off): with it on, songs without audio can be queued and their audio is requested with `POST /songs/{id}/audio`; the current song first, auto-play when ready if the user wanted it; queue rows show the state; downloads run one at a time per client; `GET /songs/{id}/status` polled about every 1 s while moving, backing off 2, 3, 5 s when idle, paused while the app is inactive, resumed with an immediate request; 429 `hourly_limit` pauses all downloads for `retry_after_minutes` ("Download limit reached - resumes in N min", refreshed every 30 s) and resumes by itself; three consecutive failures stop a bulk run. With it off, nothing is requested automatically; a current song without audio shows "Not downloaded" with a Download button.

Media Session (PLY-080, PLY-143): title is `titleLine`, artist is `artistLine`, plus album, cover artwork and position state; handlers for play, pause, previous, next, seekto, seek backward and forward (default 10 s). Browser tab title is "<displayLine> - Electrophone" else "Electrophone".

Keyboard (web): Space play/pause, Left / Right seek 5 s, only when a song is loaded, no modifier, and focus not in an input, textarea, select, button, link, dialog or editable element. In the full-screen visualizer also: V toggle, M cycle mode, T cycle terrain style, F camera flight, S shuffle, R repeat, Up / Down volume +-5 points, Esc exit.

Data / endpoints: `GET /files/{id}` (streams `audio/mp4`, Range supported), `GET /covers/{id}`, `POST /songs/{id}/audio`, `GET /songs/{id}/status`, `PATCH /songs/{id}` (via Edit).

Mac:

- MAC-020 MUST: playback uses one `AVPlayer`; the dock is a bottom overlay (`safeAreaInset`) at most 720 pt wide, centred in the detail area, with the web's two-row layout, key order and states. Status: planned
- MAC-021 MUST: media keys, Control Centre and Touch Bar-free Now Playing integrate through `MPRemoteCommandCenter` and `MPNowPlayingInfoCenter` with the Media Session mapping above (title, artist, album, artwork, elapsed, duration, rate), including seek commands. Status: planned
- MAC-022 MUST: the global Space / Left / Right shortcuts are handled by the Playback command group so they do not fire while a text field, sheet or menu has focus (same exclusion list as PLY-090); built as a local key monitor (`MacKeys`) that ignores events while a text field or sheet has focus, with the menu items shown without key equivalents. Status: planned
- MAC-023 MUST: audio `Authorization: Bearer` is supplied to `AVURLAsset` through `AVURLAssetHTTPHeaderFieldsOptionKey` (no token in URLs); a token refresh must not interrupt the current item. Status: planned
- MAC-024 SHOULD: the queue honours the same rules in a shared, unit-tested Swift port of `queue-logic.js` (the web has node tests per rule; port the cases). Status: planned

### 3.5 Visualizer (P3, Mirrored spectrum and Ring only)

Web reference ([visualizer.md](visualizer.md)): full-screen overlay opened from the dock key or `V` (never a background visualizer), closed by the X button (top right, "Exit full screen"), Esc or `V`. Exactly one mode at a time: Mirrored spectrum (default, 30 fps, mirrored bars about a bright horizon line, one horizontal 4-stop magenta-to-orange gradient, faint dimmer reflection, constant bar density `clamp(round(width/4), 96, 480)`, glow as a blurred copy), Ring (centred ring with spokes and bass pulse), Terrain (WebGL wireframe relief with lookahead timeline, 60 fps, styles, Camera flight; Synthwave variants). Background radial gradient violet. Overlay: title and artist, shared scrubber, shuffle / previous / play / next / repeat, mode dropdown (listbox: icon, label, check), volume (speaker + slider), top-right cluster Share link, Visualizer settings (left style panel, closed by default), Exit; controls and style panel auto-hide after 3 s idle and return on pointer, key or focus; a click on the picture toggles play/pause. Rules: never invent motion (silent or unrouted analyser draws only the idle horizon / ring and a one-line status), pause decays to idle, no frozen frame; flash safety (bass pulse rate-limited to at most 3 flashes per second); reduced motion gives one static frame; Web Audio missing disables the key with a tooltip. Settings: Visualizer mode (default Mirrored spectrum), Terrain style, Visualizer height Small (1/6) default, Medium (1/3), Full.

Mac:

- MAC-030 SHOULD: later phase; render with Metal or SwiftUI `Canvas` fed by an audio tap (`MTAudioProcessingTap` on the `AVPlayerItem`, or `AVAudioEngine`); a remote progressive stream may not allow a tap, so verify before committing (open question E). Reuse the exact colours, density, 30 fps pacing and the flash-safety and reduced-motion rules. Terrain, Synthwave and Camera flight are out of v1. Status: implemented for Mirrored spectrum and Ring (`MacAudioTap.swift`, `MacVisualizer.swift`, `MacVisualizerView.swift`): a 2048-point FFT in 64 log bands from an `MTAudioProcessingTap` set on the item before it plays, drawn in `Canvas` at 30 fps in an in-window overlay (V, M, Esc, dock key, View menu; native full screen, Share link, the style panel and the Settings card are not built). The tap is verified only on a local file and a Range-capable HTTP file with custom headers in a test harness; on the real server stream it is unverified until run. If no tap callback arrives within 3 s of playback the key is disabled with a tooltip and the console logs `viz tap: NO callbacks`. Colours are the `chart` tokens (the web `--viz-*` palette is viz-local); the look is untuned. Not browser-comparable by ear or eye yet
- Full-screen uses native macOS full-screen (`toggleFullScreen`), Esc exits; the same keys V, M, S, R, Up, Down apply while it is open.

### 3.6 Share links (P3)

Web reference ([share.md](share.md)): link `https://electrophone.cc/#/play/<songId>?v=1&t=<sec>&viz=<bars|ring|terrain|synthwave>&style=&fs=1&cam=&fl=1`; song id `[A-Za-z0-9._-]{1,80}`; invalid values dropped, no personal data. Dialog: checkbox "Start at current time", editable mm:ss field (error "Use mm:ss, for example 1:23"), "Open in full-screen visualizer", "Include camera" (Terrain only), read-only link field, summary of included settings, buttons "Share" and "Copy link" (live region "Link copied"). Opening a link: replaces the hash with `#/library`, unavailable song shows "This song is not available", song without audio opens its card with "No audio on the server yet"; autoplay is never attempted: a gate "Tap to play at 1:23" with "Not now". Entry points: Library row menu "Share link", song card, Playback action row, visualizer top-right cluster.

Mac: v1 has no Share. Later: a Share link item that builds the same URL (only `t`, `viz`, `fs`) and offers the system share sheet and Copy; opening links in the app (custom URL scheme) is not planned; the web handles them.

### 3.7 Playlists (placeholder built)

Web reference: nav item "Playlists" with the list and playlist pages (flat saved playlists, PLS-121 to PLS-128, built on the web 2026-10-24: Play playlist, Add to queue, Shuffle, Export, reorder, "Add to playlist..." picker; [playlists.md](playlists.md)). The Mac app is still the placeholder page that says only "Playlists are coming soon" (`PlaylistsPage.swift`), not a real playlist model; building the web pages on the Mac is a later step (task-0058 phase 4). Terminology: since 2026-10-24 the web labels the transient play queue "Add to queue" / "In queue" ("Play all" and "Add all N to queue" also act on it, [terminology](terminology.md), PLS-128) and "playlist" only means a saved playlist; the labels in this spec use the new wording, while `ios/` and `ios/MacSources/` still show the old "Add to playlist" text until the owner allows changing them.

### 3.8 Genres map and Genres map rework (Genres map built, rework not)

Web reference ([genres.md](genres.md), WEB-084..088): full-viewport canvas workspace with a force-directed genre graph (nodes sized by song count, family colours from `--chart-*`, parent edges with arrows, related edges dashed), floating toolbar (title, status chip, search, Legend, Now playing, Orphans, zoom buttons), selected-genre card with "Show N songs in Library", outline tree panel. The rework page is a three-level hierarchy map from `GET /genres/vocabulary` and library counts, with review badges and modifier filters. Data: `GET /genres/graph`, `GET /genres/vocabulary`, `GET /library`. Built for the Genres map only (`GenresMapPage.swift`, `Gen*.swift`: port of `genre-graph.js`, `genre-data.js`, `genre-view.js` with a `Canvas` force graph, search, info card, outline); the rework page and `GET /genres/vocabulary` are not built. Card style and click-only selection (GEN-026) follow the web.

### 3.9 Song stats (built)

Web reference ([stats.md](stats.md)): `#/stats`, a full-viewport canvas scatter plot of year (x, padded, at least 10 years) against BPM (y, 60 to 200 default, never below 0), one 5 px dot per song with year and BPM (version year counts), jitter seeded by the song id, colour by Genre family (default), Decade, Audio on server or None, collapsible legend with counts, hover tooltip (title, artist, year, BPM), click opens the song card, rubber-band selection with a panel "N selected:" (Show in Library, Add to queue, Play, Clear; the web adds "Add to playlist..." for a signed-in user), wheel zoom, Shift/middle/right-drag pan, `C` centre, `0` or double-click reset, "View as table" (sortable). Data: the loaded library plus `GET /genres/graph`. Built (`SongStatsPage.swift`, `Stat*.swift`); it fetches `/genres/graph` on its own, as does the Genres map (two decoders, no shared cache).

### 3.10 Music theory (built)

Web reference (WEB-093, WEB-098): `#/theory`, a read-only alphabetical glossary (`web/data/theory-terms.json`) and a "Composition metadata anatomy" section (`theory-anatomy.json`, annotated raw titles for example songs). Static JSON, no API. Built: `MusicTheoryPage.swift`, `ThyLogic.swift` (port of `theory.js`), `ThyAnatomyView.swift`; the JSON is fetched from the server's `/data/` files, not bundled.

### 3.11 Settings (P2)

Web reference (`settings.js`, WEB-004, WEB-036, WEB-070, WEB-080..083, WEB-094; LIB-091): page head "Settings" / "Your library and storage on this server." Two columns from about 800 px (one below); each setting is a row with label and a short hint (at most two lines) on the left and the control on the right; selects 14 rem wide.

Left column cards (signed in):

- Account: "Signed in as **email**" + "Sign out".
- Library: "N songs" with "X h of music" (or minutes), a divider, then rows Storage (`GET /me/usage`: "N / 500 songs · X / 5 GB", the owner "N songs · X"), Sync (text from `describeSync`: "In sync with git", "Saving to git", warnings with a "!" mark), Server (host).
- BPM detection: "N songs have audio but no BPM", "Detect missing BPM" (disabled at 0 or running), progress bar, "Detecting... 12 of 56 (3 failed)", Cancel; polls `GET /me/backfill/bpm` every 2 s only while running and visible; `POST` starts, `DELETE` cancels.
- Metadata for downloaded songs: "N downloaded songs have no metadata yet" ("Every downloaded song has its metadata." at zero), "Get metadata", "Getting metadata... N of M", Cancel, "Done: N updated, N nothing found, N failed." (`/me/backfill/metadata`).
- Download all songs: "N songs are not downloaded yet", "Download all", confirm step (count, hourly-limit note, optional "Include long songs" for songs over 300 s), progress "Downloading... N of M", Cancel, summary, failed list with "Copy failed songs".

Right column: Playback card with the checkbox "Auto-download songs" (hint "Download songs you play or add to the queue. Each download counts toward the hourly add limit."), Visualizer card (mode, Terrain style, height selects; disabled without Web Audio). Footer: legal note.

Mac:

- MAC-040 MUST: Settings is the standard macOS Settings scene (Cmd-comma) with the same cards in the same order and texts (Account, Library, Playback; later BPM detection, Metadata, Download all, Visualizer), and the signed-out main window shows the Account card (MAC-002). Status: planned
- MAC-041 MUST: v1 Settings has Account, Library (songs, storage meter, sync, server) and Playback (Auto-download); the Mac adds a "Downloads" row group for local storage if the Mac keeps audio on disk (open question B), mirroring iOS Settings. Status: planned

### 3.12 Add song and Edit song (P2)

Web reference (`add.js`, `edit-dialog.js`, `song-form.js`, `song-form-credits.js`, `song-payload.js`; WEB-015..033, ADD-001..135, LIB-050..056, LIB-133):

Add dialog (560 pt, modal, title "Add from YouTube or SoundCloud", subtitle "Save the song's details; play it from the original link or on your iPhone."):

1. Link field (placeholder "YouTube or SoundCloud link, or a YouTube video id") and a "Fetch" button. Pasted text is cleaned to the canonical link (tracking parameters removed; a bare 11-character video id becomes a watch link; SoundCloud track links incl. `on.soundcloud.com`). On every input the field is checked against the loaded library with no network: "Already in your library: <displayLine>" with a check icon and "Show in library" (closes, scrolls, flashes the row 2.5 s) and Fetch is disabled until the link changes.
2. Fetch (`POST /preview/stream`, NDJSON): a checklist under the field with the real steps "Reading the link", "Getting title and artist", "Looking up genres and the first release", "Checking Wikipedia and Wikidata", "Checking Discogs", header "Step k of n: <step>" (polite live region) and elapsed seconds; no percent. Errors shown as text: `unsupported`, `private`, `not_found`, `failed`, and `preview_only` as "Preview only — SoundCloud Go+ track, can't be downloaded in full." The link field then hides and the form opens.
3. Preview header: 96 px-class cover (thumbnail), title, "Artists (feat.) · Year", album line, duration (`m:ss`), source chip ("YouTube" / "SoundCloud"); updates live as fields change. The shared form, then error line, then a sticky footer with the primary "Save to library" button (disabled when `in_library`).
4. Save: validates year (1900 to next year) and links, then `POST /songs` with `audio:false` (web) and `source_raw` from the preview; toast "Saved to library". Closing in any way (Cancel, Esc, backdrop, Save) clears state and aborts running requests.

Edit dialog: same form; header "Edit song" with the song's display line; starts with a 96 px cover and "Change cover" (choices "Upload file" JPEG/PNG/WebP up to 5 MB, "From address" http(s) image URL + "Use this image", "Remove cover"; applied at once, toasts "Cover updated" / "Cover removed", errors in plain English; `PUT /songs/{id}/cover`, `POST .../cover/from-url`, `DELETE .../cover`); buttons Cancel, Save (`PATCH /songs/{id}`, toast "Saved", server errors inline), "Delete from library" (confirmation "Delete song?", removes record, audio and cover; 404 just closes), Download (audio only). Saving an unchanged form sends the stored structure back unchanged (ADD-122).

Shared form (WEB-033, ADD-112), fields in order:

1. Title: token-pill field (separators only " - ", " – ", " — ", " | ", " / ", " // " with spaces on both sides, and Enter; commas, "&", ";" and unspaced symbols stay inside a pill). Pill = [pencil] text [x]; the pencil edits the pill text directly (no menu, as on the web since 2026-10-18); pills drag between Title, Artists, Featuring and Remix by (accent insertion line, dimmed dragged pill). Title is required; hint "Move "X" to Artists?" when Title has 2+ pills and the first is not already an Artist pill.
2. Artists (pills), Featuring (pills).
3. Version select: none, Remix, Live, Acoustic, Extended, Instrumental, Remaster, Edit, Cover, Mashup, Other. While a Version is chosen: Version name (plain text, credited exactly), Remix by (pills; the label follows the Version type as on the web, ADD-180, e.g. Remaster by, Version by for Other), Remix year (1900 to next year; auto-suggested once from the source's publish year when never touched, shown dashed italic), "Cover of" / "Mashup of" (pills; Cover and Mashup only). Choosing none sends no version (`null` on PATCH).
4. A live line previews `displayLine`; a non-blocking warning names "Remix by" names missing from the Version name; a "Suggested split" panel offers Apply for split patterns (`&`, `,`, " and ", " x ", " vs ", "feat.", cover/mashup/remix wording).
5. Row: Links region (collapsible, "Links", state remembered; icons of filled sources while collapsed; expanded rows: YouTube link, SoundCloud link, Wikipedia: song, Wikipedia: band, Wikipedia: album, Spotify link, MusicBrainz link, Discogs link, each with a validation message and the icon as a new-tab link) on the left, buttons "Get metadata" and "Identify from audio" on the right. "Wikipedia says: artist / title" hint applied only on click.
6. Status note, then Album, First released (year of the original recording), BPM row (Add: muted "BPM is detected after saving"; Edit: read-only "<n> BPM" or "Not detected yet" with a "Re-detect" button, tooltip that BPM may be off by half or double), Genres (chip field, cap 12, "," and "/" separate, autocomplete of up to 6 suggestions from `GET /genres`, arrows, Enter or Tab accept), Countries (chip field, cap 1), Tags (shared editor: typed text stays until Enter, comma or Save; chips with x; "Suggested" row in Add; all library tags as toggle chips grouped Decade, other keys, Tags with counts; `lang:` and `genre:`/`country:` hidden from it but preserved).
7. "Get metadata" (`POST /metadata`, 15 s cap, always 200) fills only empty Album, First released and adds `genre:`/`country:` tags within caps; six service icons (YouTube, SoundCloud, Wikipedia, Spotify, MusicBrainz, Discogs) grey, pulsing while running, coloured links when found; for a song with a Version it never fills Album or links. "Identify from audio" (`POST /songs/{id}/identify`, Edit only, suggestions only).
8. Payload (pure, tested in `song-payload.js`): `title`, `album`, `mainArtists`, `featuredArtists`, `releaseYear`, `albums`, `version {type, name, artists, releaseYear, originalArtists?}`, link keys, tags; no legacy key; invalid years reported before sending. 422 `unknown_genre` / `unknown_country` show the server message ("Did you mean: ...").

Endpoints: `POST /preview`, `POST /preview/stream`, `POST /metadata`, `POST /lookup/wikipedia`, `POST /songs`, `PATCH /songs/{id}`, `DELETE /songs/{id}`, `POST /songs/{id}/bpm/detect`, `POST /songs/{id}/identify`, `GET /genres`, `GET /genres/vocabulary`, cover routes.

Mac:

- MAC-050 MUST: the iOS SwiftUI form (`SongFormView`, `TokenField`, `SongFormState`, `TagLogic`, `GenreSuggest`, `WikiLink`) is reused unchanged in logic; the Mac only adapts layout (sheet, `Form`-style grouped sections, two-column rows where the web uses a row, Tab order = visual order). Status: planned
- MAC-051 MUST: Mac Add follows iOS rather than the web: two actions, "Add to library" (catalog entry) and "Add and download" (also fetch audio), because the Mac app can hold audio (open question B). Status: planned
- MAC-052 SHOULD: drag-and-drop of a YouTube / SoundCloud URL (or pasted text) onto the Library window opens Add with the link filled (Cmd-N then paste works the same). Status: planned

## 4. Mac idioms

| Web element | Mac construct |
| --- | --- |
| 220 px rail / 64 px icon rail, toggle | `NavigationSplitView` sidebar (`List` with `.sidebar` style); toggle via toolbar button and View > Show/Hide Sidebar (Control-Cmd-S); collapsing keeps the 64 pt icon-only rail look by custom detail rather than system hiding, or accept system hide (open question F) |
| Brand block, "Offline music player" | sidebar header; app name "Electrophone" in the window and menu bar (rebrand to "Electrophone Vega 108" is pending, see brand README) |
| Server LED + text | sidebar footer; same `GET /health` poll; Window > status not needed |
| Page head (eyebrow + display title) | content header inside each page; window title shows the current page, the title bar can be hidden-style (`.hiddenTitleBar` / unified compact toolbar) |
| Library search | toolbar `.searchable` placed in the toolbar, Cmd-F |
| Add song button | toolbar item (primary) and File > Add Song... (Cmd-N); Cmd-Shift-N not used |
| Sort select | toolbar menu or the in-content accent text menu as on the web (keep the web placement; add View > Sort By menu commands) |
| Row "..." menu, row actions | context menu + the "..." button; menu bar Song menu mirrors them for the selection |
| Song card / Add / Edit dialogs / filter sheet | SwiftUI `.sheet` (560 pt wide; filter sheet narrower), Esc cancels, Return default action; the song card may be a popover anchored to the row |
| Toast | in-window overlay above the dock, same 3 s / 6 s timing, announced to VoiceOver; not a system notification |
| Mini-player dock | bottom `safeAreaInset` overlay in the detail area, 720 pt max; no floating separate window |
| Space / arrows | Playback menu items with key equivalents; they must not fire while editing text (use the responder chain, not a global monitor) |
| Media Session | `MPRemoteCommandCenter` (play, pause, toggle, next, previous, change playback position, skip forward/backward 10 s) and `MPNowPlayingInfoCenter`; hardware media keys and Control Centre follow |
| Visualizer full screen | native full-screen window state; Esc exits |
| Settings page | Settings scene (Cmd-comma); signed-out view is in the main window |
| Dark / light | follow system appearance; tokens already adapt |
| Window sizing | minimum 720 x 560 pt, default 1100 x 760 pt, resizable; remembers frame and sidebar state; Genres column appears from 900 pt content width |
| Dock icon / menu | app icon from the existing asset set; Dock menu: Play/Pause, Next, Previous |
| Keyboard focus | visible 2 px accent ring on every control (do not rely on the system ring colour); full keyboard access friendly |
| Reduced motion | honour `accessibilityReduceMotion` for marquee, ring, visualizer and sidebar animation (0.2 s ease otherwise) |

Proposed menu bar (all items have web equivalents):

- File: Add Song... (Cmd-N), Close Window (Cmd-W).
- Edit: standard text editing; Find (Cmd-F focuses search).
- View: Show/Hide Sidebar (Control-Cmd-S), Library (Cmd-1), Playback (Cmd-2), Settings (Cmd-comma); Visualizer (V) toggle later.
- Song (acts on the selected row or the current song): Play Now, Add to Queue / Remove from Queue, Download, Edit Song (Cmd-E), Show in Library (Cmd-L), Share Link (later).
- Playback: Play/Pause (Space), Next (Cmd-Right), Previous (Cmd-Left), Seek Forward / Back 5 s (Right / Left, Shift = 15 s), Volume Up / Down (Cmd-Up / Cmd-Down), Shuffle (Cmd-S would clash with Save, so Option-Cmd-S), Repeat (Option-Cmd-R), Clear Queue.
- Window and Help: standard.

These shortcuts are proposals (marked MAC-060 SHOULD, Status: planned); only Space, Left, Right, V, M, T, F, S, R, Up, Down and Esc exist on the web.

## 5. Priority order and phases

1. P0/P1 core (first milestone): shell (sidebar, stage, dock, toasts), sign-in + gate, Library (list, search, sort, four filter sheets, row actions, song card, download ring, Play all / Add all), Playback page (cover, action row, queue with all rules, persistence), dock with scrubber/volume, Media Session and media keys, auto-download and download polling with the hourly-limit pause.
2. P2: Add and Edit (shared form, pills, chip fields, links region, metadata, cover change, delete), Settings scene (Account, Library, Playback).
3. P3: Settings bulk cards (BPM detection, Metadata backfill, Download all), Share link, full-screen visualizer (Mirrored spectrum, Ring) and its settings.
4. P4 (only if wanted): Terrain / Synthwave, Playlists (once the web ships them), Genres map, Song stats, Music theory, guest read-only view.

Each phase ends in a state where playback works with the screen unlocked or locked; offline playback on the Mac needs local audio files, which v1 does not keep (ADR-0029).

## 6. Ambiguities and open decisions

- A. Auth transport: web uses the session cookie (`__Host-session`, 30 days, CSRF header), iOS uses `Authorization: Bearer <ID token>` with a Keychain refresh token (Apple cannot refresh silently). Recommendation: copy iOS; the Mac needs its own Google OAuth client and Apple audience accepted by the server (API-007 comma lists, `GOOGLE_CLIENT_ID`, `APPLE_AUDIENCE`). Not decided in any ADR.
- B. Where audio lives on a Mac: the web only streams audio that is already on the server (it never downloads to the device; "Download" there means save a file, "Auto-download" means fetch to the server), while iOS keeps audio on the phone (`audio_state` `phone`). The key principle is "on my phone". Recommendation: the Mac behaves like iOS (catalog + local files + server fetch) because it shares iOS code; v1 minimum is stream-from-server like the web. The words "download" and "audio state" must be defined for the Mac before building Library status and the Settings card.
- C. "Playlist" in labels means the play queue today (LIB-012 vs PLS-008); renaming is planned with Playlists. Mac keeps the web labels.
- D. App name: UI says "Electrophone", the brand README says the full name is "Electrophone Vega 108", rebrand pending.
- E. Visualizer tap: `MTAudioProcessingTap` is tried directly on the streamed item (no caching, no fake data); it works in a harness on local and Range-capable HTTP files with custom headers, but on the real server stream it is unverified until the owner runs the app. A failure disables the key after 3 s of playback (MAC-030).
- F. Collapsed sidebar: the web icon rail (64 px, nav icons only) is not the system sidebar behaviour; either custom or accept the system collapse. Cosmetic.
- G. Docs drift worth knowing: PLS-001 and PLS-100 put Playlists "between Library and Genres map", but WEB-012 and `index.html` put it second, right after Playback (the code order is used above); WEB-001 says a signed-out visitor sees only Settings, but the guest view (WEB-060) shows Library and Playback. Use `index.html`, `library.js` and `player-ui.js` as the order and label authority.
- H. Distribution: iOS is TestFlight internal only and the YouTube ToS note applies; the Mac build is assumed to be a locally signed, non-App-Store app (not stated anywhere).
