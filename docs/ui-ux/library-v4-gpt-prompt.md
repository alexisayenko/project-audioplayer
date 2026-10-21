# Prompt for ChatGPT: Electrophone Library v4 (iPhone)

You are a senior iOS product designer. Draw the Library of "Electrophone", an offline-first music player for iPhone, as ONE consistent set of screens. Visual goal: calm, warm, precise, "quiet glass" on warm paper; every pixel aligned, every component identical wherever it appears. Beauty comes from proportion, alignment, restraint and typographic hierarchy, not decoration.

## Process (important, to prevent inconsistency)
1. First output a DESIGN CONTRACT as a table: every component below with exact size, radius, colour, type, state variants. Then draw ALL screens strictly from that contract. A component must look pixel-identical on every screen.
2. One canvas, same scale, same device frame: iPhone 13 Pro Max, 428 x 926 pt, status bar 9:41, home indicator. Grid: 24 pt side margins, 4 pt base unit (4/8/12/16/20/24/32).
3. Use the SAME fixed cast of songs on every screen (below). Do not invent new data per screen.
4. Do not add features, colours, gradients, textures or decorations that are not listed.

## Brand and tokens (use exactly)
Day: page #F3EFE6, surface #FBF8F2, sunken (search field, inactive chip) #E9E3D6, hairline #DDD5C6, ink #1B2024, muted #5F6669, faint #A0A3A2 (decoration only), accent cyan #57D3E9 (primary actions only), accent ink/teal #0C7289, selection tint #DDF3F5 with selection ink #00778D, playing-row tint #CDEEF3, danger #E54436, ok #1F8F45.
Night (draw one dark Library): page #1B1F22, surface #24282B, sunken #15181A, hairline #353B3F, ink #ECE8DF, muted #A3A9AB, accent #57D3E9, accent ink #9EDDE6, selection tint #2C383C, selection ink #AEE9F1.
Type: SF Pro. Large title 34/41 bold; title 22/28 bold; headline 17/22 semibold; body 17/22; subhead 15/20; caption 13/18; micro 11/14; durations and BPM in SF Mono 13 medium. Radii: cover 8, filter/search 12, cards 20, sheets 28, pills fully round. Strokes: 1 hairline, 1.5 outline pills. Icons: outline SF-Symbols style, 24 pt box, 1.75 pt stroke, identical optical weight. Shadows: almost none (slab: 0 2 10 at 8% ink). Touch targets at least 44 pt. Single accent: cyan; never mix a second blue/teal glow.
App icon (top of drawer only): black vinyl record, cyan label with four teal stripes, cream spindle hole, copper rim on ivory.

## Fixed cast (use on every screen)
1. Turn The Lights Off, Kato feat. Jon, 2026, 16:39, 120 BPM, on the phone (playing)
2. Mother Protect, Niki & The Dove, 2024, 6:47, 122 BPM, on the phone
3. Alma Zarza - Tutu, LatinHype, 2023, 2:54, 124 BPM, on the server only (shows a Download pill)
4. Heroes (we could be), Alesso feat. Tove Lo, 2014, 4:54, 128 BPM, downloading 62%
5. Under Control, Calvin Harris & Alesso, 2013, 3:04, no BPM yet, on the phone
6. Untitled Session 04, no artist, no year, no cover, no audio yet (dimmed 55%)
Covers: simple abstract artwork in the Electrophone palette (cyan, ink, copper, ivory), not photos; missing cover = ink square with cyan disc.

## Components (define in the contract, then reuse)
- Header: hamburger (left), "Library" 34 bold, "455 songs" caption muted (the TOTAL library, never filtered), round cyan + button 44 pt (cyan #57D3E9, glyph #0B2A33). Compact.
- Search: full-width 48 pt field, sunken, radius 12, magnifier, placeholder "Search songs or artists", clear x when typing, "Cancel" text button (teal) while focused. No coloured border.
- Filter chips: ONE horizontally scrolling row, 36 pt high, never wraps, last chip visibly peeks (not clipped mid-word): Tags, Genres, Years, Countries (each with small outline icon, label, and a count badge when active), then Never listened (a toggle chip, not a category). Active = selection tint + selection ink + count.
- Results row: left "3 songs match" (independent space, never squeezed; hidden when no filter/search, then show nothing), sort control "Sort: Recently added" with chevron (menu), SEPARATE round direction button with up/down arrow icon reflecting state, and "Downloaded 3" outline toggle pill. Below or beside, outlined action chips: Play all N (accent ink outline, always visible, disabled when 0), Add all N (visible only while search/filters are active), Show playing (only when something is playing), Clear filters (only when a filter is active). Keep this block to two lines max.
- Sort menu: Recently added, Title, Artist, Year, BPM, Length, Last listened (7 criteria; criteria only, no asc/desc entries; checkmark on current); direction lives only in the adjacent button.
- Song row (56-64 pt, compact, hairline inset dividers, no heavy table): 56 pt cover (tap = play), title headline up to 2 lines (tap text = open Song Details), muted "Artist · Year" on one line (truncate, never wrap), trailing column: duration (SF Mono) with the audio state beneath/instead: on phone = duration only; on server only = outlined "Download" pill; downloading = "62%" with a thin progress ring/bar; no audio = "No audio yet" and the whole row dimmed. Optional BPM mono badge (outlined, radius 4) only when known. Trailing "..." button (44 pt target). Playing row = full-width playing tint with a small animated equaliser glyph on the cover. Missing metadata never leaves gaps.
- Long-press menu (native iOS context menu look): Play next, Add to queue, Edit, Remove from iPhone (only if on phone), Delete from library (danger, confirmation).
- Filter sheet (per category, bottom sheet, 28 radius, grabber): category title, "N in your library · M selected", Clear, search field "Search genres", wrapped selectable chips with counts, selected = selection tint + check, primary button "Show 128 songs" (cyan). Draw Genres.
- Active-filter strip: removable chips above the list ("Genres: House x") only while filters are active.
- Mini-player (docked above the home indicator, when a song is loaded): cover 40, title, artist, play/pause, thin progress line; one panel only, no tab bar. The main menu is a LEFT drawer (75% width, 28 radius, app icon 42 pt + "Electrophone / Offline music player", items Library, Now playing, Playlists, Statistics, Settings, divider, account row "Sign in"); draw it open once.
- Song Details (read-only, opened from title/artist; Edit button top-right): back chevron, "Song Details", large cover, title, artist feat., version/year line, primary "Play" button, then a clean label-value table (Duration, BPM, Key, Release year, Genres as chips, Tags as chips, Country, Date added, File name "Artist - Title.m4a" with chevron, Source row), then "Playback statistics" card (Plays, Last played, First played). Actions row: Play next, Add to queue, Share link, Download/Remove.

## Screens to draw (same canvas, same scale)
A. Library default (light) | B. Search "alesso" with results and "3 songs match" | C. Sort menu open | D. Genres filter sheet open | E. Long-press menu on row 1 | F. Song Details | G. Left drawer open | H. Library dark mode | I. States: empty library, loading skeleton rows, "Can't reach the server" with Retry (offline banner while downloaded songs still play), no results | J. Library at accessibility large text (rows wrap, controls stack, nothing clips).

## Quality bar
Text on ivory must meet WCAG AA. Align icons and labels on one optical grid across all screens. Equal vertical rhythm between header, search, chips, results, list. No clipped words, no overlapping controls, no inconsistent corner radii, no second accent colour, no gradients, no glow. Offline-first is visible: every row shows its audio state calmly. Finish with a short "consistency checklist" confirming each component was reused identically.
