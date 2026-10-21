# Library v5: authoritative design spec (iOS)

Status: spec, written 2026-10-21. Source of truth for the iPhone Library, replacing the ChatGPT sketch
(`library-v5-gpt-prompt.md` and its last drawing, screens A to L), which stays a sketch: where this text and the drawing differ,
this text wins. Everything is expressed in the Electrophone design system ([brand README](../brand/README.md),
[style guide](style-guide.md), `ios/Sources/DesignTokens.swift`).

Out of scope, only referenced: the docked mini-player, Now playing, the left drawer content, Playlists, Statistics, Settings,
and the Add sheet. The mini-player and drawer stay exactly as they are today.

Notation: "today" means the code on 2026-10-21 (`ios/Sources/LibraryView.swift` = LV, `LibraryFilter.swift` = LF,
`LibraryFilterModel.swift` = LFM, `Components.swift` = CMP, `PlayerService.swift` = PS). "NEW" means not built yet.
Reference width 390 pt; every layout must also hold at 375 and 430 pt. Sizes are points.

---

## 0. Purpose and principles

Key principle (CLAUDE.md): songs I pick are on my phone and play reliably, offline, with the screen locked. The Library is the place
where a person finds a song and starts it, and nothing on it may get in the way of that.

1. **Offline first.** Every control that works on songs already on the phone works with no network and no sign-in. A control that needs the
   server (Download, Get audio, Edit, Never listened, Last listened, statistics) is hidden or disabled with a reason, never a spinner that waits.
2. **One accent.** Cyan only, in the roles the tokens define: `accent`/`accentStrong` fill for the single lit action per surface, `accentInk` for
   text, outlines and icons that are "on", `accentTint` for selection washes. Red (`powerText`, `power`) only for destructive words and glyphs.
3. **Tokens only.** No hex, no literal radius, size or stroke in views. A value that has no token is listed in section 1.14 as a NEW token.
4. **44 pt targets.** Every tappable control has a 44 x 44 hit area (`DS.Space.hit`) even when it draws smaller (chips draw 36, Download pill 32).
5. **Dynamic Type up to accessibility2.** Text uses `T.*`; the root caps at `.accessibility2`; layouts have an explicit large-text variant (screen S4).
6. **Nothing moves when a number changes.** The results row has fixed slots; counts live in one fixed-width slot; the total in the header never
   changes with filters.
7. **One way to do each thing.** One reset action, one sort entry point, one delete (in Song Details), one place per count.
8. **Contrast.** Text pairs are 4.5:1 in both themes, using the substitutions of the style guide (`ink` on `accentTint`, `powerText` for red words, `ink-faint` never
   on a working control).

---

## 1. Component contract

Conventions: "hit" = 44 x 44 minimum; `surface slab` = `dsSlab` (`surface` fill + `DS.Shadow.depthSlab`); `float slab` = `dsFloat` (`surface` +
`depthLift` + 1 pt `line` ring, `DS.Stroke.strokeHairline`); "on" chips use `accentTint` fill with `accentInk`. VoiceOver is abbreviated VO.

### 1.1 Header (existing, unchanged)

| Item | Spec |
| --- | --- |
| Layout | `ScreenHeader`: [Menu 44] [title "Library", `T.display`, `ink`, 1 line, minimumScaleFactor .7] [spacer] [total count] [Add 44]. Top padding `space2`, side inset `space4`. |
| Total count | "455 songs" / "1 song", `T.caption`, `inkMuted`. Total library size (signed out: songs stored on the phone). Never changes with search or filters. |
| Add | `LitCircleButtonStyle` 44 circle, `accent` fill + glow, `plus` 22 semibold in `onAccent`. VO: "Add a song", button. The only glowing element on the screen. |
| Menu | `MenuButton`, `line.3.horizontal`, `ink`, 44. VO "Open menu". |
| States | pressed: opacity .8. No disabled state. |
| Large text | title may take 2 lines; the count drops under the title (left aligned) and Menu and Add stay on the title line. |

### 1.2 Search field

| Item | Spec |
| --- | --- |
| Size | Full width, height 44 (`DS.Space.hit`), radius `DS.Radius.radiusKey` (12), fill `DS.Color.surfaceSunken`, no shadow. Today: height 48, literal radius 16, surface slab (LV:268-269). |
| Content | `magnifyingglass` 18 `inkMuted`, 8 gap (`space2`), text `T.body` `ink`, placeholder "Search songs, artists, tags" in `inkMuted`. Return key label "Search", it dismisses the keyboard and keeps the text. |
| Clear | `xmark.circle.fill` 18 `inkMuted`, hit 44, only while the field has text. No Cancel button. VO "Clear search". |
| Keyboard | Dismissed by: return, scrolling the list (`scrollDismissesKeyboard(.interactively)`), tapping a row zone, opening a sheet. |
| States | default; focused: 2 pt (`DS.Stroke.strokeMedium`) `accentInk` ring; filled: Clear visible. |
| Search scope | Case- and diacritic-insensitive substring over title, artists (main, featured, with), album(s), remixer and version name, genres and tags (display labels, e.g. "the 90s" is not searched, "Lithuania" is). Combines (AND) with every filter. Live on each keystroke, no debounce above 150 ms. |
| VO | label "Search songs, artists and tags", trait searchField; value = text. |

### 1.3 Filter chip row

One horizontally scrolling line, never wraps (at any text size). Order: **Tags, Genres, Decades, Countries, Never listened, Downloaded**.

| Item | Spec |
| --- | --- |
| Row | `ScrollView(.horizontal)`, no indicators, content leading inset `space4`, trailing inset `space4`, item gap `space2`. Height 36 (`DS.Control.control`), each chip's hit extended to 44 (`contentShape` inset -4). |
| Peek | The last visible chip must be cut obviously by the screen edge, never mid-word: the row is masked with a 24 pt fade on the trailing edge (NEW token `chip-fade` 24) while more content exists, and the fade is removed when scrolled to the end. At 375 pt the first four chips (about 80 + 92 + 96 + 100 pt) fill about 396 pt, so "Never listened" always peeks. |
| Category chip (Tags, Genres, Decades, Countries) | Icon 16 (`DS.Icon.iconInline`) + label `T.subhead` medium, gap `space1`, horizontal padding `space3`. Icons (SF Symbols, regular weight): `tag`, `music.quarternote.3`, `calendar`, `globe`. Opens the category sheet (1.9). No count when nothing is selected. |
| Category chip, on | Fill `accentTint`, outline 1.5 pt (`strokeThin`) `accentInk`, label and icon `ink` (4.5:1 on `accentTint` in both themes) with semibold label, plus a count badge: capsule min 20 x 20 (NEW token `badge` 20), fill `scheme.strongFill`, number `T.caption` semibold in `scheme.onStrong`. Example "Genres [2]". |
| Toggle chip (Never listened, Downloaded) | Same shape. Icons `speaker.slash` and `iphone`. Off: like an off category chip. On: like an on category chip without badge, `isSelected` trait. |
| Off style | Fill `surface`, `DS.Shadow.depthSlab`, label `ink`, icon `inkMuted`. Today: off chips are `surface` slab, flexible width, with a count; toggles are an outline pill with count (CMP:145-173, 831-852). |
| Pressed | opacity .8, `durFast`. |
| Disabled | Never listened only: shown when listening data is loaded (signed in), otherwise hidden. Downloaded: hidden when signed out (everything is on the phone). Neither is ever shown disabled. |
| VO | Category: label "Genres", value "2 selected" or "none selected", hint "Opens the filter", button. Toggle: label "Never listened", hint "Shows only songs you have not played", button + selected when on. |

