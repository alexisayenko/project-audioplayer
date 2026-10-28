# iOS UI/UX loop, audit round 4 (fresh re-audit)

Re-auditor: fresh agent, did not write the fixes. Device: Alex iPhone 18 Pro simulator, 402 x 874 pt. Installed build 06:57:17 is newer than the last source edit (06:56:29). Appearance and type size were changed with `simctl ui` and restored (light, large). No source changed. Method as in audit-r0.md.

Walked: Library Songs (light default, dark AX5), Albums grid (light default, dark AX5), album screen (light default, dark AX5), dock (light, dark, AX5; Play tap checked), Now playing (light default with "..." menu, dark default, dark AX5), Song Details (light default and scrolled, dark AX5). Not walked: Library empty state, Increase Contrast, Reduce Motion, queue with 2+ songs, a Library row for a song on the phone, search with no result.

## Measures

| Measure | Value |
|---|---|
| p1 | 1 (L-D1) |
| p2 | 6 |
| belowMinTarget | 1 (dock seek zone, about 15 pt) |
| oversized | 0 |
| scopeViolations | 0 |
| visualSanityOk | false (dock seek zone shrunk to 15 pt, see table) |
| Build and tests | ElectrophoneMac builds. AudioPlayer: 173 tests; first run 3 failures reported as "0 unexpected" (network-dependent Reachability tests, URLError log lines), clean second run. Flake, no UI file involved. |
| criteriaMet | false (P1 > 0, one target under 44 pt, visual sanity) |

## Round 3 findings, status

| # | Status | Note |
|---|---|---|
| P-C1 dock Play/Next | Fixed | Centre tap on Play toggled to Pause and back; seek zone now sits at the bottom edge below the buttons. Cost: seek zone is 15 pt (see P-D1). |
| L-C1 album track Download | Fixed | "Download" shown in full in all rows, duration and Download in one right column, track numbers in a left column. |
| L-C2 album keys | Fixed | Play, Shuffle, Queue same size; Download album is a 44 pt icon on the same row. |
| L-C4 Library row column | Fixed | Duration and Download aligned for rows with and without play count; year kept. |
| L-C6 albums AX5 | Fixed | Full-width cover, one per screen. |
| P-C2 Now playing cover | Fixed | Cover on the 16 pt gutter. |
| P-C3 Now playing AX5 | Fixed | Title one line, cover about 140 pt, transport above the fold. |
| P-C4 dock AX5 | Fixed | One line "State...". |
| L-C3 album AX5 | Not fixed, worse | See L-D1. |
| L-C5 Library AX5 | Partly | See L-D3. |
| D-C1 Details AX5 | Not fixed | See D-D1. |
| D-C2 stats card | Partly | See D-D2. |

## Findings

### Library

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| L-D1 | P1 | Album screen at AX5 | The Play, Shuffle and Queue keys collapse into one overlapping cluster (glyphs drawn over each other, about 100 pt wide in total) next to the Download icon; the first track is cut by the dock (title and Download only, no duration). The transport keys are unusable and the track list is below the fold. | At accessibility sizes lay the three keys out as a 2 x 2 or vertical stack, or icon-only with a fixed 44 pt frame each and no scaling; shrink the header so the first track shows above the dock. |
| L-D2 | P2 | Album screen, default size | Track rows: the title sits at the top edge of the row (row 1 touches the card's top edge) while number and cover are centred and the subtitle slot is empty, so there is a 40 pt hole between title and Download. | Centre the title block vertically against the cover, or give the row top padding equal to the other rows. |
| L-D3 | P2 | Library Songs at AX5 | The pinned block (title, Songs/Albums, controls, search, chips) is 43 percent of the screen before the first scroll; the first row shows no duration and Download, the year is cut ("20..."), the count text is gone. | Collapse the chips row at accessibility sizes, or scroll the block with the list. |

### Player

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| P-D1 | P2 | Dock | The seek hit zone is `DS.Space.space3 + DS.Stroke.strokeProgress` = 15 pt (was 44 pt in r3, 24 pt in r0). It no longer overlaps the buttons, but the only seek control in the dock is under the 44 pt minimum. | Keep the zone at the bottom edge and make it 44 pt by letting it extend up behind the buttons while excluding the button frames (`allowsHitTesting` on a mask), or add dock bottom padding so a `DS.Space.hit` zone fits below the buttons. Check Play and Next with a centre tap again. |

### Details

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| D-D1 | P2 | Song Details at AX5 | The Download button wraps to three lines ("Down-load to iPhone", mid-word hyphen) and is about 190 pt tall at the fold, under the dock. | Make it a row with a one-line label (scale 0.7) or an icon-only 44 pt circle at accessibility sizes. |
| D-D2 | P2 | Song Details | Playback statistics card: "5 hours ago" is smaller than "1" and "7 min", so the three values and the captions do not share a baseline ("Last played" sits 9 px higher than the other captions). | Top-align the three columns with a fixed value height. |

## Scope check

Working tree diff against HEAD: 10 files in `ios/Sources` (AlbumDetailView, AlbumsView, Components, LibraryComponents, LibrarySongRow, LibraryView, PlaybackView, SongDetailsView, SongListScreen, Views), `docs/tasks/C1.md` (one line, not part of this loop) and the untracked `docs/tasks/task-0125.md`. `DesignTokens.swift`, `ios/MacSources`, `ios/Tests`, web and server untouched. Library v5 not implemented (controls line, Era chip, Play matched, collapse-on-scroll absent). No new colour or radius literals. Remaining literals: `spacing: 2` in a new `PlaybackView` VStack (same value is used in four other files, not counted), `.padding(.bottom, 14).padding(.top, 56)` in `PlaybackView` (pre-existing, only re-indented), grabber `36 x 4` (moved, pre-existing). Playback, queue and download code untouched; dock Play and Next work on a centre tap. Violations: 0.

## Visual sanity

| Item | Before (r3) | After (r4) | Verdict |
|---|---|---|---|
| Now playing cover | 352 pt | 370 pt (width of the gutter), AX5 about 140 pt | OK, aligned, everything still above the fold |
| Album card cover | 178 pt | 178 pt | OK |
| Album screen cover | 96 pt | 96 pt | OK |
| Dock | about 66 pt | about 66 pt (AX5 about 150 pt, one line) | OK |
| Dock seek hit zone | 44 pt | 15 pt | Overcorrected, below 44 pt (P-D1) |
| Album Play/Shuffle/Queue | scaled labels | full labels at default; overlap at AX5 | Default OK, AX5 broken (L-D1) |
| Albums cover at AX5 | 190 pt left-aligned | content width (about 370 pt), 1 per screen | OK, as requested in r3 |

## Notes

- Default-size screens are tidy in light and dark: Library header 36 percent of the height with 4.5 rows and aligned right column, Albums grid two per row with the 16 pt gutter, album screen shows 5 tracks, Now playing and Details fit with the dock, "Edit song" label correct.
- Out of scope, seen in passing: at AX5 the drawer content is shifted left (logo and rows clipped at the left edge). Not touched.
- Next round, in order: L-D1 (only P1), P-D1, then L-D2, D-D2, then AX5 items L-D3, D-D1.
- Simulator note: taps and screenshots lag by about one second.
