# iOS UI/UX loop, audit round 3 (fresh re-audit)

Re-auditor: fresh agent, did not write the fixes. Device: Alex iPhone 18 Pro simulator, 402 x 874 pt; installed build 06:47 is newer than the last source edit (06:46). Appearance and type size were changed with `simctl ui` and restored (light, large). No source changed. Method as in audit-r0.md.

Walked: Library Songs (default light, AX5 dark, scrolled), Albums grid (default, AX5 dark), album screen (default, AX5 dark), dock (all screens, light, dark, AX5), Now playing (default light, AX5 dark, "..." menu, queue sheet), Song Details (default light and dark, scrolled, AX5 dark). Not walked: Library empty state, Increase Contrast, Reduce Motion, a queue with 2+ songs, a Library row for a song on the phone.

## Measures

| Measure | Value |
|---|---|
| p1 | 2 (L-C1, P-C1; P-C1 is also the one scope/invariant violation) |
| p2 | 10 |
| belowMinTarget | 0 (dock seek zone is now `DS.Space.hit`, 44 pt) |
| oversized | 0 |
| scopeViolations | 1 (P-C1, dock Play/Next taps) |
| visualSanityOk | true (see table; label shrinking is logged as L-C2) |
| Build and tests | ElectrophoneMac builds. AudioPlayer: 173 tests, 1 failure: `ReachabilityTests.testACancelledOrPolicyBlockedRequestChangesNothing` (URLError -999/-1020/-1018, network-dependent, no UI file involved; passed in r2, failed in r1, so a flake) |
| criteriaMet | false (P1 > 0, one scope violation, one test failure) |

## Round 2 findings, status

| # | Status | Note |
|---|---|---|
| L-B1 Songs header at AX5 | Fixed | Pinned block 29 percent after the first scroll (43 percent before), the empty band is gone. |
| L-B2 album transport wrap | Fixed in default size | Labels on one line, but Shuffle and Queue are scaled down, see L-C2. |
| S1 and P-B1 seek zone | Fixed in size | Now `DS.Space.hit` (44 pt), no literal; but it breaks the dock buttons, see P-C1. |
| L-B3 album track rows 93 pt | Partly | Rows about 65 to 90 pt, but Download is truncated, see L-C1. |
| L-B4 albums grid alignment | Fixed | Cover on the 16 pt gutter, 178 pt, two per row, about 245 pt per card. |
| L-B5 albums at AX5 | Partly | One column, status no longer cut, cover left-aligned, see L-C6. |
| L-B6 album screen at AX5 | Not fixed | No track above the fold, see L-C3. |
| P-B2 Now playing cover alignment | Mostly | Cover centered, 25 pt inset each side against a 16 pt gutter, see P-C2. |
| P-B3 Now playing at AX5 | Fixed | Cover about 140 pt, slider and transport above the fold. |
| D-B1 Details at AX5 | Partly | Title no longer collides, year hidden; Download still at the fold, see D-C1. |

## Findings

### Library

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| L-C1 | P1 | Album screen, default size | The Download action in track rows reads "Dow..." in 4 of 7 visible rows (no-subtitle rows), the title is forced onto two lines ("Light / & Love") while a gap sits to its right, and the duration column moves between rows (x 250 pt in some rows, 305 pt in others). The row layout depends on whether a subtitle is present. Download is a core action. | Use one trailing column for all rows (duration, then Download as icon or full label, fixed width); never truncate the Download label; let the title take the remaining width. |
| L-C2 | P2 | Album screen | Shuffle and Queue labels are scaled down (about 13 pt against 17 pt for Play) and faint; the three keys look unrelated. | Same label size for the three keys: drop `minimumScaleFactor` on the key labels and make Shuffle and Queue icon-only (accessibility labels kept) if the width is short. |
| L-C3 | P2 | Album screen at AX5 | No track above the fold (cover, title, three info lines, Play, Shuffle truncated to "Shuf...", Queue, then the dock); Download album is under the dock. | Hide the cover or make it small at AX5, shorten the info to two lines, Play/Shuffle/Queue as icons with labels in the accessibility label. |
| L-C4 | P2 | Library Songs | Rows without a play count leave a blank 60 pt slot on the right, so duration and Download float left of the edge and the artist is cut to "Static Mov..." although the row has room. Rows with a play count look different from those without. | Make the trailing column the same width on all rows and right-align the duration; give the freed width to the subtitle. |
| L-C5 | P2 | Library Songs at AX5 | The first row loses its duration and Download behind the dock; the Download label reads "Downlo..." or "Down..."; the artist is cut to "Static Movemen...". The pinned block is 43 percent before the first scroll. | Let the subtitle take 3 lines and the Download label wrap; at AX5 start the list with the search and chips collapsed or smaller. |
| L-C6 | P2 | Albums grid at AX5 | One album per screen; the cover (190 pt) sits at the left and the right half of the screen is empty. | Full-width cover at accessibility sizes (cap about the content width). |