Counting as "active" for the reset button: any category selection, Never listened, Downloaded, or non-empty search.

### 1.4 Results row

ONE line, always, in this order. Nothing changes position when counts or states change.

`[Sort pill, flexible] [Direction 44] [Reset 44] [Play all N, fixed]`

| Slot | Size and position | Spec |
| --- | --- | --- |
| Sort pill | flexible width, min 96, height 36, hit 44 | Capsule outline 1.5 pt `accentInk`, no fill. Label "Sort: " in `inkMuted` + criterion in `accentInk`, both `T.subhead` semibold, then `chevron.down` (`iconXs` 12, semibold, `accentInk`), padding `space3`. The label falls back by `ViewThatFits`: "Sort: Recently added" then "Recently added" then truncation is never allowed. Opens the sort sheet (1.10). VO: label "Sort", value "Recently added", hint "Opens sort options". |
| Direction | 44 x 44 slot, 36 circle | `arrow.up.arrow.down` 18 (`iconAction`). Default order: fill `surface` + `depthSlab`, icon `ink`. Reversed: fill `accentTint`, icon `ink`, outline 1.5 `accentInk`. VO: label "Reverse sort order", value = the current order in words (table 3.5), `isSelected` when reversed. |
| Reset | 44 x 44 slot, 36 circle | `arrow.counterclockwise` 18. Nothing active: fill `surface`, no shadow, icon `inkFaint`, VO `notEnabled`, tap does nothing. Active: fill `accentTint`, icon `ink`, outline 1.5 `accentInk`, enabled. VO "Clear search and filters". The only clear action on the screen. |
| Play all N | fixed width, right aligned | Capsule height 36, hit 44. `play.fill` 14 + "Play all 455", `T.subhead` semibold. Fill `scheme.strongFill`, label `scheme.onStrong`. Width fixed to the widest label "Play all 9999" at the current Dynamic Type size (measure once with a hidden twin), the visible label is right aligned inside; so 0 to 9999 never shifts anything. Disabled (N = 0): fill `accentTint`, label `inkFaint`, no glow. VO "Play all 455 songs", hint "Replaces the queue"; disabled: "Play all, no songs". |
| Gaps | `space2` between pill and direction, 0 between direction, reset (their slots are 44 wide with 36 circles, so the visible gap is 8), `space2` before Play all. |
| Widths | At 390 the pill gets 358 - 124 (Play all) - 44 - 44 - 16 = 130 pt: "Recently added" fits, "Sort: Recently added" (about 175 pt) fits only on 430 pt screens. At 375 the pill gets 115 pt; "Recently added" still fits (about 105 pt with the chevron) with its padding reduced to `space2`. The `ViewThatFits` ladder picks the longest label that fits. |
| Large text | From `accessibility1` the row becomes two lines in the same slot order: line 1 [Sort pill flexible] [Direction] [Reset]; line 2 [Play all N] full width, left aligned. This is the only exception to "one line". |
| Today | LV:141-146 and 207-221: a separate sort menu + Downloaded chip row, then a `FlowLayout` of Show playing, Clear filters, Play all N, Add all N chips that wraps and shifts. |

### 1.5 Song row

Row = `HStack(spacing: space3)` inside the list slab, padding `space3` all sides, min height 80 (cover 56 + 2 x 12). Rows are separated by a 1 pt
`line` hairline inset `space3` (hidden around the playing row, as today LV:344). The list slab is `surface` with radius `radiusCard` 20.

| Part | Spec |
| --- | --- |
| Cover | 56 x 56 (NEW token `cover-row` 56; `coverMd` stays 64 for the transport; today a literal in `@ScaledMetric` LV:468, scaled with Dynamic Type up to 1.5x), radius `radiusSm` 8, `CoverImage`. Tap zone: the cover plus the row padding around it (68 x 80, min 44). VO hidden (the row is one element, 1.5.1). |
| Cover tap = play | On the phone: play (replaces the queue with the phone songs of the current result set, in current order, starting here; no toast). The song already current: toggle pause and resume. Server only: start the download (same as the Download pill, never auto-plays). Downloading or waiting: nothing (toast "Already downloading" once). No audio: toast "No audio yet". |
| Playing cover | Overlay: fill `coverScrim` (NEW token: `vinyl` at 45%, both themes) and an equaliser glyph (`waveform`, 24, `surface`; bars animate while `isPlaying`, static when paused, static under Reduce Motion). The playing row also has the `accentTint` wash over the whole row. |
| Title | `T.headline` `ink`, max 2 lines (3 at large text), tail truncation. Tap zone with the artist line (details). |
| Artist line | `T.subhead`, `inkMuted` (`ink` on the playing row: `inkMuted` is 4.0:1 on `accentTint` at night), 1 line: "Artist · Year" (year = the displayed year, version year first, LIB-150; missing parts and the dot are omitted). No source mark, no BPM badge. |
| Trailing column | Right aligned, vertically centered, `VStack(alignment: .trailing, spacing: space1)`: line 1 = audio state (1.6); line 2 = in-queue marker, only when queued. Width follows content, min 44. |
| In-queue marker | `text.badge.checkmark` 16 (`iconInline`), `accentInk`, shown ONLY while the song is in `player.queue`. VO: part of the row label ("in queue"). Hidden when the song is not queued; the space is not reserved (the column is vertically centered, so the duration stays put). |
| Playing state | Row wash `accentTint`; title `ink`; artist and duration `ink`; cover scrim + equaliser; VO trait selected. |
| Pressed | Zone under the finger fades to .8 opacity, `durFast`. |
| Long press | Whole row. Opens the context menu (1.11); system haptic; the row lifts as the menu preview. |
| Disabled | There is no disabled row. "No audio yet" dims the cover and the text to 55% (NEW token `dim` 0.55); it stays tappable (details, menu). |
| Focus (keyboard, Full Keyboard Access) | 2 pt `accentInk` ring around the row, radius `radiusSm`. |
| Large text | Cover stays 56 scaled, text stack takes the width, the trailing column moves below the artist line, left aligned: audio state, then the queue marker on the same line as the duration. |

#### 1.5.1 Row VoiceOver

One accessibility element per row (the cover, the text and the Download pill are not separate stops).

