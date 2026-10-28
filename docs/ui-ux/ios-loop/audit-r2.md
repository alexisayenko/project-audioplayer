# iOS UI/UX loop, audit round 2 (fresh re-audit)

Re-auditor: fresh agent, did not write the fixes. Device: Alex iPhone 18 Pro simulator, 402 x 874 pt; installed build 06:27 is newer than the last source edit (06:26). Appearance and type size were changed with `simctl ui` and restored (light, large). No source changed. Method as in audit-r0.md.

Walked: Library Songs (default light and dark, AX5), Albums grid (default, AX5), album screen (default, AX5, with dock), dock (Library, album screen, Details, AX5, dark), Now playing (default, AX5, scrolled), queue sheet with Clear confirmation, Song Details (default, scrolled, AX5, dark). Not walked: Library empty state, Increase Contrast, Reduce Motion, a queue with 2+ songs, Now playing in dark.

## Measures

| Measure | Value |
|---|---|
| p1 | 3 (L-B1, L-B2, S1) |
| p2 | 8 |
| belowMinTarget | 1 (dock seek strip, 13 pt) |
| oversized | 1 (Now playing cover at AX5, about 350 pt, not shrunk) |
| scopeViolations | 1 |
| visualSanityOk | false (dock seek hit zone shrunk from 44 pt in r1 to 13 pt) |
| Build and tests | AudioPlayer: 173 tests, 0 failures (the r1 Reachability failure is gone); ElectrophoneMac builds |
| criteriaMet | false (P1 > 0, scope violation, visual sanity, one target under 44 pt) |

## Round 1 findings, status

| # | Status | Note |
|---|---|---|
| L-A1 Albums controls at AX5 | Fixed | Sort and On phone are icon-only, count hidden, chips on one row; header about 32 percent. |
| L-A2 Songs header at AX5 | Regressed | Header now about 65 percent, see L-B1. |
| L-A3 Download hyphen at AX5 | Not re-checked (no row visible at AX5 because of L-B1) | - |
| L-A4 Albums cover alignment | Partly | Cover is centered in the column now, but see L-B4. |
| L-A5 album screen info and rows | Partly | Info is two lines, Download album is an icon; transport labels now wrap (L-B2); rows still tall (L-B3). |
| P-A1 dock height | Fixed | About 66 pt, no blank band, seek line at the bottom edge, solid ground behind it, hairline outline (also visible in dark). |
| P-A2 grabber hit area | Fixed | 88 x 44 pt overlay. |
| P-A3 cover width | Partly | Cover starts on the gutter; see P-B2. |
| P-A4 AX5 Now playing | Partly | Title and subtitle now sit under the cover in full; the cover is not shrunk, see P-B3. |
| P-A5 queue Clear | Fixed | Clear leading, Done trailing, title centered; the "Clear the queue?" dialog appears with a Clear queue action (checked; queue left intact). |
| D-A1 Details AX5 | Partly | Cover 120 pt; the Download button still sits at the fold behind the dock, see D-B1. |
| D-A2 facts card padding | Fixed | About 24 pt above and below. |
| S1 literal 300 | Fixed | Now `DS.Space.hit * 8`, derived from a token. |

## Findings

### Library

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| L-B1 | P1 | Library Songs at AX5 | The controls row has about 100 pt of empty band above and below it; the pinned header fills about 65 percent of the screen and only a third of the first row shows above the dock (was 34 percent in r1). Cause: `Color.clear` in `stackedControls` (`LibraryComponents.swift`) is flexible in both axes and expands vertically. | Use `Color.clear.frame(height: 0)` (or `.frame(maxWidth: .infinity, maxHeight: 0)`); the row stays at its 44 pt minimum height. |
| L-B2 | P1 | Album screen, default size | The transport row wraps inside the buttons: "Shuf-/fle" and "Queu/e" on two lines each, because the Download album icon took the width. The Play, Shuffle, Queue labels are the primary actions. | Keep labels on one line (`lineLimit(1)`, `minimumScaleFactor`), or make Shuffle and Queue icon-only with accessibility labels and keep Play labelled. |
| L-B3 | P2 | Album screen | Track rows are still about 93 pt: title at the top, the Download text at the bottom right, a blank band between (subtitle hidden). | Collapse the row to the cover height (about 64 pt) when the subtitle is empty; put Download on the title line. |
| L-B4 | P2 | Albums grid | The cover is inset 34 pt from the screen edge against a 16 pt gutter for the search and chips above, with a 47 pt gap between covers; the grid does not line up with the controls. | Let the cover fill the column up to the cap with its left edge on the 16 pt gutter, or align the text and cover to the gutter. |
| L-B5 | P2 | Albums grid at AX5 | One album per screen in a narrow card centered with wide empty sides; the status text is cut to "10/10 · 0 on...". | Single full-width column at accessibility sizes, status lines allowed to wrap. |
| L-B6 | P2 | Album screen at AX5 | Title, three info lines, Play and Shuffle fill the whole screen; no track is visible above the fold and the dock covers the Queue and Download album buttons. | Shorten the info to two lines at accessibility sizes and put Play and Shuffle side by side as icons with labels in the accessibility label. |

