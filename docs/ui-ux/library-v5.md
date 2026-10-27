# Library v5: design spec (iOS)

Status: spec, written 2026-10-21, brought in line with the cloud artifacts on 2026-10-22.
Implementation 2026-10-22: the four batches are implemented in source in
[task-0084](../tasks/task-0084.md). Xcode build and eight regression
tests passed; simulator comparison and device/VoiceOver verification are pending. The
"today" column below remains the pre-migration baseline. The dock and drawer
are unchanged; the supplied PDF is a visual reference, not a replacement for
the committed design tokens.
Source of truth: the "Electrophone Screens" Design artifact v53 (https://claude.ai/artifact/5K2BS7LFpb9qsKX7TtNyBm, page "Library v5": all frames, the clickable prototype, the Flows page and its legends) and the "Electrophone" Design System v37 (https://claude.ai/artifact/1SLwpCK4m4Xi5uWxFoFgSa: specimens, Icon section, Scrolling rules, READMEs). They are the latest design truth. This text is their written, implementation-oriented form: where the two differ, the artifacts win and this text is fixed. It replaces the ChatGPT sketches (`library-v5-gpt-prompt.md`, `library-v4-gpt-prompt.md`, both historical). Everything is expressed in the Electrophone design system ([brand README](../brand/README.md), [style guide](style-guide.md), `ios/Sources/DesignTokens.swift`).

Out of scope, only referenced: the docked mini-player, Now playing, the left drawer content, Playlists, Statistics, Settings, and the Add sheet. The mini-player and drawer stay exactly as they are today.

Notation: "today" means the code on 2026-10-21 (`ios/Sources/LibraryView.swift` = LV, `LibraryFilter.swift` = LF, `LibraryFilterModel.swift` = LFM, `Components.swift` = CMP, `PlayerService.swift` = PS). "NEW" means not built yet.
Reference frame: iPhone 13 Pro Max, 428 x 926 pt, status bar 54, bottom safe area 34 kept clear, the home indicator is not drawn in the mockups. Every layout must also hold at 390 and 375 pt. Sizes are points.

---

## Playback decision update — 2026-10-22 (accepted, not implemented)

[ADR-0043](../tech/decisions.md#adr-0043-persistent-queue-and-ephemeral-visible-song-audition)
supersedes the queue-replacement meaning of ordinary Library/Song Details
Play in this baseline spec. The dock continues controlling the queue;
Library/Song Details get a separate single-song audition with only Play/Pause,
which may sound simultaneously with the queue and never pauses or mutates it.
One audition replaces another. It stops when its owning row/details is no
longer visible, the user navigates away, locks or backgrounds/exits the app;
returning does not restart it. Opening Details ends a Library-owned audition
and requires a new Play there.

Implementation is pending in [task-0085](../tasks/task-0085.md); the cover tap
contract in 1.5, playing-cover state, tap zones in 3.4 and decisions 2/16/25
below record the current queue-based baseline, not the agreed audition target.
The new Play/Pause glyph must reflect audition; queue membership/current-song
status remains separate, including when both contexts have the same song.
Existing queue membership/remove actions are separate from audition transport.

The right-aligned count stays plain text beside an ellipsis button with
Play all matched, Show currently playing song and Clear all filters; show-current
continues referring to the queue song. Play all matched currently explicitly
replaces the queue (3.2); whether that and existing Play next/Play now commands
remain under the new model is unresolved, not silently redefined as audition.
Duration stays right-aligned with the title, the quick queue control sits
beneath it at 1.5 times its former glyph size, and listened count remains a
separate right-aligned value when available; bitrate is absent from mobile
Library rows. The filter label is **Decades**, formerly Era.

The original artifact remains the visual system authority; the newer explicit
owner playback decision controls behavior where the baseline differs.
[Canonical requirements and open choices](../specs/playback.md#two-independent-playback-contexts-adr-0043).

## 0. Purpose and principles

Key principle (CLAUDE.md): songs I pick are on my phone and play reliably, offline, with the screen locked. The Library is the place
where a person finds a song and starts it, and nothing on it may get in the way of that.

1. **Offline first.** Every control that works on songs already on the phone works with no network and no sign-in. A control that needs the
   server (Download, Get audio, Edit, Never listened, Last listened, statistics) is hidden or disabled with a reason, never a spinner that waits.
2. **One accent.** Cyan only, in the roles the tokens define: `accent`/`accentStrong` fill for the single lit action per surface (the + in the header), `accentInk` for
   text, outlines and icons that are "on", `accentTint` for chip washes. The quiet selection roles `selectTint`/`selectInk` mark a narrowed or non-default state in the controls line and the sheets (Done, Clear, the count while narrowing, a tinted sort icon). Red (`powerText`, `power`) only for destructive words and glyphs.
3. **Tokens only.** No hex, no literal radius, size or stroke in views. A value that has no token is listed in section 1.15.
4. **44 pt targets.** Every tappable control has a 44 x 44 hit area (`DS.Space.hit`) even when it draws smaller (chips and the sort circles draw 36, Download pill 32).
5. **Dynamic Type up to the largest accessibility size.** Text uses `T.*`; the root has no cap (IOS-122); layouts have an explicit large-text variant (screen S4).
6. **Nothing moves when a number changes.** The controls line has fixed slots; the only count is the right-aligned "N of total" count beside the ellipsis menu; the header has no counter; the sheets' match count uses tabular figures.
7. **One way to do each thing.** One Clear all filters action (in the ellipsis menu), one sort entry point (the Sort by icon), one way to apply a filter (live, no confirm button), one delete (in Song Details), one place per count.
8. **Contrast.** Text pairs are 4.5:1 in both themes, using the substitutions of the style guide (`ink` on `accentTint`, `powerText` for red words, `selectInk` on `selectTint` 4.5:1 by day, `ink-faint` never on a working control).

---

## 1. Component contract

Conventions: "hit" = 44 x 44 minimum; `surface slab` = `dsSlab` (`surface` fill + `DS.Shadow.depthSlab`); `float slab` = `dsFloat` (`surface` +
`depthLift` + 1 pt `line` ring, `DS.Stroke.strokeHairline`); "on" chips use `accentTint` fill with `accentInk`. VoiceOver is abbreviated VO.

### 1.1 Header (existing, count removed)

| Item | Spec |
| --- | --- |
| Layout | `ScreenHeader`: [Menu 44] [title "Library", `T.display`, `ink`, 1 line, minimumScaleFactor .7] [spacer] [Add 44]. Top padding `space2` (8), side inset `space4`, 44 high (52 with the top padding). Menu, title and + only: there is no counter. |
| Count | None. The library total lives only in the "N of 455" stack of the controls line (1.4), "455 of 455" when nothing narrows. Today the header shows "455 songs" (LV:132); it is removed. |
| Add | `LitCircleButtonStyle` 44 circle, `accent` fill + glow (`depthGlow`), `plus` 22 semibold in `onAccent`. VO: "Add a song", button. The only glowing element on the screen. |
| Menu | `MenuButton`, `line.3.horizontal`, `ink`, 44. VO "Open menu". |
| States | pressed: opacity .8. No disabled state. |
| Pinned | The header never scrolls away (1.14); the Songs/Albums switch and the controls line (1.4) stay pinned under it. |
| Large text | the title may take 2 lines; Menu and Add stay on the title line. |

### 1.2 Search field

| Item | Spec |
| --- | --- |
| Size | Full width, height 44 (`DS.Space.hit`), radius `DS.Radius.radiusKey` (12), fill `DS.Color.surfaceSunken`, no shadow. Today: height 48, literal radius 16, surface slab (LV:268-269). |
| Content | `magnifyingglass` 18 `inkMuted`, 8 gap (`space2`), text `T.body` `ink`, placeholder "Search songs, artists, tags" in `inkMuted`. Return key label "Search", it dismisses the keyboard and keeps the text. |
| Clear | `xmark.circle.fill` 18 `inkMuted`, hit 44, only while the field has text. No Cancel button. VO "Clear search". |
| Keyboard | Dismissed by: return, scrolling the list (`scrollDismissesKeyboard(.interactively)`), tapping a row zone, opening a sheet. The text stays. |
| States | default; focused: 2 pt (`DS.Stroke.strokeMedium`) `accentInk` ring; filled: Clear visible. |
| Position | The field is the first item of the scrolling list, above the chip row (1.14), so it scrolls away with the list and is back at the top of the list, on a status bar tap, on a sort change and on a typed search. |
| Search scope | Case- and diacritic-insensitive substring over title, artists (main, featured, with), album(s), remixer and version name, genres and tags (display labels, e.g. "the 90s" is not searched, "Lithuania" is). Combines (AND) with every filter. Live on each keystroke, no debounce above 150 ms. |
| VO | label "Search songs, artists and tags", trait searchField; value = text. |
| In sheets | The sheet search (Tags, Genres, Countries) is the same field at `field-height` 40. |

### 1.3 Filter chip row

One horizontally scrolling line, never wraps (at any text size). Order: **Tags, Genres, Decades, Countries, Never listened, Downloaded**.

| Item | Spec |
| --- | --- |
| Row | `ScrollView(.horizontal)`, no indicators, content leading inset `space4`, trailing inset `space4`, item gap `space2`, 12 pt above and below. Height 36 (`DS.Control.control`), each chip's hit extended to 44 (`contentShape` inset -4). |
| Peek | The row is masked with a 24 pt fade on the trailing edge (`chip-fade` 24) while more content exists, and the fade is removed when scrolled to the end, so the last visible chip is cut by the screen edge, never mid-word. At 428 pt the first four chips (77, 94, 105 and 112 pt wide, plus the gaps) end at the screen edge, so Never listened does not peek; only the fade shows that more exists. At 390 and 375 pt the fourth chip itself is cut by the edge (open question Q9). |
| Category chip (Tags, Genres, Decades, Countries) | Icon 16 (`DS.Icon.iconInline`) + label `T.subhead` medium, gap `space1`, horizontal padding `space3`. Icons (SF Symbols, regular weight): `tag`, `music.quarternote.3`, `calendar`, `globe`. Opens the category sheet (1.9). No count when nothing is selected. |
| Category chip, on | Fill `accentTint`, outline 1.5 pt (`strokeThin`) `accentInk`, label and icon `ink` (4.5:1 on `accentTint` in both themes) with semibold label, plus a count badge: capsule min 20 x 20 (`badge` 20), fill `scheme.strongFill`, number `T.caption` semibold in `scheme.onStrong`. Example "Genres [2]". |
| Toggle chip (Never listened, Downloaded) | Same shape. Icons `speaker.slash` and `iphone`. Off: like an off category chip. On: like an on category chip without badge, `isSelected` trait. |
| Off style | Fill `surface`, `DS.Shadow.depthSlab`, label `ink`, icon `inkMuted`. Today: off chips are `surface` slab, flexible width, with a count; toggles are an outline pill with count (CMP:145-173, 831-852). |
| Pressed | opacity .8, `durFast`. |
| Hidden | Never listened: shown only when listening data is loaded (signed in), otherwise hidden. Downloaded: hidden when signed out (everything is on the phone). Neither is ever shown disabled. |
| VO | Category: label "Genres", value "2 selected" or "none selected", hint "Opens the filter", button. Toggle: label "Never listened", hint "Shows only songs you have not played", button + selected when on. |
| Clear | There is no clear control in the row: Clear all filters is in the ellipsis menu (1.4). |

The list is narrowed ("narrowing") by any category selection, Never listened, Downloaded, a tag selection or a non-empty search. Narrowing is what turns the count select-ink and enables Clear all filters in the ellipsis menu.

### 1.4 Controls and results line

One 44 pt line when its contents fit, in this order:

`[Sort by icon 44] [Sort direction icon 44] [flexible space] [N of total] [ellipsis menu, right aligned]`

The sort controls align left and the match count aligns right. The count is plain text beside an ellipsis button. There are no standalone playback or Clear buttons. Tapping the ellipsis opens a native menu with **Play all matched**, **Show currently playing song** and **Clear all filters**.

| Control | Behaviour |
| --- | --- |
| Sort by | 44 pt target, 36 pt circle, custom `sort.criteria` glyph. Default `surface` slab and `ink`; non-default `selectTint` and `selectInk`. Opens Sort by. |
| Sort direction | 44 pt target, 36 pt circle, custom ascending/descending glyph for the effective order. Tap reverses direction and scrolls to the top. Reversed state uses `selectTint` and `selectInk`. |
| Count and actions | Always displays "N of total", optionally followed by "songs" when the row fits. Right aligned plain text in tabular `T.caption`, followed by a circular ellipsis menu button with a 44 pt target and the accessible label "Library actions". `inkMuted` normally and `selectInk` while narrowing. VoiceOver reads the count as "N of total songs matched"; Library actions is a separate menu control. |
| Play all matched | First ellipsis-menu action; replaces the queue with matching phone songs and explains skipped non-phone songs in a toast. Disabled with zero matches, during loading or on the error block. |
| Show currently playing song | Second ellipsis-menu action; scrolls to the current library song and restores accessibility focus. Disabled without a current song in the library. Like the web, a filtered-out song first offers Show in a confirmation; only Show clears filters before scrolling, retaining sort/direction. |
| Clear all filters | Third ellipsis-menu action; clears search, selected tags/categories and both filter toggles, keeps sort and direction, scrolls to the top and returns accessibility focus to the count. Disabled when no narrowing is active. |
| Loading and error | Loading retains the current count; error uses "0 of 0". The count stays visible and playback is disabled. |

**Width budget.** Prefer the full count with "songs", then the compact count without it. If neither fits, place sort controls on the first row and the count and ellipsis right aligned on the second.

**Large text.** From `accessibility1`, use the stacked layout above and retain the larger sort-control targets. The count and ellipsis remain right aligned and accessible.

**Sort glyphs.** `sort-criteria` (a card with three text lines and a funnel across its lower right corner), `sort-direction-desc` and `sort-direction-asc` (the second is the first mirrored top to bottom). 24 grid, stroke 1.75, round caps and joins, no fill, `currentColor`, drawn at 20 in the 36 circle. The SVG masters and the iOS delivery notes are in [`docs/brand/icons/`](../brand/icons/README.md). iOS ships them as custom symbols (template images in the asset catalog) named `sort.criteria`, `sort.direction.desc`, `sort.direction.asc`; until then the fallbacks are `line.3.horizontal.decrease.circle`, `arrow.down.to.line` and `arrow.up.to.line`. The reset glyph (`arrow.counterclockwise`) is not part of the set.

### 1.5 Song row

Row = `HStack(spacing: space3)` inside the list slab, padding `space3` all sides, min height 80 (cover 56 + 2 x 12). Rows are separated by a 1 pt
`line` hairline inset `space3` (hidden around the playing row, as today LV:344). The list slab is `surface` with radius `radiusCard` 20.

| Part | Spec |
| --- | --- |
| Cover | 56 x 56 (`cover-row` 56; `coverMd` stays 64 for the transport; today a literal in `@ScaledMetric` LV:468, scaled with Dynamic Type up to 1.5x), radius `radiusSm` 8, `CoverImage`. Tap zone: the cover plus the row padding around it (68 x 80, min 44). VO hidden (the row is one element, 1.5.1). |
| Cover tap = play | On the phone: play (replaces the queue with the phone songs of the current result set, in current order, starting here; no toast). The song already current: toggle pause and resume. Server only: start the download (same as the Download pill, never auto-plays). Downloading or waiting: nothing (toast "Already downloading" once). No audio: toast "No audio yet". |
| Play glyph at rest | A song on the phone that is not current shows a small play badge centred on its cover: a circle of `iconButton` 32 filled `coverScrim` with a Play glyph of `iconInline` 16 in `surface`, drawn in the light scheme so it reads on the scrim at night. It tells that the cover plays; the row tap stays Song Details. Server-only, downloading and no-audio songs show no badge (their tap is a download or a toast). Pressed: the cover scales to `enterScale` 0.96 and dims to 80% over `durFast`. VO unchanged (the badge is hidden). |
| Playing cover | Overlay: fill `coverScrim` (`vinyl` at 45%, both themes) and a persistent Pause glyph while playing or Play glyph while paused, matching the web cover button. The playing row also has the `accentTint` wash over the whole row. |
| Title | `T.headline` `ink`, max 2 lines (3 at large text), tail truncation. A positive known duration for a song with audio sits at the title line's trailing edge in `T.time`, using `formatTime`; unavailable or zero durations are omitted. Title and duration open details. |
| Artist line | `T.subhead`, `inkMuted` (`ink` on the playing row: `inkMuted` is 4.0:1 on `accentTint` at night), 1 line: "Artist · Year" (year = the displayed year, version year first, LIB-150; missing parts and the dot are omitted). No source mark, no BPM badge. |
| Audio controls | Audio state (1.6) and queue controls sit directly below duration in the same right-aligned column. |
| Listened count | Like the mobile web, a separate far-right column shows the right-aligned muted `listened.all` number when signed in and listening statistics are loaded; missing entries show 0, unavailable statistics show nothing. VoiceOver announces "Listened N times". Uses the existing shared statistics request. |
| Queue control | `queue.add` 24 (`iconPlay`, 1.5 times the previous `iconInline` glyph), `inkMuted`, with a `hit` target appends a downloaded non-current song without changing playback. A queued song instead shows `queue.included` at the same size in `accentInk`; tapping removes that song, preserving playback. Both glyphs use the exact web `listAdd` / `playlist` paths; the web Add action is also `ink-muted`, while queued status stays accented. The current song shows a non-interactive playlist status; unavailable audio has no add action. Existing add feedback and "Removed from queue" confirm changes; VO includes "in queue" and exposes the matching action. |
| Playing state | Row wash `accentTint`; title `ink`; artist and duration `ink`; cover scrim + persistent Pause/Play glyph; VO trait selected. |
| Pressed | Zone under the finger fades to .8 opacity, `durFast`. |
| Long press | Whole row. Opens the context menu (1.11); system haptic; the row lifts as the menu preview. |
| Disabled | There is no disabled row. "No audio yet" dims the cover and the text to 55% (`dim` 0.55); it stays tappable (details, menu). |
| Focus (keyboard, Full Keyboard Access) | 2 pt `accentInk` ring around the row, radius `radiusSm`. |
| Large text | Cover stays 56 scaled, title wraps up to 3 lines with duration at the trailing edge of its first line; audio state and queue control stay below duration. |

#### 1.5.1 Row VoiceOver

One accessibility element per row (the cover, the text and the Download pill are not separate stops).

- Label: "Title, Artist, 2024, 6:47, on iPhone, in queue, playing" (omit missing parts; state words as in 1.6).
- Traits: button; `isSelected` while playing.
- Default activation: play (same as the cover; on a server-only song: download).
- Custom actions in this order: Show details; Play next; Add to queue; Edit; Download (server only); Get audio (no audio only); Remove from iPhone. The same availability rules as the menu (1.11).

### 1.6 Audio-state variants (below duration)

| State | Trigger | Element | Style |
| --- | --- | --- | --- |
| On the phone | `library.contains(id)` | Duration "6:47" at the title's trailing edge | `T.time` (mono, medium), `inkMuted` (`ink` when playing) |
| Server only | `onServer != false`, not on the phone, no transfer | Outline pill "Download" | height 32, hit 44 (`contentShape` inset -6), 1.5 pt `accentInk` outline, label `T.caption` semibold `accentInk`, padding `space3`. Tap = download. VO label "Download Title" (action on the row, not a separate stop). |
| Downloading | transfer in progress | "Downloading 62%" | `T.caption` `accentInk`, 1 line (2 at large text). Waiting for the server: "Waiting…". |
| No audio yet | `onServer == false`, not on the phone, no transfer | "No audio yet" | `T.caption` `inkMuted`, right aligned, max width 84; cover and text opacity .55 |
| Arriving (not in the library yet) | transfer of a song not yet listed (signed-out Add, new song) | Same row, "Downloading NN%", no menu, not tappable | listed first, above the sorted list, regardless of sort |

The server's own state is never shown (IOS-030). Offline with a server-only song: the pill stays; a tap shows the toast "Can't reach the server".

### 1.7 Banners

One banner exists: **Offline**.

| Item | Spec |
| --- | --- |
| Where | Between the controls line and the list, `space3` gap above and below; shown while `server.reachable == false` and the library is not empty. |
| Look | Float-less slab: `surface` slab, radius `radiusKey` 12, padding `space3`, min height 44. `wifi.slash` 16 `inkMuted` + "Offline. Your downloaded songs still play." `T.caption` `ink`, then a text button "Retry" (`accentInk`, `T.caption` semibold, hit 44) at the right. |
| Behaviour | Not dismissible; disappears on its own when the server answers; "Retry" runs the catalog sync and reads "Checking…" while it runs. Pull to refresh does the same. |
| Enter | Rise `enterOffset` 8 + fade, `durBase`, `easeOut`. Reduce Motion: fade only. |
| VO | One element: "Offline. Your downloaded songs still play." with action "Retry"; announced once on appearance. |
| Today | LV:365-372, text "Offline. Showing your saved library.", no Retry. |

### 1.8 Toasts

| Item | Spec |
| --- | --- |
| Where | Top overlay of the Library, `space2` below the safe area, centered, never above the mini-player (which is at the bottom). |
| Look | Float slab, radius `radiusPill`, padding `space3` x `space2`, `T.caption` `ink`, max width 90% of the screen, up to 2 lines. |
| Timing | 2 s (3 s when longer than 40 characters); a new toast replaces the old one; no stacking. Enter: rise `enterOffset` + `enterScale` .96 to 1, `durBase` (fade only under Reduce Motion). |
| Haptics | `.success` for queue changes (today `queueTick`), `.warning` for delete (`deleteTick`). |
| VO | Posted as an announcement; the toast itself is not focusable. |

Strings (English, sentence case, no blame): "Plays next"; "Added to queue"; "Already in queue"; "Removed from this iPhone";
"Playing 40 songs" + " (queue replaced)" when upcoming songs were dropped + ", 15 not on this iPhone skipped"; "No listed songs are on this iPhone";
"No audio yet"; "Already downloading"; "Can't reach the server"; "Deleted "Title""; "Couldn't delete. Check the server and try again.";
server notices pass through unchanged (download failures, "Mobile data is off for downloads. Turn on Use mobile data in Settings.").
Today the skipped note reads "without audio skipped", which is wrong for songs that are on the server (LV:223-226): the new wording is "not on this iPhone".

### 1.9 Filter sheet (Tags, Genres, Countries, Decades)

Bottom sheet, `surface` fill, `presentationCornerRadius` `radiusTray` 28 on the top corners, float shadow, system grab handle (`grabW` 36 x `grabH` 5), over the system scrim at a low strength (about 35%) so the list behind stays readable. **It applies live and has no bottom button**: no "Show N songs", no Cancel, no per-category Clear. It closes with Done, a swipe down or a tap outside; the selection is already applied and persists in every case.

Anatomy, top to bottom, side padding `space4`:

| # | Part | Spec |
| --- | --- | --- |
| 1 | Grabber | System grab handle. |
| 2 | Title row (pinned) | Category name left, `T.title`, `ink`, header trait. **Done** right: `T.body` semibold `selectInk`, 44 target. VO: "Done", button. |
| 3 | Meta line (pinned) | Left: "32 genres · 2 selected" (`T.caption` `inkMuted`); the noun follows the category: genres, tags, decades, countries ("1 genre"). Right: the live match count "128 songs match" ("1 song matches", "0 songs match"), `T.caption` `inkMuted`, tabular figures, updated on every tap. |
| 4 | Search field | Tags, Genres, Countries only (not Decades): same field as 1.2, height 40 (`DS.Component.fieldHeight`, `dsField`), placeholder "Search genres" / "Search tags" / "Search countries", clear x, no Cancel. Filters the visible values live (case, diacritics); selected values that do not match stay selected and are still counted in the meta line. It scrolls with the values. |
| 5 | Values | Value chips (`TagChip`: 36 high, hit 44, horizontal padding 14, radius pill; off: `surfaceSunken` fill, `ink`; on: `scheme.strongFill` + `scheme.onStrong`, semibold) with the library-wide song count in `T.caption` (`inkMuted`, on: `scheme.onStrong`). Wrapped flow layout, gap `space2`. Decades: separate chronological century blocks with underlined headings and compact wrapping decade chips (large text: a vertical stack in each block). The search and the values scroll under the pinned rows, with a 24 pt fade at the bottom and a `line` hairline under the pinned rows once content scrolls. Bottom padding keeps the safe area clear. |

| Item | Spec |
| --- | --- |
| Value order | Decades: centuries and decades oldest first, then Unknown last. Others: selected-at-open first, then by song count descending, ties A-Z. The order is computed once when the sheet opens and is not updated while it is open (chips never jump under the finger). |
| Counts | Number of songs in the whole library that carry the value (not narrowed by other filters). The live match count in the meta line is the narrowed result. |
| Decades labels | Underlined headings read "19xx", "20xx", and so on; chips read "the 60s", "the 70s", "the 00s", and so on, followed by Unknown. VO reads the full decade: "2020s, 156 songs". |
| Unknown | Decades "Unknown" (songs without a year), Genres "Unknown" (no genre), Countries "Unknown" (no country): always last, counted like any value, combine like any value (OR within the category). |
| Detents | **Medium** (about 55%) by default, so the Library list stays visible above the sheet and visibly updates. **Large** (about 92%) when dragged up, when the sheet search is focused, for Tags (it opens at large, a long list) and at large text. **Decades fits its content** (shorter than medium). Use the system `.medium` and `.large` detents (`sheet-tall` 0.8 is retired for filter sheets, 1.15). Dragging a large sheet down returns to medium before it dismisses. The sheet does not change height when the keyboard opens. |
| Behind the sheet | Opening and closing a filter sheet preserves the search field, chip row, pinned-block height and list scroll position (1.14). The system sheet dims and scales the existing background without rearranging it; live filtering still updates matches. |
| Tap behaviour | Tap a chip toggles it; the list above updates immediately, then the count and ellipsis-menu availability in the controls line, then the sheet's "N songs match"; no haptic except selection (`.selection`). Selecting until nothing matches reads "0 songs match", the count "0 of 455" with Clear all filters enabled in the ellipsis menu, and Play all matched is disabled; there is no button to disable. |
| Dismiss | Done, swipe down or tap outside. Same result. The selection stays; the list keeps its scroll position; VO focus returns to the chip that opened it ("Genres, 2 selected"). |
| VO | Chip: label "House, 48 songs", `isSelected` when on. Sheet: header trait on the title; Done is a button; the escape gesture closes. |
| Today | LF:4-62: content-height sheet, no search, a "Clear" button, "Show N songs" button, a "Years" category built from `decade:` tags oldest first, values A-Z, subtitle "N in your library · M selected". |

### 1.10 Sort sheet

Bottom sheet opened by the Sort by icon, content height, same chrome as 1.9 (`radiusTray` 28, grab handle) but with no Done and no search. Title "Sort by" (`T.title`), then 7 rows of 48 pt (`DS.Component.rowHeight`) separated by `line` hairlines inset `space4`.

| Row | Icon (SF Symbol, 20 `iconNav`) | Notes |
| --- | --- | --- |
| Recently added | `clock` | default |
| Title | `textformat` | |
| Artist | `person` | |
| Year | `calendar` | |
| BPM | `metronome` | |
| Length | `timer` | |
| Last listened | `headphones` | Disabled with the caption "Sign in to use this" when listening data is not available (signed out, or never loaded) |

Row: icon `inkMuted` (selected: `accentInk`), label `T.body` `ink` (selected: semibold), trailing `checkmark` 16 `accentInk` on the selected row. Tap selects, resets the direction to the default of that criterion
(section 3.5), scrolls the list to the top and dismisses at once (`durSlow` slide). Re-selecting the current criterion only dismisses. VO: row label "Title", `isSelected` on the current one; disabled row reads "Last listened, needs sign in".

### 1.11 Context menu (long press on a row)

System `contextMenu` with the row as preview (UIKit menu: system typography, system red for the destructive item; this is the one accepted exception to "tokens only"). No "..." button anywhere on a row.

| Song state | Items (in this order) |
| --- | --- |
| On the phone, not playing | Play next (`text.insert`), Add to queue (`text.badge.plus`), Edit (`pencil`), Remove from iPhone (`iphone.slash`, destructive) |
| On the phone, currently playing | Edit |
| On the phone, local only (server no longer lists it, or signed-out library) | Play next, Add to queue (Edit only when signed in; no Remove from iPhone: it would erase the song, so deletion is in Song Details) |
| Server only | Download (`arrow.down.circle`), Edit |
| No audio yet | Get audio (`arrow.down.circle`), Edit |
| Downloading | Edit |
| Signed out | the phone rows above without Edit (Edit needs the server) |

"Delete from library" is NOT in this menu; it lives at the bottom of Song Details with a confirmation. VO exposes the same items as custom actions (1.5.1).

### 1.12 Empty and error blocks (`ContentUnavailableView` replacement)

Centered block, `space6` vertical padding: icon 40 `inkMuted`, title `T.headline` `ink`, text `T.body` `inkMuted` (max 3 lines), then up to two buttons: primary `LitButtonStyle` capsule (min height 44, content width, never full width) and secondary `DSButtonStyle(.outline)` (1.5 `accentInk` outline). No-match shows no button, because Clear all filters in the ellipsis menu is the only clear action. Today: system `.borderedProminent` / `.bordered` buttons (LV:309-310, 317-318, 322, 328, 332): not tokens.

### 1.13 Loading skeleton

Replaces the list slab only (header, search, chips and the controls line stay live; Play all matched is disabled). 8 skeleton rows of 80 inside the same slab: cover 56 placeholder (`surfaceSunken`, radius `radiusSm`), title bar 60% width x 14 and artist bar 40% x 12 (radius `radiusXs` 4), trailing bar 36 x 12. Pulse: opacity 1 to .5, `durPulse` .8 s ease in-out, repeating. Reduce Motion: static at .7. VO: one element "Loading your library", no row stops. A cached library is never replaced by a skeleton.

### 1.14 Pinned block and scrolling rules

**Library.** The slim header (1.1, 52 pt with its top padding), the Songs/Albums switch (signed in) and the controls line (1.4) are pinned: about 160 pt on an iPhone SE, 20 pt more at accessibility sizes. The search field and the chip row are the first items of the scrolling list: they scroll away with it and stay reachable at the top of the list (scroll to top, pull down, status bar tap).

| Rule | Spec |
| --- | --- |
| Search and chips | Part of the scrolling content (owner decision L7, 2026-10-27, replacing the collapse-on-scroll rule); no collapse animation and no direction tracking. The keyboard is dismissed by return, by scrolling the list (`scrollDismissesKeyboard(.interactively)`), by opening a sheet. |
| Hairline | A `line` hairline (`strokeHairline`) fades in under the pinned block (`durFast`) once content scrolls under it. |
| Sheets | Presentation and dismissal of a filter sheet do not change the background layout or scroll position (1.9). |
| Bottom | The 34 pt bottom safe area is kept clear; the list's bottom inset clears the mini-player (A). |
| Today | The whole screen is one `ScrollView` (LV:154-194): the header, search and chips scroll away with the list. |

**Other screens.**

| Screen | Pinned | Scrolls |
| --- | --- | --- |
| Library | Header (menu, title, +), the Songs/Albums switch and the controls line; hairline once content passes under | Search field, chip row and the song list |
| Settings, Statistics, Playlists | Header (menu or back, title, trailing action) | Everything below it |
| Song Details | Back, title, Edit | Cover, facts, statistics, actions |
| Now playing | Everything | Nothing: the main block does not scroll |
| Sheets | Grabber, title row (and the meta line on filter sheets) | Search and values, under a hairline; no pinned bottom button |

### 1.15 Tokens

All of these are in the Design System and exported (`docs/brand/tokens.json`, `ios/Sources/DesignTokens.swift`); they are listed here for the record.

| Token | Value | Use |
| --- | --- | --- |
| `cover-row` (`DS.Component.coverRow`) | 56 | Library row cover (replaces the literal; `coverMd` 64 stays for the transport) |
| `cover-scrim` (`DS.Color.coverScrim`) | `vinyl` at 45%, both themes | Dim layer under the Pause/Play glyph on the playing cover |
| `dim` (`DS.Opacity.dim`) | 0.55 | "No audio yet" cover and text (today a literal in LV:479, 485) |
| `badge` (`DS.Component.badge`) | 20 | Count badge on a selected category chip |
| `chip-fade` (`DS.Component.chipFade`) | 24 | Trailing scroll fade of the chip row |
| `sheet-tall` (`DS.Component.sheetTall`) | 0.8 | Retired for filter sheets (they use the system medium and large detents); unused until the open question Q11 is settled |
| `details-cover` (`DS.Component.detailsCover`) | 200 | Cover on Song Details (between `coverLg` 96 and full width) |

Already tokenised and reused: `DS.Space.*`, `DS.Radius.*`, `DS.Stroke.strokeThin/strokeMedium/strokeHairline`, `DS.Shadow.depthSlab/depthLift/depthGlow`, `DS.Control.control/grabW/grabH`,
`DS.Icon.iconInline/iconAction/iconNav/iconXs`, `DS.Color.selectTint/selectInk`, `DS.Motion.durFast/durBase/durSlow/durPulse/enterOffset/enterScale`, `DS.Component.rowHeight/fieldHeight`.
`T` lacks a semibold subhead role: use `T.subhead.weight(.semibold)` (= `DS.Dynamic.subheadStrong`).
The detents (about 55% and 92%) are the system `.medium` and `.large`, not tokens.

---

## 2. Screens

Every action-flow table has the columns: **User action → immediate UI response → resulting state → side effects (player / queue / library / network) → where focus and scroll land.**
"Scroll" is the Library list. "VO focus" is the VoiceOver cursor.

### A. Library, default (light and night)

**Purpose.** Find and start a song. **Entry.** App launch (landing screen), drawer "Library", back from Song Details, closing the Add sheet.

**Layout (top to bottom, 16 side inset).**

| Y | Element | Size |
| --- | --- | --- |
| status bar | system | 54 safe area at the top (Dynamic Island devices) |
| +8 | Header (1.1) | 44 high; pinned |
| | Songs/Albums switch (signed in) | pinned |
| | Controls and results line (1.4) | 44; pinned |
| +12 | Search field (1.2) | 44; scrolls with the list |
| +12 | Chip row (1.3) | 36 (44 hit), 12 above and below; scrolls with the list |
| +8 | List slab (1.5) | rows of 80, radius 20 |
| bottom | Safe area | 34 pt kept clear; the home indicator is not drawn |
| bottom | Mini-player (reference only, unchanged) | 64 high, floats 8 above the safe area; the list's bottom inset clears it (122 = 34 + 8 + 64 + 16) |

**Data.** Total from the catalog, rows from the filtered, sorted result set, queue marker from `player.queue`, audio state from `library` and `server.transfers`.
**Variants.** Rows: on the phone, server only, downloading, no audio yet, playing, queued. Signed out: no Downloaded chip, no Never listened, no Last listened. Nothing narrows the list: no Clear, the count is `inkMuted`. Night: same frame on dark tokens (S5).

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap cover (on the phone) | Row wash, Pause/Play glyph on the cover | Queue = phone songs of the current result set in current order, this song current, playing | `player.play(phoneSongs, startAt:)`; queue replaced; no toast | Scroll unchanged; VO stays on the row |
| Tap cover of the playing song | Cover glyph changes to Play / Pause | Paused / playing | `player.toggle()` | unchanged |
| Tap cover (server only) | Pill becomes "Downloading 0%" | Transfer started | `server.download`; never plays; no queue change | unchanged |
| Tap cover (no audio) | Toast "No audio yet" | none | none | unchanged |
| Tap title or artist | Push Song Details (screen I) | Library state kept in the app-level query object | none | Scroll and VO focus restored on return |
| Tap Download pill | Pill becomes "Downloading 0%" | Transfer | as above | unchanged |
| Long press row | Long-press menu (screen H) | Menu open | none | VO: custom actions |
| Tap search field | Keyboard, focus ring | Editing | none | Scroll unchanged |
| Tap Tags, Genres, Decades or Countries | Filter sheet opens (screens D, E, F); background layout stays in place | Sheet open | none | VO focus to the sheet title |
| Tap the Sort by icon | Sort sheet (screen C); the icon is tinted when the criterion is not Recently added | Sheet open | none | VO focus to the sheet title |
| Tap the Sort direction icon | Arrow flips (down: descending, up: ascending) and the bars reorder; circle tints / untints | Reversed flag toggles | none | Scroll to top |
| Tap Play all matched | Toast "Playing N songs"; the label never changes | Queue = the playable songs of the result set | `player.playAll` (random start under Shuffle); stays on Library | Scroll unchanged |
| Tap Clear all filters in the ellipsis menu | Search text, all filters, tag selections and both toggles clear; Clear all filters becomes disabled, the count turns `inkMuted` | Sort and direction untouched | none | Focus stays on the count; scroll to top; VO announces "Filters cleared, 455 songs" |
| Scroll the list down | Search and chips scroll away with the list; header, switch and controls line stay pinned (about 160 pt) with a hairline under them (screen M) | | none | |
| Scroll up, tap the status bar, or reach the top | Search and chips come back | | none | Status bar tap also scrolls to top |
| Tap the menu button | Left drawer opens (screen J) | | none | |
| Tap Add (+) | Add sheet | | none | Back: scroll and filters unchanged |
| Pull to refresh | Spinner | Catalog sync | `GET /catalog` (If-None-Match) | Scroll unchanged |

### B. Search results

**Purpose.** Narrow by text. **Entry.** Typing in the search field.
**Layout.** As A; the keyboard is open (list bottom inset follows it); the search field shows the clear x; the count stack reads "2 of 455" in `selectInk` with Clear all filters enabled in the ellipsis menu; Play all matched matches the count.
**Variants.** With filters on (G), with no results (K).

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Type a character | List filters live; the count updates in its fixed slot ("2 of 455" with Clear) | `search` set; order = current sort and direction | none | Scroll to top (instant) on every change; field keeps focus |
| Tap clear x | Field empties, x disappears | `search` = "" | none | Field keeps focus, scroll to top |
| Tap return | Keyboard closes | text stays | none | Scroll unchanged |
| Scroll the list | Keyboard closes interactively | text stays | none | |
| Tap cover / title / pill | Keyboard closes, action runs as in A | | | |
| Tap Clear | Search and filters clear | | | Keyboard closes; scroll to top |
| Search text matches only a remixer or tag | Song is listed | | | |
| No song matches | Empty results (K) | | | |
| Filters are also on | Active filters (G) | | | |

### C. Sort sheet

**Purpose.** Choose the criterion. **Entry.** Tap the Sort by icon. **Layout.** 1.10, content height, over a dimmed Library.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap another criterion | Check moves; sheet dismisses (`durSlow`); the Sort by icon tints unless the criterion is Recently added | Sort set, direction reset to that criterion's default, saved to UserDefaults | none | Library scrolls to top; VO focus to the Sort by icon (now reads the new value) |
| Tap the current criterion | Sheet dismisses | unchanged | none | unchanged |
| Tap Last listened while disabled | Nothing happens (VO reads the reason "Sign in to use this") | unchanged | none | |
| Swipe down / tap the scrim | Sheet dismisses | unchanged | none | VO focus to the Sort by icon |

### D. Genres sheet

**Purpose.** Pick genres. **Entry.** Tap Genres. **Layout.** 1.9 with search "Search genres", about 32 values, medium detent. Meta line "32 genres · 2 selected" and "128 songs match".
**Variants.** Nothing selected ("32 genres · 0 selected", "455 songs match"); some selected; search active (large detent); no search hits ("No genres match" `T.body` `inkMuted`).

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Open a filter sheet | Medium detent (about 55%); existing Library layout stays in place behind the system sheet; Tags opens at large | Sheet open | none | |
| Tap a value | Chip toggles; the list above updates immediately, then the count and ellipsis-menu availability in the controls line, then the sheet's "N songs match" (tabular figures, nothing jumps) | Selection changes (OR within the category, AND with other categories) | none | Sheet scroll unchanged; list keeps its scroll position |
| Focus the sheet search, or drag the sheet up | Sheet grows to the large detent; values filter, selected non-matches stay selected | | none | Keyboard open |
| Tap Done, swipe down, or tap outside | Sheet closes; the selection is already applied and stays | Selection kept | none | VO focus to the Genres chip (now "Genres, 2 selected"); the list keeps its scroll position |
| Select until 0 results | Sheet reads "0 songs match", the count "0 of 455" with Clear all filters enabled in the ellipsis menu, Play all matched disabled | | none | |

### E. Decades sheet

**Purpose.** Pick decades. **Entry.** Tap Decades. **Layout.** 1.9 without search; separate century blocks with underlined headings such as "19xx" and "20xx", oldest first; compact wrapping chips such as "the 60s", "the 70s" and "the 00s", oldest first within each block, with a count in each chip; Unknown follows all century blocks; meta line "8 decades · 2 selected" and "284 songs match"; the sheet fits its content (shorter than medium).
Decades = the displayed year (version year first) floored to ten; a song without a year is "Unknown". Stored `decade:` tags are ignored. VO reads "2020s".

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap an decade | Applies at once; two decades show songs of either (OR) | Selection changes | none | |
| Done, swipe down or tap outside | Same as the Genres sheet | Selection kept | none | Back to A; no search field |

### F. Tags sheet

**Purpose.** Pick tags (every non-genre, non-decade, non-country tag; `lang:` tags are never shown). **Entry.** Tap Tags. **Layout.** 1.9 with search "Search tags", 35+ values, opens at the large detent, scrolls. Meta line "35 tags · 2 selected" and "83 songs match".

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap a tag | Applies at once; values do not move while the sheet is open (selected-at-open values sit first; tags selected while open stay in place until the next opening) | Selection changes | none | |
| Done, swipe down or tap outside | Same as the Genres sheet | Selection kept | none | Back to A |

### G. Active filters (Genres 2)

**Purpose.** Show that a filter is on without a second strip. **Layout.** As A, with: Genres chip on (tint, outline, badge "2"); the count "128 of 455" in `selectInk` with Clear all filters enabled in the ellipsis menu; Play all matched (128 songs); no strip of values; no "N songs match" outside the sheets (the frame also shows the Sort by icon on Year).
Several categories on at once: each shows its own tinted chip; categories combine with AND.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap the tinted Genres chip | Genres sheet with the 2 selected values first (D) | | none | |
| Tap Clear all filters in the ellipsis menu | Every chip returns to off, the count reads "455 of 455" in `inkMuted`, Clear all filters becomes disabled | all filters and search cleared, sort kept | none | Focus stays on the count; scroll to top |
| Toggle Downloaded | Chip tints, list narrows | AND with the rest | none | Scroll position kept |
| Toggle Never listened | Chip tints, list narrows | Songs with no completed or skipped play, AND with the rest | needs `GET /stats/listening` (cached per session) | Scroll position kept |

### H. Long-press menu

**Purpose.** Per-song actions without a "..." button. **Entry.** Long press anywhere on a row. **Layout.** System context menu, row as preview, items of 1.11.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Play next | Menu closes, toast "Plays next" | Song inserted right after the current one (moved there if already queued); nothing loaded: it starts playing | `player.playNext`; `.success` haptic | Scroll unchanged; marker appears on the row |
| Add to queue | Toast "Added to queue" / "Already in queue" | Appended at the end, no duplicates; the marker appears | `player.enqueue` | unchanged |
| Edit | Song edit sheet (existing `SongEditView`, own Cancel and Save) | | `PATCH /songs/{id}` on Save | Back: scroll unchanged, row refreshed |
| Remove from iPhone | Toast "Removed from this iPhone"; row switches to the Download pill | Audio deleted; catalog entry kept; song leaves the queue | `library.removeAudio`; if it was queued, `removeFromQueue` | Scroll unchanged |
| Download / Get audio | Row shows "Downloading NN%" | Transfer | `server.download` / `server.getAudio` | unchanged |
| Dismiss (tap outside) | Menu closes | none | none | unchanged |

### I. Song Details (NEW screen, read-only)

**Purpose.** Everything known about a song, plus its statistics and the only delete. **Entry.** Tap title or artist in a row; "Show details" VO action; (later) mini-player. **Presentation.** Pushed on the Library `NavigationStack`
(swipe from the left edge or the back button returns). Library state is held in the app-level query object, so nothing is lost. Frames: top, end of the scroll, delete confirmation.

**Layout (header pinned, the rest scrolls, 16 side inset).**

| Order | Element | Spec |
| --- | --- | --- |
| 1 | Top bar (pinned) | Back `chevron.left` 44 (VO "Back"); title "Song Details" `T.headline`, centered; "Edit" text button at the right (`T.subhead` semibold `accentInk`, hit 44), signed in only |
| 2 | Cover | 200 x 200 (`details-cover`), radius `radiusCard`, centered, `depthSlab` |
| 3 | Title block | Title `T.title` centered (max 3 lines); artist `T.body` `inkMuted`; version / year line `T.subhead` `inkMuted` ("Original Mix · 2024", or the version label and year) |
| 4 | Primary button | `LitButtonStyle`, content width min 200, centered: "Play" (`play.fill`) on the phone; "Download to iPhone" for a server-only song; disabled "No audio yet" otherwise |
| 5 | Facts card | Surface slab (radius 20), rows of `rowHeight` 48 with `line` hairlines: label `T.subhead` `inkMuted` left, value `T.subhead` `ink` right-aligned (wraps to the left column at large text). Rows, each omitted when empty: Duration, BPM ("122 BPM"), Release year, Genres (pills), Tags (pills), Country (name), File name ("Artist - Title.m4a", only when on the phone, middle truncation, long press copies), Source (service name + chevron, opens the link). Date added, file size, and file format are omitted. Pills: `TagPill` (`accentTint`, `ink`). There is no musical key (not in the data model, Q3). |
| 6 | Playback statistics | Section label "Playback statistics" (`SectionLabel`), slab with three equal cells: Plays (number `T.title`, caption `inkMuted`), Last played ("2 days ago", full date as VO value), Total listened ("3 h 12 min"). Signed in only, from `GET /stats/listening`; hidden signed out or when never loaded. |
| 7 | Actions card | Slab, rows of 48 with icon 20 + label `T.body` `ink`: Play next, Add to queue, Share link, then Download (server only) or Remove from iPhone (on the phone, not local only). Play next and Add to queue only when on the phone and not current. |
| 8 | Delete | 32 below the actions card, centered text button "Delete from library" (`trash` 16 + `T.body`, `powerText`, hit 48), the last element of the scroll content; available for every song. The only delete in the app. |

The Edit sheet's cover summary shows the thumbnail, optional Remix line,
duration and BPM when available. It omits file size, file format, and date
added; duration and BPM remain visible in both the summary and Facts card.

**Variants.** On the phone / server only / no audio / downloading (primary button reads "Downloading NN%", disabled); signed out (no Edit, no statistics, Delete deletes the local song); the song vanished (deleted elsewhere): pop back with the toast "This song is no longer in your library".

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Back / swipe right | Pop | Library as left | none | Library scroll and VO focus on the row |
| Play | Button reads "Playing" for a moment | Queue = phone songs of the Library's current result set, this one first (the same as the cover) | `player.play` | stays on Details |
| Download to iPhone | Button shows "Downloading NN%" | Transfer | `server.download` | stays on Details |
| Edit | Song edit sheet over Details | | `PATCH` on Save | Back on Details, facts refreshed |
| Play next / Add to queue | Toast as in H | | as H | |
| Share link | Share sheet (`ShareSheet`) | | none | |
| Remove from iPhone | Toast; primary becomes "Download to iPhone"; action swaps | Audio removed, catalog kept | as H | |
| Delete from library | Confirmation dialog: title "Delete "Title" from the library?", message "Removes the song from your library, on the server and on this iPhone.", destructive "Delete from library", system Cancel | none until confirmed | none | VO focus to the dialog |
| Confirm delete | Pop to Library, toast "Deleted "Title"", `.warning` haptic | Song removed from the library (server first, then the phone, 404 counts as done); removed from the queue (the current song: playback moves on, PLY-046) | `DELETE /songs/{id}`, `library.delete`, `player.removeFromQueue` | Library scroll as left, VO focus to the row that took its place |
| Confirm delete, server unreachable | Dialog closes, toast "Couldn't delete. Check the server and try again." | Nothing removed | none | stays on Details |
| Cancel | Dialog closes | none | none | stays on Details |
| Tap Source | Opens the link in Safari | | none | |

### J. Left drawer (reference only)

Unchanged and out of scope: width 75% (321 at 428), Library selected (`selectTint` capsule), scrim, edge shadow `depthDrawer`; items Library, Now playing, Playlists (Soon), Statistics, Settings, and the account line. This spec only fixes that opening and closing the drawer never changes
Library state (search, filters, sort, direction, scroll position are kept), that tapping the scrim closes it with nothing else changing, and that choosing "Library" while on Library scrolls the list to the top.

### K. Empty results (no match)

**Entry.** Search and filters leave no song, while the library is not empty. **Layout.** As A, with the list slab replaced by the empty block (1.12): `magnifyingglass` icon, title "No songs found", text "Try a different search or clear the filters." No button: Clear all filters in the ellipsis menu is the one clear action. The count stack reads "0 of 455" in `selectInk` with Clear all filters enabled in the ellipsis menu; Play all matched is disabled.
Variant (not drawn): only Downloaded is on and nothing is stored: title "Nothing on this iPhone yet", text "Turn off Downloaded to see every song."

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap Clear | List returns | All cleared | none | Scroll top |
| Edit the search | List recomputes | | none | |
| Tap Play all matched (disabled) | Nothing | | | |

### L. Signed out, empty library

**Entry.** No sign-in session, no songs on the phone. **Layout.** Header only (menu, title, +): the search field, the filter chip row and the controls line are hidden while the library is empty and nobody is signed in; the block is centered in the remaining space.
Block: `music.note` icon, title "No songs yet", text "Your library is stored on this iPhone. Paste a YouTube or SoundCloud link to add songs, or sign in to search and sync.", primary "Add song", secondary "Sign in".

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Add song | Add sheet takes a pasted link (`AnonAddSheet`: link field, "Add", line "Sign in to search" + Sign in button) | | `POST /anon/downloads` on Add; row appears as "Downloading NN%" | Library shows the arriving row |
| Sign in | Settings opens (account card) | | none | |

### M. Library scrolled (search and chips gone), light and night

**Purpose.** Show the pinned block while the list scrolls. **Entry.** Scrolling the list down past 24 pt. **Layout.** The search field and the chip row are gone; the header and the controls line stay (about 96 pt) with a `line` hairline under them; the list runs beneath, rows cut by the hairline. Night twin on dark tokens.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Scroll up | Search and chips return (height and fade, 1.14) | | none | |
| Tap the status bar | Scroll to top; search and chips return | | none | Top |
| Reach the top | Search and chips return | | none | |
| Use the controls | Sort by, Sort direction, Play all matched, Clear work unchanged | as A | as A | Sort direction and Clear scroll to top, which brings search and chips back |

### S1. Loading skeleton

**Entry.** Signed in, first catalog sync, no cached songs (`server.syncing || !server.synced && no failure`). **Layout.** Header, search, chips and controls line as A (Play all matched disabled; the count keeps its text); list = 1.13. A cached library is never replaced by a skeleton.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Wait | Rows pulse | Sync completes | | List appears at the top |
| Type in the search | Field works, still skeleton | | none | |
| Sync fails | Error block (S3) | | | |

### S2. Offline banner

**Entry.** `server.reachable == false` with songs listed. **Layout.** A plus the banner (1.7). Downloaded songs play normally; server-only rows keep their pill.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap Retry | Banner shows "Checking…" (`T.caption`) for the request | Reachable: banner leaves. Not reachable: banner stays | `server.syncCatalog` | unchanged |
| Tap a Download pill | Toast "Can't reach the server" | unchanged | none | |
| Tap cover (on the phone) | Plays | | | |
| Connection returns | Banner leaves | | background sync | |

### S3. Error with Retry (no songs cached)

**Entry.** Signed in, sync failed, no cached songs. **Layout.** Header, search, chips and controls line as A, with the count "0 of 0", Play all matched disabled and no Clear; empty block: `wifi.slash` (unreachable) or `exclamationmark.triangle`, title "Can't reach the server" / "Couldn't load your library", text = the failure message or "Check the connection and try again.", primary "Retry". "Access denied" (403) uses `lock.slash`, the server text, no button.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap Retry | Block becomes the skeleton (S1) | Syncing | `syncCatalog` | |
| Success | List | | | Scroll top |
| Failure again | Block returns | | | VO focus to the title |

### S4. Large-text variant (accessibility1 and accessibility2)

| Element | Behaviour |
| --- | --- |
| Header | Title on up to 2 lines; Menu and Add stay on the title line |
| Search | Height grows with the text (min 44) |
| Chip row | Still one scrolling line, chips taller (min 44 drawn), peek and fade kept |
| Controls line | Two lines (1.4): sort controls left on the first row, count and ellipsis right on the second row |
| Song row | Cover 56 scaled; title up to 3 lines; trailing column under the artist line, left aligned; cover tap zone stays on the cover |
| Sheets | Filter sheets use the large detent; Decades chips become a vertical stack within each century block |
| Details | Facts rows stack label above value; statistics cells become 3 rows; cover 200 stays |
| Cap | `dynamicTypeSize(...accessibility2)` on the root; beyond it the OS scales nothing more |

### S5. Dark mode notes

Colours come from the tokens, so every screen has a dark twin (A and M are drawn in both); checks that matter:

- Slabs: `surface` is only slightly lighter than `ground` at night: the chip, row and banner edges rely on `depthSlab`; lists get no extra border. Float slabs (toast, sheets) use the 1 pt `line` ring and `depthLift` at 70%.
- On the value chips in sheets and the count badge: `scheme.strongFill` = `accent`, `scheme.onStrong` = `onAccent` (8.5:1); by day `accentStrong` + `ink` (4.8:1).
- `accentTint` rows at night: secondary text is `ink`, never `inkMuted` (4.0:1).
- `accentInk` is the pale cyan at night: Download pill, queue marker and links stay 11:1. `selectInk` on `selectTint` (tinted sort icons, Done, Clear, the narrowed count) is 4.5:1 by day and the pale cyan at night.
- Cover scrim and Pause/Play glyph use the established design tokens in both themes.
- Skeleton bars `surfaceSunken` (darker than `surface` in both themes) keep the "below the surface" meaning.
- Check every state in both themes on a device before TestFlight (batch 4).

---

## 3. Global flows and rules

### 3.1 Search, filter and sort: what applies, what resets what

Result set = `Library` songs, then AND of: search text; each category with a selection (OR inside the category); Never listened; Downloaded. Then sorted by the criterion and direction.

```
search text ──┐
Tags ─────────┤
Genres ───────┤  AND ──► result set ──► sort(criterion, direction) ──► rows ──► Play all matched = rows
Decades ──────────┤                                                     └──► count "N of total"
Countries ────┤
Never listened┤
Downloaded ───┘
```

| Change | Resets | Keeps | Scroll |
| --- | --- | --- | --- |
| Type in search | nothing | filters, sort, direction | top |
| Select a value in a filter sheet, toggle a chip | nothing | search, other filters, sort, direction | position kept (clamped to the new height) |
| Clear all filters (ellipsis menu) | search, all selections, Never listened, Downloaded | sort, direction | top |
| Change the sort criterion | direction (to the criterion's default) | search, filters | top |
| Sort direction icon | nothing | everything | top |
| Pull to refresh, catalog sync, download finishes | nothing | everything | unchanged (rows update in place) |
| Add, Edit save, Remove from iPhone | nothing | everything | unchanged |
| Delete from library | nothing | everything | unchanged |
| Switch drawer destination and return | nothing | everything | unchanged |
| Sign out | search, filters (library changes) | sort, direction | top |
| App relaunch | search, filters | sort, direction (UserDefaults) | top |

State lives in one app-level object (NEW `LibraryQuery`: `search`, `selection`, `neverListened`, `downloadedOnly`, `sort`, `reversed`), not in `LibraryView` `@State`, so navigation cannot lose it.

**Round trip to Song Details and back** keeps: search text, every selection and toggle, sort, direction, the scroll offset (the `ScrollView` stays in the stack), and the VO focus (back to the row that opened it). Returning from the Edit sheet, a
sheet, the Add sheet or the drawer is the same.

### 3.2 Play all matched semantics

- Set = the current result set in the current order (after search, filters, sort and direction). The count in the stack and in the VO label ("Play 128 matching songs") = its size (not the playable subset); the button label itself never carries a number.
- Only songs on the phone can play; the others are skipped and counted in the toast ("15 not on this iPhone skipped"). None playable: toast "No listed songs are on this iPhone", queue untouched.
- Replaces the whole queue (`player.playAll`), resets queue chips and the shuffle round. Stays on Library. Toast "Playing N songs".
- Shuffle off: starts at the first song. Shuffle on: starts at a random song of the set; the queue keeps list order.
- Repeat modes apply to the new queue as usual.
- Disabled at 0 matches, while loading and on the error block.
- "Add all" does not exist. Adding is per song (menu).

### 3.3 Long-press menu semantics

| Item | Exact meaning |
| --- | --- |
| Play next | Insert after the current song; if the song is already queued elsewhere it moves; nothing loaded: starts playing it. Not offered for the current song. |
| Add to queue | Append at the end, skip duplicates ("Already in queue"). Not offered for the current song. |
| Edit | Opens the song edit sheet (shared song form). |
| Remove from iPhone | Deletes the audio file only; catalog entry, metadata and server copy stay; the row becomes server only (Download pill). Not offered for local-only songs (it would erase them) or while the song is current. |
| Delete from library | NOT in the menu. Only in Song Details, bottom, with a confirmation. Deletes the song everywhere: server, phone, queue. |

### 3.4 Tap zones

| Zone | Tap | Long press |
| --- | --- | --- |
| Cover | play (toggle pause if current; download if server only) | menu |
| Title and artist | Song Details | menu |
| Duration, progress, "No audio yet", queue marker | Song Details | menu |
| Download pill | download | menu |
| Row anywhere else | Song Details | menu |
| Pause/Play glyph on the current cover | toggle pause | menu |

No swipe actions on rows.

### 3.5 Sort criteria (7), defaults, direction, ties

Default direction = "forward" (the order the criterion starts in). The Sort direction icon reverses it and always shows the effective order (arrow down = descending, arrow up = ascending). Songs without a value are always last, in both directions. Ties: Title A-Z (case and diacritic insensitive), then id. The direction resets to forward when the criterion changes.

| Criterion | Forward (default) | Icon at forward | Reversed | Sort key | Missing values |
| --- | --- | --- | --- | --- | --- |
| Recently added | Newest first | descending | Oldest first | `addedAt` | last |
| Title | A to Z | ascending | Z to A | base title (version label excluded), as web LIB-140 | none |
| Artist | A to Z | ascending | Z to A | first main artist, then base title | empty artist last |
| Year | Newest first | descending | Oldest first | displayed year (version year first) | last |
| BPM | Slowest first | ascending | Fastest first | `bpm` | last |
| Length | Shortest first | ascending | Longest first | `duration` (> 0) | last |
| Last listened | Most recent first | descending | Least recent first | `last_listened` (UTC date) | never listened last; signed in only |

VO value of the Sort direction icon = "descending" or "ascending" from this table. The Sort by icon is tinted when the criterion is not Recently added; the direction icon is tinted when the order is reversed from the criterion's default.

### 3.6 Filter logic

- **Across categories: AND.** A song must satisfy every category that has a selection.
- **Within a category: OR.** The web does the same (`matchesSelection` in `web/js/library-data.js`: `tags.some(...)`; LIB-030 "values in a category are OR, categories are AND"), so iOS keeps it. A selected "Unknown" is one more OR value of its category (web: `__unset__` token).
- **Never listened** and **Downloaded** are extra AND conditions. Never listened = no entry in `GET /stats/listening`, or listened plus skipped = 0; hidden until the data has loaded; if the request fails the toggle stays hidden and any earlier selection is dropped (as web LIB-190).
- **Search** is AND with all of it (1.2).
- Categories: Tags = every tag whose key is not genre, decade, country or lang (plain tags and other keys); Genres = genres; Countries = `country:` tags shown by name; Decades = computed from the displayed year, never from stored tags.

### 3.7 Decades values

The displayed year floored to the decade and grouped into chronological century blocks labelled "19xx", "20xx", and so on. Chips read "the 60s", "the 70s", "the 00s", and so on, oldest first within each block, each with the count of songs in the whole library; "Unknown" follows all blocks for songs with no year. VoiceOver reads the full decade ("2020s"). A decade is listed only if at least one song belongs to it; Unknown only if at least one song has no year. The category is called Decades (chip, sheet title, "8 decades · 2 selected").
Example: under "19xx", the 60s 4, the 70s 12, the 80s 32, the 90s 48; under "20xx", the 00s 72, the 10s 128, the 20s 156; Unknown 3 follows the blocks.
Today the category is "Years", built from `decade:` tags, labelled "the 90s", sorted oldest first (LFM:5-6, 20-22; LF; `tagLabel`).

### 3.8 Signed out versus signed in

| Area | Signed out | Signed in |
| --- | --- | --- |
| Songs | Only the songs stored on the phone (local library); no catalog, no server | Whole catalog (hundreds of songs); rows may be on the phone, on the server, downloading, or with no audio |
| Total in "N of total" | Phone songs | Catalog |
| Chip row | Tags, Genres, Decades, Countries | + Never listened (once listening data is loaded), + Downloaded |
| Sort | 6 criteria; Last listened disabled ("Sign in to use this") | 7 |
| Search | Over the phone songs; no YouTube search | Over the catalog; YouTube search lives in the Add sheet |
| Row states | On the phone, downloading (arriving) | all four |
| Menu | Play next, Add to queue (no Edit, no Download) | per 1.11 |
| Song Details | no Edit, no statistics | Edit, statistics |
| Add (+) | Add sheet takes a pasted YouTube or SoundCloud link, no search | Add sheet with search |
| Empty library | Screen L: "Your library is stored on this iPhone. Paste a YouTube or SoundCloud link to add songs, or sign in to search and sync." + Add song, Sign in | "No songs yet" "Add a song to start your library." + Add song |
| Offline | no banner (nothing to reach) | Offline banner (1.7) |

Playing downloaded songs never needs sign-in.

---

## 4. Decisions log

Corrections from Alex (the brief) and what they mean here. Entries marked "replaced" are kept for history; the current rule is in the entry named in the last column.

| # | Decision | Where |
| --- | --- | --- |
| 1 | No "..." button on rows; long press opens the full menu; title-trailing duration and artist-trailing listened count accompany the quick queue action/status | 1.5, 1.11 |
| 2 | In-queue marker: queue glyph with a checkmark, only for songs in the queue; the playing song keeps the tint and the Pause/Play glyph on its cover | 1.5 |
| 3 | No "N songs match" label in the Library; the header total never changes. Replaced by #29 and #31: the count is the "N of total" stack, the header has no counter, and "N songs match" lives only in the filter sheets | 1.1, 1.4, 1.9 |
| 4 | No "Add all"; adding is per song from the menu | 3.2 |
| 5 | ONE reset button in the results row; no "Clear all" elsewhere; no per-category Clear in sheets (removed to honour this; revisit if deselecting one by one proves slow); no Clear button in the empty state. Replaced by #30 for the form of the one clear (a text link, not an icon); the rest stands | 1.4, 1.9, K |
| 6 | No strip of selected values; a category with selections is a tinted chip with a count badge | 1.3 |
| 7 | Decades, not Years, computed from the displayed year, in chronological century blocks, plus Unknown. Renamed by #33 and #42 (the rule itself stands) | 1.9, 3.7 |
| 8 | No Cancel on search; scroll or return dismisses the keyboard | 1.2 |
| 9 | Delete from library only in Song Details, at the bottom, with a confirmation; never in the menu (reaffirmed in the 2026-10-22 artifacts) | 1.11, I |
| 10 | The results row is one line with fixed slots: Sort pill, Direction, Reset, Play all N. Replaced by #27 to #32 (icons, Play all matched, count stack) | 1.4 |
| 11 | The last chip peeks off screen with a trailing fade, never clipped mid-word. Refined by #40 | 1.3 |
| 12 | The mini-player, drawer and Now playing are not redrawn | scope |

Decisions made while writing this spec (beyond the brief):

| # | Decision | Reason |
| --- | --- | --- |
| 13 | Downloaded is the last toggle chip, after Never listened, in the same single-line row; no count on any unselected chip | Keeps one line; counts live in sheets |
| 14 | The direction resets to the criterion's default whenever the criterion changes (web LIB-208 keeps it) | Defaults differ per criterion (A-Z, newest first, slowest first); a kept flag would surprise |
| 15 | Sort and direction persist across relaunch; search and filters do not | A sort chosen is a preference, a search is a moment |
| 16 | Cover tap on the playing song toggles pause; on a server-only song it downloads (never plays) | Cover = primary action, consistent with "downloading never auto-plays" |
| 17 | Sheet values ordered by count (selected-at-open first), frozen while open; Decades uses chronological century blocks; counts are library-wide | Predictable under the finger |
| 18 | Unknown is last in Decades, Genres and Countries (web puts "not set" first, LIB-132) | Value order stays stable |
| 19 | "Show playing" leaves the Library toolbar | The controls line has no slot for it; see Q1 |
| 20 | Never listened and Last listened exist on iOS and need `GET /stats/listening` (signed in); they are hidden or disabled otherwise | Offline-first: no spinner for optional features |
| 21 | Song Details has no musical key row; the statistics card shows Plays, Last played, Total listened (no "First played": the API returns no first date) | Data that exists |
| 22 | Screen margin is 16 (`space4`, today), not the 24 of the sketch; row height stays 80 | Match today's metrics and tokens |
| 23 | Search placeholder "Search songs, artists, tags" | Says what is searched, fits at 375 |
| 24 | Toast wording "not on this iPhone skipped" replaces "without audio skipped" | Accuracy |
| 25 | Play next, Add to queue and Remove from iPhone are not offered for the song that is playing | Avoids a duplicate current song and deleting the open file |
| 26 | Large text relaxes "one line" for the controls line only (two lines: the controls and Play all matched, then the count stack) | Fixed slots cannot fit at accessibility sizes |

Decisions from the 2026-10-22 artifacts (Screens v53, Design System v37). Numbers 13 to 26 above keep their meaning; the new ones start at 27.

| # | Decision | Replaces | Where |
| --- | --- | --- | --- |
| 27 | The sort criterion is an icon button (`sort.criteria`, a list with a funnel), tinted `selectInk` on `selectTint` when the criterion is not Recently added, VO "Sort by, <criterion>"; it opens the 7-criteria Sort sheet | The text Sort pill ("Sort: Recently added") and #10 | 1.4, 1.10 |
| 28 | The sort direction is an icon button (`sort.direction.desc` / `.asc`: bars plus an arrow; the arrow flips with the effective order), tinted when reversed from the default, VO "Sort direction, descending"; default direction per criterion as before (3.5). Both glyphs are drawn at 20, stroke 1.75 (token `icon-stroke` is 1.8: mismatch, Q10), masters in `docs/brand/icons/` | The `arrow.up.arrow.down` button, VO "Reverse sort order", `accentTint` styling | 1.4, 3.5 |
| 29 | The controls line uses [Sort by][Sort direction][count and ellipsis right]; compact counts adapt to width; narrow/accessibility layouts show sort first, then the count and ellipsis | Results row `[Sort pill][Direction][Reset][Play all N]` (#10) and the two-line large-text rule of #26 (now covering the whole controls line) | 1.4, S4 |
| 30 | The reset icon is gone. The ellipsis menu offers Clear all filters, enabled only while narrowing, and clears search, filters, tag selections and both toggles; sort and direction stay. Still the only clear action | The Reset icon button (#5, #10) | 1.4, 3.1, K |
| 31 | The count is the stack "N of M" (always that form; "songs" word dropped below 370 pt of row width; `selectInk` while narrowing, `inkMuted` otherwise); the header has no counter (menu, title, + only) | The header total "455 songs" and the count inside "Play all N" (#3) | 1.1, 1.4 |
| 32 | "Play all matched" is an ellipsis-menu action, disabled at 0; the + stays the only filled cyan action | "Play all N" filled strong capsule with a fixed-width number | 1.4, 3.2 |
| 33 | Category "Era" is now "Decades"; chronological century blocks with compact decade chips and Unknown (VoiceOver reads "2020s"); sheet subtitles "N genres / tags / decades / countries · M selected" | "Era" label, "2020s" labels, subtitle "32 in your library · 2 selected" (#7 label) | 1.3, 1.9, 3.7 |
| 34 | The header block is pinned (header, Songs/Albums switch and controls line, about 160 pt on an iPhone SE); search and chip row are the first items of the list and scroll away with it (revised 2026-10-27, owner decision L7; before, they collapsed on scroll down); a `line` hairline appears under the pinned block once content scrolls under it | "List is not pinned" (a note of #22) and open question Q5 | 1.14, M |
| 35 | Scrolling rules for the other screens: the header stays pinned and only the content scrolls (Settings, Statistics, Song Details, Playlists); Now playing's main block does not scroll; sheets pin their title row (filter sheets also the meta line) and have no pinned bottom button | none (new) | 1.14 |
| 36 | Filter sheets apply LIVE: no "Show N songs" button, no Cancel; **Done** (`selectInk`) in the title row; the meta line shows "N genres · M selected" on the left and the live "K songs match" on the right; dismiss by Done, swipe down or tap outside, the selection stays; per-category Clear stays absent | The bottom "Show N songs" button, the "closes by the bottom button" rule, the subtitle "N in your library · M selected" | 1.9 |
| 37 | Filter sheet detents: medium (about 55%) by default so the list stays visible and visibly updates, large (about 92%) for Tags, when the search field is focused or when dragged up; Decades fits its content; background layout stays in place behind the sheet; the list keeps its scroll position on open and close | The fixed `.fraction(0.8)` detent (`sheet-tall`) and "Library scrolled to top when the sheet closes" | 1.9, D |
| 38 | `selectTint` / `selectInk` (not `accentTint` / `accentInk`) mark non-default and narrowing states in the controls line and sheets (tinted sort icons, Clear, the narrowed count, Done); the chips keep `accentTint` + `accentInk` | Reset and Direction styled with `accentTint` and `accentInk` | 1.3, 1.4, 1.9 |
| 39 | The bottom safe area (34 pt) stays clear and the home indicator is not drawn in the mockups; the reference frame is 428 x 926 and layouts must hold at 390 and 375 | Reference width 390 with 375 and 430 | notation, A |
| 40 | At 428 pt the first four chips end at the screen edge, so Never listened does not peek and only the 24 pt fade shows that more exists | "At 375 pt the first four chips fill about 396 pt, so Never listened always peeks" (#11 detail) | 1.3 |
| 41 | Selecting a value in a filter sheet or toggling a chip keeps the list's scroll position; text search, Clear, a new criterion and the direction icon scroll to the top | "Scroll to top" on every filter change | 3.1 |

| 42 | iOS category is named "Decades"; century grouping and decade filtering are unchanged | "Era" label from #33 | 1.3, 1.9, 3.7 |

---

## 5. Gap list and implementation order

### 5.1 Element by element: today versus this spec

| Element | Today (file:line) | Spec |
| --- | --- | --- |
| State location | LV:23-36 `@State` in the view | App-level `LibraryQuery` (3.1) |
| Pinned block | LV:154-194: one `ScrollView` holds header, search, chips, actions and the list; everything scrolls away | Header, switch and controls line outside the scroll view; search and chips scroll with the list (1.14) |
| Header | LV:129-138: "455 songs" caption beside +; otherwise matches | Remove the count (1.1) |
| Search field | LV:257-270: height 48, literal radius 16 (LV:269), slab fill, placeholder "Search songs or artists" (LV:260), clear x without a 44 hit | 44 high, `radiusKey`, `surfaceSunken`, new placeholder, 44 hit x, focus ring |
| Search scope | LV:54-60: title, artist, album, tags; no remixer, no diacritic folding | 1.2 |
| Chips | LV:289-298: 4-column grid (2 at large text), flexible width, count shown, selected = strong fill; CMP:145-173 | One scrolling row, intrinsic width, icon, tint + badge, fade; 6 items |
| Decades | LFM:5-6, 12, 20-22: category "Years" built from `decade:` tags, oldest first | "Decades": computed from the year, chronological century blocks and compact decade labels, plus Unknown |
| Downloaded toggle | LV:285-287, 141-145: a pill with a count beside the sort control; CMP:831-852 | Last chip of the row, no count |
| Never listened | missing | NEW toggle (listening data) |
| Sort control | LV:272-283: text `Menu` + `Picker` pill "Sort: Recently added" with a chevron (LV:282) | Sort by icon button opening a Sort sheet (1.4, 1.10) |
| Sort direction | missing | NEW icon button (1.4, 3.5) |
| Sort criteria | LV:3-6: four criteria | 7 criteria, defaults per criterion (3.5) |
| Sort logic | LV:61-76: Title and Artist raw strings, Year descending with -1 missing, no ties rule | 3.5 |
| Controls line | LV:207-221 `FlowLayout` of ActionChips (Show playing, Clear filters, Play all N, Add all N), wraps | 1.4: one 44 pt line, fixed slots |
| Count | LV:132 header caption "455 songs"; Play all N chip carries the result count | "N of M" stack in the controls line |
| Clear | LV:214, 203 chip "Clear filters" shown only when active | Text link "Clear" under the count, only while narrowing |
| Add all | LV:216-218, 239-246 | Removed |
| Show playing | LV:213, 248-255 | Removed from the toolbar (Q1) |
| Play all | LV:230-237: filled "Play all N" chip; toast uses "without audio skipped" (LV:223-226) | "Play all matched" outlined capsule (1.4), 3.2, new toast wording |
| Song row | LV:455-522 `LibrarySongRow`: whole row is one button, one tap = play / download / toast; trailing "..." | Three zones, no "..." (1.5, 3.4) |
| Row tap | LV:392-396, 379-380 | cover = play, text = details |
| Row menu | LV:412-433 "..." menu; LV:435-442 context menu lacks Remove from iPhone and has Delete; a11y actions LV:403-410 have Delete | 1.11 (no Delete, no "...") |
| Delete | LV:191-197, 427, 441, 410 in the menu | Only Song Details |
| In-queue marker | missing | NEW (1.5) |
| Playing cover | LV:520 tint only | + scrim + Pause/Play glyph |
| Audio-state | LV:487-498, 506-515: literals `maxWidth: 84`, `lineWidth: 1.5`, 55% | tokens (`dim`), same behaviour |
| Row accessibility | LV:503-505: one button, label with state, actions | 1.5.1 (adds Show details, Download, Get audio) |
| Filter sheet | LF:4-62: content-height detent, no search, a "Clear" button, a "Show N songs" button (LF:49), N values A-Z, subtitle "N in your library · M selected" | 1.9: live apply, Done, meta line with live match count, medium/large detents, search, order and counts, no Clear |
| LitButton | LF:66-77 | reuse for other sheets; no longer used by filter sheets |
| Song details | none (`SongEditView` is edit only) | NEW screen I |
| Empty states | LV:300-334 `ContentUnavailableView`, system buttons, "No songs match" + "Clear filters" button | 1.12, K: no second clear |
| Offline banner | LV:365-372, text "Offline. Showing your saved library." | 1.7 with Retry |
| Toast | LV:168-175 slab, 2 s | 1.8 float slab, enter motion |
| Skeleton | LV:313-314 `ContentUnavailableView` "Loading your library…" | 1.13 |
| Listening data | only inside `StatisticsView` (decoding private) | NEW shared `ListeningStore` |
| Sort glyphs | none (SF Symbols only) | NEW custom symbols `sort.criteria`, `sort.direction.desc`, `sort.direction.asc` (asset catalog, `docs/brand/icons/`) |
| Large text | LV:141-145, 290 | S4 |
| Queue membership | `player.queue` exists (PS:15) | marker reads it (use a `Set` of ids for speed) |

To verify in code during batch 3: `PlayerService.enqueue` / `playNext` when nothing is loaded (PS:145-160) behave as 3.3 says (queued, not auto-played, versus play).

### 5.2 Order of work (4 batches)

| Batch | Scope | Files |
| --- | --- | --- |
| 1. Controls line, results, sort, rows | Header without the count; the ONE 44 pt controls line with fixed slots (Sort by icon, Sort direction icon, Play all matched, "N of M" count stack with Clear all filters enabled in the ellipsis menu; width budget 428/390/375; two-line variant at accessibility1); Sort sheet with 7 criteria, defaults, ties and direction; custom sort symbols in the asset catalog (fallbacks until then); Play all matched menu wording; remove Add all and expose Show currently playing song in the ellipsis menu; song row with three zones, queue marker, playing scrim and Pause/Play glyph, no "..."; `LibraryQuery` app-level state with persisted sort; `ListeningStore` (for Last listened) | `LibraryView.swift` (split the row and the controls line out), `Components.swift` (SongRow pieces, icon buttons), NEW `LibraryQuery.swift`, NEW `LibrarySort.swift`, NEW `ListeningStore.swift`, `Assets.xcassets` (sort symbols from `docs/brand/icons/`) |
| 2. Filters and scrolling | Chip row (one line, icons, tint + badge, fade); Decades from year with Unknown and abbreviated labels; filter sheets that apply live (Done in the title row, meta line with live "N songs match", medium and large detents, Decades fits content, search, order, counts, Unknown values, no Clear, no bottom button); Never listened and Downloaded toggles; search scope; pinned header and controls line with the scroll collapse of search and chips, hairline, status bar tap | `LibraryFilter.swift`, `LibraryFilterModel.swift`, `Components.swift` (`CategoryChip`, `ToggleChip` replaced by one `FilterChip`), `LibraryView.swift` (header and controls outside the `ScrollView`, scroll offset tracking) |
| 3. Menu and Details | Long-press menu with the new items; VO custom actions; Song Details screen (read-only, statistics, actions, Delete with confirmation); Edit entry from Details; delete moved out of rows; the Settings, Statistics and Playlists headers pinned per the scrolling rules | NEW `SongDetailsView.swift`, `LibraryView.swift`, `SongEditView.swift` (entry only), `PlayerService.swift` (only if the queue edge cases of 5.1 need a fix), `ShareSheet.swift` (reuse) |
| 4. States and verification | Skeleton, offline banner with Retry, error and empty blocks on tokens, toast restyle, large-text variants, dark-mode and contrast verification on a device (including `selectInk` on `selectTint`), VO pass; docs: `docs/specs/ios.md` (IOS-030..033 rewritten), `docs/specs/library.md` iOS notes, `style-guide.md` gap closure | `LibraryView.swift`, `Components.swift`, `docs/specs/ios.md`, `docs/ui-ux/style-guide.md`, `docs/CHANGELOG.md` |

Each batch updates the docs that its code makes wrong, in the same commit (CLAUDE.md "Docs change with code").

---

## 6. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Where does "Show playing" live now that the controls line is full? | Long-press on the mini-player ("Show in Library"), in the dock phase; until then it is absent |
| Q2 | Song Details "First played": the API only returns `last_listened` and `total_listened_s` | Show Total listened now; add `first_listened` to `GET /stats/listening` later and swap |
| Q3 | Musical key: not in the data model; the sketch shows a Key row | Leave it out until a detector exists |
| Q6 | Direction reset on criterion change differs from web LIB-208: change the web to match? | Yes, same rule on both platforms |
| Q9 | At 375 pt the controls line leaves only 15 pt free (Play all matched keeps its full label) and the fourth chip is clipped by the edge at 390 and 375; large text wraps | Verify on a 375 pt device in batch 4; if tight, shorten the Play all matched padding before dropping the label |
| Q10 | The sort glyphs are drawn at stroke 1.75 while the token `icon-stroke` is 1.8 | Unify in the next token export (the 0.05 gap is invisible at 20 pt); until then the glyphs keep 1.75 |
| Q11 | `sheet-tall` 0.8 is unused: filter sheets use the system medium and large detents; the Flows legend still calls it the Sort sheet's height cap while the Sort frame fits its content, and the token's usage text still says filter sheets with search | Fit the Sort sheet to its content, retire the token in the next export and fix its usage text |
| Q12 | Never listened and Last listened need listening data (`GET /stats/listening`), so they are hidden or disabled until it loads | Ship `ListeningStore` in batch 1 and keep the hide/disable rule; no spinner |
| Q13 | The three sort glyphs are not yet custom symbols in the asset catalog | Export from `docs/brand/icons/` in batch 1; use the fallback SF Symbols until then |

Decided since the first version of this spec (kept so the numbers stay stable):

| # | Was | Decision |
| --- | --- | --- |
| Q4 | Filter-sheet counts: library-wide or narrowed? | Library-wide on the chips; the narrowed result is the live "N songs match" in the meta line (1.9) |
| Q5 | Pin the results row under the status bar while scrolling a 455-song list? | Yes: the header, switch and controls line are pinned, about 160 pt; search and chips scroll away (decision 34, 1.14) |
| Q7 | Play all N: show the result count or the playable count? | The button is "Play all matched" and carries no number; the count and the VO label use the result count, the toast explains the skips (decision 32, 3.2) |
| Q8 | Cover tap on a server-only song starts a download: acceptable? | Yes, it downloads and never plays (decision 16, 3.4) |