- Label: "Title, Artist, 2024, 6:47, on iPhone, in queue, playing" (omit missing parts; state words as in 1.6).
- Traits: button; `isSelected` while playing.
- Default activation: play (same as the cover; on a server-only song: download).
- Custom actions in this order: Show details; Play next; Add to queue; Edit; Download (server only); Get audio (no audio only); Remove from iPhone. The same availability rules as the menu (1.11).

### 1.6 Audio-state variants (trailing column, line 1)

| State | Trigger | Element | Style |
| --- | --- | --- | --- |
| On the phone | `library.contains(id)` | Duration "6:47" | `T.time` (mono, medium), `inkMuted` (`ink` when playing) |
| Server only | `onServer != false`, not on the phone, no transfer | Outline pill "Download" | height 32, hit 44 (`contentShape` inset -6), 1.5 pt `accentInk` outline, label `T.caption` semibold `accentInk`, padding `space3`. Tap = download. VO label "Download Title" (action on the row, not a separate stop). |
| Downloading | transfer in progress | "Downloading 62%" | `T.caption` `accentInk`, 1 line (2 at large text). Waiting for the server: "Waiting…". |
| No audio yet | `onServer == false`, not on the phone, no transfer | "No audio yet" | `T.caption` `inkMuted`, right aligned, max width 84; cover and text opacity .55 |
| Arriving (not in the library yet) | transfer of a song not yet listed (signed-out Add, new song) | Same row, "Downloading NN%", no menu, not tappable | listed first, above the sorted list, regardless of sort |

The server's own state is never shown (IOS-030). Offline with a server-only song: the pill stays; a tap shows the toast "Can't reach the server".

### 1.7 Banners

One banner exists: **Offline**.

| Item | Spec |
| --- | --- |
| Where | Between the results row and the list, `space3` gap above and below; shown while `server.reachable == false` and the library is not empty. |
| Look | Float-less slab: `surface` slab, radius `radiusKey` 12, padding `space3`, min height 44. `wifi.slash` 16 `inkMuted` + "Offline. Your downloaded songs still play." `T.caption` `ink`, then a text button "Retry" (`accentInk`, `T.caption` semibold, hit 44) at the right. |
| Behaviour | Not dismissible; disappears on its own when the server answers; "Retry" runs the catalog sync. Pull to refresh does the same. |
| Enter | Rise `enterOffset` 8 + fade, `durBase`, `easeOut`. Reduce Motion: fade only. |
| VO | One element: "Offline. Your downloaded songs still play." with action "Retry"; announced once on appearance. |
| Today | LV:365-372, text "Offline. Showing your saved library.", no Retry. |

### 1.8 Toasts

| Item | Spec |
| --- | --- |
| Where | Top overlay of the Library, `space2` below the safe area, centered, never above the mini-player (which is at the bottom). |
| Look | Float slab, radius `radiusPill`, padding `space3` x `space2`, `T.caption` `ink`, max width 90% of the screen, up to 2 lines. |
| Timing | 2 s (3 s when longer than 40 characters); a new toast replaces the old one; no stacking. Enter: rise `enterOffset` + `enterScale` .96 to 1, `durBase`. |
| Haptics | `.success` for queue changes (today `queueTick`), `.warning` for delete (`deleteTick`). |
| VO | Posted as an announcement; the toast itself is not focusable. |

Strings (English, sentence case, no blame): "Plays next"; "Added to queue"; "Already in queue"; "Removed from this iPhone";
"Playing 40 songs" + " (queue replaced)" when upcoming songs were dropped + ", 15 not on this iPhone skipped"; "No listed songs are on this iPhone";
"No audio yet"; "Already downloading"; "Can't reach the server"; "Deleted "Title""; "Couldn't delete. Check the server and try again.";
server notices pass through unchanged (download failures, "Mobile data is off for downloads. Turn on Use mobile data in Settings.").
Today the skipped note reads "without audio skipped", which is wrong for songs that are on the server (LV:223-226): the new wording is "not on this iPhone".

### 1.9 Filter sheet (Tags, Genres, Countries, Decades)

Bottom sheet, `surface` fill, `presentationCornerRadius` `radiusTray` 28, system grab handle (`grabW` 36 x `grabH` 5). No Cancel, no Clear, no Done: it closes by swipe down,
scrim tap, or the bottom button; selections apply live and are kept in every case.

Anatomy, top to bottom, side padding `space4`, top padding `space6`:

| # | Part | Spec |
| --- | --- | --- |
| 1 | Title | Category name, `T.title`, `ink`, header trait. |
| 2 | Subtitle | "32 in your library · 2 selected" `T.caption` `inkMuted`. |
| 3 | Search field | Tags, Genres, Countries only (not Decades): same field as 1.2, height 40 (`DS.Component.fieldHeight`, `dsField`), placeholder "Search genres" / "Search tags" / "Search countries", clear x, no Cancel. Filters the visible values live (case, diacritics); selected values that do not match stay selected and are counted in the subtitle. |
| 4 | Values | Value chips (`TagChip`: 36 high, hit 44, horizontal padding 14, radius pill; off: `surfaceSunken` fill, `ink`; on: `scheme.strongFill` + `scheme.onStrong`, semibold) with the song count in `T.caption` (`inkMuted`, on: `scheme.onStrong`). Flow layout, gap `space2`. Decades: a 2 column grid of equal chips (large text: 1 column). Scrolls when taller than the available height. |
| 5 | Primary button | `LitButtonStyle` (52 high, `accent` fill + glow, `onAccent` label): "Show 128 songs" ("Show 1 song"). 0 results: label "No songs match", disabled (`accentTint`, `inkFaint`). Pinned at the bottom of the sheet, above the safe area; `space4` below the values. |

| Item | Spec |
| --- | --- |
| Value order | Decades: newest first (2020s, 2010s, ...), then Unknown last. Others: selected-at-open first, then by song count descending, ties A-Z. The order is computed once when the sheet opens and is not updated while it is open (chips never jump under the finger). |
| Counts | Number of songs in the whole library that carry the value (not narrowed by other filters). The button shows the live result count. |
| Unknown | Decades "Unknown" (songs without a year), Genres "Unknown" (no genre), Countries "Unknown" (no country): always last, plain style, counted like any value, combine like any value (OR within the category). |
| Height | Decades: content height (about 380 at 390 wide). Tags, Genres, Countries (search + many values): fixed detent `.fraction(0.8)` (NEW token `sheet-tall` 0.8) so the sheet does not change height when the keyboard opens; the value area scrolls and shrinks above the keyboard, the button stays visible. Large text: `.large`. |
| Tap behaviour | Tap a chip toggles it; the list behind updates at once; the button count updates; no haptic except selection (`.selection`). |
| VO | Chip: label "House, 48 songs", `isSelected` when on. Sheet: header trait on the title; the button is the last stop; escape gesture closes. |
| Today | LF:4-62: content-height sheet, no search, a "Clear" button, years from `decade:` tags oldest first, values A-Z, button "Show N songs". |

### 1.10 Sort sheet

