# Changelog

What shipped, newest first. One line each; the web UI and server are live at https://electrophone.cc. Everything listed here is deployed except the sections marked "built, not deployed" (the 2026-10-14 release went out once the SSH access in [task-0027](tasks/task-0027.md) was restored; the live visualizer files match `origin/main` as of 2026-10-15). Why: [tech/decisions.md](tech/decisions.md); runbook: [tech/deploy.md](tech/deploy.md).

## 2026-10-24 (playlist page: Add to queue before Shuffle, web, deployed)

- Web (owner, 2026-10-24: "swap shuffle and add to queue"; PLS-124; deployed 2026-10-24 as `8487026`; `node --check` only, no tests run, no test assertions affected): the playlist page actions are now Play playlist, Add to queue, Shuffle, Export, Edit, Delete (`web/js/playlist-view.js`; the buttons are built in one place, so keyboard Tab order follows; the row menu has no such actions).

## 2026-10-24 (Add songs shortcut on the playlist list rows, web, deployed)

- Web (owner, 2026-10-24: he looked for the add-songs search box on the Playlists list and found it only on a playlist's page; the shortcut was offered and accepted; deployed 2026-10-24 as `e587442`; [task-0058](tasks/task-0058.md), PLS-134; no tests run or written by the owner's rule, `node --check` and a browser check at 500 and 375 px against a local server with fixture songs and two playlists): every row of the Playlists list has a plus button ("Add songs to <name>", before the pencil and the trash, same size, 44 px hit area). It opens that playlist and puts the cursor in the "Add songs by title or artist" box (`#/playlists/<id>?add=1`, removed from the address once used, so Back and reload do not focus it again). Clicking the row or the name still just opens the playlist.

## 2026-10-24 (sidebar text no longer reflows while it collapses and expands, deployed)

- Web (owner report 2026-10-24, five frames of a screen recording; WEB-037, WEB-050, PLY-199; deployed 2026-10-24 as `8da932d`; no tests run, test assertions edited in `web/js/side-toggle-edge.test.mjs`): the build stamp ("81dc214 · 24 Oct 10:47") wrapped character by character into a column while the sidebar widened, and the title, artist and menu labels re-truncated as the width changed. Before, at 1200x800 and 0, 40, 80, 120 and 160 ms of the expansion (animations stepped with `currentTime`): the stamp 18, 6, 2, 1 and 1 lines (332, 116, 44, 26 and 26px high), the menu list 283px of 349px at the first frame; the collapse and the title, artist and label heights were already one line. After: the stamp is one 26px line at every sample in both directions (`white-space: nowrap` on `.build-line` in every state, `overflow-wrap` removed, clipped by its own box), the title (16px), artist (14px) and the 18px labels are one line each, the footer row's text column has a fixed final width clipped by its button (`--side-open`, the one 220px open width), no menu scrolling at any sample, and all 120 sidebar boxes are identical to before in the open sidebar and the rail. The rail's round play button and ring (56px, 3.5 to 59.5px of the 64px rail) are not clipped: no ancestor clips them at any frame, so the cut seen in the recording is the recording's crop.

## 2026-10-24 (genre research sources page, docs only)

- Docs (owner request 2026-10-24: "store somewhere this one"; nothing saved, no deploy, no tests): new [tech/genre-research-sources.md](tech/genre-research-sources.md) lists the links used for genre research with their trust level (RYM, Musicmap and Discogs as reference; guides, wikis and Wikipedia as corroborating or weak), including the neurotrance.org psytrance sub-genres guide.

## 2026-10-24 (playlist add by search, web, deployed)

- Web (owner request 2026-10-24: "in playlist editing - allow adding song by searching it name, artist - basically similar textbox as in Library"; deployed 2026-10-24 as `9931e3d`, [task-0058](tasks/task-0058.md), PLS-129 to PLS-133; no tests run or written by the owner's rule, `node --check` and a browser check at 1200 and 375 px against a local server with fixture songs): the playlist page has an "Add songs by title or artist" search box under the action buttons. Typing lists the library songs that match (the Library's matcher: case and accents ignored, title, artists, version, tags) and are not in the playlist yet, with a "N songs found, K already in this playlist" line; Up and Down move, Enter or a click adds, the song appears in the list at once with the toast "Added to <name>" and focus stays in the box for the next one; a failed add is rolled back with a toast. The search textbox and the matcher were extracted from the Library (`search-box.js`, `song-match.js`) and both pages use them.

## 2026-10-24 (sidebar icons keep the same x when it collapses and expands, deployed)