### Player

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| P-B1 | P2 | Dock | The seek hit zone is 13 pt (`seekZone`, `Views.swift`), down from 44 pt in r1 and 24 pt in r0; a seek tap on the 3 pt line is hard to hit. | Keep the 3 pt line at the bottom edge and extend the overlay hit area upward to 44 pt (for example `DS.Space.hit`) as an overlay that does not change the dock height. |
| P-B2 | P2 | Now playing | The cover (352 pt cap) starts on the left gutter but stops 18 pt short of the right gutter, so its right edge does not line up with the slider and cards below. | Center it in the content width or let it fill the width (cap to the available width). |
| P-B3 | P2 | Now playing at AX5 | The cover stays about 350 pt (40 percent) and the title block sits under it; the slider, transport and Up next are all below the fold (one scroll away). | Shrink the cover at accessibility sizes (about 40 percent of its size) so the transport shows above the fold. |

### Details

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| D-B1 | P2 | Song Details at AX5 | Cover is 120 pt, but title, artist and year wrap to five lines; the primary Download button is still cut by the fold and the dock. | Allow the artist line to scale or truncate to two lines at accessibility sizes, or hide the year line (kept in the facts). |

## Scope check

Working tree diff against HEAD: 9 files in `ios/Sources`, plus `docs/tasks/C1.md` (one line, not part of this loop) and the untracked `docs/tasks/task-0125.md`. `DesignTokens.swift`, `ios/MacSources`, `ios/Tests`, web and server are untouched. No playback, queue, download or offline logic changed (the queue sheet only gained the confirmation dialog; the Song Details action conditions are unchanged, only moved into a row list). Library v5 items (controls-line rework, Era chip, Play matched, collapse-on-scroll) are not implemented.

| # | Sev | File | Violation | Fix |
|---|---|---|---|---|
| S1 | P1 | `Views.swift` `MiniProgress.seekZone` | `DS.Stroke.strokeProgress + DS.Space.space2 + 2` adds a literal `2` that is not a token (same class of finding as r1's literal 300). | Use `DS.Space.hit` (also fixes P-B1) or tokens only. |
| note | - | `AlbumsView.swift`, `PlaybackView.swift`, `SongDetailsView.swift` | `coverLg * 1.5`, `hit * 8`, `detailsCover * 0.6` are derived from tokens (accepted; named tokens would be cleaner). | - |

## Visual sanity

| Item | Before | After | Verdict |
|---|---|---|---|
| Now playing cover | about 370 pt | 352 pt | OK |
| Album card cover | 178 pt | 144 pt | OK |
| Album screen cover | 200 pt | 96 pt | OK |
| Dock | about 130 pt | about 66 pt | OK, tidy, no blank band |
| Dock grabber hit | 44 pt | 88 x 44 pt | OK |
| Dock seek hit zone | 24 pt | 13 pt | Overcorrected (below usable size) |
| Details cover at AX5 | 200 pt | 120 pt | OK |
| Download pill | outlined, 31 pt visible | text only, 44 pt zone | OK |

## Notes

- Default-size screens are now tidy: Library rows align, Details is compact and the facts card is balanced, the dock is compact in light and dark, Now playing shows cover, genres, slider, transport and Up next in one screen.
- Next round, in order: L-B1 (one-line fix), L-B2, S1 with P-B1 (one change), then L-B3, P-B2, P-B3, D-B1, L-B4 to L-B6.
- Simulator note: taps registered with a delay of about one second; the first tap after a launch was not applied until a second one arrived. Not an app defect.