Bottom sheet, content height, same chrome as 1.9 (no Cancel, no button). Title "Sort by" (`T.title`), then 7 rows of 48 pt (`DS.Component.rowHeight`) separated by `line` hairlines inset `space4`.

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

"Delete from library" is NOT in this menu. VO exposes the same items as custom actions (1.5.1).

### 1.12 Empty and error blocks (`ContentUnavailableView` replacement)

Centered block, `space6` vertical padding: icon 40 `inkMuted`, title `T.headline` `ink`, text `T.body` `inkMuted` (max 3 lines), then up to two buttons: primary `LitButtonStyle` capsule (min height 44, content width, never full width) and secondary `DSButtonStyle(.outline)`. Today: system `.borderedProminent` / `.bordered` buttons (LV:309-310, 317-318, 322, 328, 332): not tokens.

### 1.13 Loading skeleton

Replaces the list slab only (header, search, chips and the results row stay live; Play all shows 0 and is disabled). 8 skeleton rows of 80 inside the same slab: cover 56 placeholder (`surfaceSunken`, radius `radiusSm`), title bar 60% width x 14 and artist bar 40% x 12 (radius `radiusXs` 4), trailing bar 36 x 12. Pulse: opacity 1 to .5, `durPulse` .8 s ease in-out, repeating. Reduce Motion: static at .7. VO: one element "Loading your library", no row stops.

### 1.14 NEW tokens needed (add to the Design System, then re-export)

| Token | Value | Use |
| --- | --- | --- |
| `cover-row` (`DS.Component.coverRow`) | 56 | Library row cover (replaces the literal; `coverMd` 64 stays for the transport) |
| `cover-scrim` (`DS.Color.coverScrim`) | `vinyl` at 45%, both themes | Dim layer under the equaliser on the playing cover |
| `dim` (`DS.Opacity.dim`) | 0.55 | "No audio yet" cover and text (today a literal in LV:479, 485) |
| `badge` (`DS.Component.badge`) | 20 | Count badge on a selected category chip |
| `chip-fade` (`DS.Component.chipFade`) | 24 | Trailing scroll fade of the chip row |
| `sheet-tall` (`DS.Component.sheetTall`) | 0.8 | Detent fraction of filter sheets with search |
| `details-cover` (`DS.Component.coverDetails`) | 200 | Cover on Song Details (between `coverLg` 96 and full width) |

Already tokenised and reused: `DS.Space.*`, `DS.Radius.*`, `DS.Stroke.strokeThin/strokeMedium/strokeHairline`, `DS.Shadow.depthSlab/depthLift/depthGlow`, `DS.Control.control/grabW/grabH`,
`DS.Icon.iconInline/iconAction/iconNav/iconXs`, `DS.Motion.durFast/durBase/durSlow/durPulse/enterOffset/enterScale`, `DS.Component.rowHeight/fieldHeight`.
`T` lacks a semibold subhead role: use `T.subhead.weight(.semibold)` (= `DS.Dynamic.subheadStrong`).

---

## 2. Screens

Every action-flow table has the columns: **User action → immediate UI response → resulting state → side effects (player / queue / library / network) → where focus and scroll land.**
"Scroll" is the Library list. "VO focus" is the VoiceOver cursor.

### A. Library, default (light)

**Purpose.** Find and start a song. **Entry.** App launch (landing screen), drawer "Library", back from Song Details, closing the Add sheet.

**Layout (top to bottom, 16 side inset).**

| Y | Element | Size |
| --- | --- | --- |
| status bar | system | 54 safe area at the top (Dynamic Island devices) |
| +8 | Header (1.1) | 44 high |
| +12 | Search field (1.2) | 44 |
| +12 | Chip row (1.3) | 36 (44 hit) |
| +12 | Results row (1.4) | 44 |
| +8 | List slab (1.5) | rows of 80, radius 20 |
| bottom | Safe area | 34 pt kept clear; the home indicator is not drawn |
| bottom | Mini-player (reference only, unchanged) | overlays the bottom, the list gets bottom inset = mini-player height + `space4` |

**Data.** Total from the catalog, rows from the filtered, sorted result set, queue marker from `player.queue`, audio state from `library` and `server.transfers`.
**Variants.** Rows: on the phone, server only, downloading, no audio yet, playing, queued. Signed out: no Downloaded chip, no Never listened, no Last listened. Nothing is selected: Reset is faint.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap cover (on the phone) | Row wash, equaliser on the cover | Queue = phone songs of the current result set in current order, this song current, playing | `player.play(phoneSongs, startAt:)`; queue replaced; no toast | Scroll unchanged; VO stays on the row |
| Tap cover of the playing song | Equaliser stops / starts | Paused / playing | `player.toggle()` | unchanged |
| Tap cover (server only) | Pill becomes "Downloading 0%" | Transfer started | `server.download`; never plays; no queue change | unchanged |
| Tap cover (no audio) | Toast "No audio yet" | none | none | unchanged |
| Tap title or artist | Push Song Details (screen I) | Library state kept in the app-level query object | none | Scroll and VO focus restored on return |
| Tap Download pill | Pill becomes "Downloading 0%" | Transfer | as above | unchanged |
| Long press row | Context menu (screen H) | Menu open | none | VO: custom actions |
| Tap search field | Keyboard, focus ring | Editing | none | Scroll unchanged |
| Tap a chip / Sort pill | Sheet (screens D-F, C) | Sheet open | none | VO focus to the sheet title |
| Tap Direction | Order flips, circle tints / untints | Reversed flag toggles | none | Scroll to top |
| Tap Play all N | Toast "Playing N songs" | Queue = the playable songs of the result set | `player.playAll` (random start under Shuffle); stays on Library | Scroll unchanged |
| Tap Reset (active) | Everything clears, Reset goes faint | search, selections, Never listened, Downloaded cleared; sort and direction untouched | none | Scroll to top; VO announces "Filters cleared, 455 songs" |
| Tap Add (+) | Add sheet | | none | Back: scroll and filters unchanged |
| Pull to refresh | Spinner | Catalog sync | `GET /catalog` (If-None-Match) | Scroll unchanged |
| Tap status bar | Scroll to top | | | |

### B. Search results

**Purpose.** Narrow by text. **Entry.** Typing in the search field.
**Layout.** As A; the keyboard is open (list bottom inset follows it); the search field shows the clear x; Reset is tinted; Play all N shows the match count.
**Variants.** With filters on (G), with no results (K).

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Type a character | List filters live; Play all label updates in its fixed slot | `search` set; order = current sort and direction | none | Scroll to top (instant) on every change; field keeps focus |
| Tap clear x | Field empties, x disappears | `search` = "" | none | Field keeps focus, scroll to top |
| Tap return | Keyboard closes | text stays | none | Scroll unchanged |
| Scroll the list | Keyboard closes interactively | text stays | none | |
| Tap cover / title / pill | Keyboard closes, action runs as in A | | | |
| Tap Reset | Search and filters clear | | | Keyboard closes; scroll to top |
| Search text matches only a remixer or tag | Song is listed | | | |

