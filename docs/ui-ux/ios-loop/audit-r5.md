# iOS UI/UX loop, audit round 5 (fresh re-audit)

Re-auditor: fresh agent, did not write the fixes. Device: Alex iPhone 18 Pro simulator, 402 x 874 pt. Installed build 07:06:23 is newer than the last source edit (07:04:56). Appearance and type size were changed with `simctl ui` (dark, AX5) and restored (light, large). No source changed. Method as in audit-r0.md.

Walked: Library Songs (light default, dark AX5), Albums grid (light default, dark AX5), album screen (light default, dark AX5), dock (light default, dark AX5; Play tap toggles Pause and back), Now playing (light default, dark AX5), Song Details (light default and scrolled, dark AX5 top and bottom). Not walked: Library empty state, Increase Contrast, Reduce Motion, queue with 2+ songs, a Library row for a song on the phone, search with no result, tap-seek accuracy on the dock.

## Measures

| Measure | Value |
|---|---|
| p1 | 0 |
| p2 | 6 |
| belowMinTarget | 0 (dock seek zone is `DS.Space.hit`, 44 pt, bottom-aligned; album keys at AX5 are 44 pt icons) |
| oversized | 1 (Albums grid cover at AX5, about 370 pt) |
| scopeViolations | 0 |
| visualSanityOk | true |
| Build and tests | ElectrophoneMac builds (macOS). AudioPlayer: TEST SUCCEEDED, 173 tests, 0 failures. |
| criteriaMet | true (zero P1, 0 under 44 pt, fold holds at default size on all screens, builds and tests pass, 0 scope violations, visual sanity OK) |

## Round 4 findings, status

| # | Status | Note |
|---|---|---|
| L-D1 album keys at AX5 | Fixed | Play, Shuffle, Queue, Download are four separate 44 pt icon buttons on one row; first track fully visible above the dock. |
| P-D1 dock seek zone | Fixed | 44 pt zone at the dock's bottom edge; Play and Next still work on a centre tap. Cost: see P-E1. |
| L-D2 album track rows | Fixed | Title centred against the cover, no hole before Download. |
| D-D2 stats card | Fixed | "0", "Never", "0 min" share one top line and one caption line. |
| D-D1 Details Download at AX5 | Fixed | One line "Download" with icon, full width. |
| L-D3 Library AX5 pinned block | Not fixed | See L-E1. |

## Findings

### Library

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| L-E1 | P2 | Library Songs at AX5 | Pinned block (title, Songs/Albums, controls, search, chips) is about 41 percent of the screen; the first row shows no duration and no Download, the year is cut ("20...") and the count text is gone. Unchanged since r4. | Hide the chips row at accessibility sizes or let the block scroll with the list. |
| L-E2 | P2 | Albums grid at AX5 | The cover is the full content width (about 370 pt); the first album's title and status sit under the dock, so the grid shows a cover and no name. | Cap the cover at about 240 pt at accessibility sizes, or put the title above the fold. |
| L-E3 | P2 | Album screen at AX5 | Track row 1 is about 260 pt tall: the title wraps to two lines and "Download" breaks mid-word ("Down-load"); only one track is visible. | Allow the label to scale down (one line) or use the icon-only download glyph in track rows at accessibility sizes. |

### Player

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| P-E1 | P2 | Dock | The 44 pt seek zone costs a blank band of about 35 pt under the buttons, so the dock is about 96 pt tall (was about 66 pt in r3) with an empty lower third. | Acceptable; if tuned later, draw the 3 pt line at the band's bottom edge with a faint label-free track, or reduce the band to the 3 pt line and expand the hit zone with a mask that excludes the buttons. |
| P-E2 | P2 | Now playing at AX5 | "Up next" wraps to two lines beside "Queue (1)" and the "..." button sits lower than the title baseline. Transport is above the fold. | Stack "Queue (1)" under "Up next" at accessibility sizes; align the menu button to the title's first line. |

### Details

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| D-E1 | P2 | Song Details at AX5 | The genre chip in the facts card runs past the card's right edge (clipped). | Let the chip wrap or truncate within the card width. |

## Scope check

Working tree diff against HEAD: 10 files in `ios/Sources` (AlbumDetailView, AlbumsView, Components, LibraryComponents, LibrarySongRow, LibraryView, PlaybackView, SongDetailsView, SongListScreen, Views), `docs/tasks/C1.md` (one line, not part of this loop) and the untracked `docs/tasks/task-0125.md`. `DesignTokens.swift`, `ios/MacSources`, `ios/Tests`, web and server untouched. Library v5 not implemented (no controls-line rework, Era chip, Play matched or collapse-on-scroll). No colour or radius literals. Remaining small literals: `spacing: 2`, `DS.Space.space2 + 2` in the dock (2 pt optical offset), `.padding(.bottom, 14).padding(.top, 56)` in `PlaybackView` (pre-existing), grabber `36 x 4` (pre-existing); not counted. Playback, queue and download code untouched; dock Play toggled to Pause and back on a centre tap. Violations: 0.

## Visual sanity

| Item | Before (r4) | After (r5) | Verdict |
|---|---|---|---|
| Dock | about 66 pt | about 96 pt, blank band under buttons | OK, not inflated beyond reason (r0 was 130 pt); see P-E1 |
| Dock seek zone | 15 pt | 44 pt | Fixed |
| Album Play/Shuffle/Queue | overlapping at AX5 | four 44 pt icons at AX5, full labels at default | OK |
| Now playing cover | 370 pt, AX5 about 140 pt | same | OK |
| Album card cover | 178 pt | 178 pt (AX5 about 370 pt) | Default OK, AX5 large (L-E2) |
| Album screen cover | 96 pt | 96 pt | OK |

## Notes

- Default-size screens are tidy in light mode: Library 4.5 rows with aligned right column and year kept, Albums two per row, album screen 5 tracks above the dock, Now playing and Details fit with transport and actions visible.
- Remaining items are all AX5 and none hides the core path (play, pause, next, seek).
- Not verified: dock tap-seek landing point (a tap at 75 percent moved the bar only slightly; `PlaybackSeek.tapTarget` may cap tap jumps; playback code out of scope).
- Simulator note: taps and screenshots lag by about one second.