### Player

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| P-C1 | P1 | Dock | The 44 pt seek overlay (`MiniProgress.seekZone`, `Views.swift`) is a high-priority gesture over the bottom 44 pt of the dock; the Play/Pause and Next buttons (44 pt, centered in the row) sit inside that zone. A tap on the centre of Play does not pause or play: it seeks +5 s (checked on the simulator; only a tap on the top 10 pt of the button toggles). Next has the same geometry. Dock Play/Pause is the core path. | Keep the seek line at the bottom edge but put the 44 pt hit area on the line only below the buttons (increase the dock's bottom padding so the zone does not overlap the buttons), or lower the gesture priority and exclude the button frames; Play and Next must toggle and skip on a centre tap. |
| P-C2 | P2 | Now playing | The cover has a 25 pt inset on each side, the slider, genre chip and cards a 16 pt gutter, so the cover edge does not line up. | Fill the content width (16 pt gutter) up to the cap. |
| P-C3 | P2 | Now playing at AX5 | "Now playing" wraps onto two lines (about 130 pt of header) and the "..." button sits beside the first line only. | Allow the title to scale or use one line at accessibility sizes. |
| P-C4 | P2 | Dock at AX5 | The dock is about 150 pt (17 percent of the height) and the title is cut to "State Of Mi...". | Keep the dock one line high at AX5: title on one line, scaled, no second line. |

### Details

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| D-C1 | P2 | Song Details at AX5 | The stacked Download button (icon above label, about 130 pt) is cut by the dock at the first screen. | Make the AX5 button a row (icon beside the label) so it fits above the fold. |
| D-C2 | P2 | Song Details | In the playback statistics card "5 hours ago" wraps to two lines and the three values no longer share a baseline. | Allow `minimumScaleFactor` or top-align the three values. |

## Scope check

Working tree diff against HEAD: 9 files in `ios/Sources`, plus `docs/tasks/C1.md` (one line, not part of this loop) and the untracked `docs/tasks/task-0125.md`. `DesignTokens.swift`, `ios/MacSources`, `ios/Tests`, web and server are untouched. Library v5 items (controls-line rework, Era chip, Play matched, collapse-on-scroll) are not implemented. No literal sizes, radii or colours were added: the r2 literal in `seekZone` is gone; new `minimumScaleFactor(0.7)` values are typographic, not tokens (noted); `coverLg * 2`, `hit * 3`, `hit * 8`, `detailsCover * 0.6` derive from tokens.

| # | Sev | File | Violation | Fix |
|---|---|---|---|---|
| S1 | P1 | `Views.swift` `MiniPlayer` / `MiniProgress` | Invariant "playback controls work as before" broken: the new seek overlay covers the dock Play and Next buttons (same as P-C1). The queue-clear confirmation is accepted (IOS-125 pattern). | See P-C1. |

## Visual sanity

| Item | Before (r2) | After (r3) | Verdict |
|---|---|---|---|
| Now playing cover | 352 pt | 352 pt (AX5 about 140 pt) | OK |
| Album card cover | 144 pt | 178 pt (on the gutter) | OK, aligned |
| Album screen cover | 96 pt | 96 pt | OK |
| Dock | about 66 pt | about 66 pt (AX5 about 150 pt) | OK at default |
| Dock seek hit zone | 13 pt | 44 pt | Size right, but overlaps the buttons (P-C1) |
| Album Shuffle and Queue labels | full size | about 70 percent | Shrunk, logged as L-C2 |
| Details cover at AX5 | 120 pt | 120 pt | OK |

## Notes

- Default-size screens are tidy: Library header 36 percent of the height with 4.5 rows, Details compact in light and dark, Now playing shows cover, genre, slider, transport and Up next together, the dock is compact in light and dark, "Edit song" label is correct, the queue sheet and its Clear confirmation are consistent.
- Next round, in order: P-C1 (one change, the only blocker for the core path), L-C1, then L-C2, L-C4, P-C2, D-C2, then the AX5 items L-C3, L-C5, L-C6, P-C3, P-C4, D-C1.
- Simulator note: taps and screenshots lag by about one second (a screenshot right after a tap can show the old state). The progress bar moved 5 s after the centre tap on Play, the Pause icon appeared only after a tap at the top of the button.