### C. Sort sheet

**Purpose.** Choose the criterion. **Entry.** Tap the Sort pill. **Layout.** 1.10, content height (about 410 at 390 wide), over a dimmed Library.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap another criterion | Check moves; sheet dismisses (`durSlow`) | Sort set, direction reset to that criterion's default, saved to UserDefaults | none | Library scrolls to top; VO focus to the Sort pill (now reads the new value) |
| Tap the current criterion | Sheet dismisses | unchanged | none | unchanged |
| Tap Last listened while disabled | Nothing happens (VO reads the reason) | unchanged | none | |
| Swipe down / tap scrim | Sheet dismisses | unchanged | none | VO focus to the Sort pill |

### D. Genres sheet

**Purpose.** Pick genres. **Entry.** Tap Genres. **Layout.** 1.9 with search "Search genres", about 32 values, detent .8.
**Variants.** Nothing selected (subtitle "32 in your library · 0 selected"); some selected; search active; no search hits ("No genres match" `T.body` `inkMuted`).

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap a value | Chip toggles; subtitle and button update; list behind updates | Selection changes (OR within the category, AND with other categories) | none | Sheet scroll unchanged; Library scrolled to top when the sheet closes |
| Type in the sheet search | Values filter; selected non-matches hidden but still selected | | none | Keyboard open; sheet height unchanged |
| Tap "Show N songs" / swipe down / scrim | Sheet closes | Selection kept | none | VO focus to the Genres chip (now "Genres, 2 selected") |
| Select until 0 results | Button becomes "No songs match" (disabled) | | none | |

### E. Decades sheet

**Purpose.** Pick decades. **Entry.** Tap Decades. **Layout.** 1.9 without search; 2 column grid: 2020s 156, 2010s 128, 2000s 72, 1990s 48, 1980s 32, 1970s 12, 1960s 4, Unknown 3 (example); content-height sheet.
Decade = the displayed year (version year first) floored to ten; a song without a year is "Unknown". Stored `decade:` tags are ignored.
Flows: as D (no search). Selecting two decades shows songs of either (OR).

### F. Tags sheet

**Purpose.** Pick tags (every non-genre, non-decade, non-country tag; `lang:` tags are never shown). **Entry.** Tap Tags. **Layout.** 1.9 with search, 40+ values, detent .8, scrolls.
Flows: as D. With many selections, the selected-at-open values sit first; tags selected while the sheet is open do not move until the next opening.

### G. Active filters (Genres 2)

**Purpose.** Show that a filter is on without a second strip. **Layout.** As A, with: Genres chip on (tint, outline, badge "2"); Reset tinted; Play all 128; no strip of values; no "N songs match".
Several categories on at once: each shows its own tinted chip; categories combine with AND.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap the tinted Genres chip | Genres sheet with the 2 selected values first | | none | |
| Tap Reset | All chips return to off, Reset to faint | all filters and search cleared, sort kept | none | Scroll to top |
| Toggle Downloaded | Chip tints, list narrows | AND with the rest | none | Scroll to top |
| Toggle Never listened | Chip tints, list narrows | Songs with no completed or skipped play, AND with the rest | needs `GET /stats/listening` (cached per session) | Scroll to top |

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
(swipe from the left edge or the back button returns). Library state is held in the app-level query object, so nothing is lost.

**Layout (scrolls, 16 side inset).**

| Order | Element | Spec |
| --- | --- | --- |
| 1 | Top bar | Back `chevron.left` 44 (VO "Back"); title "Song Details" `T.headline`, centered; "Edit" text button at the right (`T.subhead` semibold `accentInk`, hit 44), signed in only |
| 2 | Cover | 200 x 200 (`details-cover`), radius `radiusCard`, centered, `depthSlab` |
| 3 | Title block | Title `T.title` centered (max 3 lines); artist `T.body` `inkMuted`; version / year line `T.subhead` `inkMuted` ("Original Mix · 2024", or the version label and year) |
| 4 | Primary button | `LitButtonStyle`, content width min 200, centered: "Play" (`play.fill`) on the phone; "Download to iPhone" for a server-only song; disabled "No audio yet" otherwise |
| 5 | Facts card | Surface slab (radius 20), rows of `rowHeight` 48 with `line` hairlines: label `T.subhead` `inkMuted` left, value `T.subhead` `ink` right-aligned (wraps to the left column at large text). Rows, each omitted when empty: Duration, BPM ("122 BPM"), Release year, Genres (pills), Tags (pills), Country (name), Date added ("12 Mar 2026"), File name ("Artist - Title.m4a", only when on the phone, middle truncation, long press copies), Source (service name + chevron, opens the link). Pills: `TagPill` (`accentTint`, `ink`). There is no musical key (not in the data model, Q3). |
| 6 | Playback statistics | Section label "Playback statistics" (`SectionLabel`), slab with three equal cells: Plays (number `T.title`, caption `inkMuted`), Last played ("2 days ago", full date as VO value), Total listened ("3 h 12 min"). Signed in only, from `GET /stats/listening`; hidden signed out or when never loaded. |
| 7 | Actions card | Slab, rows of 48 with icon 20 + label `T.body` `ink`: Play next, Add to queue, Share link, then Download (server only) or Remove from iPhone (on the phone, not local only). Play next and Add to queue only when on the phone and not current. |
| 8 | Delete | 32 below the actions card, centered text button "Delete from library" (`trash` 16 + `T.body`, `powerText`, hit 48), the last element of the scroll content; available for every song. |

**Variants.** On the phone / server only / no audio / downloading (primary button reads "Downloading NN%", disabled); signed out (no Edit, no statistics, Delete deletes the local song); the song vanished (deleted elsewhere): pop back with the toast "This song is no longer in your library".

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Back / swipe right | Pop | Library as left | none | Library scroll and VO focus on the row |
| Play | Button reads "Playing" for a moment | Queue = phone songs of the Library's current result set, this one first (the same as the cover) | `player.play` | stays on Details |
| Download to iPhone | Button shows "Downloading NN%" | Transfer | `server.download` | |
| Edit | Edit sheet over Details | | `PATCH` on Save | Back on Details, facts refreshed |
| Play next / Add to queue | Toast as in H | | as H | |
| Share link | Share sheet (`ShareSheet`) | | none | |
| Remove from iPhone | Toast; primary becomes "Download to iPhone"; action swaps | Audio removed, catalog kept | as H | |
| Delete from library | Confirmation dialog: title "Delete "Title" from the library?", message "Removes the song from your library, on the server and on this iPhone.", destructive "Delete from library", system Cancel | none until confirmed | none | VO focus to the dialog |
| Confirm delete | Pop to Library, toast "Deleted "Title"", `.warning` haptic | Song removed from the library (server first, then the phone, 404 counts as done); removed from the queue (the current song: playback moves on, PLY-046) | `DELETE /songs/{id}`, `library.delete`, `player.removeFromQueue` | Library scroll as left, VO focus to the row that took its place |
| Confirm delete, server unreachable | Dialog closes, toast "Couldn't delete. Check the server and try again." | Nothing removed | none | stays on Details |
| Tap Source | Opens the link in Safari | | none | |