- Web (owner request 2026-10-24, "the icons are centred with lots of air, that creates the feeling of jerking; make them left aligned"; WEB-037, WEB-050, PLY-199; deployed 2026-10-24 as `81dc214`; no tests run, test assertions edited in `web/js/side-toggle-edge.test.mjs` and `web/js/mini-compact.test.mjs`): the menu icons, the Help and Settings icons, the logo mark and the rail's play button no longer slide sideways while the sidebar changes width. Before, the rail centred the icons and changed the sidebar padding at once while the width was still animating: at 1200x800 the icon's left edge was 24px open, 99.5, 81, 39 and 24.7px at 0, 50, 100 and 150 ms of the collapse and 21.5px in the rail (the pill's left edge 16px, then 8px), the mark 24px open and 94.5px at the start of the collapse. After, everything is left-aligned at one fixed x: icon and mark left edge 21.5px in the open sidebar, in the rail and at 0, 50, 100 and 150 ms in both directions (measured at 1200x800 and 1000x700, animations stepped with `currentTime`), the pill's left edge 16px in every state (rail 16-47px, open 16-203px), y values unchanged. The inline padding of the items and the brand block is the one `--nav-pad` (5.5px, derived from the 64px rail width), the sidebar keeps its `--space-4` inline padding in the rail, the rail width stays 64px, the 480-719px rail has the same icon x (21.5px) with its mark centred on the icon column (was left-aligned at 8px), the Help flyout and the toggle keep their places, the phone tab bar is identical. The rail's round play button is left-aligned on the icons' centre so it no longer slides during the transition.

## 2026-10-24 (Genres map v2 zoom bar back to the bottom, deployed)

- Web: the Genres map v2 zoom bar sits in the bottom left corner again in wide windows (GEN-110; owner report "you didn't place it in bottom?", deployed 2026-10-24 as `2a6f20c`, no tests run, test assertions checked, none affected): the bar rose by the whole expanded playback dock (108 px) even where the centred dock is not under it, so in a wide window it floated about 120 px above the bottom edge; now it rises only while the dock's left edge is within `--space-3` of the bar's right edge (`--zoom-reserve`, CSS `sign()` under `@supports`), and `--dock-reserve` is the exact dock height (no stale 24 px with the dock collapsed into the sidebar at 480 to 719 px, no extra 8 px above the dock; the collapsed sheet pill and the bar are `--space-3` apart). Measured in iframes at 500x448, 375x667, 720x600, 1000x700 and 1300x700 with the real CSS and the v2 DOM structure (not the real app, no real playing dock).

## 2026-10-24 (flat playlists, web, deployed)

- Web (owner decision 2026-10-24, deployed 2026-10-24 as `2cf671a`, [task-0058](tasks/task-0058.md) phase 2; PLS-121 to PLS-128, PLY-204, LIB-012; no tests run or written by the owner's rule, `node --check` and a browser check against a local server with fixture songs): the Playlists page replaces the placeholder (`#/playlists` list, `#/playlists/<id>` page; signed-in users only, guests see no nav item). List: A to Z with the first song's cover, count and last change, New playlist (a taken name suggests "Name (2)"), edit, delete with a confirm and an Undo toast. Playlist page: cover, name, description, "N songs, H:MM total" ("about" when a length is missing), Library rows with a drag handle and a remove button (Undo toast), reorder by dragging and by Alt+Up and Alt+Down with one `PUT /playlists/{id}/order` per drop or short pause, and the actions Play playlist (replaces the queue, starts the first, "N songs without audio skipped"), Shuffle, Add to queue and Export (`<name>.txt`). "Add to playlist..." opens a picker (playlists marked "In playlist", New playlist...) from the song card, Library rows and the Statistics selection panel. The queue toggle formerly called "Add to playlist" / "In playlist" is now "Add to queue" / "In queue" in the whole web UI (labels, toasts, tooltips, specs, Mac spec text); the iOS and Mac apps are unchanged.

## 2026-10-24 (rail and open sidebar share the same vertical positions, deployed)

- Web (owner request 2026-10-24, "fix layout jerks, vertical spacing should be the same"; WEB-037, WEB-050, PLY-199; deployed 2026-10-24 as `fc5edfb`; no tests run, test assertions edited in `web/js/side-toggle-edge.test.mjs` and `web/js/mini-compact.test.mjs`): the rail and the open sidebar share the same vertical positions, so toggling the sidebar moves nothing vertically. Before, the rail kept its own 24px top padding, 44px lockup box, 24px mark and 41px first-item gap: at 1000x700 the mark centre was at y 50 (open 32), the toggle at 80 (64), the first item at 113 (68), the divider at 373 (328), Help at 386 (341), Settings at 422 (377), the player row top at 607 (567) with its play button centre at 648 (602). After, both states have the mark centre at 32, brand block 8-56, toggle 64, first item 68, divider 328, Help 341, Settings 377, row top 585 and play centre 620, stamp box 658-684 (26px), measured with `getBoundingClientRect` in same-size iframes at 1200x800, 1000x700, 800x700 and 800x420, with and without a loaded song; the item boxes stay 32px high and nothing moves at any frame of the width transition. The rail now uses the open sidebar's top padding, the same 48px brand block and 30px mark, the same toggle offset (outside the menu column, no overlap with the first item) and the same `--side-lockup-gap`; the hidden stamp keeps its box in the rail, the menu margin above the player row applies in both states, and the rail's round play button is centred on the open row's play button.

## 2026-10-24 (zenonesque and suomisaundi added, nitzhonot description rewritten, deployed)

- Server data (owner request 2026-10-24; GEN-056, GEN-103, GEN-105, DATA-196, DATA-197, task-0096; deployed 2026-10-24 as `1e08011`, load checks only, no tests run, test assertions edited): `suomisaundi` (Rate Your Music: 175 releases, "a Finnish-based deviation of Psytrance") is an approved extra under `psytrance`, level 3, with `related` goa trance and synonyms `spugedelic trance`, `suomisoundi` and `suomistyge`; `zenonesque` (48 releases, "a form of Progressive Psytrance") is an approved extra under `progressive psytrance`, level 4, with `related` minimal techno and tech trance and synonyms `zenon` and `zenon sound`. Neither is in Discogs; the Rate Your Music breadcrumbs were not shown, so both parents are inferred from the text. Both get rows in `genre_extras.json` and `genre_sources.json` and Genres map v2 circles (`suomisaundi` level 3, `zenonesque` level 4, `v1` the same name). Own-words descriptions of about 100 words (nitzhonot 105, zenonesque 103, suomisaundi 105 words) from Rate Your Music plus Wikipedia (Nitzhonot and Suomisaundi articles; no Zenonesque article exists); the nitzhonot text replaces the short one and keeps `Tempo: about 145-160 BPM.`; the two new ones have no tempo line (no source gives one). The vocabulary is now 537 genres and 582 memberships (420 / 112 / 5 at levels 2 / 3 / 4), 70 extras, trance 25 = 14 / 7 / 4, Trance subfamily 23 (147 in all); the web fixture `genre_payload_levels.json` is regenerated and the source policy and candidate lists no longer leave the two out. No library song in the three user libraries carries these tags or is by Sensient, Ryanosaurus, Dirty Hippy, Grouch or Eyal Barkan.

## 2026-10-24 (nitzhonot added under goa trance, deployed)

- Server data (owner request 2026-10-24; GEN-056, GEN-105, DATA-197, task-0096; deployed 2026-10-24 as `08b6d3f`, load checks only, no tests run, test assertions edited): `nitzhonot` is now an approved extra under `goa trance` (Rate Your Music page "Nitzhonot": 549 releases, breadcrumb All genres > Goa Trance > Nitzhonot), so it is level 4 (the fourth, with `chillstep`, `hi-tech psytrance` and `psycore`). It is not in Discogs; `related` full-on psytrance and uplifting trance; synonyms `nitzonot` and `nizhonot` (`greek uplifting` and `nitzhogoa` are later strands, named in the description only). Own-words description with `Tempo: about 145-160 BPM.`; rows in `genre_extras.json` and `genre_sources.json`; Genres map v2 circle `nitzhonot` (level 4, parent `goa-trance`). The earlier notes that left it out as unattested are fixed in [genre-terminology.md](tech/genre-terminology.md#source-policy-for-new-genres), [genre-levels.md](tech/genre-levels.md#psytrance-sub-genres-added-owner-2026-10-23) and [microgenre-candidates.md](tech/microgenre-candidates.md). The vocabulary is now 535 genres and 580 memberships (420 / 111 / 4 at levels 2 / 3 / 4), 68 extras, trance 23 = 14 / 6 / 3, Trance subfamily 21 (145 in all); the web fixture `genre_payload_levels.json` is regenerated. No library song in the three user libraries carries a nitzhonot tag or is by Eyal Barkan.

## 2026-10-24 (hi-tech psytrance moved under dark psytrance, deployed)

- Server data (owner request 2026-10-24; GEN-056, GEN-105, DATA-197, task-0096; deployed 2026-10-24, load checks only, no tests run, test assertions edited): `hi-tech psytrance` now has the parent `dark psytrance` instead of `psytrance` (Rate Your Music breadcrumb Hi-Tech Psytrance > Dark Psytrance > Psytrance; the tree is grouping, not lineage), in `genre_levels.json`, `genre_extras.json` and `genres_v2.json` (`hi-tech-psytrance`, level 4 beside `psycore`). Its `related` list drops `dark psytrance` (now the parent) and gains `psycore`. The vocabulary stays 534 genres and 579 memberships, but the levels are now 420 / 111 / 3 at levels 2 / 3 / 4 (`chillstep`, `hi-tech psytrance`, `psycore`) and trance is 22 = 14 / 6 / 2; the web fixture `genre_payload_levels.json` is regenerated. No library song carries a hi-tech tag. Details: [genre-levels.md](tech/genre-levels.md#psytrance-sub-genres-added-owner-2026-10-23).

## 2026-10-24 (flat playlists, server side, deployed)

- Server (owner decision 2026-10-24, deployed 2026-10-24 as `67a7361`, [task-0058](tasks/task-0058.md) phase 1, ADR-0022 amended; PLS-110 to PLS-120, API-229 to API-238, DATA-199; no tests written by the owner's rule, checked by hand against a local server): per-user flat playlists in `users/<uid>/playlists.json`, each `{id (pl_ + 8 characters), name, description, created, updated, songs: [song ids]}`, private to the signed-in user (guests and anonymous get 401). Routes `GET/POST /playlists`, `GET/PATCH/DELETE /playlists/{id}`, `POST /playlists/{id}/songs` (duplicates and ids not in the library are skipped and reported), `DELETE /playlists/{id}/songs/{song_id}`, `PUT /playlists/{id}/order` (exact permutation, else 422 `bad_order`) and `GET /playlists/{id}/export`, a text file with one `Artists - Title (Version) - m:ss` line per song. Names are unique per user (409 `playlist_name_taken`); non-owners get 200 playlists and 2000 songs per playlist (422). Deleting a library song removes its id from the user's playlists; the sync's inbound check lists the file. No web page yet (the Playlists page is still the placeholder).

## 2026-10-24 (forest psytrance review updated with Fandom wiki leads, docs only)

- Docs (owner request 2026-10-24; nothing saved, no deploy, no tests): [tech/genre-references-forest-psytrance.md](tech/genre-references-forest-psytrance.md) checks the artists and example track from the Electronic Music Wiki (Fandom) page on forest. One new proposed pick, Noctilus - Sick Loose Animals (archetype, 2016, medium); Mark Day, Confo, Arjuna, Archaic and Jotunn stay leads, Awwen and Baba Yaga were not found as forest. New open point: the wiki calls forest a dark psy sub-genre, the tree makes it a child of psytrance.

## 2026-10-24 (forest psytrance reference review, docs only)

- Docs (owner request 2026-10-24, decision EX; nothing saved, no deploy, no tests): [tech/genre-references-forest-psytrance.md](tech/genre-references-forest-psytrance.md) is a verified review of reference tracks for `forest psytrance`. The owner library holds no forest song (Bamboo Forest is full-on, not forest); five proposed picks, none in the library: Derango - Deranged (landmark) and The Poisonous Square (breakthrough), Atriohm & Encephalopaticys - Close to Nowhere (archetype), Battle of the Future Buddhas - Battlebong and Ka-Sol - Waspnest (origin, low confidence). The Gemini leads are checked and mostly not confirmed. The psytrance review links to it.

## 2026-10-24 (four psytrance songs retagged to child genres, deployed)

- Data (owner decision EW, 2026-10-24; TAG-109; deployed 2026-10-24 as `b8534c3`, the server's data commit `2af5db2` shows the four retags plus three side effects below; load checks only, no tests run, test fixture and assertions edited): `server/data/library_genre_removals.json` gains three rows and extends one (now 131 songs, 213 removals, 25 additions): Bamboo Forest - Xplorer and Breath go from `psytrance` to `full-on psytrance`; Static Movement - Sian and Antinomy - State of Mind go from `psytrance` to `progressive psytrance`, and Sian keeps `progressive trance`. Applied once at server start for the owner library (the file hash changed, so the whole plan ran again: `rock` left Desire - Under Your Spell and Donna Summer - I Feel Love and `shoegaze` left M83 - Midnight City, genres a later metadata lookup had put back after their earlier removal rows); `removal_songs.json` gains the three new songs and `test_the_real_file_owner_requested_rows` the four expected genre lists. Details: [tech/library-genre-cleanup.md](tech/library-genre-cleanup.md).

## 2026-10-24 (psytrance reference tracks saved, data only)

- Data (owner request 2026-10-24, no deploy; the server picks the file up by its inbound fast-forward, STO-057): four whole-genre `psytrance` references in `genre_references.json` of the data repo (commit `82034c2`): Hallucinogen - LSD (origin, 1994, library song), Astrix - Deep Jungle Walk (archetype, 2016), Vini Vici - The Tribe (landmark, 2015), Armin van Buuren, Vini Vici feat. Hilight Tribe - Great Spirit (breakthrough, 2016). Infected Mushroom - Symphonatic was checked and skipped (not on Classical Mushroom). Details: [tech/genre-references-psytrance.md](tech/genre-references-psytrance.md#saved).

## 2026-10-24 (goa trance reference re-check, docs only)

- Docs: owner report that the goa trance origin pick "Total Eclipse - Total Eclipse" is a band name, not a song, was checked against MusicBrainz, Last.fm, PsyDB and Psynews: the self-titled track exists on Project II Trance (Dragonfly, August 1993), so the data entry `a62572c8` is unchanged (no data change); a tracklist-reading method note was added to [tech/genre-references-goa-trance.md](tech/genre-references-goa-trance.md).

## 2026-10-24 (download button on library reference tracks without audio, deployed)

- Web: in the Genres map v2 Genre info panel a Reference track that is in the library but has no audio on the server (`audio_state` `none`) shows the Library's download button (`icon sq-btn`, `download` icon, "Download to the server") in the right-aligned slot instead of the length; the (+) stays for tracks not in the library and the length for tracks with audio on the server or the phone (GEN-087, GEN-088, GEN-111; owner request "when it's in lib, but not downloaded - display download button instead of add"; deployed 2026-10-24; node syntax check and static browser check at 340 px only, no tests run, none edited): the click requests the download through the same `autodl.request` as the Library row, the Library's progress ring replaces the button while it is queued, running or failed, and the row turns into the length when the download finishes; the button and `fetchAudio` moved to the shared `web/js/dl-control.js` (`library-rows.js` uses it too), and the compact rows now repaint on web store and download changes.

## 2026-10-24 (microgenre candidates review, docs only)

- Docs: phase 1 of the microgenre flag (owner decision CH1, [task-0100](tasks/task-0100.md)): criteria, a review table of 53 candidates (25 recommended as microgenre, 19 keep, 4 synonym, 5 drop) and a proposal of what the flag would do; nothing built, no data, API or UI change. [tech/microgenre-candidates.md](tech/microgenre-candidates.md).
- Docs: follow-up task notes (owner request): [task-0101](tasks/task-0101.md) microgenre flag phase 2 (the seven open points and the build plan) and [task-0102](tasks/task-0102.md) the RYM checks only the owner can do; docs only.

## 2026-10-24 (dock collapse button on the left edge strip, deployed)

- Web: the expanded dock's "Collapse player" button now slides out only when the pointer is over the dock's left edge strip (owner report 2026-10-24: "it should appear when I hover on the area to the left from the image"; PLY-149, WEB-037; deployed 2026-10-24; node syntax check only, browser-checked with `document.elementFromPoint` and a class standing in for `:hover` since the pane has no real hover, no tests run, test assertions edited): hovering the cover, title, controls, seek bar or volume no longer reveals it. The strip is a new transparent `span.mini-edge`, 30 px wide at 1000 and 1440 px (the dock's `--space-4` left padding up to the cover's left edge plus half the button width outside the dock) and the dock's full height; the button sits above it, so moving from the strip onto the button keeps it out, and it still slides back after the 200 ms delay. Keyboard focus in the dock still reveals it, it is always visible on touch (the strip is not displayed there) and appears without sliding under reduced motion.

## 2026-10-24 (psytrance family descriptions, synonyms and Psycore, deployed)

- Server data (owner request 2026-10-24; GEN-056, GEN-105, DATA-196, DATA-197; deployed 2026-10-24, load checks only, no tests run, test assertions edited): `psycore` is back as an approved extra, parents `dark psytrance` (Rate Your Music page "Psycore": 236 releases, breadcrumb Dark Psytrance > Psycore), so it is level 4 (the second after `chillstep`), synonym `psy core`, `related` hi-tech and forest psytrance; the removal in `beee034` was wrong because the Rate Your Music search page does not list sub-subgenres. `twilight psytrance` stays out (a variant of full-on, now a synonym of `full-on psytrance`). Own-words descriptions with a `Tempo:` line for psytrance (140-150), dark (140-180), progressive (130-140, from three guides), forest (140-160), full-on (145-150), hi-tech (160-200, was 170-200) and psycore (200-400). New synonyms: dark `dark psychedelic trance`, `horror trance`; progressive `minimal psytrance`, `progpsy`, `psyprog`, `psygressive`; forest `forest psychedelic`; full-on `full-on`, `night full-on`, `twilight psytrance`, `morning full-on`; hi-tech `hitek`, `hi tech psy`. Genres map v2: circle `psycore` (level 4, parent `dark-psytrance`) and two extra synonyms on `dark-psytrance`. The vocabulary is now 534 genres and 579 memberships (420 / 112 / 2 at levels 2 / 3 / 4); the web fixture `genre_payload_levels.json` is regenerated. Source-policy text fixed in [genre-terminology.md](tech/genre-terminology.md#source-policy-for-new-genres) with the search-page caveat; details: [genre-levels.md](tech/genre-levels.md#psytrance-sub-genres-added-owner-2026-10-23).

## 2026-10-24 (psytrance reference-track review, docs only)

- Docs: [`tech/genre-references-psytrance.md`](tech/genre-references-psytrance.md) is the verified psytrance reference-track review (7 picks with roles, sources and confidence, no origin pick, no psytrance eras exist; supersedes the memory-only psytrance row; read-only, nothing saved; owner request 2026-10-24; task-0093).

## 2026-10-24 (genres map zoom bar at the bottom, deployed)

- Web: on the phone layout (under 720 px) the Genres map v2 zoom bar stays at the bottom left with the Genre info sheet open too (GEN-110; owner request "place bottom in both cases", two pictures; deployed 2026-10-24; node syntax check and measurements with getBoundingClientRect in iframes only, no tests run, none edited): the open sheet now ends above the bar (`--space-3` above it, so the bar is never covered) instead of the bar sitting in a strip above the sheet; collapsed and from 720 px nothing changes. `web/genres.css`.

## 2026-10-24 (Genres map v2 psytrance styles, deployed)

- Server data (owner request 2026-10-24; task-0096, GEN-105, DATA-197; deployed 2026-10-24, checked in the browser pane against a local API (dock of Hi-Tech Psytrance with its v1 description; circles were tiny dots because the throwaway library was empty), no tests run, test assertions edited): `genres_v2.json` gains five level 3 children of Psytrance beside Goa Trance, the styles Rate Your Music lists under it: Dark Psytrance (synonym darkpsy), Progressive Psytrance, Forest Psytrance, Full-On Psytrance and Hi-Tech Psytrance, each mapped by `v1` to the v1 genre of the same name, so the dock shows its v1 description, sources and reference tracks. The map code needed no change; v1 untouched.

## 2026-10-24 (web playback end and reconnect fix, deployed)

- Web fix: a song that reached its end no longer sits at 7:42 / 7:42 with the pause icon after a server restart, and a lone song with Shuffle and Repeat whole list loops (PLY-200 to PLY-203, WEB-140; owner report 2026-10-23; deployed 2026-10-24, checked in the Chrome browser pane against a local API with an injected cut stream, Safari and a device not tried, no tests run, test assertions edited): a watchdog and a near-end rule (`web/js/end-guard.js`) run the normal end-of-song path when the browser never fires `ended` (stalled tail, media error in the last 3 s or 2 %); the pause icon follows the element (a failure that is not retried now pauses it); the media retry window is about 31 s instead of 5 s, remembers that the user wanted playback (Chrome pauses before `error`, so the reload used to stay silent on "Reconnecting...") and backs off when the stream breaks again at once; Shuffle + Repeat whole list on a single playable song restarts it instead of stopping with "No downloaded songs to shuffle" (`shufflePlayable` in `queue-logic.js`).

## 2026-10-24 (genre vocabulary rules, docs only)

- Docs: two owner decisions on the genre vocabulary (2026-10-24): a new genre needs attestation by Rate Your Music, Discogs styles or Musicmap, and the genre tree depicts grouping, not lineage (the "lineage axis" wording is now "grouping"); nothing built or deployed. [genre-terminology.md](tech/genre-terminology.md#source-policy-for-new-genres), ADR-0038 amendment in [decisions.md](tech/decisions.md).

## 2026-10-24 (sidebar lockup 1.5x, deployed)

- Web: the sidebar brand lockup is 1.5 times bigger (owner request 2026-10-24 "make it 1.5x bigger"; WEB-037, WEB-050; deployed 2026-10-24; node syntax check only, browser-checked on a local fixture page with the real stylesheet at 520, 700, 800 and 1000px window heights, in both themes, no tests run, test assertions edited): from 720px the vinyl mark is 30px (was 20px) and the wordmark box 48px by 144px (was 32px by 96px), their sizes `calc(var(--icon-nav) * 1.5)` and `calc(var(--icon-button) * 1.5)` because no token is 30px or 48px for this; the mark-to-wordmark gap is `--space-1` and the brand block has no right padding, so the 178px lockup fits the 179px it has inside the 220px sidebar (the mark's left edge stays on the menu icons' left edge, the wordmark does not shrink and the dark chip has no side padding); the lockup gap is `--space-3` (was `--space-4`), which keeps the visible space under the wordmark ink at 21.5px (was 22.3px) instead of letting it grow to 25.5px, so the menu moves down 12px, not 16px, and the full stack needs about 12px more window height; the footer row and the build stamp keep their height and their fixed 16px bottom offset at every height; the 64px rail and the 480-719px rail are unchanged (mark 24px, same positions as before).

## 2026-10-24 (sidebar build stamp, deployed)

- Web: the sidebar build stamp is pinned at one fixed bottom offset (owner request 2026-10-23 "make it static - bottom"; WEB-037, WEB-102, PLY-199; deployed 2026-10-24; node syntax check only, browser-checked on a local fixture page with the real stylesheet, no tests run, test assertion edited): the open sidebar (from 720px) always has `--space-4` of bottom padding, so the stamp sits 16px above the sidebar's bottom edge with or without the player row, where it was 8px higher without the row; identical at 700, 800 and 1000px window heights and at 440px, where the menu scrolls and the stamp keeps its height; the stamp is hidden in the rail and under 720px as before.

## 2026-10-23 (psytrance sub-genres, trimmed to hi-tech, deployed)

- Server and web data: `twilight psytrance` and `psycore` are removed again from the vocabulary, with their synonyms, `related` links, descriptions, sources rows and test assertions (owner decision 2026-10-23: only styles attested on Rate Your Music, Discogs or Musicmap become genres, and Rate Your Music lists only Dark, Progressive, Forest, Full-On and Hi-Tech Psytrance under psytrance; GEN-056, DATA-196; deployed 2026-10-23, no tests run, test assertions edited; no library song carried either name). `hi-tech psytrance` stays. The vocabulary is now 533 genres and 578 memberships; the web fixture `genre_payload_levels.json` is regenerated. Details and the candidates not added: [genre-levels.md](tech/genre-levels.md#psytrance-sub-genres-added-owner-2026-10-23).

## 2026-10-23 (psytrance sub-genres, deployed)

- Server and web data: three psytrance sub-genres joined the vocabulary as approved extras under `psytrance` (owner request 2026-10-23; not in Discogs; GEN-056, DATA-196; deployed 2026-10-23, no tests run, test assertions edited): `twilight psytrance`, `hi-tech psytrance` and `psycore`, each with an own-words description and a `Tempo:` line (the vocabulary was 535 genres and 580 memberships). The first and the last were removed again, see the entry above.

## 2026-10-23 (web brand lockup, deployed)

- Web fix: the Genre info panel no longer shows the text "null" for a genre without a mapped v1 genre (Genres map v2 panel `genres-v2-info.js`, and the same pattern in the classic genre card `genre-card.js` for a card with no "Where it sits" section or a group; GEN-105, GEN-111; deployed 2026-10-23, node syntax check and static fixture check only, no tests run, none edited): empty sections are now left out of the panel instead of being passed to `replaceChildren` as `null`.
- Web: the Genres map v2 Genre info panel and its collapsed pill start at the very top of the screen (12 px inset) instead of below the page title, and the phone bottom sheet is taller (GEN-110; owner request "the free space on top is wasted"; deployed 2026-10-23, no tests run, none edited): the panel was positioned inside the map area, which begins under the title block, so about 100 px stayed blank above it; it is now `position: fixed` from 720 px wide, the title wraps if it would run under the panel (720 px only), and under 720 px the sheet runs from 12 px above the bottom to 68 px under the top of the map area (it was 55% high), keeping the zoom bar visible in the strip above it (measured with getBoundingClientRect in the browser pane at 1920, 1440, 1000, 906, 720, 719, 600 and 375 px, 700 and 1000 px high; the expanded playback dock was simulated).
- Web: the BPM chip of the Genre info panel moves from its own line above the description onto the genre name line, floated to the right edge (Genres map v2 panel and classic genre card; GEN-088, GEN-110, GEN-111; owner request; deployed 2026-10-23, node syntax check and static browser check at 320 and 340 px with short and very long names, with and without tempo; no tests run, none edited): the name takes the remaining width and wraps, the chip never shrinks, no chip when the tempo is not a number or range (a text tempo stays a plain line in the description).
- Web: the (+) and "Add to library" buttons on Reference tracks no longer open the Add dialog with a Wikipedia, MusicBrainz or other source page: they prefill the entry's YouTube or SoundCloud link when it has one, else "Artist - Title", and the Add dialog searches YouTube for that text and lists up to 5 results to pick from (`GET /search`; GEN-087, GEN-088, GEN-111, ADD-191, API-018; owner request; deployed 2026-10-23, node syntax check only, search results not seen in a browser; test assertions edited, none run); the (+) now shows for every entry with an artist and a title.
- Web: the open sidebar (from 720px) matches the GPT proposal's proportions (owner request 2026-10-23, picture 95 live against picture 96 proposal, measured as ratios of the sidebar width; WEB-037, WEB-050, PLY-199; deployed 2026-10-23; browser-checked at 540, 700, 800 and 1000 px high on a local fixture page with the real stylesheet and app code, no tests run, test assertions edited): the lockup ink is 0.55 of the width instead of 0.73 (mark `--icon-nav` 20px, wordmark `--icon-button` 32px high, left after the mark), it sits 8px under the top edge instead of 28px, and the first menu item is 16px under the brand block instead of 41px (wordmark ink to the first item's centre 0.17 of the width instead of 0.30); the sidebar toggle takes no height there; in the player row the play button is `--control` 36px instead of 44px, the progress line 2px instead of 3px, the title `--font-eyebrow` 12px and the artist `--font-micro` 11px; item pitch, pill height, radius, divider spacing and the upper hairline distance already matched and are unchanged; menu labels in the proposal are about 0.86 of the live size and were left as they are. The 64px rail keeps its earlier layout (so its logo and menu now sit lower than in the open sidebar); the full stack needs about 548px of window height instead of 615px.
- Web: the role badges on Reference tracks (Archetype, Origin, Landmark, Breakthrough; Genre info panel, Genres map v2 dock and classic genre card) share one look, the owner's picture (GEN-088, GEN-111; owner request; deployed 2026-10-23, static browser check at 340 px only, no tests run): the neutral chip surface (`--surface-sunken`), ink text in weight 500, `--radius-sm` corners, `--space-3` side padding and no visible border (a transparent hairline keeps the height at 22 px); the Archetype accent fill is gone, so there is no per-role colour and the `role-*` classes are removed from the markup.
- Web: the expanded dock's collapse control is a round surface button with a thin dark left chevron that straddles the dock's left edge, with a dark "Collapse player" tooltip pill below it (owner picture 92, PLY-149; deployed 2026-10-23; checked at 1000 and 720 px against a local API, animation in motion not seen, no tests run, test assertions edited): at rest it is hidden, tucked into the dock's edge; when the pointer is over the dock or keyboard focus is inside it, it slides out (transform and opacity, `--dur-base`) and slides back after a 200 ms hover-intent delay; it is always visible on touch, appears without sliding under reduced motion, and the dock's left padding is the plain `--space-4` again.
- Web: the sidebar player row (collapsed dock, open sidebar) has no lower hairline any more: its progress line closes the row and the build stamp sits below it (owner request 2026-10-23, picture 94, WEB-037, PLY-199; deployed 2026-10-23; browser-checked at 700, 800 and 1000 px high, no tests run, test assertions edited); the upper hairline stays.
- Web: in the Genres map v2 Genre info panel the small "Add" pill on Reference tracks that are not in the library is a (+) icon button, the Library's row icon button (`icon sq-btn`, `plus` icon, 24 px with the 44 px hit area, hover colour and focus ring of the Library rows), in the same right-aligned slot as the length; tooltip and label "Add to library", it opens the Add dialog as before, and the pill CSS is gone (GEN-088, GEN-111; owner request; deployed 2026-10-23, static browser check at 340 px only, keyboard focus ring not seen, no tests run).
- Web: the Genres map v2 Genre info panel scrolls as one block and the zoom bar moves to the bottom left (GEN-110, GEN-111; owner request; deployed 2026-10-23, no tests run): the Reference tracks list and the History timeline no longer scroll inside their own regions (no three-row minimum), the panel body under the pinned "Genre info" caption scrolls everything together; the zoom bar (+, minus, reset view) sits at the bottom left, just above the playback dock while it is expanded and in the corner when it is collapsed into the sidebar (same `--dock-reserve` as the panel), and the panel and its collapsed pill take over the bar's old top offset; on phones the bar rises above the bottom sheet (checked in the browser pane at 1440, 1000 and 375 px against a local API; the expanded playback dock was simulated, animation not seen).
- Web: sidebar spacing from the owner's picture 91 and a regression fix (owner request 2026-10-23, WEB-037, PLY-199; deployed 2026-10-23; browser-checked at 560, 700, 800 and 1000px high, no tests run, test assertions edited): from 720px the first menu item sits 50px under the visible wordmark (named value `--side-lockup-gap`), menu rows are 32px high with a 36px pitch, `--radius-sm` corners and 8px inline padding and icon gap, the Studio/Help divider has 12px each side, the player row 16px above and 8px below inside its hairlines and the sidebar 16px of bottom padding; the full stack needs about 615px instead of 730px. Fix: at 480-719px, where the sidebar cannot widen, the icon rail shows the "Expand player" chevron above the play button again, so a collapsed dock can be expanded (it stays hidden from 720px).
- Web: "Server is starting..." (Library status line and the empty page before the first route) is the same dark top-centre pill with a spinner as the "Loading..." note and the update bar, instead of plain inline text; it goes away when the server answers (WEB-117, WEB-140; owner request; deployed 2026-10-23, static browser check only, no tests run). `loadingNote` takes the text.
- Web: fix: the Genres map v2 Genre info panel did not collapse (GEN-110; owner report 2026-10-23): the collapse click re-rendered the chevron icon, which detached the clicked element, and the pill's own click handler on the panel head then saw a target outside any button and reopened the panel straight away; the handler now ignores clicks whose target left the head (checked in the browser pane against a local API; collapse, reopen from the pill and chevron, reload persistence and the selection checked; deployed 2026-10-23, no tests run).
- Web: the collapsed-dock sidebar footer row shows no song art (owner request 2026-10-23, PLY-199, WEB-037; deployed 2026-10-23, no tests run): the row is title, artist and the thin progress line on the left (one "Expand player" button) and the round 44px play and pause button on the right, between the two hairlines; the cover image is no longer created or loaded there; the icon rail no longer has the small "Expand player" chevron above its round play button, so from the rail the dock is expanded by first widening the sidebar; this supersedes the earlier cover and rail chevron entries below.
- Web: the sidebar build stamp (revision and build time, owner only) moved below the player row, to the very bottom of the sidebar under its lower hairline, and stays visible when the window is short or no song plays; a hairline divider now separates Studio from Help in the menu (a short line on the icon rail); the player row has more room above the cover than below it, as in the owner's pictures (WEB-102, WEB-131, PLY-199; deployed 2026-10-23, no tests run).
- Web: the genre info panel History section (Genres map v2 dock and classic genre card) no longer shows the numbered source links [1] [2] after each era name (GEN-088, GEN-111; owner request; deployed 2026-10-23, no tests run): era sources stay in `genre_eras.json` and the API; the link styles are removed from `web/genres.css`.
- iOS: playback and Statistics refinements (task-0087, task-0088, task-0090, task-0099; IOS-002, IOS-041, STT-100; built for iOS Simulator and macOS, not run on a device, not in a TestFlight build): tapping left or right of the playhead seeks 5 seconds, genre chips on the expanded Playback, Up next and queue interaction fixes, a top grabber on the collapsed dock that expands the Now Playing panel, and the Listening tab refreshes every 30 seconds while Statistics is visible.
- Web: the collapsed-dock sidebar footer is restyled to the owner's pictures (PLY-199, PLY-149, WEB-037; deployed 2026-10-23): the boxed card with its top arrow strip is replaced by a flat row between two hairlines with a 48px rounded cover, bold title and muted artist, a thin progress line under the text up to the right edge and a round 44px play and pause button; the cover and text are one "Expand player" button with a hover tint and a tooltip above it; the expanded dock's collapse control is a plain thin left chevron with a round hover wash and a "Collapse player" label (no server change, no tests run).
- Web: the sidebar mini-player card (collapsed dock, sidebar open) no longer clips on short windows: it keeps its full height, the menu list above it scrolls when the window is too short, and its play and pause button is a plain 44px circle without the progress ring (PLY-199; deployed 2026-10-23).
- iOS and macOS: plays are recorded and uploaded so listening statistics include phone listening, also offline (task-0056 phase 4, IOS-087 to IOS-090; built for iOS Simulator and macOS, not run on a device; in TestFlight build 20261031 with the refreshed drawer logo lockup, uploaded 2026-10-23). `PlayRecorder` counts actual played time like the web recorder, `PlayQueue` keeps plays in `Application Support/plays/queue.json` and sends `POST /plays` batches with a stable `batch_key`, retrying with backoff; Library Plays numbers and the Statistics Listening tab reload after an upload. No server change.
- Web: the Genres map v2 info panel is a floating overlay on the right under the zoom bar (300-360 px, above the playback dock while it is expanded) instead of the left dock: a quiet "Genre info" caption with a collapse chevron, the genre name with its map colour dot, category and level, the BPM chip, a left-aligned description, a collapsed "History" (eras), and "Reference tracks · N" as a separately scrolling list of compact Library rows (cover, bold title, length only for songs in the library, artist and year with the role pill at the right; the small source icons are gone, owner decision EJ1); the collapsed panel is a genre-name pill with the colour dot at the same place, and opening and closing animate (GEN-097, GEN-110, GEN-111; deployed 2026-10-23, no tests run).
- Data: the ten MusicBrainz sources of the goa trance reference entries are readable release and recording pages instead of JSON web-service queries; types and notes unchanged, other genres untouched; data change only, no deploy needed (task-0093; [`tech/genre-references-goa-trance.md`](tech/genre-references-goa-trance.md#saved-musicbrainz-pages)).
- Data: nine goa trance reference tracks saved in `genre_references.json` (eight new entries, `Hallucinogen - LSD` updated; all reviewed, era and sources set; Alex approved the picks of [`tech/genre-references-goa-trance.md`](tech/genre-references-goa-trance.md#saved)); data change only, no deploy needed (task-0093).
- Web: the collapsed playback dock is refined (PLY-199, owner decisions EL1 and EM1; deployed 2026-10-23): the sidebar card drops the cover and shows title and artist, the round play and pause button and a thin progress line along its bottom edge; the sidebar rail gets a 56px play and pause button below a divider and a quiet "Expand player" chevron above it (visible on hover and keyboard focus), so the large dock can be restored from the rail; the old limitation "no way back to the dock in the rail" is resolved.
- Web: the playback dock has three states (PLY-149, PLY-199, owner decision EG1): expanded (floating dock, sidebar without player), collapsed with the sidebar open (the sidebar footer shows cover, title, artist and a round play and pause button, its top arrow expands the dock) and collapsed with the sidebar rail (only a 44px round play and pause button with a thin progress ring, track name and artist in its tooltip and label); the old compact pill is gone, the state is kept in `ap2.miniCompact`, phones are unchanged (deployed 2026-10-23, no tests run).
- Server and web: Genres map v2 saves the circles a signed-in user moved on the server, per user (`GET` and `PUT /me/genre-layout`, `users/<uid>/genre_layout.json`); the page sends them 5 seconds after the last drag or when it is hidden, keeps a local copy, and "Reset layout" clears them (API-227, API-228, DATA-198, GEN-109, ADR-0046; deployed 2026-10-23, no tests written or run).
- Web: the genre info panel tempo line shows only the BPM chip (`.bpm-badge`) alone on its line: no "Tempo", no "about", no trailing period; a non-numeric tempo shows its text alone (GEN-088; deployed 2026-10-23, no tests run).
- Docs: [`tech/genre-references-goa-trance.md`](tech/genre-references-goa-trance.md) is the verified goa trance reference-track review (13 picks with roles, eras, sources and confidence; supersedes the memory-only goa rows; read-only, nothing saved; task-0093).
- Docs: [`tech/genre-references-library-candidates.md`](tech/genre-references-library-candidates.md) proposes 91 reference-track candidates for 62 genres from the owner library (read-only analysis, nothing saved; task-0093).
- Server and web: the `goa trance` genre description is Alex's new two-line text (`Tempo: about 135-150 BPM.` and one prose paragraph, DATA-196), and the genre info panel shows the Tempo line with its BPM chip on its own line above the justified paragraph instead of inline inside it (GEN-088; deployed 2026-10-23, no tests run).
- Web: the sidebar and drawer brand lockup is the refreshed Electrophone Vega 108 master with the full lower edge and the `p` descender; the web copy `web/img/electrophone-lockup.png` is regenerated from it (task-0097, `docs/brand/logo`; deployed 2026-10-23, no tests run, not seen in a browser).
- Server and web: the `goa trance` genre description is Alex's own prose, one paragraph with no Tempo line, so its card shows no BPM chip; a one-line description now renders as the same justified prose (`.gc-prose`) as a multi-line one (GEN-088, DATA-196; deployed 2026-10-23, no tests run).
- Web: the plain "Loading..." state (page route loader, Features and Music theory panels) is a compact dark pill with a small spinner, the look of the "new version" update bar (WEB-117, WEB-134; deployed 2026-10-23, static browser check only, no tests run). It floats at the same top-centre spot as the update bar (below it when both show) instead of sitting in the page flow (deployed 2026-10-23, static browser check only, no tests run).
- Web: Genres map v2 remembers the selected genre per browser (`electrophone.genresV2Selected`) and selects it again after leaving the page or reloading; deselecting clears it, a genre missing from the payload is ignored (GEN-108; deployed 2026-10-23, no tests run).
- Web: genre info panel description is one justified paragraph instead of a bulleted list (GEN-088; hyphenated, `text-wrap: pretty`; deployed 2026-10-23, no tests run).
- Web: genre info panel has no Tempo panel: the BPM chip sits inline at the start of the description paragraph ("Tempo about [135-150 BPM]. ..."), the beat pattern after the first comma is hidden for now, a non-numeric tempo is plain prose (GEN-088; deployed 2026-10-23, no tests run, static browser check only).
- Server: the web session cookie lasts 30 days (was 12 h) and any signed-in request past half of its life renews it, so open tabs and overnight gaps no longer sign the owner out (API-020, API-143, ADR-0006 amendment; to deploy).
- Web: Genres map link lines are clipped to the circle edges, so a line no longer shows through a semi-transparent parent circle (GEN-107; to deploy, focused test only).
- Web: genre info panel eras timeline no longer repeats the dates in the era note (leading date prefix stripped on render, seed notes cleaned; GEN-088), and reference track rows no longer show "To review" (the `reviewed` field stays; to deploy, focused tests only). Reference track rows use the standard song format (cover thumbnail, bold title that opens the song card for library tracks, muted "Artist · year"; GEN-088; to deploy, focused tests only).
- Web: genre info panel reference track rows reuse the Library song row markup and CSS (`li.song`, `.row-cover`, `.title-line .open`, `.sub-line .sub`); custom `.ref-*` row styles removed (GEN-088; to deploy, focused tests only).
- Web: the Rate Your Music link in the genre info panel uses Alex's blue wave logo (`web/img/rym.png`, 64px circle) instead of the generic glyph (GEN-088; to deploy, focused tests only); the Wikipedia link uses the Wikipedia globe (`web/img/wikipedia.png`, from Wikimedia Commons), and the visible labels are "Wiki" and "RYM" (full names stay in title and aria-label).
- Web: the genre info panel tempo is the Library BPM chip (`.bpm-badge`, number or range plus small "BPM"; a qualifier such as "about" is a muted word before it; non-numeric values stay bold text; superseded by the inline chip below; GEN-088; deployed 2026-10-23, no tests run).
- Web: genre info panel description is scannable (GEN-088; deployed 2026-10-23, no tests run): a `Tempo:` line is a highlighted key-fact row, the other lines a spaced bulleted list in muted subhead type, one-line descriptions stay a paragraph (`web/js/genre-desc.js`, card and dock).
- Genre info: the Goa Trance description is now a 10-line identification summary (descriptions may have several lines, limit 1000 characters; `.gc-desc` uses `white-space: pre-line`; to deploy).
- Web: Genres map circles keep the cluster colour: the genre card / song card vocabulary load (v1 tree) no longer resets the shared slot colours after the map applied them (to deploy).
- Server: curated Rate Your Music links for Goa Trance and Psytrance in `genre_rym.json` (slugs goa-trance, psytrance; unverified, RYM blocks automated fetches; to deploy).
- Web: reference tracks and eras are read-only in the genre card and dock (GEN-088, GEN-099; to deploy, focused tests only): the add, edit, review, delete and "Edit eras" controls are gone; curation goes through Claude and the API (unchanged).
- Web: genre info panel reference track rows have no play button, the role pill moved to the middle right of the row, the clickable title has no underline (GEN-088; to deploy, focused tests only).
- Web: genre info panel rework (GEN-088, GEN-092; to deploy, focused tests only): description, then links (Wikipedia and Rate Your Music; Apple Music and Discogs removed), divider, eras as a vertical timeline (years, name, details; the numbered source links were removed the same day), divider, flat read-only reference track list; fixed `linkText` length and the genre-card test setup.
- Web: Genres map (v1 `#/genres` and v2) circle dragging is rigid (task-0096, GEN-106; to deploy, focused tests only): a child moves alone, a parent drags its descendants after it as a damped spring (lag, slight overshoot, settling at their original offsets), dropped circles stay put, nothing unrelated is pushed; v1 now uses the same engine (the old spring pull is gone).
- Web: Genres map v2 drops the right-hand panel (task-0096; to deploy, focused tests only): no family chips, search, See also, legend, Now playing or Reload on `#/genres2`, the map uses the full width; the zoom buttons are a horizontal row at the top right; the collapsed genre dock is a horizontal "Genre info" bar with a chevron at the top left; v1 `#/genres` unchanged.
- Genres v2: Alex approved two children of Trance (task-0096; to deploy, focused tests only): Psytrance (level 2, parent Trance, synonyms psychedelic trance, psy-trance) and Goa Trance (level 3, parent Psytrance, synonym goa), mapped to the v1 names `psytrance` and `goa trance`; `genres_v2.json` rows may now carry `synonyms` and `details` (history in `details`; hierarchy is grouping, not lineage).
- Web: Genres map v2 has no outline panel (task-0096; to deploy): the outline list, its toggle and Expand/Collapse all are not built on `#/genres2`; family chips, search, legend and See also stay; `#/genres` unchanged.
- Web: Genres map v2 genre dock overlays the map without resizing or moving it (GEN-097, task-0096; to deploy, tests not run, not seen in a browser): the canvas offsets and the `dock-rail` class are removed, the zoom bar and legend sit left of the right panel, the dock is a semi-opaque floating box.
- Server: reference tracks per genre (task-0093 phase 2, ADR-0044; to deploy, own tests run only): shared owner-curated catalogue `genre_references.json` in the data root, API `GET /genres/references`, `GET|POST /genres/{name}/references`, `PATCH|DELETE /genres/{name}/references/{id}` (API-216..API-222, DATA-194), four roles, several typed sources per entry, startup migration `migrate_reference_tags` (owner `classical <genre>` tags become unreviewed archetype entries).
- Server: eras per genre (GF1, task-0093, ADR-0044; to deploy, own tests run only): `genre_eras.json` in the data root, `eras` in `GET /genres/{name}/references`, `era` on entries and summaries, owner-only `PUT /genres/{name}/eras`, 422 `unknown_era`; goa trance eras seeded once at start (`AUDIO_GENRE_ERAS_SEED=0` disables) (API-223..API-225, DATA-195).
- Server: own-words genre descriptions (GD1, task-0094; to deploy, own tests run only): `server/data/genre_descriptions.json` (DATA-196, 18 first drafts to be reviewed by Alex), served as `description` on `GET /genres/vocabulary` rows, `levels` and `forms`.

- Task: genre card infobox (to deploy) ([task-0094](tasks/task-0094.md)).
- Task: standard identifiers for songs (analysis, to deploy) ([task-0095](tasks/task-0095.md)).
- Docs: goa trance eras with references (to deploy).
- Docs: wave 1 working document for reference tracks (to deploy) ([genre-references-wave1](tech/genre-references-wave1.md)).
- Web: genre card phase 1 (GEN-089..GEN-097, task-0094; to deploy, tests not run, not seen in a browser): a popup card for a genre (header, description, source links, parents, subgenres, groups and related chips with a back arrow, reference tracks, View in Library, Show on map), opened from the Genres map side panel (name or "Open card") and from genre chips in the song card; the side panel now shows only a short preview.
- Docs: external genre resources listed (to deploy).
- Docs: Musicmap findings for goa trance (to deploy).
- Docs: Musicmap super-genres compared with our level 1 (to deploy).
- Server: the genre `ambient techno` (level 2 under techno and ambient, fusion, synonyms ambient techno music and intelligent techno, Rate Your Music link) joins the vocabulary (to deploy, tests not run).
- Docs: ADR and task for genre reference tracks (analysis, to deploy) ([ADR-0044](tech/decisions.md), [task-0093](tasks/task-0093.md)).

- Web: the Genres screen has a "See also" row under the Outline with links to Rate Your Music genres and Musicmap (GEN-086, to deploy; not seen in a browser).

- Web: the sidebar brand block shows the vinyl mark with the two-line Electrophone / Vega 108 lockup, as in the iOS drawer; the text title and "Offline music player" tagline are gone, and the collapsed rail shows the mark alone (WEB-050, task-0092).

## 2026-10-22 (iOS Library refinements, simulator built; not uploaded)

- iOS: keep a visible plain-text match count on the right with an adjacent ellipsis menu for Play all matched, Show currently playing song and Clear all filters, remove the separate playback/Clear buttons, and group Era chips chronologically under century headings, and show Pause/Play on the current cover like the web. Simulator build and code review passed; these refinements are newer than TestFlight build 20261028.

## 2026-10-22 (iOS Library v5, build 20261028 uploaded to TestFlight)

- iOS: Library v5 controls, seven sort options and direction, live filters and Era, separate play/details row zones, queue markers, Song Details with sharing and deletion, loading/offline/error states, and pinned headers. Dock/mini-player and drawer unchanged. All eight query regression tests passed in the iOS simulator; signed Release archive and internal TestFlight upload succeeded. Apple processing and visual/device verification pending ([task-0084](tasks/task-0084.md)).

## 2026-10-22 (web shuffle and scroll button, to deploy)

- Web: the Library tools (Metadata for downloaded songs, BPM detection) moved from the Library page into the Settings Library card as two rows under Download all; the Library tools toggle, badge and hint are gone (WEB-070, WEB-081, WEB-082).
- Web: the Library "Songs | Drafts" switch moved from its own row into the page header, right of the "Library" title (below 720px it wraps under the title) (LIB-159).
- Web: queue "Clear" now keeps only the song that is playing (earlier and later songs and the tag chips are removed; with nothing playing the queue empties) (PLY-034).
- Web: the Library "Scroll to top" button moved from the bottom right to the top centre of the content area (WEB-103).
- Web: the shuffle order is built after the play counts have loaded (1.5 s timeout, rebuilt when they arrive) and Play all starts from the lowest-played tier, so recently played songs no longer come back while unplayed ones exist (PLY-178).

## 2026-10-21 (iOS build 20261027: refined drawer, Settings hierarchy, new icon and logo; iOS uploaded, server and web NOT deployed)

- iOS (TestFlight build 20261027): refined menu drawer (75% width, select tint, selection on touch-down); Settings hierarchy with free-space and format notes; new app icon (full-bleed glass plate) and vinyl logo. Not yet tested on a device. The signed-out Add flow needs the server deploy.
- Web (committed, not deployed): Library tools panel (moved to Settings 2026-10-22).
- Design system (committed): Library v5 component tokens and brand section, Vega 108 style reference; Library v5 screen spec ([library-v5.md](ui-ux/library-v5.md)).

## 2026-10-21 (iOS build 20261026: local library, drawer, offline covers; server and web: public view off, anonymous downloads; iOS uploaded, server and web NOT deployed)

- iOS (TestFlight build 20261026): signed out, the app keeps a local library only (no guest mode) and can add a song from a pasted link anonymously.
- iOS: left menu drawer with Playlists and Statistics; Share link; covers kept offline; "Download all"; "Open in Files" with readable file names; smoother scrolling; free space and format notes. Not yet tested on a device.
- Server and web (committed, not deployed): the public read-only view is off by default and signed-out visitors get a sign-in screen (ADR-0018 switched off).
- Server (committed, not deployed): anonymous downloads staged temporarily, built for the signed-out iOS add; sign-in failure logging.
- Web: focus rings show for keyboard navigation only; a click or touch, or focus returned after a dialog closes by pointer, draws no ring (WEB-165).
- Cloudflare: scanner rules added.

## 2026-10-21 (time readout no longer jerks, web, to deploy)

- Web: the dock and Studio time readouts shifted sideways when digits or the minus sign changed ("9:59" to "10:00", "-2:12" vs "1:12"); the elapsed button now has a fixed minimum width in `ch` fitted to the longest value for the song (duration length plus one for the minus sign, 6 ch while unknown), right-aligned, with tabular numerals and no wrapping (PLY-185). Not seen in a browser; tests not run.

## 2026-10-21 (Statistics Listening: most listened by count, web, to deploy)

- Web (STA-060): "Most listened" ranks by how many times a song was listened to (`listened.all`, ties by listened time) and shows "12 times" instead of the time. Not run, not seen.

## 2026-10-21 (Features: task link at the start of the line, curated recent items, web, to deploy)

- Web (task-0068, WEB-135, WEB-136): on the Features page the `task-00NN` link moves to the start of each line in a fixed-width monospace column (empty placeholder when there is no task); the same on Planned and In progress. Not seen in a browser; tests adjusted, not run.
- Data: `docs/releases-map.json` gets curated items for the commits since 3d6a438 (no more lines cut with "..."); regression-fix commits are hidden with empty lists.

## 2026-10-21 (task statuses, docs, to deploy)

- Task statuses 0045 and 0054 updated (to deploy).

## 2026-10-21 (time readouts: no selection, elapsed toggles to time left, web, to deploy)

- Web: the dock time and the Studio clock can no longer be text-selected and show a default pointer; the elapsed part is a button that swaps to the time left ("-0:35", the same on both, kept in `ap2.timeLeft`) and back; unknown duration stays on elapsed (PLY-185). Written, not run or seen in a browser.

## 2026-10-21 (shuffle in tiers by 30-day play count, web, to deploy)

- Web: shuffle now plays the least-played songs first in tiers (no weights): the minimum 30-day count (server listened + skipped plus plays not yet flushed, at least 5 s) among the songs left in the round is drawn first, randomly among equals, then the next value; a new round re-reads the counts; no data means a uniform shuffle (PLY-178, [task-0056](tasks/task-0056.md)). Not run, not heard.

## 2026-10-21 (Statistics page: tabs and Genres table, web, to deploy)

- Web: "Song stats" is now "Statistics" (route unchanged); it has tabs Songs (the Year x BPM chart), Listening (Most listened, Most skipped; replaces the toolbar toggle) and the new Genres tab: every genre of the library with its song count, total listened time and times listened, sortable and filterable, a total row, a row click opens the Library filtered by that genre (STA-070..075, [task-0056](tasks/task-0056.md)). Not run, not seen.

## 2026-10-21 (Studio loop controls compact, web, to deploy)

- Web: the Studio A and B editors are two compact side-by-side clusters (caption, 96 px time field, "Set" button, four small nudges) that wrap on narrow widths; ids, aria-labels and keyboard handling unchanged; not seen in a browser.

## 2026-10-21 (sources shape type + ref, server, to deploy)

- Server: song `sources` are stored as `[{type, ref, trim_start, trim_end, duration?}]` and the URL is derived (`server/app/sources.py`); `source_url` is no longer stored; API songs keep `url`, `source`, `id`, `source_url` and add `type`, `ref`, `trim_start`, `trim_end`, `duration`; `PATCH` takes `url`, `sources` and `trim`; `POST /preview` and `POST /songs` return a link's start time as `trim_start_hint` only; startup migration `app.migrate_sources` (backup `backups-sources/<uid>/`, `AUDIO_SOURCES_SHAPE=0` disables) (DATA-193, API-206, task-0045 phase 1; tests written, full suite not run).

## 2026-10-21 (cut a song's start and end in Add and Edit, web, to deploy)

- Web: Add and Edit get a collapsed "Advanced" section with Start and End (m:ss, h:mm:ss or seconds), validation, the resulting length, Start prefilled from a link's time, `trim` sent with the save and a "Re-download with this cut" button in Edit; needs the server trim support (task-0045 phase 2), not run or seen in a browser (ADD-183 to ADD-186).

## 2026-10-21 (fade in and fade out, web, to deploy)

- Web: Settings > Playback gets "Fade in" and "Fade out" sliders (0 to 12 s, step 0.5, Off by default; capped at half of the song, not at a Studio loop, not after a seek or restore); ramps run on a new "fade" gain node in the Web Audio chain (created only when a fade is on), with an "audio.volume" fallback while the page is visible; no crossfade yet (PLY-180 to PLY-184, task-0053; not run, not heard, not tried with the screen locked).
- Web: the fade settings are a percent of the song length, not seconds: 0 to 15 % in 1 % steps (Off by default), with a live hint for the loaded song ("≈ 18 s on this song"); fade seconds = percent of the duration, at most 60 s and half of the song, no minimum, none while the duration is unknown; stored in `ap2.fadePct.in` and `ap2.fadePct.out` (the earlier seconds keys are ignored). Supersedes the seconds wording above; a real crossfade is still not built (PLY-180 to PLY-184, task-0053; not run, not heard).

## 2026-10-21 (song card: no Country field, no Genre caption, web, to deploy)

- Web: the song card details line no longer shows the Country field and the genre chips have no "Genre" caption, they start at the left edge in a group labelled "Genres" for screen readers (LIB-120, LIB-142; tests updated, not run, not seen in a browser).

## 2026-10-21 (Artist and Album entities, docs, to deploy)

- Sources shape decided: {type, ref, trim_start, trim_end}, URL derived (to deploy): [ADR-0040](tech/decisions.md), [task-0045](tasks/task-0045.md).
- ADR and task for Artist and Album entities (analysis, to deploy): [ADR-0039](tech/decisions.md), [task-0083](tasks/task-0083.md).
- ADR-0039: shared owner-curated catalogue and cover fallback chain decided (to deploy).
- Task-0045: trim on download decided (to deploy): [ADR-0040](tech/decisions.md), [task-0045](tasks/task-0045.md).
- ADR-0039: the umbrella entity is called Release, B1 decided (decided, to deploy).

## 2026-10-21 (View in Library from the title and artist popovers, web, to deploy)

- Web: all part popovers (artist, title, version) show values only, no field captions (tooltip and `aria-label` carry the names): bold wrapping name, one row of values (title: year left, album right; artist: country left, years "2002 – 2014" right), genre pills below, "View in Library" at the bottom-right (LIB-187, LIB-210, not seen in a browser, tests not run).
- Web: the title popover on the song card gets a "View in Library" button (the artist popover had a filter link, now the same button): it closes the card and opens the Library with the search set to the base title (all versions and artists of that song), chips and "Never listened" cleared, sort kept (LIB-210, not seen in a browser, tests not run).

## 2026-10-21 (server LED moved to the logo, web, to deploy)

- Web: the server health LED moved from the bottom of the nav to a small badge (9 px, 2 px ring in the nav colour) on the top-right corner of the round logo, so it shows on the collapsed icon rail too; tooltip, `aria-label` and colours (green, amber starting, red down) unchanged, the build text stays at the bottom; hidden under 480px with the brand block, as before (WEB-037, not seen in a browser, tests not run).

## 2026-10-21 (cover from a Discogs page, server and web, to deploy)

- Server: `PUT /songs/{id}/cover` with `{url}` (and `POST /songs/{id}/cover/from-url`) accepts a Discogs master or release page address; the cover is looked up through the Discogs API and downloaded (`server/app/discogs_cover.py`, API-201), 422 `discogs_not_configured` without `DISCOGS_TOKEN`, 422 `cover_url_unreachable` when Discogs has no cover. `GET /songs/{id}/cover/suggestions` adds a Discogs entry for a song with a `discogs_url` (API-202). Never tried against live Discogs; `DISCOGS_TOKEN` must be set on the server.
- Web: the Change cover dialog shows "Discogs page: the cover will be fetched when you save." instead of an image preview for such addresses; the "Wikipedia" option is now "Suggestions".

## 2026-10-21 (Wikipedia cover lookup fix, server and web, to deploy)

- Server: the Change cover dialog found no Wikipedia cover for single and album pages because MediaWiki `pageimages` leaves out non-free (fair use) infobox images (Birdy - Wings); `cover_candidates` now tries the REST page summary first (`thumbnail` / `originalimage`, 1024 px url), then `pageimages`, then the article's file list (`prop=images` and `imageinfo`, skipping logos, flags and icons), for any `*.wikipedia.org` link; Wikimedia API calls and image downloads send `Electrophone/1.0 (https://electrophone.cc)` as User-Agent and `utm_*` parameters are dropped from fetched image URLs (API-202, task-0054, to deploy; tests written, not run, never tried against live Wikipedia).
- Web: the Change cover dialog shows the preview frame only when an image or the default placeholder is selected, no empty dark square under "No Wikipedia covers found" (task-0054, to deploy; test written, not run).

## 2026-10-21 (task-0060 merged, docs, to deploy)

- Genre model: descriptive aspects (beat, rhythm, texture) recorded in task-0070 (to deploy).
- Docs: Task-0060 merged into task-0038 (to deploy).
- Genres: new `chillstep` (level 4 under dubstep, synonym chill step, Rate Your Music link) and a Rate Your Music link for `downtempo` (to deploy).
- Genres: `bard` is a synonym of `singer-songwriter` (with bard song, авторская песня, author song; also `ALIASES`, and the old `bard` to `folk` retag is dropped), a Rate Your Music link and an own-words note for it; Тимур Муцураев - Погасли свечи changes from `folk` to `singer-songwriter` through the removal file (to deploy).

## 2026-10-21 (change cover from the song card, web, to deploy)

- Web: the song card has a round "Change cover" button; its dialog (`web/js/cover-dialog.js`, loaded on demand) offers From address, Upload (drag and drop), Wikipedia suggestions and Default image, previews the choice before "Save", and "Remove custom cover" returns to the automatic cover (LIB-197, LIB-198, task-0054; needs the server half, tests written, not run).
- Server: `PUT /songs/{id}/cover` accepts multipart `file`, JSON `{url}` and JSON `{default: true}`, songs get `cover_source` (`custom` / `default`, never overwritten by an automatic cover fetch), `GET /songs/{id}/cover/suggestions` lists up to 4 Wikipedia images, and `DELETE` on a custom or default cover returns to the automatic one (API-201, API-202, API-203, DATA-192, task-0054, to deploy; its tests pass, full suite not run).

## 2026-10-21 (remaster version names, server, to deploy)

- Server: `app.migrate_version_norm` rewrites every stored remaster spelling in `version.name` of all users to the canonical one (EC1, to deploy; tests written, not run).
- Server and web: `normalize_version` (`server/app/version_norm.py`, port `web/js/version-norm.js`) spells every new remaster version name `remaster` / `<year> remaster` when a song is added, edited, drafted or imported and in the song form; "re-mastered" now reads as a remaster kind (DATA-191, EC1, to deploy; tests written, not run).

## 2026-10-21 (Library row layout, web, to deploy)

- Web: Library rows place every cell in an explicit grid column (title next to the cover again) and the listened count (Stats) now also shows on phones as a narrow muted number at the end of the row (to deploy; not seen in a browser).

## 2026-10-21 (task statuses audited, docs, to deploy)

- Docs: Task statuses audited (to deploy): every in-progress task checked against code and this changelog; task-0065 back to to do, status notes in task-0036 and task-0055.
- Docs: Stale not-deployed task statuses fixed (to deploy).
- Docs: Task statuses decided with Alex: 0037, 0055, 0036 (to deploy).

## 2026-10-21 (genre outrun, server data, to deploy)

- Server: new genre `outrun` (extra, level 2 under synthwave, approved; synonyms outrun music and outrun electro; related to electro house), a Rate Your Music link, and a Wikipedia link to the Synthwave article's Outrun section (a `#fragment` title from the new `genre_sources_manual.json`).
- Server: genre `spacesynth` (already approved under synthwave and italo disco) gained synonyms space synth, synthdance, synthesizer dance and spacedance, related hi-nrg and space disco, and a Rate Your Music link (tests and fixture updated, not run).

## 2026-10-21 (Library table view, web, to deploy)

- Web (LIB-209, task-0056): the Library has a List | Table switch (owner and signed-in users). The table shows the current result (search, filters, sort, Reverse order) with Song, Length, Times listened, Times skipped, Total listened; sortable headers (third click returns to the Library order), sticky header, row click opens the song card. `web/js/library-table.js`, `library.js`, `library-data.js`, `icons.js`, `web/style.css`, test `web/js/library-table.test.mjs` (not run).
- Web (LIB-209, task-0056): the Table view is removed again (Library switch, `library-table.js`, `electrophone.libraryLayout`); the Library list gets a right-aligned "Stats" column with the listened count per song (muted 0 for no plays; owner and signed-in users once `GET /stats/listening` has loaded; none for guests; shown from 900 px wide). Not run, not seen.

## 2026-10-21 (resume playback position after reload, web, to deploy)

- Web (PLY-179): the position of the current song is saved (every 5 s, on pause, seek and page hide) and restored paused after a reload. `web/js/resume-position.js`, `web/js/player.js`, test `web/js/resume-position.test.mjs` (not run).

## 2026-10-21 (New version available notice, web and server, to deploy)

- Web (WEB-157, task-0081): an open tab checks `GET /version` when it becomes visible, on focus and every 5 minutes while visible, and shows "A new version is available." with Reload and dismiss when a deploy changed the code; never reloads by itself. `web/js/update-check.js`, `web/js/app.js`, `web/style.css`.
- Server (API-200): public `GET /version` returns the current web version hash (no-store). `server/app/web.py`.

## 2026-10-21 (fix: song info card crash, web, to deploy)

- Web: opening the song info card (the Now playing (i) button) threw "'setInterval' called on an object that does not implement interface Window" because the live BPM controller called browser timers as methods of a plain object; the default timers are now arrow wrappers. A sweep of `web/js` found no other occurrence. `web/js/live-bpm-ctl.js`, `web/js/live-bpm-ctl.test.mjs`.

## 2026-10-21 (Library sort by length, web, to deploy)

- Web (LIB-207): the Library sort menu has "Length": shortest first, songs without a known duration last, ties by title. `web/js/library-data.js`, `web/js/library.test.mjs`.
- Web (LIB-208): a "Reverse order" toggle beside the Library sort select flips every sort; songs without a value stay last. `web/js/library-data.js`, `web/js/library.js`, `web/js/icons.js`, `web/style.css`.

## 2026-10-21 (shuffle prefers less-played songs, web, to deploy)

- Web (task-0056, PLY-178): shuffle builds each round order by weighted sampling, weight 1 / (1 + listened.d30 + skipped.d30)^2, uniform when no listening data. `web/js/shuffle-pick.js`, `web/js/queue-logic.js`, `web/js/player.js`, test `web/js/shuffle-pick.test.mjs` (not run).

## 2026-10-21 (song card: playing now, web, to deploy)

- Web (task-0056, LIB-206): the card of the song playing now shows "·" instead of Skipped numbers and a note until the song ends, then refreshes. `web/js/song-card.js`, `web/js/player.js` (`song-ended` event), tests written, not run.

## 2026-10-21 (Features fixes, server, to deploy)

- Server (task-0068, WEB-135, API-187): curated items in `docs/releases-map.json` kept `"task": null` because `TASK_ID` in `server/app/features.py` lacked a backslash (`task-d{4}`); fixed. A release no longer ends in "and N more": the cap of 12 is gone and every item is listed. The curated line "Voiceless (SoundCloud) gets its genres" (a data edit) is removed. Tests adjusted, not run.

## 2026-10-21 (play recorder diagnostics log, web, to deploy)

- Web (task-0056): the recorder logs every play open and close with its reason, and ignored song id flickers, to `localStorage['ap2.plays.log']` (last 40; `window.apPlaysLog()`), to find what splits plays. `web/js/play-recorder.js`, test written, not run.

## 2026-10-21 (play recorder split fix, web, to deploy)

- Web (task-0056): one continuous listen was recorded as several short plays because every tab hide or screen lock closed the open play; hiding now keeps it open, and `pagehide` saves the seconds so far and continues with a `cont: true` record that the server merges. `web/js/play-recorder.js`, tests written, not run.

## 2026-10-21 (listening continuation, server, to deploy)

- Server (task-0056, API-196): `POST /plays` accepts `cont: true` and merges the piece into the previous record of the same song (within 15 minutes of its end) in place; `GET /stats/listening` repairs stored fragments of one listen (`plays.merge_fragments`). `server/app/plays.py`, `server/app/schemas.py`, `server/tests/test_plays.py` (not run).

## 2026-10-21 (Features page, to deploy)

- Web: Features page updated (to deploy): tasks 0073, 0074, 0075, 0077, 0078, 0079, 0080 marked done; Jazz colour data commit left out of the releases.
- Server (task-0068, API-187): `docs/releases-map.json` accepts an `items` table of curated release lines per commit hash prefix (replaces the line generated from the commit; empty list hides it); lines written for the commits of 2026-10-20 and 2026-10-21 with long subjects. `server/app/features.py`, `server/tests/test_features.py` (not run).

## 2026-10-21 (Drafts import of YouTube playlists, web, to deploy)

- Web (task-0080, LIB-200..205): a YouTube playlist link pasted into Drafts is resolved through `GET /youtube/playlist` and its videos are added as drafts in chunks of 10 with "Adding 12 of 87..." progress and Cancel; unavailable videos and ones already in Drafts or the Library are skipped and counted; friendly inline errors. Needs the server route. `web/js/drafts-import.js`, tests written, not run, not seen.

## 2026-10-21 (YouTube playlist resolver for Drafts, server, to deploy)

- Server (task-0080, API-199): `GET /youtube/playlist?url=` lists a public playlist for the Drafts import (max 500, private and deleted skipped, 5 minute cache, shared import limit; Mix, Liked and Watch later answer 422 `playlist_unavailable`). `server/app/routes/playlist_import.py`, `server/tests/test_youtube_playlist.py` (not run). The web flow is separate.

## 2026-10-21 (listening history, server, to deploy)

- Server (task-0056 phase 1, API-196..198): `POST /plays` (idempotent batches by `batch_key`) and `GET /stats/listening` (listened and skipped per song for today, 7 days, 30 days, all time); the history is a CSV per user in `<music root>/.plays/<uid>/` (`AUDIO_PLAYS_DIR`) outside git, copied once a day into `users/<uid>/play-history.csv` in one commit (`AUDIO_PLAYS_SYNC=0` disables). The directory must be backed up with the audio dataset. `server/app/plays.py`, `server/app/routes/plays.py`, `server/tests/test_plays.py` (not run).

## 2026-10-21 (listening in Library and Song stats, to deploy)

- Web (task-0056 phase 3, LIB-190, STA-060): Library "Never listened" chip and "Last listened" sort; Song stats "Listening" view (most listened, most skipped); owner and signed-in only, from `GET /stats/listening`. No per-day chart (no series in the API). Not run, not seen.

## 2026-10-21 (listening recording and song card table, to deploy)

- Web (task-0056 phase 2, PLY-170..177, LIB-195, LIB-196): plays are recorded (listened seconds, queued locally, batched to `POST /plays`) for owner and signed-in users; the song card shows Listened/Skipped by Today, Last 7 days, Last 30 days, All time, Total listened and Last listened from `GET /stats/listening`. Needs the server routes. Tests written, not run; not seen.

## 2026-10-21 (Studio uses the full page width, built, not deployed)

- Web (task-0072, WEB-156): the Studio drops the 1100px page cap and fills the width between the nav rail and the right edge; the waveform is taller on large screens (`clamp(140px, 22vh, 260px)`) and redraws on resize. Phones unchanged. Not run, not seen.

## 2026-10-21 (R-Tem - Voiceless genres, to deploy)

- Server data: the owner-approved genre list adds `progressive house` and `electro house` to R-Tem - Voiceless (Z05 mix, SoundCloud; it had no genre): one add-only row in `library_genre_removals.json` (TAG-109), applied once at the next server start.

## 2026-10-21 (Latin and Folk, World, & Country removed, built, not deployed)

- Server data and web (task-0079): Latin and Folk, World, & Country are no longer level 1 nodes. 121 genres moved under the group Others, 6 (bossa nova, latin jazz, country rock, folk rock, folk metal, folk punk) keep only their other parent and lost `fusion`; all genres stay in the vocabulary. The old family names are synonyms of Others. The legacy `GET /genres/graph` has 9 colour families (Mac app unaffected otherwise). Songs tagged `genre:latin` or `genre:folk, world, & country` are not changed and keep the value as an unmappable tag.

## 2026-10-21 (white genre nodes get a rim, built, not deployed)

- Web, server data (task-0075 notes): `Hip Hop` and `Others` are drawn white (`#FFFFFF` in the `hex` table of `genre_levels.json`, with all their descendants); white slots (`isWhite` in `genre-data.js`) get a thin neutral rim (`--chart-rim`, #8A8F93; the `--line` token in dark mode) on the force and radial map nodes, family chips, song-card genre chips, outline and legend swatches. Other colours are unchanged. Not run, not seen.

## 2026-10-21 (Song stats field limits, built, not deployed)

- Web (task-0078, STA-025): the Song stats chart fits its view to the plotted points plus 20% of the width and height on every side; zoom-out and pan stop at these limits. `web/js/field-limits.js`.

## 2026-10-21 (gapless A-B loop, built, not deployed)

- Web (task-0077, PLY-160, PLY-161, WEB-152): the Studio A-B loop plays from a decoded buffer (`AudioBufferSourceNode`, loopStart/loopEnd) through the shared gain and analyser chain, so the wrap has no decoder gap; files up to 24 MB and 10 min, otherwise (or on any failure) the timer-seek loop as before. Tests written, not run; not verified with real audio in a browser.

## 2026-10-21 (genre colours drawn on the map canvas, built, not deployed)

- Web: the per-genre `hex` colours now reach the Genres map circles: the canvas views cached `--chart-N` before the vocabulary loaded and never re-read them; `setSlotColours` now notifies `onSlotColours` subscribers (force, radial, legacy graph views) which re-read colours, as they do on a theme change (task-0075).

## 2026-10-21 (genre colours, deployed)

- Web, server: own colours on the genre map, chips and Outline for Blues #0068F7, Jazz #8F4997, Pop #F664A5, Funk / Soul #F7690A, house #F7DF6A, techno #535353, drum and bass #E8BD0C and synthwave #881DF7 (subgenres follow); a new `hex` table in `genre_levels.json` is served in the vocabulary payload; the legacy graph colour families are unchanged.

## 2026-10-21 (Genres map drag, deployed)

- Web (task-0075): dragging a parent on the genre map only pulls its children (they follow when it moves farther than their link length, never when it moves closer) and never pushes other circles; a dragged circle stays where it was dropped instead of springing back to its parent. Not deployed.

## 2026-10-21 (genre source links, deployed)

- Web, server (task-0074, GEN-066): selecting a genre on the genre map shows Wikipedia, Apple Music and Discogs links, plus Rate Your Music where a curated URL exists (`genre_rym.json`, empty until Alex supplies the URLs) (new tab); Discogs now links every genre (a plain release search when the genre is not in Discogs).

## 2026-10-21 (Features: one release per date, deployed)

- Web, server (task-0068, WEB-135, API-187): all deploys and features of the same date are combined into one release entry on the Features screen (one date heading, one merged list, newest first, de-duplicated, hash of the newest deploy of the day). Not deployed.

## 2026-10-21 (live BPM on the song card, deployed)

- Web (task-0073, LIB-019a): the BPM badge in the song card is a toggle; on, it turns azure and shows the tempo measured live from the playing audio (visualizer analyser, onset detection over a 10 s window, stored BPM as half/double hint); the choice persists in `localStorage` (`ap.liveBpm`). Not deployed.

## 2026-10-20 (Studio: waveform, A-B loop and saved loops, built, not deployed)

- Web, server (task-0072, WEB-150..156, PLY-160, API-195, DATA-190): new main-menu page Studio (`#/studio`): waveform of the playing song (server peaks via ffmpeg, cached beside the audio; browser decode under 12 MB as fallback), marks A and B (handles, Set here, m:ss.s fields, nudges), a loop that lives in the player with a dock chip, and named loops saved on the song (`loops`). Guests can loop but not save. Not deployed.

## 2026-10-20 (electronic ignored in suggestions, built, not deployed)

- Server (TAG-112, CZ): `electronic` and the names of the group Others are ignored evidence in the genre suggestion rule: never suggested, never agreement or a source group, and they no longer unlock song-page genres of the group.

## 2026-10-20 (the server listens first, startup work in the background, built, not deployed)

- Server and web (task-0071, CV1, API-188, WEB-140): the git recovery and the migrations no longer run before uvicorn accepts connections, so a deploy is no longer a long 502 window. The server listens at once and runs them in a background thread; until they are done every data route answers `503 {"detail":"starting"}` with `Retry-After: 3` while `/health` (now with `ready` and `startup`), the page and the static files are served; `AUDIO_STARTUP_MAX_S` (300) releases the gate, a failing migration is logged and the server still becomes ready. The web retries a starting server for about 20 s with a "Server is starting..." note, the sidebar LED turns amber, `scripts/deploy.sh` waits for `ready`. Measured on a copy of the 423-song library: first `/health` 200 after 1.0 to 2.0 s, ready after 1.4 to 2.3 s. Not deployed.

## 2026-10-20 (Features icon, built, not deployed)

- Web (WEB-131): the Help > Features item uses a new `features` icon, a 2x2 grid of three rounded squares with an outlined star in the top-right cell, in the standard 1.8 stroke on the 24x24 grid.

## 2026-10-20 (temporary Others node replaces Electronic, data and server, built, not deployed)

- Server and data (task-0066, T2): `app.migrate_retired` removes the retired genre `electronic` (`server/data/retired_genres.json`) from the songs of every user once at server start, a generic pass separate from the owner removals; songs whose only genre it was stay without one. Backup, report and marker in `backups-genre-retired/<uid>/`, one git commit per user, switch `AUDIO_GENRE_RETIRED=0` (TAG-111, [runbook](tech/deploy.md#genre-retired), tests `test_migrate_retired.py`). Dry run on a copy of the live library: 170 songs touched, 7 left without a genre. The owner one-off genre fixes (TAG-085) never add a retired or non-canonical genre, so a restart does not bring `electronic` back (startup idempotence test in `test_migrate_retired.py`). Not deployed.
- Data and server (task-0066, T1, owner decision 2026-10-20): the family `Electronic` is renamed to a temporary group `Others` (`group: true`, `temporary: true` in `genre_levels.json`): a level 1 node that is never a vocabulary entry and never assigned to a song; the 146 genres that were under Electronic (51 direct children, the rest below them, house > deep house, psytrance > goa trance unchanged) have Others as parent instead, levels unchanged. `electronic` is not a genre any more: not canonical (stored `genre:electronic` tags are kept and listed by the legacy-tag review, writes get 422, never suggested); its aliases `dance & edm`, `club`, `electronica`, `indietronica`, `alternative dance`, `rave` are dropped (`edm` and its aliases stay). `GET /genres/vocabulary` gains `groups` (Others: assignable false, temporary true, colour Electronic, members) and `forms` (promoted genres, empty now); `families` lists Others in the old Electronic slot; `flavours` and `subfamilies` stay. `/genres/graph` keeps the 11 legacy families (Others and every genre promoted out of it map to Electronic). New `scripts/genre-ops.py` (promote a genre to level 1, move or re-parent a genre, review before/after) so the next restructure steps are small data edits. Not deployed; the song-side removal of the `electronic` pill is T2, the web (Others node, groups) is T3.
- Web (task-0066, T3, GEN-083, WEB-114): the Genres map and the genre pickers read the new vocabulary: the top node is derived from `families` plus `groups` and `forms`, no family name is hardcoded any more. `Others` is a grey group node (neutral palette slot, dashed outline, no song count and no Library button, a "temporary group" badge and an infobox-free note "Others - a temporary group: organisational, never assigned to songs" when it is selected); the genres below it are shades of the neutral (subfamily ladder on the neutral base); the song card shows them on a line that starts with the Others chip. The genre field never offers or accepts a group, its old names or `electronic` (a hint says so). A stored `genre:electronic` that is still on a song is not counted anywhere and shows as typed on the line without a family. Any number of level 1 forms (promoted genres) render generically with their `display` label and the colour of their group (the legacy Electronic slot) until they get their own, with a spare-slot fallback. Not deployed.
- Data and server (task-0066 step 1, GEN-084, owner decision 2026-10-20, "move dnb, trance, synthwave, techno, house, synthpop, disco out of Others"): house, techno, trance, drum and bass and synthwave are level 1 genres now (`scripts/genre-ops.py promote`; the `forms` block of `GET /genres/vocabulary` lists them; their children rise one level: 49 genres from level 3 to 2, 5 from level 4 to 3, no level 4 left; the subfamily labels are kept); `Others` is removed from the parents of synthpop (parents Pop and new wave, level 2, not level 1) and disco (parent Funk / Soul only, level 2; italo disco, euro disco and the other disco kin follow it out of Others). Others keeps 82 genres (44 direct members). The legacy `/genres/graph` still has only the 11 families: the five forms map to Electronic, disco to Funk / Soul, synthpop to Pop. New `unparent` command in `scripts/genre-ops.py`. Side effect: an agreed `electronic` from MusicBrainz and Wikipedia no longer lets the song page apply techno, trance, house, hi-nrg and the like (they are no longer genres of the group Others). Not deployed.

## 2026-10-20 (etalon test, docs only, not deployed)

- Docs: genre-terminology.md gets the etalon test in "How to decide a new label" (a genre has a reference song, a group does not; also the criterion for a level 1 form), the etalon songs are named the prototype songs, decision CY1; task-0070 gains the `prototypes` field idea (phase 0 by hand for the level-1 forms, open question F). Docs only, not deployed.

## 2026-10-20 (genres are prototype categories, docs and About sentence, built, not deployed)

- Web and docs: the About page gains one sentence (genres work like colour names: a clear centre and a soft border); genre-terminology.md gets the section "Genres are prototype categories" (prototype theory, colour analogy, consequences for equal parents, `related`, the evidence rule and task-0070) and decision CW1 (WEB-139).

## 2026-10-20 (About page, built, deployed 2026-10-20)

- Web: Help > About is a real page: what Electrophone is, how genres are organised (genres, groups, modifiers, the four axes), examples and links to the documentation; public, no private details (WEB-139, [task-0069](tasks/task-0069.md)).

## 2026-10-20 (Features screen: releases and planned, built, deployed 2026-10-20)

- Web and server: the Features page (Help menu) has three tabs, Released (grouped by day, newest on top, a block per deploy with its short hash and feature sentences with links to the task files), In progress and Planned (tasks `to do` only), each tab with a count, fed by the public `GET /features/data`, which the server builds from its own git checkout and `docs/tasks`; the service records each start on a new HEAD as a deploy, so no deploy step or file write is needed (WEB-134 to WEB-138, API-187, [task-0068](tasks/task-0068.md)). Only `feat` commits are listed (owner DA1). Library data edits (genre removals and fixes, scope `data`) are left out of the releases. History before the first recorded deploy is backfilled one release per day (`docs/releases-map.json` fixes task links).

## 2026-10-20 (Now playing queue follows the current song, deployed 2026-10-20)

- Web: the Now playing queue list auto-scrolls to centre the current song on every song change and when the page opens, like an automatic "Show playing" (PLY-151).

## 2026-10-20 (genre box: Enter places the only suggestion, suggestion label no longer gapped, deployed 2026-10-20)

- Web: in the Add and Edit genre box, Enter places the single shown suggestion (an exact name or synonym still wins, an arrow-highlighted item wins over both, never during IME composition, ADD-182); a suggestion such as "folk" is one continuous word again (the matched part is bold, no gap between the spans).

## 2026-10-20 (Electronic restructure planned, docs only, deployed 2026-10-20)

- Docs: [task-0066](tasks/task-0066.md) plans the Electronic restructure (forms at level 1, Electronic and EDM as groups; owner decision AN1), [genre-electronic-forms.md](tech/genre-electronic-forms.md) holds the proposed placement of the 146 genres, genre-terminology.md and ADR-0038 record the decisions and the remaining open ones; no data or code change.

## 2026-10-20 (hardcore renamed hardcore techno, built, deployed 2026-10-20)

- Data and server: the genre `hardcore` (Electronic, UK hardcore) is renamed `hardcore techno` in the genre data files and as the parent of happy hardcore, hard house, hard trance, hardstyle and the others (owner decision AX1); `hardcore` is a new `sound` modifier (defined, not attached, task-0065); no synonym. `app.migrate_renames` rewrites stored `genre:hardcore` tags to `genre:hardcore techno` once at start for every user (backup `backups-genre-rename/`, marker, idempotent, TAG-110, [deploy.md](tech/deploy.md#genre-rename)); the Discogs style "Hardcore" maps to `hardcore techno`. The Wikipedia lookup no longer suggests a bare `hardcore` (The Prodigy - Voodoo People loses that suggestion).

## 2026-10-20 (genre model written down, docs only, deployed 2026-10-20)

- Docs: ADR-0038 and a rewritten [genre-terminology.md](tech/genre-terminology.md) record the owner's genre model: genres versus groups (Electronic and EDM are groups), four axes (Form, Medium, Purpose, Tradition) plus personal Mood, modifiers as qualifiers of Form, the place, modifier and ambiguous-name tests, and the open decisions AN to AY; no data or code change.

## 2026-10-20 (flavour renamed modifier, deployed 2026-10-20)

- Data and server: the `flavours` block and per-genre `flavours` lists in `genre_levels.json` are now `modifiers`; `genre_vocab.py` has `MODIFIER_KINDS` (sound, mood, scene); `GET /genres/vocabulary` serves `modifiers` and, as a deprecated alias for one release, the same content under `flavours` (GEN-082).
- Web: the Genres map reads `modifiers` (falls back to `flavours`), the filter row says "Modifier" and shows Sound, Mood and Scene groups separately, "Clear modifiers" (GEN-055, WEB-088, [genre-levels.md](tech/genre-levels.md#modifiers)).

## 2026-10-20 (flavour kinds split into sound, mood and scene, deployed 2026-10-20)

- Data: in `genre_levels.json` the flavours `dark`, `deep` and `uplifting` change `kind` from `sound` to `mood` (sound: acid, progressive, melodic, vocal, hard, minimal, tech; scene: baltimore, berlin); `FLAVOUR_KINDS` and the test accept all three; the web still treats any non-scene kind as sound until the Genres map groups mood (GEN-055, [genre-levels.md](tech/genre-levels.md#modifiers)).

## 2026-10-20 (epic removed from the genres, deployed 2026-10-20)

- Data: `epic` is a descriptor (a mood), not a genre, and it pulled songs into the Classical family, so it is removed from the vocabulary (Classical 24 genres, 534 in all) and dropped from songs at the next start (`REMOVED_GENRES`); 2 songs in the owner removal list (126 songs, 208 removals and 18 additions after the bare `r&b` or `rhythm and blues` left 9 songs, `dub` left Gogol Bordello - Immigraniada, `soft rock` and `eurodance` left Ace of Base - All That She Wants, `reggae` left Boney M. - Sunny and `darksynth` was added to ZOMBIENICK - OSCILLATIONS; [genre-levels.md](tech/genre-levels.md#epic-removed-owner-2026-10-20)).

## 2026-10-20 (Genres map: Electronic circle shown again, built, deployed 2026-10-20)

- Web: the Electronic family circle is drawn again on the Genres Graph and Radial, like every other family (label, ring, lines to its children with arrowheads, selection); `HIDDEN_FAMILY_NODES` is kept as an empty list so a family can be hidden again (GEN-072, owner decision 2026-10-20); the earlier radial centre title for a hidden family only shows when a family is hidden.

## 2026-10-20 (Genres map arrows, built, deployed 2026-10-20)

- Web: parent-to-child lines on the Genres map (Graph and Radial) get an arrowhead at the child end (GEN-081); dotted related lines stay plain; skipped for short lines and at low zoom.

## 2026-10-20 (Help menu in the sidebar; built, deployed 2026-10-20)

- Web: new expandable "Help" item in the sidebar (WEB-131, task-0061) with Music theory, About and Features; collapsed on every load, shown to everyone including signed-out visitors; inline list in the wide rail, flyout in the icon rail, bottom sheet on the phone tab bar (Help takes Music theory's slot, so the tab bar keeps seven entries). Music theory moved under it; `#/about` and `#/features` are placeholder pages (WEB-132, WEB-133); About and Features are tier-2 lazy routes. The header has no chevron and the sub items are indented one icon column in the wide rail (Alex feedback). Deployed 2026-10-20.

## 2026-10-20 (Dock: mouse wheel sets the volume, built, deployed 2026-10-20)

- Web: the mouse wheel over the mini-player dock changes the volume (PLY-150, task-0063): 5 points per notch, Shift 1 point, accumulated for touchpads, clamped 0..100, unmutes on a raise, with an inline "62%" note for about 1 s; Ctrl+wheel and a hidden dock are left alone. Deployed 2026-10-20.

## 2026-10-20 (song card title line parts, built, deployed 2026-10-20)

- Web: in the song card the artists, the title and the version in the `Artist - Title (Version)` line are buttons that open a small info popover on click or tap (the part turns azure on hover and focus, not underlined; the copy icon stays glued to the last word of a wrapping line; Escape, outside click or another part closes it): artist (Country, Genres, Years of activity, filter link; stub data for now, LIB-188), title and version (Year of release, Albums, Genres of the song) ([task-0062](tasks/task-0062.md), LIB-185 to LIB-189).

## 2026-10-20 (Genres graph: wider rings, steadier selection)

- Web: Genres graph and Radial: a genre with several families (disco, euro disco, eurodance) is painted with the plain family colours in every wedge (Funk / Soul orange, Electronic teal, Pop pink) instead of the Electronic wedge taking the subfamily shade, which turned purple for the Eurodance & disco subfamily (`fillDisc` shades single-family discs only); dragging a child never moves its parent (`PARENT_REACTION` = 0). WEB-114, GEN-075, WEB-125. Deployed.
- Web: Genres graph: dragging a parent circle no longer gravitates toward its children, and every drawn descendant follows it with a 300 ms delay (`CHILD_FOLLOW_MS`, time constant a third of that) and ends at exactly the position relative to the parent it had before the move, toward or away (replaces the stretch-only leash; links to followers are muted meanwhile and the followers ride along until the simulation sleeps); dragging a child moves it freely and never moves its parent. Headless on the real vocabulary (disco, euro disco): relative offset error 0.00 px after a 120 px move toward and a 200 px move away. GEN-075 (7a), WEB-125. Deployed.
- Web: in Genres graph drill-down the children of an opened genre sit on a ring three times as wide (`RING_SCALE` = 3 in `genre-force-view.js`: first ring, count-based radius, cap and the spacing of concentric rings, and the link rest length is the ring radius), so Rock's children are several circle radii from Rock and their labels no longer pile up on it; selecting a genre with several parents (house, then eurodance) no longer makes it jerk: newly drawn extra parents are placed on a small arc just outside the ring of its children with their rest positions there, and the camera stays put when the revealed set still fits the view (headless, real vocabulary: under 5 px in the first 300 ms). GEN-075 (2) and (6a), WEB-125. Deployed.

## 2026-10-20 (Owner genre fixes: After Dark)

- Data: the owner-approved genre list removes new wave and electronic from Mr.Kitty - After Dark (synthwave, synthpop, witch house and darkwave kept), now 115 songs, 192 genres removed and 15 added in all (TAG-109). Deployed.

## 2026-10-20 (Owner genre fixes: 5 more wrong genres)

- Data: the owner-approved genre list removes 5 more wrong genres from 5 songs, now 114 songs, 190 genres removed and 15 added in all (TAG-109): arena rock (KISS - I Was Made For Lovin' You), deep trance (Lasgo - Something), hardcore hip hop (Eminem - Stan, horrorcore kept), jungle (Concord Dawn - Morning Light, whose row is extended) and melodic death metal (CREMATORY - Ist es wahr, the other four genres kept). Deployed.

## 2026-10-20 (Owner genre fixes: 19 wrong genres)

- Data: the owner-approved genre list removes 19 more wrong genres from 18 songs, now 110 songs, 185 genres removed and 15 added in all (TAG-109): acid house (Ya Mama), bassline (Petrichor), cool jazz (Soul Lament), country rock (Money For Nothing), dark ambient (Innocente), electroclash (The World is Mine), garage house (Power To The Beats), italodance (Self Control), jangle pop and paisley underground (Walk Like an Egyptian), krautrock (Radioactivity), melodic hardcore (The Kids Aren't Alright), polka (Immigraniada), new romantic (Come Undone), post-disco (Cold Heart, Royal Albert Hall), progressive rock (Oxygene, Pt. 4), rnb/swing (Big City Life), shoegaze (Midnight City) and slowcore (Young and Beautiful). Six of the songs already had a row, which is extended. Deployed.

## 2026-10-20 (Owner genre fixes: Babel and Dancin)

- Data: the owner-approved genre list gains two rows, now 98 songs, 166 genres removed and 15 added in all (TAG-109): Gustavo Bravetti - Babel is retagged from dancehall to dubstep (Discogs and Qobuz: electronic, dubstep, grime, club/dance; no grime added), and Aaron Smith - Dancin (KRONO Remix) is retagged from dancehall and house to deep house and nu-disco. Deployed.

## 2026-10-19 (Owner genre fixes: removals and darkwave retag)

- Data: the owner-approved genre list gains one row and changes one, now 96 songs, 163 genres removed and 12 added in all (TAG-109): Brotherhood Of Man - Save Your Kisses For Me loses middle of the road, schlager and disco and keeps pop; the Baby K feat. Giusy Ferreri - Roma-Bangkok row now ends with synthpop and moombahton only (Wikipedia: electropop, moombahton), so its earlier removal of those two is dropped. Deployed.

- Data: the owner-approved genre list (`server/data/library_genre_removals.json`) gains five rows, now 95 songs, 159 genres removed and 10 added in all (TAG-109): Roma-Bangkok loses synthpop, house, hip hop and moombahton; Lana Del Rey - Young and Beautiful loses trip hop and indie rock; Militant (Future Fate), Cruise (Crockett) and Dark Time (Weightlessness) are retagged from darkwave to darksynth with the existing `remove` plus `add` row (the added genre goes after the song's last genre; no code change). Deployed.

## 2026-10-20 (lo-fi removed)

- Web: each Outline row of the Genres map with library songs has a "Show N songs in the Library" icon button (shown on hover, focus or touch) that opens the Library filtered by that genre and its descendants, replacing the removed infobox button (GEN-080, WEB-130).
- Data: the genre `lo-fi` is removed from the vocabulary (owner decision: a production aesthetic, not a form), like industrial and ethereal: it joins `REMOVED_GENRES`, so the stored tag is dropped at startup from the 3 library songs that carry it (Pictures Of Purple Skies, Aurora, Raindrops); Rock is 110 genres (41 level 2, 69 level 3, 19 held); tests and counts updated; `lo-fi hip hop` and `chillhop` are not vocabulary genres.

## 2026-10-19 (equal genre parents)

- Server and data: all parents of a genre are equal (owner decisions BY1, BX, CB2, [ADR-0037](tech/decisions.md), [task-0055](tasks/task-0055.md), GEN-070 to GEN-072): a genre belongs to every family it descends from and a song counts in each; the level is the shortest path depth; the depth cap of three levels is gone (sanity bound 12). `GET /genres/vocabulary` keeps `family`, `parents` and `level` and adds `families`; the graph nodes gain `families`; the `family` override is removed. The suggestion rule uses every parent and family.
- Data: disco is in Funk / Soul and Electronic and so are its children, post-disco is under disco; psytrance is under trance (its branch reaches level 4); eurodance has house, euro disco and Pop; darkwave has Electronic, post-punk and new wave; synthpop has Electronic, Pop and new wave; the genres industrial and ethereal are removed (stored tags dropped at startup; the alias "ethereal wave" is gone, so that tag is dropped too). Not applied: the larger nesting proposal (CA1, BV).
- Data: `electro house` is now a child of `house` alone, with `electro` as a `related` link, so it no longer belongs to the Hip Hop family (owner decision CT1); electroclash still reaches Hip Hop through electro.
- Data: `darkwave` now has only `post-punk` and `new wave` as parents (owner decision DB2): it is in Rock only (level 3), loses the Electronic subfamily "Synth & wave", and its child `coldwave` is Rock only too; Electronic 146 members, Rock 123 ([genre-levels.md](tech/genre-levels.md#equal-parents-and-the-edits-of-2026-10-19-adr-0037-task-0055)).
- Web: the Outline lists a genre under each parent, the family chips and counts count a song in each family, a genre of several families is a pie of equal segments in the family colours on the Radial and the Graph, the Radial draws deeper levels on further rings, and the Electronic family circle is not drawn on the map (its chip and Outline row still work).
- Fix: `GET /genres/vocabulary` `genres[].parents` listed the old Discogs/extras parents (psytrance under Electronic, electro house under Electronic, darkwave without post-punk and new wave, psybient without ambient) while `levels[name].parents` was right; the rows now carry the same full parent set as `levels` (`genre_vocab.build` takes the tree's parents); the Genres map graph draws every parent link as an equal `parent` link (the shallowest or alphabetical parent no longer becomes the only strong one, the rest weak `related`).
- Web: Genres graph children follow their parent: dragging a circle carries its whole subtree with a delay of about 300 ms (`CHILD_FOLLOW_MS`, exponential smoothing, deeper levels up to 400 ms; visible circles follow, hidden descendants' rest positions shift too, so nothing snaps back), revealed children start on a small ring around the parent with zero velocity and a gentle reheat (0.25), parent-child springs are stiffer (strength 1.4 / sqrt(min degree), floor 0.15 on the cooling factor) and velocity loss is 0.34 instead of 0.4; related links stay weak, reduced motion moves the subtree at once without lag. In drill-down a click on empty canvas collapses everything to the top level (GEN-075, WEB-125).
- Web: in Genres graph drill-down a click on a closed genre that is not a top-level circle, at level 2 as well as deeper (the families and the hidden Electronic root's genres stay top level and never hide anything; a genre with a drawn parent such as eurodance under Pop qualifies) hides its siblings with the branches they had open and keeps only the genre, its children and the full chains of all its parents (the parents are drawn closed; clicking one opens it as usual); clicking the selected genre again brings everything back as it was before the click; the same applies to a pick from the Outline, search or Now playing; top-level circles keep the browsing behaviour (GEN-075, WEB-125, `clickDrill` in `genre-drill.js`).
- Web: Genres graph dragging is now a one-way delayed leash instead of a rigid subtree move: a child follows its dragged parent only when the link is stretched beyond its rest length (eased, `CHILD_FOLLOW_MS` = 300, chained down the descendants, per parent link for several parents), moving a parent toward its child or a child toward its parent moves the other one not at all (slack tree links have no spring, charge or collision between a parent and child while one is held), dragging a child away moves the parent only a few pixels (`PARENT_REACTION` = 0.02 instead of 0.5), drag warmth 0.1 instead of 0.3 (`genre-force-view.js`, `genre-sim.js`, GEN-075 (7a), WEB-125). Not tested.
- Web: equal parents in the Genres graph code: a genre keeps all its parent links (no single last parent): dragging a circle also carries a genre when any of its parents is in the dragged subtree (unless another parent is pinned outside it), a selected genre highlights the chains of all its parents, new circles appear around the first parent already drawn, and "Now playing" falls back to the nearest drawn ancestor over all parents (`genre-force-view.js`, `genres-rework.js`).
- Web: selecting a genre on the Genres map highlights every ancestor along every parent path (for example spacesynth > italo disco > disco > Funk / Soul, a hidden Electronic root ends the chain at the topmost drawn ancestor): ancestor circles at full strength with labels, the chain edges in the selected-edge style, both fading gently with distance (GEN-043; `genre-force-view.js`).
- Web: the Genres map (Graph and Radial) shows no hover hint any more (no floating card with name, counts and status; owner request 2026-10-20, GEN-059); hover keeps the pointer cursor and the ring on the circle, the details stay in the click infobox and the Outline.
- Web: a click on a node of the Genres map (Graph and Radial), Enter in the search and the Outline no longer show the genre infobox (owner request 2026-10-20, "when click - don't show genre info box"): the click only highlights the node and its ancestor chain (and drills down on the Graph); the infobox, its "Show N songs in Library" button, the Sources icon row (`genre-sources-ui.js`) and their CSS are removed, and the existing page tests no longer expect them (GEN-014, WEB-087, WEB-109, WEB-111 withdrawn).
- Web: Genres graph parent links are one-way (owner request 2026-10-20): a child follows its parent as before, but a parent feels the child only when the child is pulled beyond the link's rest length, and then at half the former reaction (`parentReaction: 0.5` in `genre-sim.js`, set in `genre-force-view.js`); moving a child inside the rest length leaves the parent alone; related and association links stay symmetric.
- Web: Genres graph drill-down: opening a genre creates its children anew around it on every open (also after a collapse and reopen), spread evenly on a ring (angles evenly spaced; the fan opens away from the drawn parent over about 300 degrees, the full circle without one; more than 14 children use several concentric rings in proportion to their circumference), and the ring positions replace their layout rest positions, so the children no longer bunch on one side or sit far from the parent; children already drawn through another parent keep their place (`genre-force-view.js`, GEN-075, WEB-125).
- Data: `house` gets a `related` link to `disco` (owner decision DF1: house grew out of disco; an association, not a parent, so parents, families and counts do not change).

## 2026-10-20 (Genres map drill-down)

- Web: the Genres Graph opens with only the families (and the level 2 genres of the hidden Electronic circle) and opens branch by branch on a click; a genre with several parents draws all its parent chains; Esc or "Collapse all" returns to the families; the "Drill-down" toggle (on by default, remembered in the browser) shows the previous full Graph when off ([task-0057](tasks/task-0057.md), GEN-075, WEB-125). Not tested and not seen in a browser yet.

## 2026-10-19 (genre map shows the library, built, deployed 2026-10-20)

- Web: the Genres map opens on every visit with the genres that have songs in the library and their ancestors, not the whole vocabulary: the Graph's "Library only" toggle is replaced by an opt-in "All genres" button that is off at each open and not stored, the family chips list only families with library songs, the search and the Outline follow the same scope, and the stored Electronic subfamily choice is cleared on read instead of hiding library genres (WEB-108, WEB-114, GEN-060).

## 2026-10-19 (faster cold start, deployed 2026-10-20)

- Web: the radial view of the hidden Electronic family shows "Electronic" as the title at the centre (the circle stays hidden; GEN-072, deployed 2026-10-20).
- Web: the BPM badge is a rounded rectangle (`--radius-xs`, 4px) instead of a pill; the owner asked for about 3px, which needs a new radius token in the Design System.
- Web: the Library BPM badge moved out of the Genres cell to the right end of the subtitle line, after the in-queue icon and right-aligned under the song length; the Genres cell is plain text again and the reserved empty slot is gone; the badge shows at all widths (LIB-019, LIB-161, LIB-175, deployed 2026-10-20).
- Web: Library rows lose the "..." menu, the source logo and the right-hand cell (all duplicated by the song card). Each row ends its title line with one glyph-only azure state button left of the length: Download to the server (no audio), Add to queue (shown on row hover or focus), or the playlist glyph for a queued song (always visible, click removes); the progress ring replaces it during a download; no toast, the glyph changes. This reverses the passive in-queue icon of LIB-161. The only thing reachable solely through the old menu was "Play now", which the cover button still does (LIB-180, deployed 2026-10-20).

- Web: `/auth/me`, `/me` and `/library` start together and the Library is fetched once instead of twice (WEB-116); Settings, Genres map, Playlists, Song stats, Music theory and the visualizer load only when needed (WEB-117, WEB-118); the page tells the browser to fetch the whole startup module graph at once with generated `modulepreload` hints (WEB-119). Local cold start (60 ms latency, 5 Mbit/s): 173 to 110 JS files, DOMContentLoaded 7.7 s to 4.6 s.
- Web: two-tier loading, no build step: tier 1 (preloaded with `modulepreload`, 56 modules, 210 KB) is only what paints the Library list and the shell; the song card, Add and Edit with the song form, share dialog and links, tag picker, filter sheet and Drafts view load on a click with an inline "Loading..." note (WEB-120); once the first rows and their first 12 covers are in, the other 123 modules are warmed in the background 6 at a time when idle, never on data saver or 2g, and paused while a click is loading a module (tier 2, WEB-121, generated from the import graph); the first 12 covers load eagerly with high priority (WEB-122). Local cold start (60 ms, 5 Mbit/s): 110 to 58 JS requests before the first row, DOMContentLoaded 4.6 s to 2.5 s, first library row 6.0 s to about 3.7 s; all lazy modules cached after about 9 s.

## 2026-10-19 (song card copy icon, deployed 2026-10-20)

- Web: the song card's Copy title is a round icon button right of the title text, azure, shown on hover or focus (always on touch) and turning into a check for 1.5 s after copying (LIB-155); the confirmation shows inline on that line instead of a toast (WEB-115). Close in the song card is a floating round X over the cover corner and the empty header row is gone (LIB-177) that fades out when idle and returns on movement or focus. The card's round buttons highlight on hover and focus; its playlist button shows the playlist icon in azure with its position while the song is in the queue (LIB-149).

## 2026-10-19 (song card width, deployed 2026-10-20)

- Web: the song card dialog is as wide as its cover plus padding instead of leaving empty space beside the cover (LIB-176).

## 2026-10-19 (Library row length, deployed 2026-10-20)

- Web: the Library row shows the song length right-aligned on the title line instead of a lone Time column; the header label is gone, rows without audio keep their logo, Download button and ring (LIB-175).

## 2026-10-19 (Library search words, deployed 2026-10-20)

- Web: the Library search finds a pasted "Maduk ft Veela - Ghost Assassin VIP" (words matched separately, ft/feat/&/dashes ignored, diacritics folded; LIB-162).

## 2026-10-19 (Library queue mark, deployed 2026-10-20)

- Web: the Library row loses its round "Add to playlist" toggle button and its column; a song in the queue shows a small list icon right-aligned on the subtitle line under the length (no number; tooltip "In the queue, position N of M", also on the cover), and the row menu offers "Add to queue" / "Remove from queue" (LIB-161, LIB-095, LIB-096).

## 2026-10-19 (Library genre removals, deployed 2026-10-20)

- Server and data: a one-off, owner-approved removals and additions of genres (90 songs, 150 genres removed, 7 added, 1 song cleared, `server/data/library_genre_removals.json`) runs once at server start for the owner library only, with backup, report and marker in `backups-genre-removals/<uid>/` and one git commit; switch `AUDIO_GENRE_REMOVALS=0` (TAG-109, [runbook](tech/deploy.md#genre-removals), tests `test_migrate_removals.py`). Deployed 2026-10-20.

## 2026-10-19 (Genre suggestion rule, deployed 2026-10-20)

- Server and web: genres from the lookups are applied only when independent sources agree, the rest are suggestions (decision EH1, ADR-0035, TAG-099 to TAG-108, API-186, ADD-181). Two groups out of MusicBrainz, Wikipedia song page, Wikipedia artist page, Discogs and the link's own tags must name a genre (a child counts for its ancestor); the Wikipedia song page alone also applies a genre that is not ambiguous and shares a family with an applied one; at most 5 are applied, a non-family ancestor is dropped beside its child. `POST /preview`, `/preview/stream`, `/metadata` and `/lookup/wikipedia` share one function (`metadata.resolve`), `tags` holds only the applied genres and the new `genre_suggestions` lists the rest with source badges; the Add and Edit forms show them as a "Suggested genres" row (click adds, x dismisses) and the old "From the original (not applied)" line is part of it. The artist infobox is no longer promoted to the song's own genres. Stored songs are not changed. Deployed 2026-10-20.

## 2026-10-19 (Genre terminology and parents lists, deployed 2026-10-20)

- Docs: new [tech/genre-terminology.md](tech/genre-terminology.md) (glossary, how "genre" is used in Wikipedia and catalogues, the genre by form, medium and purpose axes plus the subjective mood axis, open facets decision) and ADR-0034. Deployed 2026-10-20.
- Web: the Library search box has a clear (x) button on its right edge, shown while it has text; click or Escape clears the box and the filter and keeps focus (LIB-160). Deployed 2026-10-20.
- Web: the Library remembers the last used tab (Songs or Drafts) across reloads and navigation (localStorage key `electrophone.libraryView`, LIB-159); the Drafts view lost its "Clear all drafts" button and confirmation (per-draft Delete with undo stays; the API route `DELETE /drafts` is unchanged). Deployed 2026-10-20.
- Server data, docs and tests: the Rock family is drafted (owner decision DR1, GEN-067): 91 of the 111 Rock genres are placed under reviewed parents from Wikipedia lead sentences (42 level 2, 69 level 3, no level 4; krautrock and post-rock under experimental rock, hardcore punk and extreme metal as extra parents, folk metal, folk punk, rap metal and electronic rock marked as fusion genres, 11 genres gained `related`), 20 genres with an unsure review stay at Rock and provisional. Deployed 2026-10-20.
- Data (review only, not loaded): `server/data/genre_hierarchy_evidence.json` lists the Wikidata and Wikipedia parents of every genre with a Wikipedia match (472 of 549 with Wikidata parents, 208 with a lead-sentence parent), and `scripts/hierarchy-diff.mjs` compares them with `parents[]` per family. Deployed 2026-10-20.
- Server: every genre and family now records which of Discogs, MusicBrainz, Wikipedia and Apple Music has it (`server/data/genre_sources.json`, 449 MusicBrainz, 463 Wikipedia, 138 Apple Music of 540; ambiguous candidates in `genre_sources_review.json`, built by `scripts/build-genre-sources.mjs`); `GET /genres/vocabulary` rows gain `sources` and `source_links` (Wikipedia, Apple Music, Spotify, Discogs, MusicBrainz links built server side, ADR-0033, GEN-066). Deployed 2026-10-20.
- Server, web and docs: every node of the genre vocabulary is a genre and level 1 is a family (ADR-0030, GEN-057, GEN-058); the word "style" is gone from the UI, the docs, the data keys and the code except where it quotes the Discogs API. `genre_styles.json` is now `genre_discogs.json` (`families`, `genres`), and a genre has `parents` (a list: the first is the primary parent, the rest are cross-links) instead of `parent`, `also_under` and `also_in_genres`; the tree, the counts, the cross-links and the Genres map are unchanged (checked against a snapshot taken before the change). `GET /genres/vocabulary` now serves `level` family or genre, `parents`, `family` and `family_synonyms`; `GET /genres/graph` nodes carry `anchor` (and still `style` for the macOS app). Deployed 2026-10-20.
- Server and web: genre `spacesynth` is now level 3 under synthwave with italo disco as a cross-link, and the new genre `space disco` (a disco subgenre, approved, not in Discogs) sits at level 3 under disco in Electronic; Electronic now has 50 level 2 and 95 level 3 genres. Deployed 2026-10-20.
- Server: the flat `genres` row of `spacesynth` (from `genre_extras.json`) now lists synthwave first and italo disco second like its `levels` entry; new tests (`test_genre_payload_agrees.py`, `web/js/genre-payload.test.mjs`, fixture `server/tests/fixtures/genre_payload_levels.json`) fail when the served payload and `genre_levels.json` disagree. Deployed 2026-10-20.
- Web: the Genres map hover tooltip no longer prints the text "null" for the parts a node does not have (regression test added). Deployed 2026-10-20.
- Web: the Genres map opens as an Obsidian-style force-directed graph of all about 530 genres (library genres emphasised, family chips and a Library only toggle as filters, drag, pan, zoom, hover highlight, double-click zoom, smooth cooling physics; GEN-060, WEB-108) with a "Graph | Radial" switch that keeps the previous radial map; the force simulation now moves the lower-degree end of a link more (it was reversed); a genre with parents in several families is drawn in a split colour of all its families (up to 3, both views, legend line added); every parent link is one identical solid line and the infobox lists "Parents" without primary/extra wording; fusion genres (`fusion: true`) show under their second family only with the new "Fusion genres" switch (default off, GEN-063); the genre infobox is now its own panel next to the outline (WEB-109) with an empty source-icons slot; Radial stays one family at a time and opens on the selected node's family when switched to (GEN-062); a "Related" switch draws faint dotted lines for the new `related` data (GEN-066); the infobox lost its Children, Parent chain, Level, Families and In Discogs rows and gets a Sources row of icon links from the vocabulary `source_links` (WEB-111); split-colour genres in Radial now use their family colours (disco is Funk / Soul + Electronic; the umbrella hue had leaked in); genre names stay lowercase as the vocabulary gives them and songs listed only in the bare `genres` field now count on the map (GEN-065); the status is plain text above two one-line, horizontally scrolling button rows (WEB-110); Electronic genres are shaded by subfamily (up to ten shades of the family colour, pairwise at least 0.1 apart in OKLab, computed from the `subfamily` and `subfamilies` payload data, a Subfamily chip row filter, legend section and infobox row; WEB-114); the Graph now starts from a crossing-minimising layout (sector seed plus time-sliced annealing: 560 crossings of the plain force layout down to 154 with Fusion on, 405 down to 115 with it off, measured with the Rock hierarchy) and keeps it by a rest-position spring, with "Reset layout", an owner-only "Export layout" (clipboard JSON, download fallback) and an optional `web/data/genre-layout.json` with "Use saved layout" (WEB-112, WEB-113); hovering a circle only shows the tooltip and a ring, selection and neighbour highlight happen only on click (also in Radial, which already worked this way). Deployed 2026-10-20.
- Server and data: 22 genres whose parent link was only an association now carry it as `related` instead of `parents` (new optional list on a genre in `genre_levels.json`, served in `levels[genre].related`, validated; no effect on the tree, counts or colours; gospel moves to Folk, World, & Country, trap and acid jazz lose `fusion`); genre display names are lowercase; the genre `soviet wave` is now `sovietwave` (stored tags are migrated at startup, with the usual backup). Deployed 2026-10-20.
- Server and data: Electronic genres carry an optional `subfamily` (eight subfamilies declared: House, Techno, Trance, Breaks & bass, Synth & wave, Experimental industrial & noise, Ambient & downtempo, Eurodance & disco; declared in `genre_levels.json`; children inherit; payload `levels[genre].subfamily` and `subfamilies`, validated, GEN-068); the new genre `edm` takes electronic dance music, dance music, club music, electronic dance and dance from the Electronic family; `eurobeat` is now a synonym of `eurodance` (stored tags are rewritten at startup with the usual backup). Deployed 2026-10-20.
- Server and data: nine reviewed Rock genres added as extras (hardcore punk, experimental rock, extreme metal, noise rock, roots rock, neo-psychedelia, glam metal, college rock, death-doom; nothing moved under them yet) and electro-funk / electrofunk as synonyms of electro. Deployed 2026-10-20.
- Server: 23 Discogs genres that sit in two families now list the second family as an extra parent in `genre_levels.json` (24 multi-family genres with disco), and 12 blends (blues rock, folk rock, country rock, funk metal, jazz funk, soul jazz, acid jazz, latin jazz, hip house, trip hop, synthpop, trap) carry the new optional `fusion: true` flag, served in `GET /genres/vocabulary` `levels`; levels, families and counts are unchanged (GEN-061). The map toggle that uses the flag is separate. Deployed 2026-10-20.
- Web: the Drafts button "Add properly" is now "Add to Library" (label, aria-label, docs). Deployed 2026-10-20.
- Web: the Songs | Drafts switch in the Library was unstyled (plain browser buttons, the count as tiny text) because `drafts.css` was never linked from `index.html`; it is now linked, the buttons are 44 px tall and the count is a badge; new test `css-linked.test.mjs` fails when a stylesheet is not linked. Deployed 2026-10-20.

## 2026-10-19 (Version artists label follows the version type, deployed 2026-10-20)

- Web: the field and song card row for the version's artists is labelled by the version type (Remix by, Remaster by, Edit by, Live by, Acoustic by, Extended by, Instrumental by, Mashup by, Cover by, Version by for Other or none) instead of always "Remix by"; the form label updates when the Version dropdown changes (ADD-180). Not checked in a browser.

## 2026-10-18 (Library draft list)

- Server and web: the Library has a "Songs | Drafts N" switch. In Drafts the owner and every signed-in user paste "Artist - Title" lines and links (one per line, Ctrl or Cmd+Enter), get a quick YouTube or SoundCloud lookup (title, channel, length, upload year, thumbnail; two lookups at a time, stops on a 429) and keep them as a per-user list in `users/<uid>/drafts.json` (not in `library.json`; guests get 401; up to 500 drafts, 100 lines and 300 characters per line per paste). Rows show an "In library" mark, Refresh, Edit, Delete with undo and "Add to Library" (opens the Add dialog with the link, removes the draft after saving); New routes `GET/POST/DELETE /drafts`, `PATCH /drafts/{id}`, `POST /drafts/{id}/refresh`, `DELETE /drafts/{id}`. [ADR-0032](tech/decisions.md), [task-0050](tasks/task-0050.md).

## 2026-10-18 (Genres map panel collapses as one, not deployed)

- Web: on the Genres map the header block (status chip, Show legend, Now playing, Reload, family chips) and the Outline are one panel with a single collapse button in its title row; collapsed, only a compact "Outline" button remains to bring the whole panel back, also on phones ([WEB-085](specs/web.md), WEB-086, GEN-054). Not checked in a browser.

## 2026-10-18 (Pill pencil edits directly, not deployed)

- Web: the pencil on a song form pill (Title, Artists, Featuring, With, Remix by, Cover / mashup sources) now starts editing the pill text directly; the popup menu (Edit text, Move to ..., Remove) is gone, so pills move between fields only by drag and drop and the Title "Move to Artists?" hint; the X still removes. Not checked in a browser.

## 2026-10-18 (Library row playlist button, not deployed)

- Web: the Library row playlist button keeps the plus icon (`listAdd`) when pressed, like the song card toggle; the pressed state is only the accent background, and the unused check icon is gone.

## 2026-10-18 (Settings Library card, not deployed)

- Web: Settings moved "Download all" (text, button, confirm step, progress, failed list) into the Library card after the Server row and dropped the separate "Download all songs" card; the Build row left the Library card (the sidebar build line stays; WEB-082, WEB-102). Not deployed.

## 2026-10-18 (path validation, not deployed)

- Server: the migration command lines validate their path arguments (library, legacy backup, report, backup folder; NFR-121) and the atomic JSON writers refuse NUL bytes and directories; web: the pitch tracker drain loop, the playlist import retry and three bit truncations were rewritten for static analysis with no behaviour change. Not deployed.

## 2026-10-18 (vs splits artists on add)

- Server and web: adding from a link or a playlist import now reads a spaced "vs" / "vs." in the artist text as two main artists ("Mason vs Princess Superstar" gives Mason and Princess Superstar); stored artists are never split (ADD-177).
- Server and web: the single-link Add (preview, SoundCloud probe, download fallback) now reads "Artist - Title" in a video title like the playlist import when the video has no artist data ("The Midnight - Love Is An Ocean (Lyrics)" on a fan channel gives The Midnight), and a trailing use-note bracket such as "[Saltburn Soundtrack]" or "[Game OST]" is cut from the title; stored songs are unchanged (ADD-178, ADD-179).

## 2026-10-18 (tighter sidebar top)

- Web: the logo block, the collapse chevron button and the first menu item sit closer together vertically (the visible gaps shrink by about a third); the menu list spacing and the collapsed/expanded alignment are unchanged (WEB-037).

## 2026-10-18 (Library actions under the chips)

- Web: the Library toolbar keeps only Show playing beside the search field; Clear filters, Play all and Add all to playlist moved back to the sort bar row under the chips, right-aligned, and under 720px wrap onto their own line below the sort select (LIB-030).

## 2026-10-18 (sidebar stays put)

- Web: collapsing or expanding the sidebar no longer moves the logo, the chevron button or the menu items vertically; only the width and the labels change (WEB-037).

## 2026-10-18 (song card Albums row)

- Web: the song card details block ends with an `Album: ...` or `Albums: A, B` item listing every album of the song, placed after Remix by / Cover of / Mashup of and above the Genre lines; hidden when the song has no album (LIB-142, LIB-158).

## 2026-10-18 (song card Year fact)

- Web: the song card details block shows `Year: 1995` for a song without a version year too (before, only versions with a year had it); the version and remaster forms are unchanged (LIB-142, LIB-150).

## 2026-10-18 (sidebar toggle shape)

- Web: the sidebar collapse chevron button is a rounded square with softly rounded corners instead of a circle; size, position, border and icon are unchanged (WEB-037).

## 2026-10-18 (Discogs in Get metadata)

- Web and server: "Get metadata" in the Add and Edit form now applies the Discogs result (link, year, genres), says why Discogs was skipped (not configured, no match, lookup failed), and a Discogs master or release link pasted into the Discogs link field is read directly instead of searching (ADD-172, ADD-173, API-172, API-173).

## 2026-10-18 (compact player on the right)

- Web: the compact player pill (PLY-149) now sits at the right edge of the stage, 16px from the edge, instead of centred; the handle stays on its left and the expanded dock stays centred.

## 2026-10-18 (sidebar toggle)

- Web: the sidebar collapse chevron is a small round button on the sidebar's right edge, half over the page, at the height between the logo and the first menu item.

## 2026-10-18 (Library chips under the search)

- Web: the Library search field takes the remaining toolbar width with the action buttons (Clear filters, Show playing, Play all, Add all) at its right end, and the category chips (Tags, Genres, Years, Countries) sit on their own line directly below it at every width; under 720px the buttons wrap after the chips and the sort bar keeps only the sort select and the summary (LIB-030).

## 2026-10-18 (genres map library only)

- Web: the Genres map and its outline show only genres of songs that are in the library plus the ancestors that connect them (ancestors without a song of their own are neutral connector nodes); the "Show whole vocabulary" and "Only with songs" toggles are gone, the family chips list only families with library songs (most songs first and pressed by default), the status chip reads "N genres in <family>" counting genres with songs, and a library without genre tags shows "No genres yet. Add songs with genres to see them here." ([WEB-085](specs/web.md), GEN-054).

## 2026-10-18 (genres map approved sign)

- Web: the Genres map no longer draws the green check badge on approved genres, and the legend lost its "Check badge" entry; the question badge, the dashed ring, the outline badge and the data stay.
- Web: the green "approved" pill is gone from the Genres rework outline rows, "Alex approved" from the genre details and the map hover tooltip, and "approved" from the Status filter chips; the question badge, the provisional badge, the dashed ring, the other status chips and the data stay.

## 2026-10-18 (genres map families)

- Web: the Genres map has a family row in its header (Electronic, Blues, Jazz, Rock, each with its palette dot); a chip redraws the map around that family with the same circles, counts, selection and details, and picking an outline row of another family switches the map to it.

## 2026-10-18 (genres map panel)

- Web: on the Genres map the status chip and the Show whole vocabulary, Show legend, Now playing and Reload buttons moved into the Outline panel as its header row, so there is one side panel instead of two; closing the outline leaves the header row (with an Outline button to reopen it).

## 2026-10-18 (song card playlist icon)

- Web: the song card playlist toggle keeps the list add icon in the pressed state and differs only by the accent background; the accessible name still tells the state (LIB-149).

## 2026-10-18 (song card genre lines)

- Web: the song card's Genre row now shows one line per level-1 genre inferred from the song's genre tags (family chip first even when untagged, then the tagged genres by level, a two-family genre on both lines, unknown genres on a last line); LIB-158.

## 2026-10-18 (song card buttons)

- Web: the song card's playlist toggle sits right after Play next (Play next, Playlist, Share, Download, Edit), and opening the card no longer draws a focus ring on the first button; the dialog itself takes the initial focus and Tab still shows the ring.

## 2026-10-18 (Play next icon)

- Web: the song card's round Play next button shows a play triangle with a plus at its top right (new icon `playPlus`) instead of the queue-list icon.

## 2026-10-18 (Other family colour fix)

- Web and macOS: Other and unknown genre families keep the neutral `--chart-15` after the family list shrank to 11 plus Other; the other 11 families keep their old colours (GEN-040).

## 2026-10-18 (removed genre families)

- Server, web and macOS: the families Stage & Screen, Children's, Brass & Military and Non-Music are removed with every style, synonym and extra under them (soundtrack, trailer, score, musical, theme, audiobook, spoken word, poetry, military, marches, lullaby and the rest; GEN-037, TAG-073, TAG-077, [genre-levels.md](tech/genre-levels.md#removed-families-alex-2026-10-18)); `epic` stays as a Classical style. 11 families remain; songs lose the removed genres at the next start through the existing genre-tag migration (backup in `backups-genre-merge`).

## 2026-10-18 (clean credits on add)

- Server and web: a song added from a link or a playlist now stores clean credits (task-0048 phase 1, [credits.md](specs/credits.md)): a trailing "(feat. X)", "[feat. X]" or " feat. X" in the title, a feat keyword inside an artist pill ("Kato Feat. Jon") and a trailing "(with X)" move into `featuredArtists` and the new optional `withArtists`, the title is saved without them; one parser (`credit_title.py`, twin `credit-title.js`) and one case table (`credit_title_cases.json`). The Add and Edit form has a With pill field, pasting a title with such a group into the Add form moves it, and the suggestions of one parse are one row with one Apply and one Dismiss. Not deployed; existing songs are untouched until the migration.

## 2026-10-18 (playlist import)

- Web and server: pasting a YouTube playlist link in Add opens an import table (checkbox, title with version, artists, version, year, genres, length, status; "Select all"/"Select none", "N of M selected", "Add N songs"): songs over 5 minutes and songs already in the library are unticked and marked, private and deleted videos are shown as Unavailable, the first 200 videos are listed, and the ticked songs are saved as catalog entries one by one through `POST /songs` (quota respected, progress bar, "Added" marks, summary toast). Metadata comes from YouTube data only, no AcoustID, Discogs, MusicBrainz or Wikipedia calls. New endpoints `POST /import/youtube-playlist` and `POST /import/youtube-playlist/details` (ADD-150 to ADD-158, API-160 to API-162).
- Server: a version word in a trailing title bracket ("(Extended Mix)", "(Slowed)", "(Live from the Royal Albert Hall)", "(2011 Remaster)") becomes the song's version, in the single-link Add and in the playlist import alike; `POST /preview` returns `version_year` (ADD-159).
- Server and web: the playlist import reads details 10 videos per request by 2 workers with short random pauses and stops when YouTube rate-limits; videos YouTube lists without a title or refuses to serve show as Unavailable rows; without a YouTube artist field a title "Artist - Title" gives the artist (API-161, ADD-154, ADD-158).
- Server: yt-dlp is installed as `yt-dlp[default]` (brings `yt-dlp-ejs`); the server needs deno for YouTube challenges ([deploy](tech/deploy.md#deno)).

## 2026-10-18 (song card and labels)

- Web: the credits label "Remixed / mixed by" is now "Remix by" and "Version year" is now "Remix year" in the song form, pill menus and the Theory page; data keys are unchanged.
- Web: the song card has no facts column beside the cover; Country, BPM, Length, one Year fact ("2023 · original 1985") and Remix by sit in one details block under the full-title line, and the separate Remix year and First released lines are gone from the card.
- Web: the song card has a "Copy" button next to the full-title line that copies it to the clipboard and shows "Title copied".

## 2026-10-18 (remaster year)

- Web: a remaster with its own year shows it in the title, "Doctor Doctor (2007 remaster)", and the year line keeps the original year only, "UFO · 1979"; Library sort by Year and Song stats use the original year (LIB-150).

## 2026-10-18 (data model 3)

- Server: countries are `country:` tags on the song again, any number per song; the Artist table, `artists` in `GET /library` and the `/artists` routes are gone (ADR-0031, [task-0049](tasks/task-0049.md)). A startup migration (`migrate_model3`) moves each library to schema 3 and keeps a backup in `backups-model3/`.
- Web: the song form and the tag picker accept several countries.
- Server: new genre dream trance under trance (synonyms dream house, dream dance); anthem trance, epic trance and euphoric trance are synonyms of uplifting trance.

## 2026-10-18 (genres map and dock)

- Web: Genres map is now the new radial map; Genres map rework is gone from the menu and its old link redirects.
- Web: choosing a genre in the Genres map outline selects it on the map but does not open the infobox; a click on a circle does.
- Web: the Genres map has one side panel with the genre details inside the Outline.
- Web: the Genres map legend has a title and is hidden until you press Show legend.
- Web: the Genres map has a Now playing button that finds the playing song's genre.
- Web: the Electronic circle on the Genres map uses the Electronic colour.
- Web: Show N songs in Library on the Genres map also includes songs tagged with the genre itself.
- Web: the Genres map and genre suggestions call every level a genre.
- Web: the mini-player has a compact mode, a pill with Play/Pause, Next and volume, switched by the handle on its left edge.
- Web: the sidebar collapse chevron sits between the brand and the first menu item.

## 2026-10-18 (web polish)

- Web: the Library filter sheet applies at once; there is no Show N songs button.
- Web: the song card has a round Play next button instead of Play now, and the line under the cover shows the full title.
- Web: the Library toolbar has Show playing and Clear filters.
- Web: the mini-player title and the Now playing queue rows open the song card.
- Web: the menu item Playback is now called Now playing.
- Web: the Genres map, Genres map rework and Song stats screens have the standard page head, and the ELECTROPHONE line is hidden from 720px up.
- Web: the genre maps no longer draw dashed also-under cross-link lines.
- Web: the first visualizer open no longer silences playback.

## 2026-10-17 (built, not deployed)

- Docs only: decision DR (ADR-0036, [task-0048](tasks/task-0048.md)): featured artists become credits (Featuring / With roles), never part of the stored title, and a per-user Settings option "Credit display" chooses the shape, Apple / YouTube (default) `A & B - Title (feat. C) [Version]` or Spotify / MusicBrainz `A & B feat. C - Title [Version]`; spec [credits.md](specs/credits.md) (CRD-001 to CRD-054, WEB-104, DATA-162, DATA-163, API-148), title parsing on import and a one-time migration planned; nothing built.
- iOS: removing the playing song from the queue now pauses and cues the neighbouring song instead of leaving the old one playing; songs cued after a restart or tag add now advance to the next song when they end.
- Mac: native macOS app `ElectrophoneMac` (task-0047, ADR-0029): sign-in, Library, Playback with a transport bar and media keys, Add and Edit, Settings; it streams from the server and never downloads audio to the Mac. Builds; not tested with a real account, no signing team or icon yet; the visualizer, share link and song info are not built.

- Mac: Playlists (placeholder), Genres map, Song stats and Music theory pages in the web's sidebar order, plus a visualizer (Mirrored spectrum, Ring) driven by an `MTAudioProcessingTap` (V, M, Esc, dock key). `ios/project.yml` now declares explicit `AudioPlayer` and `ElectrophoneMac` schemes. Builds; not seen on a real UI, and the tap on the real server stream is unverified (needs Range support on `/files`).

- Web: Library search is built by one helper (`web/js/search-text.js`) that finds songs by version artists (`of`, `by`), also under the v2 names (`originalArtists`, `artists`), and by version name (LIB-141, LIB-151).
- Server: the sync timer rebases the server's unpushed commits over commits another app (`moodtracker`) pushed outside `audioplayer/` instead of stopping with "data diverged", then pushes; real overlaps in `audioplayer/` stay an error; `GIT_SYNC_REBASE_FOREIGN=0` and `GIT_SYNC_OWNED_PREFIXES` (ADR-0028, NFR-120, STO-061, STO-062, API-144); not deployed.
- iOS, not built or run: removed the nested ternary in the Library row accessibility state and gave the empty artwork `CancellationError` catch a body, no behaviour change (SonarCloud swift:S3358, swift:S108, [task-0046](tasks/task-0046.md)).
- Server, web and ops: the owner sees which build runs: `GET /health` owner form gains `build: {sha, committed_at, deployed_at}` and the sidebar (under "Server online") and Settings > Library show "Build 68df2bf · deployed 2026-10-17 14:05" in local time; `scripts/deploy.sh` writes a git-ignored `BUILD` file after the pull, best effort, else the server uses git and its start time (API-145, NFR-119, WEB-102); not deployed.
- Server and web: `french house` is a reviewed genre again (Electronic, under house, task DQ1) and `french touch` is an alias of it instead of a fold to house; the startup migration rewrites stored `french touch` to `french house` and leaves stored `french house` alone; not deployed.

## 2026-10-17 (YouTube genres and release tags, not deployed)

- Server and web: the git sync timer also fast-forwards data fixed in GitHub (or pushed from another clone) onto the server within 60 s, under a shared write lock, with invalid JSON refused and a diverged repo shown as a sync error; `GIT_SYNC_INBOUND=0` turns it off (ADR-0027, STO-057 to STO-060, NFR-118, API-144, WEB-101); not deployed.

- Server and web: staying signed in across deploys: the boot session check retries while the server restarts (WEB-100) and `GET /auth/me` renews a session cookie past half its life (API-143); not deployed.
- Web: Library is now the first navigation item, followed by Now playing and Playlists, in the side rail, icon rail and phone tab bar; it stays the default landing page (WEB-012); not deployed.
- Web: fix in Add, typing in the Tags field turned every letter into its own chip (the live title preview read the form with `values()`, which committed the Tags text on each keystroke, LIB-055); text now stays in the input until Enter, comma or Save; not deployed.
- Server and web: saving a new web song takes about 1 s instead of 3 to 5: the link lookup Fetch already did is reused (API-142) and the web patches the saved song into its list instead of reloading the library (ADD-134); not deployed.

- Server and web: a reversed YouTube title "In The End [Mellen Gi Remix] feat. Fleurie - Tommee Profitt" is read title first, so Add fills Title, Artists, Featuring and the remixer correctly instead of swapping title and artist (ADD-135); not deployed.
- Web: Library is now the first navigation item, followed by Now playing and Playlists, in the side rail, icon rail and phone tab bar; it stays the default landing page (WEB-012); not deployed.
- Server and web: genre "Soviet Wave" (a synthwave subgenre, not in Discogs; aliases sovietwave, soviet-wave, Russian "советская волна"), level 3 under synthwave; not deployed.
- Server and web: "A - T (X Cover)" titles (Pharrell Williams - Happy (EFIX & ALLISON Cover)) suggest performer and original from evidence or offer both readings (ADD-133); not deployed.
- Server and web: for a song with a version the original recording's genres from MusicBrainz, Discogs and Wikipedia are no longer applied, they are listed as "From the original (not applied)" (`original_genres`, TAG-096), and the preview never links the remixer's Wikipedia page as the artist (TAG-097); not deployed.
- Web: a song whose version has a year shows that year, not the original one, in the Library row, the song card, the dock and Now playing, the Media Session, Library sort by Year and Song stats; the card facts show "2012 · original 1985" when they differ; falls back to the original year; one helper in `credits.js` (LIB-150, not deployed).
- Web: the Library title of a song without audio shows the pointing-finger cursor like the others, since it opens the song card too (not deployed).
- Server and web: genres from YouTube tags, categories and hashtags (TAG-095, `youtube_genres` and `tag_sources` on `/preview`), and "(... Release)" label tags are dropped from titles and a "Cover Release" suggests a cover with no original artist (ADD-131); "(mashup by X)" titles suggest X as the artist and the artists before the dash as the mashup sources (ADD-132).

- Web: the Library row title button's keyboard focus ring is drawn inside the button, so the row's `overflow: hidden` info block no longer clips it to the right and bottom edges (not deployed).
## 2026-10-17 (data model v2, built, not deployed)

- Server: songs are stored as `mainArtists`, `featuredArtists`, `releaseYear`, `albums`, `version {type, name, artists, releaseYear, originalArtists}`, `rawTitle` and `sources {platform, url}` (DATA-156); decade is computed at runtime, `lang:` tags are gone, `country:` tags moved to a per-user Artist table (`GET /artists`, `PATCH /artists/{name}`). `artist`, `remixer`, `remix_year`, `year`, `album` and `tags` stay derived in every response, so iOS is unchanged; old and flat names are still accepted on input for one release. New one-time migration `app.migrate_model2` (dry run, derived-field check that aborts on any difference, backup, review file) replaces `migrate_credits`; runbook in deploy.md.
- Web: reads and sends the v2 names, decade chips and filters computed from `releaseYear`.
- Server and web: the decade (Years filter, chips, `decade:` in the tags view) follows the displayed year, the version year when there is one (DATA-161).
- Server: genres are stored bare in `genres[]` (no `genre:` prefix); `tags[]` is kept only for other leftovers; responses derive the prefixed `tags` view for iOS; `PATCH`/`POST` accept `genres` or legacy prefixed `tags`; the web edit dialog sends `genres`.
- Server: changing country tags on a song with several main artists is refused with 422 (DATA-160); the edit dialog shows the message inline.

## 2026-10-16 (button shape audit, not deployed)

- Web: WEB-099 applied app-wide: Library row Download and Add to playlist and the Edit dialog Download are round icon buttons (44px), and the Song stats selection bar has a round Add to playlist icon and a dock-style Play key.

## 2026-10-16 (song card: dock-style action keys, Share and playlist keys, not deployed)

- Web: the song card action row is one wrapping row: "Play now" as a dock-style key (no Play/Pause toggle), then Share link, Download, Edit and Add to / Remove from playlist as round icon buttons; rule recorded as WEB-099 (rect keys for playback, round buttons for metadata) (LIB-149).

## 2026-10-16 (Library: long artist line no longer overlaps columns, not deployed)

- Web: in the Library table the Track cell shrinks and clips; the Artist and Year line wraps to 2 lines with an ellipsis and carries a full-text tooltip (LIB-148).

## 2026-10-16 (Add: fetch progress checklist, not deployed)

- Web and server: pressing Fetch in Add now shows the real steps (reading the link, title and artist, genres and first release, Wikipedia and Wikidata, Discogs) as a checklist with the current step, an aria-live line and elapsed seconds, and the failing step on error (ADD-129); new `POST /preview/stream` sends NDJSON step events and the same result as `POST /preview`, which is unchanged for iOS (API-140). Measured on a cold lookup: yt-dlp about 2 s, MusicBrainz about 10 s, Wikipedia and Wikidata about 6 s, Discogs under 1 s.

## 2026-10-16 (Music theory: composition metadata anatomy, not deployed)

- Web: the Music theory page gains an interactive "Composition metadata anatomy" section (WEB-098): pick an example title (plain, feat., remix, cover, mashup, live, acoustic, extended, instrumental, remaster, edit), see its parts annotated, the field table and the stored JSON; data in `web/data/theory-anatomy.json`.

## 2026-10-16 (git sync: per-save local commit, timer pushes, built, not deployed)

- Server, web and ops: a save writes atomically and commits locally, with no pull and no push in the request (NFR-111); `audioplayer-gitsync.timer` (60 s) runs `python -m app.gitsync`, which only pushes repos with unpushed commits; a rejected push stops that repo and is `error`, never merged (ADR-0026, STO-054 to STO-056). `/health` `sync` is now an object with `ok|pending|stale|error`, counts, ages and a timer heartbeat for the owner and only `ok|degraded` for everyone else (API-137); Settings shows a mark on the sync card and a dot on the nav item while `stale` or `error`. `GIT_SYNC_MODE=request` keeps the old path for one release. Units in `deploy/systemd/`, check with `scripts/check-gitsync.sh`; root must install the timer before the state returns to `ok` ([deploy.md](tech/deploy.md#git-sync-timer)). Fixes: cover downloads are staged outside the repo and written atomically under the git lock, a failed save removes only the files its own transaction created, and `scripts/check-domain.sh` accepts the object form of the guest `/health` (`degraded` is a warning).

## 2026-10-16 (documentation: data model v2 and the versions concept)

- Docs: ADR-0025 records data model v2 (final names, the version block with `type`, `originalArtists` for cover and mashup only, the Artist table, runtime decade, DDEX adopted only for the display-artist role names and `version.type`, full DDEX and a Work/chain model deferred); new concept note [concept-songs-versions-and-credits](product/concept-songs-versions-and-credits.md); [ddex-terminology](tech/ddex-terminology.md) and task-0043 added. ADR-0026 plans per-save local commits with a systemd timer that only pushes, plus a Settings warning mark when pushes lag (amends ADR-0005; task-0021, NFR-111 to NFR-114, WEB-094, deploy.md and architecture.md updated; see the git sync entry above). The changelog sections below are marked deployed or not deployed according to production at `c813d92`.

## 2026-10-16 (mashup version kind, built, not deployed)

- Web and server: decision BJ1 - a mashup is a version of kind `mashup`; the makers are the main artists and the sources go in `version.of`, now a list of names (a single string is accepted and normalised, also for stored legacy values). Display `Maker A & Maker B - Title (mashup)`, details "Mashup of S1, S2". The form has the Mashup option and a context-aware "Cover of" / "Mashup of" pill field; the suggestion reads a trailing "(mashup)" and only suggests (makers unknown, sources only from an explicit x or vs). Rules DATA-140, DATA-141, ADD-127, ADD-128, LIB-147, API-136.

## 2026-10-16 (cover suggestion rule, built, not deployed)

- Web and server: the "Suggested split" reads a title parenthetical ending in "Cover" as a cover of the original artist ("Cover of Gnarls Barkley") or, when the name is a credited artist, as the performer ("Cover performed by Sofia Karlberg"); ambiguous without artists; suggestion only (ADD-126); the migration review file carries `of` or `performer`.

## 2026-10-16 (dock Visualizer split button, no background visualizer, deployed)

- Web: the dock Visualizer button is a split button: the icon part opens the full-screen visualizer (same as the Now playing button), the chevron part opens the mode menu; the dock foot row is 44 px high so the button no longer overhangs the dock (PLY-148). The background visualizer and the Settings switch "Visualizer background" are removed (VIZ-020); the visualizer and its settings panel (new gear button) exist only in full screen. Deployed (the dock key below replaces the split button).

## 2026-10-16 (dock Visualizer key, built, not deployed)

- Web: the dock Visualizer button is now a plain square key like Previous and Next, placed left of Shuffle; no pill, chevron or mode dropdown in the dock (the mode is chosen inside the full-screen window); the dock foot row is back to 28 px (PLY-148). Built, not deployed.
- Web: the Visualizer button is removed from the Now playing action row; the dock Visualizer key (left of Shuffle) and the key V are the only entries (PLY-148, VIZ-021). Built, not deployed.

## 2026-10-16 (song card without Decade, deployed)

- Web: the song card no longer shows the Decade row (the exact year is already shown); the `decade:` tag stays everywhere else (LIB-146). Deployed.

## 2026-10-16 (Now playing cover button centred, deployed)

- Web: the play/pause circle on the Now playing cover sits exactly in the middle of the cover (it was about 44% down, above the title scrim); PLY-016. Deployed.

## 2026-10-16 (Music theory page, deployed)

- Web: new "Music theory" navigation item (`#/theory`, after Song stats, open-book icon) with a read-only list of terms and brief descriptions from `web/data/theory-terms.json`; for now British Invasion, Drum machine and Syncopation (WEB-093). Deployed.

## 2026-10-16 (structured credits and versions, deployed)
- Fix: a legacy value that fails validation is kept in `raw.rejected` instead of being dropped; a version marker is no longer hidden by a title word that merely contains it (Recovery, Alive); the deploy runbook warns against rolling code back across the credits migration.

- Server: songs now store `artists`, `featured`, `released`, an optional `version {kind, name, by, year, of}` and an immutable `raw`; `artist`, `remixer`, `year` and `remix_year` are derived in every response and still accepted in requests, so the iOS app is unchanged (DATA-127 to DATA-139, API-120 to API-135, IOS-072 to IOS-074, ADR-0024, [design](tech/metadata-model-design.md)).
- Server: an idempotent startup migration converts old songs without splitting any credit, with a backup in `backups-credits/` and a review file of songs worth a look; `/preview` adds `raw`, `suggested_credits` and `released_suggestion`; `released` no longer falls back to the upload date (DATA-126); a song with a version never gets a MusicBrainz or Discogs link.
- Web: the Add and Edit form has Artists, Featuring, First released, Version (kind, name, year, remixed / mixed by, cover of) and a Suggested split with Apply and Dismiss; the library, Now playing, share page, stats and the Media Session show one display line from the structure (ADD-111/112, LIB-134). Dry run on a copy of the live library: 201 songs, every derived artist, remixer, year and remix_year equal to the original, 63 songs listed for review. iOS needs no change; deployed.

## 2026-10-16 (Now playing uses the standard dock, deployed)

- Web: Playback is now the first navigation item, followed by Playlists and Library, in the side rail, icon rail and phone tab bar; the default landing page stays Library (WEB-012). Deployed.
- Web: song card actions are icon buttons (Play/Pause, Download, Edit) with the Close link at the top right; "Add to playlist" stays text (LIB-146). Deployed.
- Web: the song card shows the title and the "Artist · Year" line over the bottom of the cover (Now playing scrim), clamped to 2 lines, plain text below when there is no cover (LIB-146). Deployed.
- Web: Now playing no longer has its own progress bar, times, transport tray and volume row; the standard mini-player dock now shows there too (it was hidden by a CSS rule) with the same seek, times, volume and toggles (PLY-146). The full-screen visualizer still hides it and uses its own overlay. The round thumbs of the seek and volume sliders get a 1px accent border like the selected Shuffle / Repeat buttons (PLY-147).
- Web: the Visualizer mode dropdown moved from the Now playing page into the dock (PLY-148, VIZ-044): icon only, in the dock's second row after the volume (in the main row below 480 px), popup opens upward and is no longer clipped; the full-screen Visualizer button stays on Now playing. Deployed.

## 2026-10-16 (psytrance branch, deployed)

- Server and web data: `psytrance` is now a level 2 umbrella beside `trance` with level 3 children dark, forest, progressive and full-on psytrance (new, not in Discogs, approved), goa trance and psybient (GEN-056); trance no longer lists them. The three-level cap is unchanged.

## 2026-10-16 (remix year suggestion, deployed)

- Web and server: with a "Remix & additional production" value and an empty Remix year, the Add and Edit form suggests the YouTube or SoundCloud publish year (dashed, italic; a typed value is never touched, clearing the remix removes the suggestion); `POST /preview` and `POST /metadata` gain `published_year`, `POST /metadata` an optional `remix_year` hook (ADD-111, API-048).

## 2026-10-16 (Wikipedia link search, deployed)

- Server and web: "Get metadata" and the Add preview found no Wikipedia links for "What Is Love" by Haddaway because they came only from MusicBrainz relations (that recording has none, and its best release is a compilation), and `POST /metadata` returned only the album link, never the song or band link. Now a verified English Wikipedia search fills missing song, band and album links (TAG-087; infobox must match the artist, disambiguation pages never qualify), `/metadata` returns `wikipedia_song` and `wikipedia_artist`, and the web fills empty link fields from them (ADD-050); the found song page also corrects the year (1993 instead of 2002). iOS not changed.

## 2026-10-16 (Genres map rework page, deployed)

- Web: new sidebar item "Genres map rework" (`#/genres-rework`, WEB-084) after "Genres map", with a drawn radial map of the Electronic genre tree (WEB-085 to WEB-087, GEN-051 to GEN-054, API-119, [task-0037](tasks/task-0037.md)): 15 umbrellas around the genre, their children fanning out, node size by songs in your library, a dashed ring for styles not in Discogs, dashed also-under links, pan and zoom, hover tooltips, details panel, and an outline list with search over names and synonyms. Server: `GET /genres/vocabulary` now carries `levels` and `genre_synonyms` from `server/data/genre_levels.json`. By default only styles with songs and their ancestors are drawn; "Show whole vocabulary" (remembered) adds the rest, empty standalone styles as dim dots on an outer arc, and also-under lines show only for the selected or hovered node. Fixed the map drag sticking to the pointer (drag now ends on pointer cancel, lost capture, blur or a move without a button; same guard added to the Genres map). Review badges (Alex approved, never on Discogs styles; Under question), flavour chips and filters (dim, not remove), status filter and display names (WEB-088). Outline rows get unique keys; map labels hide when they do not fit, in priority order, with no leader lines or nudging (selected, hovered and searched nodes always labelled). Umbrellas in two genres (disco) show in both trees with an "also in" chip. Not checked in a browser; the data placements await Alex.

- Server: Alex's genre decisions (TAG-086, GEN-055, deployed; the deploy migration rewrites the owner's tags, 65 songs): 20 Electronic styles removed and folded through ALIASES (dance, electronic dance, electronica, chillout, electropop, french house, melodic house and others), `liquid drum and bass` added, `club` and `club music` fold into electronic instead of being dropped, `status` (approved, under question; Discogs outranks approval), `flavours` (block defined and served, not attached to any style yet, proposal in docs/tech/genre-flavours-proposal.md) and `display` fields in `genre_levels.json`, all served in the vocabulary payload.

## 2026-10-16 (wrong genre folds fixed, deployed)

- Server: BA2 corrections to the genre fold: `rave` now folds to electronic, `breakbeat hardcore` to breakbeat, `raggacore` is dropped (TAG-073, TAG-085). `migrate_tags.ONE_OFF` removes the artist-level noise tags from SNAP! "Rhythm Is A Dancer" (hardcore), Кар-мэн "Лондон, гудбай" (hardcore, dubstep, techno) and marshmello "WaVeZ" (hip hop, pop punk, hardstyle); backup in `backups-genre-merge`, idempotent, owner only.

## 2026-10-16 (leftover genre tags, deployed)

- Server: junk genre tags dropped for good (aaron smith, joris, skrux, medley, music video, party, popcorn, functional music, event music, party music, west coast swing), `⚈⚈` retagged to glitch hop, and `west coast swing` is no longer retagged to swing (TAG-085, [task-0035](tasks/task-0035.md)). A one-off table in the startup migration fixes the 5 affected songs (MIKA loses swing; Point Point, Air France, If You and Memory Reboot get a genre); backup in `backups-genre-merge`, idempotent.

## 2026-10-16 (web style overhaul, deployed)

- Design system: the Electrophone artifact (version 26) gains token families chart, stroke, state, motion, elevation, overlay, icon and control, `radius-xs`, `space-5`, `power-text`, two type styles, 15 web components (Icon, SearchField, SortControl, Toggle, Slider, Dialog, Sheet, Toast, Menu, TokenPill, Banner, StatCard, GenreMap, VisualizerChrome, SignIn) and a 45-icon Lucide and Simple Icons set; `docs/brand/tokens.json` is byte-identical to the artifact copy.
- Tooling: `scripts/sync-design-system.py` emits a `[data-theme="dark"]` scope, `--font-*` shorthand variables and the new families, rejects unknown arguments and has `--check`; the iOS file only gained lines.
- Web: the read-only banner is a quiet surface card, floating slabs use one `shadow-float` recipe, copper is a rim on covers only, hover, pressed, focus, disabled, motion and reduced motion come from tokens, radii, heights, type and z-index use tokens, nav icons are generated from `icons.js`.
- Web: the visualizer chrome is retokenised under an always-dark scope, Stats and Genres share the panel recipe and read `--chart-N`, chart tops no longer sit under the header card, the stale `--hairline`, `--text-muted` and `--gf-N` references are gone.
- Web fixes: tab labels wrap at 399px, the focus ring follows the rounded input well, genres no longer clip mid-letter, the download ring fits three digits, the marquee padding matches its token.
- Not done: Step 3 icon swaps, Step 4 brand mark and assets, toast exit motion and toast layering above the full visualizer, merging the Genres and Stats button families, the Screens board re-wire.

## 2026-10-16 (sixth batch, deployed)

- Server: canonical genre vocabulary (ADR-0023, [task-0035](tasks/task-0035.md) phases 1 and 2, TAG-077 to TAG-084, API-117, API-118): `server/data/genre_styles.json` (512 Discogs styles under the 15 genres, each checked against the public Discogs search) and `server/data/genre_extras.json` (65 reviewed extras with family and parent: the kept subgenres of TAG-076 and the reviewed library tags), loaded once at start with validator tests (`test_genre_vocabulary.py`); `genre_families.json` is retired and families come from the new files.
- Server: strict genre writes: `POST /songs` and `PATCH /songs/{id}` answer 422 `unknown_genre` with up to 5 "did you mean" names for a `genre:` value outside the vocabulary (after aliases and retags; a tag the song already carries still passes); suggestions from `/preview`, `/metadata`, `/lookup/wikipedia`, identify, yt-dlp and the metadata backfill silently drop values outside the list; new `GET /genres/vocabulary` (canonical list with family and genre or style level, built once, guests may read it) and `GET /genres` offers only canonical names.
- Server: the startup migration keeps tags it cannot map and writes them with song counts and sample ids to `backups-genre-merge/review-<uid>.json` (outside the git-synced tree, rewritten only when it changes, logged); `GET /genres/graph` nodes carry `style`, the Discogs style or extras entry they hang on (nearest ancestor when the node is not one), ready for the hybrid outline.
- Web: genre picker (TAG-080, [task-0035](tasks/task-0035.md) phase 3): the Genres field of the song form (Add and Edit) autocompletes over `GET /genres/vocabulary` with the family colour dot and the style or genre level; no free text (unknown text stays and offers "did you mean" chips); aliases, spelling variants and a trailing " music" resolve to the canonical name (the endpoint now also serves `aliases`); the Tags editor refuses a typed `genre:` tag; a 422 `unknown_genre` on save keeps the form open with the server's suggestions.
- Web: hybrid Genres outline (GEN-046 to GEN-050): family, then Discogs style, then Wikidata subgenres below it (Electronic > Trance > Festival trance), the Wikidata umbrella chain never shown; nodes without a style fall back to the GEN-036 skip logic; counts, "also under" notes, Orphans, Now playing and the map's ancestor chain unchanged. Not checked in a browser. Discogs-style "also under" family links are not built.

## 2026-10-16 (fifth batch, deployed)

- Server: genre cleanup (TAG-071, TAG-073, TAG-075, TAG-076, GEN-039): new aliases (dnb, drum & bass, drum n bass to drum and bass; edm to electronic dance; euro pop to europop; eurohouse to euro house; electronic pop to electropop; festival progressive house, festival trap and red disco to their parent), a new retag table (appalachian folk and bard to folk, west coast swing to swing, romantic to classical, psychedelic to psychedelic rock, nederpop to pop, orchestral to modern classical, alternative to alternative rock, indie to indie rock, progressive to progressive house when the song has an electronic tag else progressive rock), more junk dropped (popular, underground, club, cyberpunk); dystopian is retagged to darksynth (no established "dystopian synthwave" genre), real subgenres kept with a family entry, nu-nrg and uplifting trance get a hard trance and trance parent (neurofunk, liquid funk, techstep, melodic techno, darksynth, psybient, estrada, epic, trailer and others), disco now Funk / Soul, new wave Rock, acid jazz Jazz; `GET /genres` no longer offers built-in names that would be rewritten on save; the migration reruns at the next start (backup in `backups-genre-merge`, idempotent).

## 2026-10-16 (fourth batch, deployed)

- Genres map: families are now the 15 Discogs genres plus Other (ADR-0021, GEN-037 to GEN-042, task-0033): a reviewed table `server/data/genre_families.json` (explicit label to family), then the song-weighted majority of the parents, then the umbrella rule, then Other; the keyword family map is removed; outline and legend follow the fixed Discogs order and hide empty families; 99.8% of the live library's songs get a family.
- Genres map: a reviewed manual parent table (`server/app/data/genre_parents.json`, GEN-045) links orphans (pop punk, dance pop, synth-rock, dreamsynth, sunshine house); edges carry `origin: manual`; entries with a missing node or a cycle are skipped.
- Server: vague/non-genre tags progressive music, underground music, dystopian music, comedy music, comedy, novelty music, novelty song and novelty are dropped for good (TAG-073); the migration removes them at the next start (backup in `backups-genre-merge`).

## 2026-10-16 (deployed)

- Web: the Wikipedia button on the genre card and in Now playing uses the same serif W icon as the song form Links (one definition in `service-icons.js`; the thin line glyph is gone).
- Web: the Genres outline also skips umbrella categories without own songs such as "regional music", "national music", "traditional music", "folk music by ..." and "music genre(s) by ..."; their children reattach to the nearest real ancestor or form their own family (GEN-036).
- Web: Genres map shows the whole ancestor chain of a selected genre (and of Now playing genres), fading with distance, fit to view, plus an arrow-direction line in the Legend (GEN-043, GEN-044).
- Web: new Playlists menu item (list icon) between Library and Playback in the side rail, icon rail and phone tab bar, route `#/playlists` with a placeholder "Playlists are coming soon."; the phone tab bar fits six items with 11px labels and tighter gaps (WEB-012).
- Docs: planned: Playlists (new top-level menu item: folders and playlists, import from YouTube, SoundCloud and Spotify links and from M3U8/CSV/JSON files, export, Refresh, guest view; spec [playlists.md](specs/playlists.md) PLS-001 to PLS-092, ADR-0022, [task-0034](tasks/task-0034.md)); nothing built.
- Web: Settings has two more bulk cards under BPM detection: "Metadata for downloaded songs" (server job `/me/backfill/metadata`, fills only empty fields, N of M, cancel, summary; API-115, API-116) and "Download all songs" (queue in the browser, confirm step with the hourly limit, skips songs over 5 minutes unless included, stops after 3 failures, copy-able failed list; WEB-081 to WEB-083).
- Docs: Connect YouTube decided (task-0032, ADR-0020 accepted): owner only first, Production unverified consent, songs plus a refreshable Electrophone playlist per imported list; all users (Google verification) stays future; cap value (CZ) still open; nothing built.
- Web: Settings is two columns (Account, Library and BPM on the left; Playback and Visualizer on the right; one column on phones) with one row pattern (label and short hint left, control right); selects are 14rem wide so values are not cut off (full width under the label on phones), and Sign out never wraps (WEB-080).
- Web: the song card header reads as three lines: title (remix once), "Artist · Year" and the album on its own muted line (omitted when empty); long names wrap (LIB-120).
- Web: Settings in the navigation uses a cog (eight-tooth gear outline with a centre circle) instead of the sun-like icon, in the side rail, icon rail and phone tab bar (WEB-012).
- Web: the progress, volume and visualizer sliders always show a few pixels of accent fill past the thumb, even at the start or near-zero volume (`--fill-min`); pressed, lit and expanded controls show a single ring when focused (the box-shadow ring is dropped in favour of the focus outline), which removes the double outline on the Genres map toolbar pills.
- Docs: planned: genre families follow Discogs (spec GEN-037 to GEN-042, ADR-0021, [task-0033](tasks/task-0033.md)); nothing built.
- Genres map: the outline skips Wikidata classification categories with no songs of their own (ethnic music, music of ..., ... diaspora, world music, by genre and similar); their children move up to the next real ancestor, so urban contemporary sits under popular music (GEN-036).
- Genres map: the genre card has a small W icon after the title that opens the English Wikipedia article (the Wikidata `enwiki` sitelink; dimmed icon to Wikidata when there is no article, none when no item); the Parents section and the bottom Wikidata text link are removed (GEN-014, GEN-035); `/genres/graph` nodes carry `wikipedia`; entities cached before this are refetched lazily.
- Genres map: a root left in Other takes the family of its children when one family covers at least half its songs, so "popular music" sits under Pop (GEN-034).
- Server: orphan genre tags cleaned (TAG-073, TAG-074): new aliases (euroda, deep progressive, mor, retro-synth, hip-hop & rap, russian electropop and others), junk tags dropped for good (mkj, deb, stadiumx, sam smith, dancin, relaxed, love song), and a leading demonym or language word (russian pop, british blues, dutch house) becomes `country:`/`lang:` tags with the bare genre; `uk garage`, `french house` and similar are kept. `migrate_tags` reruns at the next start (backup in `backups-genre-merge`, idempotent).
- Web: Genres map has an Orphans button (next to Legend and Now playing) that selects every genre with no connections and lists them with song counts; exclusive with Now playing; toolbar widened to 456px (GEN-032, GEN-033).
- Server and web: the YouTube, SoundCloud and Spotify fields of the song form's Links region are editable. New optional `spotify_url` (validated, in guest view and catalog); `PATCH /songs/{id}` accepts `youtube_url` and `soundcloud_url` (validated, 422 on a bad link or when clearing the song's own source link; audio and id untouched; the next Download uses the edited link) (DATA-072, DATA-073, API-114, WEB-075).
- Docs: the second `VIZ-100` (Mirrored spectrum pixel and LED settings) is renumbered `VIZ-106`, fixing the duplicate rule ID.
- Web: Playback queue card fills the rest of the screen width (player column stays at most 420px; 1100px cap removed on this page; stacked below 900px).
- Docs: planned: a 5-minute cap on long videos: playlist import marks them 'Long (1:02:10)', unchecks them and asks 'Import N long videos anyway?' (YTC-051 to YTC-053, task-0032 CZ); Download of a long song asks first (ADD-081); nothing built.
- Docs: planned: spec and task for Connect YouTube (Google OAuth, import playlists and Liked videos as catalog songs without audio): [youtube-connect.md](specs/youtube-connect.md) (YTC-001 to YTC-050), [task-0032](tasks/task-0032.md), ADR-0020 proposed; nothing built.
- Web: the song form's source icons became an expandable "Links" region (collapsed by default, state remembered) with one labelled field per source (YouTube, SoundCloud, Wikipedia song/band/album, Spotify, MusicBrainz, Discogs; icon opens the link when filled, dim when empty); "Get metadata" and "Identify from audio" moved to its right.
- Web and server: a song's cover can be changed in the Edit dialog (Change cover: Upload file, From address, Remove cover); `PUT /songs/{id}/cover`, `POST /songs/{id}/cover/from-url` (SSRF-safe) and `DELETE /songs/{id}/cover`; images are re-encoded as JPEG up to 1024 px, songs get `cover_v` for cache busting; needs Pillow (`server/requirements.txt`) on deploy; the iOS app does not offer it yet (API-097, API-098, LIB-133, WEB-071, PLY-141).
- Web: Now playing has a round Wikipedia (W) button in the action row after the service links, opening the song's article ("Song on Wikipedia"), else the album's ("Album on Wikipedia"), else the artist's ("Artist on Wikipedia"), else no button; the two Wikipedia text links under the BPM are removed (PLY-015, PLY-072).
- Server and web: a song has an optional `wikipedia_album` link (the album's Wikipedia article) next to the song and band links: stored, validated, in the guest view, sent by Add/Edit, filled by Preview, Get metadata and Identify from the MusicBrainz release group; the iOS app ignores it for now (DATA-071, API-113, TAG-072).
- Web: the song info card cover is now the same size as the Now playing cover (up to 420px square, centred) instead of the full dialog width.
- Web: Now playing drops the dial and "7%" readout; its volume row is now the standard control from the visualizer overlay (speaker mute button plus slider, same saved volume).
- Web: the Genres map header is wider (340px to 384px) so the title, Legend and Now playing button sit on one row on desktop; at phone width it still wraps.
- Web: the Library BPM badge now sits at the start of the Genres column, before the genre text, in a fixed-width slot (empty spacer when a song has no BPM) so genre text stays aligned.
- Web: the mini-player target button is removed; clicking the song title on the Library page now scrolls to and highlights the playing row (no song card), and still opens Playback from other pages.
- Server: duplicate genre tags are merged permanently (owner request): `clean_tag` canonicalises `genre:` values on write and load (trailing " music" stripped, `electronic dance music` and `punk rock` aliased, duplicates collapsed), the Genres map resolves a bare tag to its "X music" Wikidata item so merged nodes keep their edges, and a startup migration rewrites every user library once, backing each up to `backups-genre-merge/<uid>/library.json` outside the synced tree (TAG-071, GEN-031).
- Web: Genres map panel, the collapse chevron glyph now shares the left edge of the Legend and Now playing buttons and the Find a genre input (it sat about 9px right of them because of the centred 44px hit box; the hit area is now 36px with negative margins) (GEN-027).

## 2026-10-15 (deployed 2026-10-16)

- Web: removed the "Add to current playlist" (list with check) button from the mini-player (owner request); the Library row toggle, the song card and the Playback queue stay the ways to manage the queue (PLY-118, PLY-119).
- Web: removed the "Source" text link from the Now playing details (owner request: it is among the action buttons); a source on another host than YouTube or SoundCloud keeps a generic round "Open source" link button in the action row; Wikipedia links stay (PLY-011, PLY-015, PLY-072).
- Web: mini-player below 480px: gaps and padding reduced by 4px and the cover is 56px below 400px, giving the title block about 91px at 375px (27% of the bar, was 67px / 20%) and 77px at 360px (24%, was 52px / 16%); the 35% goal is not met without removing another control (PLY-070).
- Web: removed the pencil (Edit details) button from the mini-player (owner request); the target button (Show in list) now also opens the song card of the playing song, whose Edit button reaches the Edit dialog (PLY-118, PLY-072).
- Web: the Song stats panel and the Genres map toolbar and info cards are collapsible (owner request): a 44px chevron in the title row hides the controls, notes, legend and search; the stats pill and the Legend and Now playing buttons stay; state saved per panel (`ap2.panel.stats`, `ap2.panel.genres`, `ap2.panel.genreInfo`), collapsed by default on first visit below 480px, animated unless reduced motion (STA-024, GEN-027).
- Web: the mini-player cover thumbnail is 1.5x larger (owner request): `--mini-cover-size` 66px (was 44px), corner radius 1.5x, overlay circle 42px (was 28px, icon 27px); from 480px the cover spans both rows (title and artist row, time and seek row) and the bar keeps 92px; below 480px the bar is 82px high (was 64px) and the space reserved under pages (`--mini-h`) grows to 90px (was 72px) (PLY-016, PLY-070).
- Web: the shuffle icon is redrawn as the classic two crossing arrows (owner image): two rounded 2 px strokes that cross once near the centre with a small over/under gap, arrowheads pointing right at the top right and bottom right; same name, size and style as the other icons.
- Web: Library and Now playing cover thumbnails are 1.5x larger (owner request): Library rows `--row-cover-size` 60px (was 40px) in the table and 84px capped at 25% of the width (was 56px) on the phone, queue rows `--queue-cover-size` 60px (was 40px); corner radius and the play/pause overlay circle scale with them (42px / 36px), Library rows are 76px high from 720px; the mini-player and the Playback cover are unchanged.
- Web: fixed clicking a Library row doing nothing (owner bug): opening the song card threw `actionButtons(...).indexOf is not a function` because the SonarCloud cleanup left DOM NodeLists where arrays were expected (`indexOf` in the card repaint, `find` in focus return); both now spread the NodeList into an array; the test DOM shim returned arrays and hid it, so a new test uses real NodeList-like results (LIB-120).

- Web: the Library row's BPM badge moved from the Track title line into the Genres cell, after the genre text (owner request; genre text shrinks and clamps, the badge keeps its size; shown from 900px with the Genres column, absent without BPM; LIB-019, LIB-010, LIB-110).
- Web: Library filters (owner request): Genres, Years and Countries sheets get a system "not set" entry first (count of songs with no value; italic, dashed icon; combines like any value; never a real tag) to find songs with a missing genre, year or country (LIB-132).
- Web: Genres map, Now playing now selects all genres of the playing song at once (owner request): the whole constellation (selected style, neighbours, links, labels) is highlighted and fitted, the button shows pressed, it follows song changes, and an empty click, another dot, a second press or Esc releases it like a user selection; disabled with "No genres for this song" (GEN-025, GEN-026).
- Docs: new concept page [concept-digital-phosphor-led.md](product/concept-digital-phosphor-led.md) for the Ice Blue Mirror 2 digital phosphor LED display (idea, display model, palette, geometry, settings, decisions log, open ideas).
- Web: Ice Blue Mirror 2 colours made exact (owner: base sectors were white): the trail uses palette colours 1 to 9 exactly (Max level 1 to 8, default 8; Trail brightness removed), the now sector is palette colour 10 (#d0f4ff, flat, no white lift or outline), cells draw source-over, glow halos (colour 7) are drawn first, Base row glow is a colour 7 halo instead of white. New Reflection style setting (alpha, shade, shifted; preset shifted): an exact opaque mirror with palette colours 4 steps darker, saturation >= 0.8 and a linear depth fade, mirror gap 12 px, no blur or glow (VIZ-105).
- Web: Ice Blue Mirror 2 bar width is now 4x the section height (new Mirror setting Section aspect, 0 = off; the Bar width slider is disabled and derived from the effective section height, also after Fit to room) and Section gap is 0.40: sections 80 x 20 px, pitch 28 px, Derived bar height 560 px, 14 bars at 1200 px (VIZ-104, VIZ-105).
- Web: the "Visualizer" toggle moved from the Playback transport controls into the Now playing action row as the last round button, after Song info (VIZ-021, PLY-072).
- Web: Playback action row (owner request): YouTube and SoundCloud icon links to the current song's sources (only when present, left of Share) and a "Song info" button replacing the pencil Edit; it opens the read-only song card, which keeps Edit for writers (PLY-072).
- Web: Now playing subtitle no longer shows the album (owner: the title appeared twice when the album equals it): it is Artist · Year, like the Library row; the album stays in the song card (PLY-010, WEB-026).
- Web: Now playing no longer shows remix info twice (the title parenthetical and a "Remix: ..." subtitle item); the subtitle is Artist · Year via `subtitleString` (PLY-010).
- Web: Ice Blue Mirror 2 now has 20 LED sections of 20 px with 40 px bars: Section height and LED sections work together (Derived bar height = sections x (section + gap) = 480 px, Max bar height disabled while both are set), Fit to room shrinks sections (minimum 3 px) when the Visualizer height leaves too little room and the Sections group shows the effective rows and size with a "More room" hint; in the full-screen overlay the bars use the whole canvas height only when the new Mirror setting "Use the whole screen in full-screen mode" (`fullRoom`, Bars group, default off) is on, which only Ice Blue Mirror 2 sets; all other presets keep the Visualizer height in the overlay (VIZ-104, VIZ-105).
- Web: owner-approved Ice Blue Mirror, tag `mirror-liked-1` (001814c); parameters and restore commands in the visualizer spec (VIZ-106).
- Web: new preset "Ice Blue Mirror 2" (working copy of the liked look, original frozen and pinned by a test, 4x bigger LED blocks, black background) with new Mirror settings: Section height, Tone variation, Peak marker, Peak hold, Afterimage, Afterimage fade, Base row glow, Mirror gap, Reflection blur, Tilt, Ice reversed colours, Black backdrop, Bar width up to 80 px (minimum 8 bars for bars wider than 12 px); the last clicked preset wins the highlight when presets are equal (VIZ-104).
- Web: Mirrored spectrum "History trail" for Ice Blue Mirror 2: only the current LED sector is lit (white outline) plus a trail whose brightness steps with per-row visit counts (visits in a sliding window of the last 10 s, counted after a 60 ms minimum dwell, 3 visits per step; trail rows use a dim blue ladder (the same four owner colours), not alpha or white, so the greys are gone; 'Loss per second' and 'Step lightening' settings removed); new settings Current sector, Minimum dwell, Visits per step, Window, Max level, Trail brightness; the current sector has a soft blue glow instead of a white outline (new Glow and Glow size settings); trail colours cap only value in HSV (no greys); new Ice 2 colours and backdrop (`--viz-ice2-*` in `viz.css`, owner-approved 11-stop blue ramp #040d31 to #f4fdff); the preset drops the peak marker and afterimages; other presets draw unchanged (VIZ-105).
- Web: Ice Blue Mirror 2 fixes (owner: scene not horizontal, only one or two sections visible): tilt 0; 21 LED sections instead of section height 35 (only about 4 rows); History trail rows now span the full-scale bar height so the current sector can reach every row (level 1.0 used to stop about 4 rows short of 21); Section height now disables the LED sections count in the panel (labels say which wins); tests pin trail colour contrast (CIEDE2000 vs background >= 10, reflection >= 6) (VIZ-104, VIZ-105).
- Web: Mirrored spectrum "Ice Blue Mirror" built -- new settings Bar width (px) and Gap (px) (replace Bar count / Bar width, Auto = classic), Max bar height (px) (replaces Height), LED sections, Bar tips, Ice palette, vertical gradient, Horizon band and Ice backdrop (new `--viz-ice-*` variables in `viz.css`); old saved values migrate once; defaults draw exactly as before (VIZ-106).

- Web: Mirrored spectrum style panel (`viz-mirror-settings.js`, `viz-mirror-panel.js`) -- bar count, width, height, rise and fall speed, colours (Theme / Reversed / Accent from the design tokens), reflection opacity and horizon glow with Reset buttons, saved in `ap2.viz.mirror` (defaults equal the old look), plus six one-click presets (Neon Cylinders, Cyan Magenta Wave, Neon Blocks, Pink Cyan Blocks, Ice Blue Mirror, Classic) with thumbnails in `web/img/mirror-presets/`; checked in a browser on a synthetic spectrum at 1200 and 375 px, not on real playback. The planned Bars, Horizon line, Bottom space and Frequency captions settings are specified in VIZ-099 to VIZ-103 and described in `docs/product/concept-mirrored-spectrum.md` (VIZ-098).

- Web: Synthwave triangle-mesh diagonals no longer flip from frame to frame (`/ \ / \` shimmer): the checker parity was tied to the on-screen row and inverted at every one-cell scroll wrap; two index variants per tier are now swapped by the world cell parity (`diagParity`), so a cell keeps its diagonal as it scrolls.

- Web: Synthwave no longer collapses on weak GPUs (Radeon R5 230 at 1920x1200 fell to 8 fps and then to Terrain while the picker still said Synthwave): internal render scale (backing store 100/75/60/50% stretched by CSS) and fewer glow repeats are the first things the governor gives up, before grid level and frame rate; sun, haze, reflection, sky and horizon passes are scissored to their own bounds; the last stable rung is remembered per device in `localStorage` (`ap2.viz.synth.shed`) and a fast machine always starts at full quality; the Terrain fallback is the last resort and is now visible: the mode picker reads "Synthwave terrain (using Terrain: too heavy)" and the notice states the measured interval and render scale; the vizdebug box shows render scale, rung, passes, fill and glow; VIZ-090.
- Web: Synthwave presets panel (eight presets with thumbnails in `web/img/synth-presets/`, regenerated by `scripts/synth-thumbs/`); a missing thumbnail now falls back to a name-only tile, and the Blue valley, Neon peaks and Neon sea thumbnails were retuned (relief walls, brighter magenta sea reflection); VIZ-093.
- Web: new fourth visualizer mode "Synthwave terrain" (key `M` cycle, mode dropdown, Settings, share link `viz=synthwave`, WebGL only): a square or triangle grid moving toward the viewer with spectrum relief, valley, hills and future silhouette, a sliced sun with haze ring and horizon band, a ground reflection, a horizon line, a star sky and vignette; about 130 adjustable properties in the style panel stored in `ap2.viz.synth` with Reset; own renderer `viz-synth-*.js`, Terrain untouched; under load it degrades stars and haze, slice detail, grid LOD and then half rate, and falls back to Terrain; reduced motion draws one static frame; VIZ-080 to VIZ-091, task-0030. Known gap: the peak fade setting has no effect yet.
- Web: Synthwave sun position is now "Sun height (radii)" (`sun.height`, -1..3, default 0.5): the disc centre height above the horizon line in radii, independent of the sun radius (0 half sunk, 1 bottom edge touches the horizon, above 1 floats); replaces `sun.lift` (a saved `lift` is ignored, default applies); VIZ-083.

## 2026-10-14

- Web: Terrain level-of-detail tiers are now chosen by distance from the camera (`rho = hypot(x, z)`) instead of depth z, and every tier's mesh starts at the camera, so under Camera flight yaw the cell size no longer differs between the left, centre and right at the same distance (no more layers of different cells); the vertex count grows (level 2 at 16:9: about 52k, at most 120k); VIZ-043, VIZ-074.
- Web: Terrain pacing no longer sticks at half rate -- an 8 s warm-up grace (start, style or flight toggle, resize, tab return, timeline building), frames with a geometry rebuild are not counted, bans cap at 120 s and reset after 60 s without a downgrade, the vizdebug box shows the last downgrade reason, its age and the ban; docks and the debug box keep a safe-area aware 8px left offset (VIZ-031, VIZ-061).
- Docs: visualizer docs audited against the code -- Terrain style list and gains per style (VIZ-051), camera panel as VIZ-075 (the second VIZ-044 renamed), `FAR_FLAT_START` 0.92 everywhere, a controls cheat sheet in visualizer.md, liked-2 baseline note that later changes exist, module lists (WEB-064, architecture.md), and the "not deployed" markers dropped because the release is live.
- Web: Camera flight yaw now visibly swings on wide views -- yaw amplitude was limited by the grid's side coverage (0.2 deg at aspect 3.3 and 0 at 4.0 with base yaw -5.2); far LOD tiers are widened (cap 85 deg and 8x, near tier unchanged), grid side edges fade out, the amplitude floor is 8 deg (`FLIGHT_YAW_MIN_DEG`) with the centre shifting toward 0, and the vizdebug flight line shows the amplitude and `yaw limited by view width` (VIZ-074, VIZ-044).
- Web: new Terrain style "Lava" (key `lava`, after Full spectrum in the T cycle) = the former Full spectrum (Relief, no beats) with now line defaults height 2.2x (`NOW_LINE_GAIN_H_LAVA`) and glow 4x (`NOW_LINE_GAIN_B_LAVA`); the vizdebug fields `nowH` / `nowB` show the active style's defaults until edited and Reset restores them; "Full spectrum" is now the plain Relief style (unchanged rows, landmarks on, no smoothing) plus Multi beat peaks added on top through the soft knee; the now line boosts only the peaks (1.1x height, `nowB` glow weighted by peak share), `layerFullRelief`; VIZ-051, VIZ-054, VIZ-055.
- Web: Terrain camera flight is 2x faster -- new `FLIGHT_SPEED = 2` divides all drift periods (eye 20 / 12.35 / 8.7 s, yaw 15 / 9.25 / 6.5 s), amplitudes and the 3 s / 2 s eases unchanged; peak speeds about 9.3 deg/s yaw and 0.57 units/s eye at the default camera (VIZ-074).
- Web: Terrain lookahead fixes -- a song whose duration was still unknown at `loadstart` was rejected to the live fallback (flat future); now loads fine, failures show a reason in the vizdebug box and `console.warn`, retries twice; the timeline is built around the playhead first, cached per song and kept across mode switches, the next song's first 20 s are built ahead, uncovered rows are filled progressively with a short fade instead of all-or-nothing, the song end fades flat, relief flattens only over the last 8% of the depth (`FAR_FLAT_START` 0.92); VIZ-046, VIZ-048, VIZ-049
- Web: "Full spectrum" is now Relief with a 1.1x now line -- no beat detection or base relief; label without the "Beat peaks:" prefix; vizdebug Camera panel gets number fields "Now line height" (`nowH`) and "Now line glow" (`nowB`), stored with the camera values; VIZ-044, VIZ-051, VIZ-055
- Docs: terminology -- new `docs/specs/terminology.md` glossary (now line / "line now", relief vs beat peaks, parts, camera, quality, overlay, share link, baselines) with aliases and requirement ids.
- Web: the thumbnails in the Now playing list are now cover buttons like the Library rows -- hover or focus shows the play icon, the current row shows Pause or Play at 75%, a click starts that queue item or toggles the current one; play and pause repaint the covers in place without rebuilding the list (PLY-073).
- Web: the Terrain now line no longer lifts the terrain -- `NOW_LINE_GAIN_H` 2.0 -> 1.0, the brighter glow (`NOW_LINE_GAIN_B` 2.0) stays; VIZ-051.
- Web: the full-screen left style dock (Visualizer style and the debug Camera panel) now auto-hides with the bottom controls -- same idle timer and reveal events, fade without layout shift, instant under reduced motion; neither the dock nor the controls hide while the pointer is over them, focus is inside the dock or on a select or slider, or a drag is in progress; Playback's background placement is unchanged (VIZ-022, VIZ-073).
- Web: fixed a dead toggle pill at the right of the full-screen controls row -- the mode dropdown container shared the class `viz-switch` with the Camera flight switch, so it picked up the pill-and-knob `::after` style; the flight switch is now `viz-flag-switch` and the pill exists only in the left Visualizer style panel (VIZ-073).
- Web: the full-screen volume slider no longer moves the other controls -- it used to grow from 0 to 96 px on hover or focus and the centred control row shifted (Shuffle to Repeat and the mode dropdown moved 48 px); its width is now always reserved and only the opacity changes (VIZ-071).
- Web: Terrain camera flight -- a "Camera flight" switch in the left style panel (also key `F`, off by default, forced off with reduced motion) makes the camera drift slowly like a spaceship: eye height up to 35% either way and yaw up to 14 degrees (clamped to the covered grid), smooth sums of sines with random phases, dt-based so 30/60/120 fps match, moving only while playing, 3 s ease-in and 2 s ease-out, no grid rebuilds while drifting; the debug panel shows the live offset and share links carry `fl=1` (VIZ-074, SHARE-017).
- Web: full-screen visualizer controls reworked -- Share link and a new Exit (X) button sit in a semi-opaque top-right cluster that wakes to full opacity with a ring and tooltip when the mouse is within 48 px (and on keyboard focus); a click or tap on the picture now pauses or plays (central icon flash, "Playing" / "Paused" announced) instead of exiting; exit is the X, Esc or V (VIZ-022, VIZ-023). The part toggles moved out of the bottom rows into a left "Visualizer style" panel for everyone ("Terrain style" select for Terrain, Bass/Mids/Highs and Beats/Melody/Other for the Mirrored spectrum, collapsed by default below 480 px), stacked above the vizdebug-only "Camera (debug)" panel (VIZ-044, VIZ-056, VIZ-073).
- Web: the visualizer mode switch is now a dropdown -- a button with the current mode's icon, label and chevron opens a listbox of the modes (keyboard, outside-click and auto-hide closing, opens upward near the bottom; icon only below 480 px), on Playback and in the full-screen overlay (VIZ-044); the overlay's X exit button returns in the top-right cluster (see next entry).
- Web: Terrain now draws at 60 fps (was 30;) -- the target is the display refresh capped at 60 (`TERRAIN_TARGET_FPS`; 30 on a low battery or with reduced motion; the Mirrored spectrum and Ring stay at 30), the pace governor is judged against the 16.7 ms target and gets a half-rate bottom rung (30 fps) with the 30 s ban logic, motion smoothing is dt-based (the look is the same at 30, 60 and 120 fps), and a rigid near tier is re-uploaded every 3 rows instead of every row (uploads 480 -> 178 per second, level 2). vizdebug shows target and achieved fps and the rung (VIZ-031, VIZ-061..063).
- Web: Terrain beat-peak styles now stand on a soft base relief of the spectrum (60%) and the now line swells the terrain under it to 2x height with a 0.3 s gaussian falloff, brighter glow (VIZ-051).
- Web: the vizdebug Eye (camera height) slider now spans 0.2..10 (was 0.2..4); clamp, copy line and stored values follow (VIZ-044).
- Web: the vizdebug Sync trim now spans -1000..+1000 ms (was -300..+300; 10 ms slider steps, default 0 = auto estimate), so the audio-to-visual offset is easier to feel; the copy line `sync=NNNms` and stored values clamp to the same range (VIZ-064).
- Web: shuffle, repeat and volume in the full-screen visualizer -- Shuffle and Repeat (off / all / one with a "1" badge) buttons around Previous / Next, a Mute button with a volume slider (hover-open on desktop, always visible on touch, hidden where the browser ignores `audio.volume`, e.g. iPhone), keys `S`, `R`, `ArrowUp` / `ArrowDown`, live announcements; all share state with the Playback controls (`ap2.shuffle`, `ap2.repeat`, `ap2.volume`); control row wraps at 360 px (VIZ-070 to VIZ-072, PLY-092).
- Web: the Playback cover and the mini-player thumbnail now behave like a Library row cover -- same round translucent play/pause overlay (75%, full on hover or focus), tooltip and label "Pause <title>" / "Play <title>" (no tooltip on touch), click toggles playback; shared helper `row-cover.js` (`paintCover`, `currentCoverModel`); the mini-player's title and artist still open Playback (PLY-016, PLY-070).
- Web: share a song as a link (task-0028,) -- a Share link button on Playback and in the full-screen visualizer, and "Share link" in the Library row menu, open a dialog that builds `#/play/<id>?v=1&t=83&viz=terrain&style=single&bg=1&fs=1&cam=eye,pitch,yaw` (start time, mode, Terrain style, background, full-screen flag, optional camera; Web Share or copy, "Link copied" live region); opening a link shows "Tap to play at 1:23", seeks, applies the visualizer settings for that visit only and opens the full-screen visualizer for `fs=1`; missing songs show "This song is not available". Specs: docs/specs/share.md.
- Web: Terrain tuning pass -- camera yaw slider in the vizdebug panel (key `ap2.viz.dbg.cam5`, copy line now `eye pitch yaw sync`); new styles "Beat peaks: full spectrum" and "Melody on beats" (offline harmonic/percussive masks and a lead-pitch line baked into the timeline, amber accent; VIZ-066/067); frame pacing governor with fps, level, tier, vertex and DPR in the debug box and a Quality override (VIZ-061); cheaper frames (DPR cap 1.5, cached uniforms, skipped re-uploads; JS 3.7 -> 2.6 ms measured, VIZ-062); audio-to-visual latency cut (centred analysis window, calibrated beat onset and lead, output-latency compensation plus Sync trim; VIZ-063/064); soft height knee instead of a flat roof on tall peaks and relative beat strength so intros stay small (VIZ-065).
- Docs: owner-approved Terrain look recorded as tag `terrain-liked-2` (commit edd86a8; favourite camera eye 3.70, pitch -13.0), see the Liked baseline 2 block in docs/specs/visualizer.md.
- Web: part toggles on the Mirrored spectrum -- Bass / Mids / Highs (250 Hz and 4 kHz, 1/3-octave raised-cosine crossovers) and Beats / Melody / Other (harmonic/percussive median-filter masks on the bar spectrogram, Other = what neither explains) switch parts off in the drawn bars only, with smooth dimming; collapsed behind "Parts" below 480 px, saved in `ap2.viz.parts`, last toggle of a row cannot be turned off (VIZ-056 to VIZ-060; `viz-parts.js` is reusable by Terrain).
- Web: Terrain cells are about 3x smaller near the camera -- the drawn grid is now a level-of-detail mesh of square cells (0.35 / 0.2 / 0.12 world units at quality 0 / 1 / 2, doubling with distance in depth tiers, each tier only as wide as the camera footprint), resampled on the CPU from the unchanged coarse height lattice, so the beat-peak and relief cost is unchanged (about 31000 grid vertices at level 2, 16-bit indices). The quality governor now actually reaches Terrain level 2: its levels 0 / 1 / 2 / 3 map to Terrain 2 / 1 / 1 / 0 (before, Terrain only ever ran at level 0 or 1, so bloom and the finest grid were never used) (VIZ-031, VIZ-043).
- Docs: Terrain concept described in plain language for designers (docs/specs/terrain-concept.md), linked from visualizer.md
- Web: Terrain grid cells are square -- uniform column spacing equal to the row spacing in world units (1.0 / 0.6 / 0.4 units at levels 0 / 1 / 2, counts follow the aspect, capped at 30000 vertices with both spacings widened together), replacing the dense-centre column spacing (owner request after reference 14.webp; tag `terrain-liked-1` keeps the old grid).
- Web: new "alive" Terrain styles, off by default -- Beat peaks: single / hill / multi. The ground is flat; each detected beat (spectral flux of the bass bands, adaptive median + 3 MAD threshold, 0.18 s minimum gap, offline on the lookahead timeline and causal live) grows a peak at the now slice in 0.15 s that rides toward the camera and sinks to flat over 5 s (height up to 4.5 units by strength). Select "Terrain style" in Settings > Playback, key `T`, and a dropdown in the `vizdebug=1` panel; stored in `ap2.viz.terrain.style`, default Relief (VIZ-051 to VIZ-055).
- Web: Terrain look pass after reference 13.webp (post-baseline) -- brighter glowing nodes at line crossings, directional light from the upper right (per-vertex slope light factor, `LIGHT_DIR`, `LIGHT_GAIN`), height fog denser in valleys and toward the horizon, a slow dark-blue mist pass over the terrain (off at level 0, 1 then 2 octaves), darker calm sky and ground; new camera defaults eye 3.31, pitch -13.5 deg with debug key `ap2.viz.dbg.cam4` (VIZ-043).
- Web: Terrain landmarks are now a peak around the strongest columns of the loudest row (gaussian, sigma 8% of the width) instead of a full-width wall, and windows without a clear spectral peak get none (VIZ-050); Terrain level-of-detail tiers cross-fade with shared bead noise and fade out sub-pixel lines, and the relief flattens over the last 20% of the depth so the far edge has no comb (VIZ-043).
- Web: Terrain landmark ridges -- one tall ridge every 5 s on the loudest row of each 5 s window (anchored at 0 s, so seeks give the same ridges), heights x1.8 + 0.4 clamped to 4.5 world units, baked per row so nothing pulses; quiet windows get none; live fallback boosts new rows within 10% of the window maximum so far (VIZ-050, after baseline c9b18e7).
- Web: the Ring visualizer is another 2x bigger (4x the original, `RING_SCALE`; 20% of the smaller canvas side at Small); the outer-dot clamp (about 22% of the smaller side when centred) still applies and binds at Medium and Full (VIZ-042).
- Web: owner-approved Terrain baseline (c9b18e7), tag `terrain-liked-1`; parameters and restore commands in VIZ-043 ("Liked baseline", docs/specs/visualizer.md).
- Web: the Ring visualizer is twice as big (radius, spokes, halo and dot rings; e.g. 5% to 10% of the smaller canvas side at Small), clamped so the outer dot ring never leaves the canvas (VIZ-042).
- Web: Terrain now covers the whole screen width at every visible depth -- the constant-width grid is sized from the camera frustum (half-width 25.4 x aspect, was 3.2 x aspect, so the strip was only about 56% of an 800x600 screen), columns are spaced densely in the middle and sparsely toward the far-off edges (`columnX`), grid is now 40x128, 64x144, 88x208 rows x columns (was 40x36, 64x52, 88x72); perspective, peak heights and time direction unchanged (VIZ-043; checked in a browser with a synthetic timeline at 2000x1200, 800x600, 2400x1000 and 430x932, not on real audio).
- Web: Terrain reworked as a rigid landscape -- uniform world-space rows scroll toward the camera at a constant speed with continuous sub-row motion (no accelerating "liquid" flow, no per-row damping or swell), constant world width with real perspective (depth lines converge toward the horizon and fan out at the bottom edge; no width flare), camera eye 2.0 / pitch -10 (debug key `ap2.viz.dbg.cam3`), grid 40x36 / 64x52 / 88x72, per-row baked amplitude (rows no longer pulse together with the live beat; palette energy is a slow follower), bass camera shake kept but off (`SHAKE_ENABLED`), cross lines only above about 0.5 world units so flat ground shows long ribbons and raised ground a grid, soft beaded ribbons with depth-of-field at levels 1-2 (level 0 stays crisp), and a bright now slice (VIZ-043, VIZ-047, VIZ-044; checked in a browser with a generated tone, not on a real song).
- Web: Terrain lookahead -- with Terrain active, the server audio is fetched and decoded and a spectrum timeline (same 8192 FFT, bands, tilt, 50 dB window and smoothing as the live path) is built in a Worker at 16 rows/s, so the terrain shows about 5 s of upcoming relief toward the horizon with the now slice at mid-screen, scrolled by `audio.currentTime` with seek, pause and rate handling; falls back to the live view when the track cannot be decoded (VIZ-046, VIZ-048, VIZ-049).
- Web: Terrain fills the whole screen -- new default camera eye 3.43, pitch -22.2 degrees (horizon 16% from the top), the field is 64 units deep with exponentially spaced rows reaching the horizon and flares wide enough for portrait to 32:9 (no empty sides or sky), and the sideways sway and camera drift are removed (lines stay on fixed columns); the vizdebug camera key is now `ap2.viz.dbg.cam2` so old stored values do not hide the new defaults (VIZ-043, VIZ-044; checked in a browser with a synthetic spectrum at 2000x1200, 2400x1000 and 430x932, not on real audio).
- Web: Terrain camera fixed -- the eye now sits above the surface (1.6 instead of 0.4, pitch -4.8 degrees, near plane 0.3), the grid is dense (up to 160x104 instead of 72x96), heights are smoothed into rounded swells and damped near the camera, and lines fade near the eye, so the foreground is a calm fine grid instead of spikes and giant polygons (VIZ-043; checked in a browser with a synthetic spectrum, not on real audio).
- Web: with `vizdebug=1` a Terrain camera panel (eye height and pitch sliders, Reset, copy line `eye=... pitch=...deg`) appears in the Playback background and the full-screen overlay; values persist in `ap2.viz.dbg.cam2` (VIZ-044).
- Web: Terrain restyled to match the reference -- long depth-wise ribbons thicker and brighter near the camera, thin cross lines that appear on raised areas (grid on peaks), glowing crests, low camera with the horizon about 57% from the bottom, drifting bluish smoke and sparse stars, and a dark calm state that brightens with the music's energy; the heightmap is no longer mirrored (low frequencies left, highs right); smoke and line passes follow the quality level (VIZ-043; checked in a browser only with a synthetic spectrum at about 2 fps, not on real audio).
- Web: in the full-screen overlay the Terrain visualizer now fills the whole viewport instead of a thin band set by "Visualizer height"; the setting still scales Terrain in the Playback background and the bars and ring everywhere (VIZ-041, VIZ-043).
- Web: the Terrain visualizer now links in Chrome -- the shader failed with "Precisions of uniform u_mode differ" and the silent fallback showed Mirrored spectrum; the vertex shader now declares `precision mediump float;` like the fragment shader (VIZ-043).
- Web: the Library row "..." menu button is hidden when a row has no menu items (guest on a song without audio); a hidden placeholder keeps the column aligned (WEB-061).
- Infra and docs: `play.isayenko.net` removed with no redirect (DNS record deleted, ingress rule removed on perkunas); electrophone.cc is the only host; defaults, examples, scripts and docs updated (ADR-0019 amendment).
- Web: the visualizer no longer draws a fake animated envelope when the analyser is missing or silent (flat idle line plus a status naming the cause), resumes the audio context on V, button and play, and `?vizdebug=1` shows context state, analyser data and same-origin checks for Safari (VIZ-036); server tests added for `/files/<id>` Range 206 and `Accept-Ranges` (owner and guest).
- Server and web: guest scrub no longer exposes the top-level `file` and guest streaming 404s for ids outside the owner's catalog; metadata-only `POST /songs` no longer counts against `USER_ADDS_PER_HOUR` (only the audio fetch does); the sign-in error text no longer hardcodes `play.isayenko.net`; coverage measured (server about 99%, web about 96%) (NFR-056, NFR-081, NFR-090, ADR-0010, ADR-0017, ADR-0018).
- Web: the visualizer now works in Safari -- the Web Audio context and media source are created synchronously inside the first click or key press (V, the Visualizer button, Play, Next, Previous), a blocked context retries on the next gesture, and auto-advance only resumes it; verified on macOS Safari with `?vizdebug=1` (state ok, live analyser data) (VIZ-036).
- Web: the Previous and Next icons in the full-screen visualizer controls were near-white on a near-white key and are now dark ink (`--ink`, about 15:1 contrast).
- Web: Mirrored spectrum, Ring and Terrain now follow the music -- bar levels use a +3 dB/octave tilt and a slow loudness reference instead of a fixed -100..-30 dB window that clipped loud bars into the same shape (VIZ-010).
- Web: Mirrored spectrum bar pitch is a whole 4 px (was 4.5), still 60% width on whole device pixels with gaps of at least 1 device px (VIZ-010).
- Web: Selected Shuffle and Repeat toggles keep the transparent interior and 1px accent ring and gain a faint outer-only glow at 25% strength (PLY-132).
- Web: Mirrored spectrum no longer shows striped dark gaps between bars -- bar edges snap to whole device pixels with one constant width, for any DPR and width (VIZ-010).
- Web: Mirrored spectrum fixes -- bar density no longer drifts (the governor no longer lowers the bar count), no extra lighter ghost bars (glow is skipped without canvas blur support and the cheap level is blurred), lower half dimmer (alpha 0.35), and the visualizer is 2x shorter (Small 1/6 default, Medium 1/3) (VIZ-010, VIZ-011, VIZ-013, VIZ-017, VIZ-041).
- Web: Shuffle, Repeat and Repeat-one icons redrawn as crisp 2-unit stroked arrows; Repeat-one now has a bold, legible numeral 1 (PLY-134).
- Web: Mirrored spectrum matches the reference -- thicker bars (pitch 4.5 px, 60% width) with jagged shimmering heights, 4-colour gradient, no white tips, per-bar soft glow plus a wider body glow, bright glowing horizon, one flipped lower half, radial full-screen background with a faint ring backdrop; analyser fftSize 8192.
- Server and web: BPM backfill -- Settings > BPM detection > Detect missing BPM fills the BPM of songs that have audio on the server but no BPM (`GET|POST|DELETE /me/backfill/bpm`): one job server-wide, niced, sequential with a pause, one commit per batch, never overwrites an existing BPM (API-110..112, NFR-110, ADD-110, WEB-070, DATA-070; real aubio on real songs and perkunas CPU/thermals not verified).

- Docs: electrophone.cc migration phases 1-3 done (Cloudflare zone active, both hostnames serve the app, Google and Apple sign-in verified on the new host); iOS URL, canonical redirect and HSTS still open (task-0026).

- Server and web: copyright note in the guest view and Settings (fixed text, optional `LEGAL_CONTACT` link, public `GET /legal`) and no-index for the public site (`X-Robots-Tag` on all responses, `GET /robots.txt`, meta robots) (API-095, API-096, NFR-094, NFR-095, WEB-065, ADR-0018).

- Web: marquee titles get 14px padding at both ends while running, so the first and last letter no longer sit under the 12px edge fade (LIB-131, PLY-133).
- Server and web: hostname-agnostic config for the move to electrophone.cc (ADR-0019): `PUBLIC_HOSTS`, `CANONICAL_HOST` (308 for GET/HEAD, `/health` and writes exempt), `OAUTH_REDIRECT_URIS`; defaults keep today's behaviour; Apple sign-in shows a clear message when the address is not registered (NFR-090..093).
- Docs/scripts: domain migration play.isayenko.net to electrophone.cc planned (runbook [tech/domain-migration.md](tech/domain-migration.md), task-0026, read-only `scripts/check-domain.sh`).
- Web: audio visualizer phase 1 -- a Visualizer button and the key `V` open a full-screen spectrum (many thin mirrored bars around a light horizon line, magenta to orange, with a radial ring), Settings > Playback > "Visualizer background" draws it behind the Playback screen; the Web Audio graph is created lazily on that first gesture, the loop runs only while playing, visible and on screen, reduced motion shows a static frame (VIZ-001..035, PLY-091, NFR-024; not browser-verified).
- Web: visualizer phase 2 wired -- one visualizer at a time, never combined: Mirrored spectrum, Ring, or the WebGL Terrain (where WebGL exists); a segmented switch next to the Visualizer button and in the full-screen controls, the key `M`, and Settings > Playback "Visualizer mode" and "Visualizer height" (Small, 1/6, by default; Medium is 1/3) choose; the mirrored bars are now one series (the extra reflection is gone); lighter drawing (no shadowBlur, batched bars, quarter-resolution glow pass, 30 fps, DPR cap 1.5, `vizdebug=1` frame-time readout) (VIZ-040..045, task-0023; not browser-verified).
- Web: Genres map selects a genre only on click (hover just rings it and shows the tooltip, no more dimming or label jumps; pressing a node no longer reheats the layout), and the Now playing button stays enabled for a song without genres (GEN-026).
- Web and server: `year` and `remix_year` now accept 1900..next year (current UTC year + 1, so 2027 in 2026) instead of 0..3000 and 1900..2100; out-of-range lookup years are discarded, stored values are left alone and an unchanged one passes `PATCH`, the Year inputs get min and max, and the decade tag now covers every year from 1950 up to that limit (`decade:30s` appears by itself) (DATA-062, TAG-050).
- Web: Song stats treats a BPM outside 20..300 or a year outside 1900..next year (0, null, strings) as missing, and the BPM axis can no longer be panned or zoomed below 0 (STA-002, STA-003).
- Web: Song stats colours dots by genre family by default (the Genres map palette, polled while families resolve), right-drag pans, `C` or the Center button centres the chart (STA-005, STA-013).
- Docs: bought the domain `electrophone.cc` (EUR 2.80 first year, EUR 7.43 per year after); recorded in brand/domains.md; the invoice is kept in the private project-meta repo.
- Tasks: added task-0025 (audio equalizer v2: 10-band graphic EQ in the shared Web Audio graph, presets, bypass; proposal, deferred until after the visualizer).
- Tasks: added task-0024 (change playback tempo to a target BPM, e.g. 125.1 to 132.3, pitch preserved; proposal, deferred; BPM decimal precision open).
- Web: a space between the song title and its remix part everywhere; a title or remix too long for its box now scrolls left and right (ping-pong marquee) in the mini-player, the Playback heading and the current Library and queue rows, and on hover or focus in other rows; reduced motion keeps the ellipsis (LIB-131, PLY-133).
- Web and server: public read-only guest view -- a visitor who is not signed in sees the owner's library (Library, Playback, Genres map, Song stats) read-only with a "Viewing Alex's library" banner and can stream the audio; no edit, add, download or delete controls; per-IP limits (240 requests/min, 1024 MB audio/hour, 3 streams); kill switches `PUBLIC_VIEW=0` and `PUBLIC_AUDIO=0`; the allow-list routes now send `Cache-Control: private, no-cache` (API-090..094, WEB-060..063, LIB-130, PLY-140, NFR-080..083, ADR-0018).
- Tasks: added task-0023 (audio visualizer: spectrum bars and ring, as a Playback background and a full-screen mode; proposal, phase 1 scope decided).
- Tasks: added task-0021 (speed up saving songs in the git store, deferred; includes the later database direction) and task-0022 (provision AcoustID and Discogs keys and fpcalc, blocked on Alex); task-0019 is now blocked by task-0022.
- Docs: brand README records the full brand name "Electrophone Vega 108" (short forms Electrophone, Vega 108) and the 2026-10-14 domain price comparison with a recommendation (vega108.app); nothing purchased yet.
- Web: Genres map and Song stats get a raised toolbar card and share its style with the legend, selected-genre card, outline and zoom buttons; both pages run under the floating mini-player; the outline floats over the map without resizing it; new "Now playing" button lists the playing song's genres and highlights them on the map (GEN-021, GEN-024, GEN-025, STA-023).
- Web and server: optional "Remix year" (`remix_year`, 1900..2100) next to Remix & additional production in the Add and Edit forms; the song card shows "Remix year 2024" and the remix part of the title gets the tooltip "Kav Verhouzer Remix (2024)"; `year` and the decade tag are unaffected; the iOS app does not send or show it yet (ADD-101, DATA-061, API-081, LIB-125, WEB-051).
- Web: Library search also matches the Remix & additional production value (LIB-020); the placeholder reads "Search title, artist, album, remix or tag".
- Web: selected Shuffle and Repeat toggles (tray and mini-player) show a transparent button with a thin (1px) bright accent (cyan) ring and an accent-ink icon, with a fully transparent interior (no fill, no glow halo) instead of a cyan fill (PLY-132).
- Web: tapping a Library row opens a read-only song card (cover, title, tags, BPM, links, download state; Play now, Add to playlist, Download, Edit); the row cover is now a play/pause button that shows Pause or Play on the current song (LIB-120..124, PLY-131, ADR-0016).
- Web: the service icons in the Add and Edit forms light up from every stored link (YouTube, SoundCloud, Spotify, Wikipedia, MusicBrainz, Discogs) instead of only after "Get metadata" (ADD-100).
- Web: new "Song stats" page (sidebar item after Genres map): a full-page scatter plot of year against BPM, one dot per song, coloured by decade, genre family or audio state, with a legend that hides groups, hover tooltips, click to open the song card, rubber-band selection with Add to playlist and Play, wheel zoom and pan, keyboard navigation and a table view; "Show in Library" for a selection is not wired yet (STA-001..030).
- Quality: SonarCloud cleanup -- split high-complexity functions, linear-time regexes, split test assertions, `Annotated` FastAPI dependencies, sha1 ETag marked non-security, `clean-titles.py` accepts only `library.json` paths; behaviour unchanged.
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
- iOS: TestFlight builds 20261020 to 20261027 (latest 20261027).

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

## 2026-10-21 (trim on download and re-download, server, to deploy)

- Server: `POST /download`, `POST /songs` and `POST /songs/{id}/audio` take an optional `trim: {start, end}`; the stored audio is only the cut part (yt-dlp sections for YouTube, ffmpeg cut for SoundCloud, always re-encoded to AAC m4a), the trim is kept on the primary source, `duration` and `bpm` describe the cut (API-204, task-0045).
- Server: new `POST /songs/{id}/redownload` replaces a song's audio with its stored or a new trim, one download per song at a time (API-205). Not run against real ffmpeg and yt-dlp yet.

## 2026-10-21 (dock layout break on a failed lazy load, web, to deploy)

- Web: "Could not load. Try again." was the lazy-UI failure note (song card chunk), inserted after the dock title button and breaking the dock grid; inside the dock it is now a toast (WEB-158). Not seen in a browser.
- Web: a failed lazy UI load (song card from the dock title) retries once, then asks `GET /version`; a stale tab after a deploy shows the toast "This page is out of date. Reload to continue." with Reload (the update bar also shows), otherwise "Could not load. Try again." (WEB-158). Tests not run.

## 2026-10-23 (reference tracks per genre, web, to deploy)

- Web: reference tracks (ADR-0044, task-0093 phase 3): a "Reference tracks" section in the Genres side panel (role badge, note, play or "Add to library", sources with a verified tick from 2 sources, owner editing), the song card action "Mark as reference" with a star badge, and a Library filter chip "Reference tracks" with a role select and row stars (GEN-087, GEN-088, LIB-211, LIB-212). The Add dialog accepts a prefilled link. Server contract assumed, tests not run, not seen in a browser.

## 2026-10-23 (reference tracks eras, web, to deploy)

- Web: per-genre eras for reference tracks (GF1, ADR-0044, task-0093): the reference list is grouped by era (name, "c. 1994-1997" years, note, "N sources" toggle, entries by year then title, "Other" last), the owner gets "Edit eras" and an optional "Era" select in the track form and the "Mark as reference" dialog (GEN-098..GEN-100). Server contract (eras in `GET /genres/{name}/references`, `PUT /genres/{name}/eras`, `era` on entries) assumed, tests not run, not seen in a browser.

## 2026-10-23 (genre info dock on the map, web, to deploy)

- Web: on the Genres map the genre info is a collapsible left dock (selected genre, chips select on the map with a back arrow, collapsed rail with a dot when a genre is selected, state saved, bottom sheet on phones) instead of the short preview with "Open card"; the popup stays for other entry points; the info is one reusable `renderGenreInfo` (GEN-097, task-0094). Tests not run, not seen in a browser.

- Web: second screen "Genres map v2" (`#/genres2`, nav item under "Genres map", GEN-101, task-0094): the Genres map with the left genre info dock; the Genres screen stays as deployed with the right-hand preview and "Open card"; both share the stored map preferences; "Show on map" selects on the screen the user is on (to deploy).

## 2026-10-23 (genres structure v2, docs, to deploy)

- Docs: ADR-0045 and task-0096 for genres structure v2 in parallel with v1 (Musicmap super-genres and clusters; first step the six EDM / Dance super-genres; GEN-102..GEN-105, DATA-197).

- Web and server: genres structure v2, a separate structure built in parallel (task-0094, GEN-102 to GEN-105, API-226, DATA-197): `GET /genres/v2` serves `server/data/genres_v2.json` (first only the six Musicmap EDM / Dance super-genres: Breakbeat, Drum 'n' Bass, Hardcore, House, Techno, Trance, no children); `#/genres2` shows only these circles in one cluster colour with the dock showing the mapped v1 description, sources and reference tracks; v1 vocabulary, graph and `#/genres` unchanged (to deploy).
- Genres structure v2: clusters carry Musicmap colours (`colour`, EDM / Dance #D52633); the six circles, chips and dock dot use the cluster colour in light and dark mode instead of the Rock chart slot (to deploy).