### J. Left drawer (reference only)

Unchanged and out of scope: width 75% (max 320), Library selected (`selectTint` capsule), scrim, edge shadow `depthDrawer`. This spec only fixes that opening and closing the drawer never changes
Library state (search, filters, sort, direction, scroll position are kept), and that choosing "Library" while on Library scrolls the list to the top.

### K. Empty results (no match)

**Entry.** Search and filters leave no song, while the library is not empty. **Layout.** As A, with the list slab replaced by the empty block (1.12): `magnifyingglass` icon, title "No songs found", text "Try a different search or clear the filters." No button: the Reset button in the results row is the one clear action. Play all 0 is disabled; Reset is tinted.
Variant: only Downloaded is on and nothing is stored: title "Nothing on this iPhone yet", text "Turn off Downloaded to see every song."

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap Reset | List returns | All cleared | none | Scroll top |
| Edit the search | List recomputes | | none | |
| Tap Play all 0 | Nothing (disabled) | | | |

### L. Signed out, empty library

**Entry.** No sign-in session, no songs on the phone. **Layout.** Header (count "0 songs") only: the search field, the filter chip row and the results row are hidden while the library is empty and nobody is signed in; the block is centered in the remaining space.
Block: `music.note` icon, title "No songs yet", text "Your library is stored on this iPhone. Paste a YouTube or SoundCloud link to add songs, or sign in to search and sync.", primary "Add song", secondary "Sign in".

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Add song | Add sheet takes a pasted link (`AnonAddSheet`: link field, "Add", line "Sign in to search" + Sign in button) | | `POST /anon/downloads` on Add; row appears as "Downloading NN%" | Library shows the arriving row |
| Sign in | Settings opens (account card) | | none | |

### S1. Loading skeleton

**Entry.** Signed in, first catalog sync, no cached songs (`server.syncing || !server.synced && no failure`). **Layout.** Header, search, chips and results row as A (Play all 0 disabled); list = 1.13. A cached library is never replaced by a skeleton.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Wait | Pulse | Sync completes | | List appears, scroll at top |
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

**Entry.** Signed in, sync failed, no cached songs. **Layout.** Empty block: `wifi.slash` (unreachable) or `exclamationmark.triangle`, title "Can't reach the server" / "Couldn't load your library", text = the failure message or "Check the connection and try again.", primary "Retry". "Access denied" (403) uses `lock.slash`, the server text, no button.

| User action | Immediate UI response | Resulting state | Side effects | Focus / scroll |
| --- | --- | --- | --- | --- |
| Tap Retry | Block becomes the skeleton | Syncing | `syncCatalog` | |
| Success | List | | | Scroll top |
| Failure again | Block returns | | | VO focus to the title |

### S4. Large-text variant (accessibility1 and accessibility2)

| Element | Behaviour |
| --- | --- |
| Header | Title on up to 2 lines, count under it |
| Search | Height grows with the text (min 44) |
| Chip row | Still one scrolling line, chips taller (min 44 drawn), peek and fade kept |
| Results row | Two lines (1.4) |
| Song row | Cover 56 scaled; title up to 3 lines; trailing column under the artist line, left aligned; cover tap zone stays on the cover |
| Sheets | `.large` detent; Decades grid becomes 1 column; Show button stays pinned |
| Details | Facts rows stack label above value; statistics cells become 3 rows; cover 200 stays |
| Cap | `dynamicTypeSize(...accessibility2)` on the root; beyond it the OS scales nothing more |

### S5. Dark mode notes

Colours come from the tokens, so every screen has a dark twin; checks that matter:

- Slabs: `surface` is only slightly lighter than `ground` at night: the chip, row and banner edges rely on `depthSlab`; lists get no extra border. Float slabs (toast, sheets) use the 1 pt `line` ring and `depthLift` at 70%.
- On chips and the Play all button: `scheme.strongFill` = `accent`, `scheme.onStrong` = `onAccent` (8.5:1); by day `accentStrong` + `ink` (4.8:1).
- `accentTint` rows at night: secondary text is `ink`, never `inkMuted` (4.0:1).
- `accentInk` is the pale cyan at night: Sort pill, Download pill, queue marker and links stay 11:1.
- Cover scrim and equaliser are theme-independent (`vinyl` 45%, `surface` glyph).
- Skeleton bars `surfaceSunken` (darker than `surface` in both themes) keep the "below the surface" meaning.
- Check every state in both themes on a device before TestFlight (batch 4).

---

## 3. Global flows and rules

### 3.1 Search, filter and sort: what applies, what resets what

Result set = `Library` songs, then AND of: search text; each category with a selection (OR inside the category); Never listened; Downloaded. Then sorted by the criterion and direction.

```
search text ──┐
Tags ─────────┤
Genres ───────┤  AND ──► result set ──► sort(criterion, direction) ──► rows ──► Play all N = rows
Decades ──────┤
Countries ────┤
Never listened┤
Downloaded ───┘
```

| Change | Resets | Keeps | Scroll |
| --- | --- | --- | --- |
| Type in search | nothing | filters, sort, direction | top |
| Toggle or select a filter | nothing | search, other filters, sort, direction | top |
| Reset button | search, all selections, Never listened, Downloaded | sort, direction | top |
| Change the sort criterion | direction (to the criterion's default) | search, filters | top |
| Direction button | nothing | everything | top |
| Pull to refresh, catalog sync, download finishes | nothing | everything | unchanged (rows update in place) |
| Add, Edit save, Remove from iPhone | nothing | everything | unchanged |
| Delete from library | nothing | everything | unchanged |
| Switch drawer destination and return | nothing | everything | unchanged |
| Sign out | search, filters (library changes) | sort, direction | top |
| App relaunch | search, filters | sort, direction (UserDefaults) | top |

State lives in one app-level object (NEW `LibraryQuery`: `search`, `selection`, `neverListened`, `downloadedOnly`, `sort`, `reversed`), not in `LibraryView` `@State`, so navigation cannot lose it.

**Round trip to Song Details and back** keeps: search text, every selection and toggle, sort, direction, the scroll offset (the `ScrollView` stays in the stack) and the VO focus (back to the row that opened it). Returning from the Edit sheet, a
sheet, the Add sheet or the drawer is the same.

### 3.2 Play all semantics

- Set = the current result set in the current order (after search, filters, sort and direction). N in the label = its size (not the playable subset).
- Only songs on the phone can play; the others are skipped and counted in the toast ("15 not on this iPhone skipped"). None playable: toast "No listed songs are on this iPhone", queue untouched.
- Replaces the whole queue (`player.playAll`), resets queue chips and the shuffle round. Stays on Library.
- Shuffle off: starts at the first song. Shuffle on: starts at a random song of the set; the queue keeps list order.
- Repeat modes apply to the new queue as usual.
- Disabled at N = 0.
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
| Equaliser glyph on the playing cover | toggle pause | menu |

No swipe actions on rows.

### 3.5 Sort criteria (7), defaults, direction, ties

Default direction = "forward". The Direction button reverses it. Songs without a value are always last, in both directions. Ties: Title A-Z (case and diacritic insensitive), then id. The direction resets to forward when the criterion changes.

| Criterion | Forward (default) | Reversed | Sort key | Missing values |
| --- | --- | --- | --- | --- |
| Recently added | Newest first | Oldest first | `addedAt` | last |
| Title | A to Z | Z to A | base title (version label excluded), as web LIB-140 | none |
| Artist | A to Z | Z to A | first main artist, then base title | empty artist last |
| Year | Newest first | Oldest first | displayed year (version year first) | last |
| BPM | Slowest first | Fastest first | `bpm` | last |
| Length | Shortest first | Longest first | `duration` (> 0) | last |
| Last listened | Most recent first | Least recent first | `last_listened` (UTC date) | never listened last; signed in only |

VO value of the Direction button = the order in words from this table.

### 3.6 Filter logic

- **Across categories: AND.** A song must satisfy every category that has a selection.
- **Within a category: OR.** The web does the same (`matchesSelection` in `web/js/library-data.js`: `tags.some(...)`; LIB-030 "values in a category are OR, categories are AND"), so iOS keeps it. A selected "Unknown" is one more OR value of its category (web: `__unset__` token).
- **Never listened** and **Downloaded** are extra AND conditions. Never listened = no entry in `GET /stats/listening`, or listened plus skipped = 0; hidden until the data has loaded; if the request fails the toggle stays hidden and any earlier selection is dropped (as web LIB-190).
- **Search** is AND with all of it (1.2).
- Categories: Tags = every tag whose key is not genre, decade, country or lang (plain tags and other keys); Genres = genres; Countries = `country:` tags shown by name; Decades = computed from the displayed year, never from stored tags.

### 3.7 Decades values

Floor of the displayed year to the decade: "2020s", "2010s", "2000s", "1990s", ..., newest first, each with the count of songs in the whole library, then "Unknown" for songs with no year. A decade is listed only if at least one song belongs to it; Unknown only if at least one song has no year.
Example from the sketch: 2020s 156, 2010s 128, 2000s 72, 1990s 48, 1980s 32, 1970s 12, 1960s 4, Unknown 3.
Today the Years category is built from `decade:` tags, labelled "the 90s", sorted oldest first (LFM:5-6, 20-22; LF; `tagLabel`).

### 3.8 Signed out versus signed in

| Area | Signed out | Signed in |
| --- | --- | --- |
| Songs | Only the songs stored on the phone (local library); no catalog, no server | Whole catalog (hundreds of songs); rows may be on the phone, on the server, downloading, or with no audio |
| Total count | Phone songs | Catalog |
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

Corrections from Alex (the brief) and what they mean here:

| # | Decision | Where |
| --- | --- | --- |
| 1 | No "..." button on rows; long press replaces it; trailing column = duration then audio state, nothing else (the queue marker sits under it, only when queued) | 1.5, 1.11 |
| 2 | In-queue marker: queue glyph with a checkmark, only for songs in the queue; the playing song keeps the tint and the equaliser on its cover | 1.5 |
| 3 | No "N songs match" label; the count is only in "Play all N"; the header total never changes | 1.1, 1.4 |
| 4 | No "Add all"; adding is per song from the menu | 3.2 |
| 5 | ONE reset button in the results row; no "Clear all" elsewhere; no per-category Clear in sheets (removed to honour this; revisit if deselecting one by one proves slow); no Clear button in the empty state | 1.4, 1.9, K |
| 6 | No strip of selected values; a category with selections is a tinted chip with a count badge | 1.3 |
| 7 | Decades, not Years, computed from the displayed year, newest first, plus Unknown | 1.9, 3.7 |
| 8 | No Cancel on search; scroll or return dismisses the keyboard | 1.2 |
| 9 | Delete from library only in Song Details, at the bottom, with a confirmation; never in the menu | 1.11, I |
| 10 | The results row is one line with fixed slots: Sort pill, Direction, Reset, Play all N | 1.4 |
| 11 | The last chip peeks off screen with a trailing fade, never clipped mid-word | 1.3 |
| 12 | The mini-player, drawer and Now playing are not redrawn | scope |

Decisions made while writing this spec (beyond the brief):

| # | Decision | Reason |
| --- | --- | --- |
| 13 | Downloaded is the last toggle chip, after Never listened, in the same single-line row; no count on any unselected chip | Keeps one line; counts live in sheets |
| 14 | The direction resets to the criterion's default whenever the criterion changes (web LIB-208 keeps it) | Defaults differ per criterion (A-Z, newest first, slowest first); a kept flag would surprise |
| 15 | Sort and direction persist across relaunch; search and filters do not | A sort chosen is a preference, a search is a moment |
| 16 | Cover tap on the playing song toggles pause; on a server-only song it downloads (never plays) | Cover = primary action, consistent with "downloading never auto-plays" |
| 17 | Sheet values ordered by count (selected-at-open first), frozen while open; Decades newest first; counts are library-wide | Predictable under the finger |
| 18 | Unknown is last in Decades, Genres and Countries (web puts "not set" first, LIB-132) | Value order stays stable |
| 19 | "Show playing" leaves the Library toolbar | The results row has no slot for it; see Q1 |
| 20 | Never listened and Last listened exist on iOS and need `GET /stats/listening` (signed in); they are hidden or disabled otherwise | Offline-first: no spinner for optional features |
| 21 | Song Details has no musical key row; the statistics card shows Plays, Last played, Total listened (no "First played": the API returns no first date) | Data that exists |
| 22 | Screen margin is 16 (`space4`, today), not the 24 of the drawing; row height stays 80; list is not pinned | Match today's metrics and tokens |
| 23 | Search placeholder "Search songs, artists, tags" | Says what is searched, fits at 375 |
| 24 | Toast wording "not on this iPhone skipped" replaces "without audio skipped" | Accuracy |
| 25 | Play next, Add to queue and Remove from iPhone are not offered for the song that is playing | Avoids a duplicate current song and deleting the open file |
| 26 | Large text relaxes "one line" for the results row only (two lines, same slot order) | Fixed slots cannot fit at accessibility sizes |

---

## 5. Gap list and implementation order

### 5.1 Element by element: today versus this spec

| Element | Today (file:line) | Spec |
| --- | --- | --- |
| State location | LV:23-36 `@State` in the view | App-level `LibraryQuery` (3.1) |
| Header | LV:129-138 matches | no change |
| Search field | LV:257-270: height 48, literal radius 16 (LV:269), slab fill, placeholder "Search songs or artists" (LV:260), clear x without a 44 hit | 44 high, `radiusKey`, `surfaceSunken`, new placeholder, 44 hit x, focus ring |
| Search scope | LV:54-60: title, artist, album, tags; no remixer, no diacritic folding | 1.2 |
| Chips | LV:289-298: 4-column grid (2 at large text), flexible width, count shown, selected = strong fill; CMP:145-173 | One scrolling row, intrinsic width, icon, tint + badge, fade; 6 items |
| Decades | LFM:5-6, 12, 20-22: `years` from `decade:` tags oldest first | Computed from year, newest first, Unknown, label "Decades" |
| Downloaded toggle | LV:285-287, 141-145 beside the sort control; CMP:831-852 with a count | Last chip of the row, no count |
| Never listened | missing | NEW toggle (listening data) |
| Sort | LV:3-6 four criteria; LV:272-283 `Menu` + `Picker` | 7 criteria, sheet, direction (3.5, 1.10) |
| Sort logic | LV:61-76: Title and Artist raw strings, Year descending with -1 missing, no ties rule | 3.5 |
| Results row | LV:207-221 `FlowLayout` of ActionChips (Show playing, Clear filters, Play all N, Add all N), wraps | 1.4: fixed slots |
| Reset | LV:214, 203 chip "Clear filters" shown only when active | Always-present icon button, faint when idle |
| Add all | LV:216-218, 239-246 | Removed |
| Show playing | LV:213, 248-255 | Removed from the toolbar (Q1) |
| Play all | LV:230-237: toast uses "without audio skipped" (LV:223-226) | 3.2, new toast wording |
| Song row | LV:455-522 `LibrarySongRow`: whole row is one button, one tap = play / download / toast; trailing "..." | Three zones, no "..." (1.5, 3.4) |
| Row tap | LV:392-396, 379-380 | cover = play, text = details |
| Row menu | LV:412-433 "..." menu; LV:435-442 context menu lacks Remove from iPhone and has Delete; a11y actions LV:403-410 have Delete | 1.11 (no Delete, no "...") |
| Delete | LV:191-197, 427, 441, 410 in the menu | Only Song Details |
| In-queue marker | missing | NEW (1.5) |
| Playing cover | LV:520 tint only | + scrim + equaliser |
| Audio-state | LV:487-498, 506-515: literals `maxWidth: 84`, `lineWidth: 1.5`, 55% | tokens (`dim`), same behaviour |
| Row accessibility | LV:503-505: one button, label with state, actions | 1.5.1 (adds Show details, Download, Get audio) |
| Filter sheet | LF:4-62: no search, a Clear button, content-height, N values A-Z | 1.9 |
| LitButton | LF:66-77 | reuse |
| Song details | none (`SongEditView` is edit only) | NEW screen I |
| Empty states | LV:300-334 `ContentUnavailableView`, system buttons, "No songs match" + "Clear filters" button | 1.12, K: no second clear |
| Offline banner | LV:365-372, text "Offline. Showing your saved library." | 1.7 with Retry |
| Toast | LV:168-175 slab, 2 s | 1.8 float slab, enter motion |
| Skeleton | LV:313-314 `ContentUnavailableView` "Loading your library…" | 1.13 |
| Listening data | only inside `StatisticsView` (decoding private) | NEW shared `ListeningStore` |
| Large text | LV:141-145, 290 | S4 |
| Queue membership | `player.queue` exists (PS:15) | marker reads it (use a `Set` of ids for speed) |

To verify in code during batch 3: `PlayerService.enqueue` / `playNext` when nothing is loaded (PS:145-160) behave as 3.3 says (queued, not auto-played, versus play).

### 5.2 Order of work (4 batches)

| Batch | Scope | Files |
| --- | --- | --- |
| 1. Row, results row, sort, reset | Results row with fixed slots; Sort sheet, 7 criteria, direction, defaults, ties; Reset button; Play all wording; remove Add all and Show playing; song row with three zones, queue marker, playing scrim and equaliser, no "..."; `LibraryQuery` app-level state with persisted sort; `ListeningStore` (for Last listened); new tokens `cover-row`, `cover-scrim`, `dim` (design system, re-export, `scripts/sync-design-system.py`) | `LibraryView.swift` (split the row and the results row out), `Components.swift` (SongRow pieces, icon buttons), NEW `LibraryQuery.swift`, NEW `LibrarySort.swift`, NEW `ListeningStore.swift`, `docs/brand/tokens.json` |
| 2. Filters | Chip row (one line, icons, tint + badge, fade); Decades from year with Unknown; filter sheets with search, order, counts, Unknown values, no Clear; Never listened and Downloaded toggles; search scope; tokens `badge`, `chip-fade`, `sheet-tall` | `LibraryFilter.swift`, `LibraryFilterModel.swift`, `Components.swift` (`CategoryChip`, `ToggleChip` replaced by one `FilterChip`), `LibraryView.swift` |
| 3. Menu and Details | Long-press menu with the new items; VO custom actions; Song Details screen (read-only, statistics, actions, Delete with confirmation); Edit entry from Details; delete moved out of rows; token `details-cover` | NEW `SongDetailsView.swift`, `LibraryView.swift`, `SongEditView.swift` (entry only), `PlayerService.swift` (only if the queue edge cases of 5.1 need a fix), `ShareSheet.swift` (reuse) |
| 4. States and verification | Skeleton, offline banner with Retry, error and empty blocks on tokens, toast restyle, large-text variants, dark-mode and contrast verification on a device, VO pass; docs: `docs/specs/ios.md` (IOS-030..033 rewritten), `docs/specs/library.md` iOS notes, `style-guide.md` gap closure | `LibraryView.swift`, `Components.swift`, `docs/specs/ios.md`, `docs/ui-ux/style-guide.md`, `docs/CHANGELOG.md` |

Each batch updates the docs that its code makes wrong, in the same commit (CLAUDE.md "Docs change with code").

---

## 6. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Where does "Show playing" live now that the results row is full? | Long-press on the mini-player ("Show in Library"), in the dock phase; until then it is absent |
| Q2 | Song Details "First played": the API only returns `last_listened` and `total_listened_s` | Show Total listened now; add `first_listened` to `GET /stats/listening` later and swap |
| Q3 | Musical key: not in the data model; the sketch shows a Key row | Leave it out until a detector exists |
| Q4 | Filter-sheet counts: library-wide (this spec) or narrowed by the other active filters? | Library-wide: stable and cheap; narrowed counts can follow |
| Q5 | Pin the results row under the status bar while scrolling a 455-song list? | Not now; the status-bar tap scrolls to top; revisit after device testing |
| Q6 | Direction reset on criterion change differs from web LIB-208: change the web to match? | Yes, same rule on both platforms |
| Q7 | Play all N: show the result count (this spec) or the playable count when most songs are server only? | Result count; the toast explains the skips |
| Q8 | Cover tap on a server-only song starts a download: acceptable, or should it open Details? | Download (one tap, never plays), as the row tap does today |
