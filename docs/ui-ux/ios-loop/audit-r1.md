# iOS UI/UX loop, audit round 1 (fresh re-audit)

Re-auditor: fresh agent, did not write the fixes. Device: Alex iPhone 18 Pro simulator, 402 x 874 pt; the installed build (06:16) is newer than the last source edit (06:11). Appearance and type size were changed with `simctl ui` and restored (light, large). No source changed. Method as in audit-r0.md.

Walked: Library Songs (default, scrolled, AX5, dark not walked for Songs), Albums grid (default, AX5, dark), album screen (not playing, playing with dock), dock (paused/playing, Library, album screen, Song Details, AX5), Now playing (default, AX5, menu), queue sheet (medium and large), Song Details (default, AX5). Not walked: Library empty state, album screen at AX5, Now playing and Details in dark, Increase Contrast, Reduce Motion, a queue with 2+ songs.

## Measures

| Measure | Value |
|---|---|
| p1 | 2 |
| p2 | 11 |
| belowMinTarget | 1 (dock "Expand player" grabber, 16 pt) |
| oversized | 1 (dock, about 106 pt with a blank band) |
| scopeViolations | 1 |
| visualSanityOk | false (grabber hit zone shrunk from 44 pt to 16 pt) |
| Build and tests | AudioPlayer scheme builds, 173 tests, 1 test fails (`ReachabilityTests.testACancelledOrPolicyBlockedRequestChangesNothing`, network error codes; file and code untouched by this diff, not caused by it); ElectrophoneMac builds |
| criteriaMet | false (P1 > 0, scope violation, one test failing, visual sanity) |

## Round 0 findings, status

| # | Status | Note |
|---|---|---|
| L1 Library AX5 header | Improved, not met | Chips on one row, + and "..." inside gutters, count wraps to 2 lines. Header is now about 34 percent of the screen (was 43), target was 25. See L-A2. |
| L2 Album screen header | Fixed | Cover 96 pt beside title and info; first 4 tracks show above the fold with the dock. |
| L3 play-count shifts columns | Fixed | Duration and Download align across rows; year kept ("Static Mov... · 2016"). |
| L4 heavy Download pill | Fixed | Text-only, 44 pt zone. |
| L8 Albums grid card | Mostly fixed | 210 pt per card instead of 295; see L-A4. |
| L9 repeated artist in album tracks | Fixed | Track number shown, subtitle hidden when equal to the album artist. |
| L10 AX5 subtitle and pill | Partly | Year no longer lost, but "Down-load" hyphenates, see L-A3. |
| L11 chip shadow clipping | Fixed | Chip row and genre row no longer clip. |
| P1 dock height | Not fixed | Height 130 to 106 pt, still a blank band under the row, rows still show in a gap below the dock. See P-A1. |
| P2 seek strip 24 pt | Fixed (44 pt) | But grabber now 16 pt, see P-A2. |
| P3 cover 370 pt | Fixed | 300 pt, no bars. See P-A3 and the scope item. |
| P4 AX5 Now playing | Partly | Cover 40 percent, menu aligned, subtitle 3 lines; title truncates, see P-A4. |
| P5 "Song details" label | Fixed | "Edit song". |
| P6 genre chips look tappable | Fixed | Flat tint. |
| P7 queue subtitle | Fixed | "Antinomy · 2022". |
| P8 Clear in leading slot | Partly | See P-A5; confirmation not verified. |
| D1 Details AX5 title collision | Fixed | Title on its own line. |
| D2 Release year duplicate | Fixed | Row removed. |
| D3 letterboxed cover | Not reproducible with this song (square art) | Not judged. |
| D4 facts and hairlines | Fixed | Duration and BPM share one row; no trailing hairline. |

## Findings

### Library

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| L-A1 | P1 | Library Albums at AX5 | The controls row collapses: the sort chip "Recently added" wraps into a column of fragments ("R / ec / en / tly / ad..."), the On phone chip is "...", the count wraps, the selected Albums chip truncates to "Albu...". The header fills about 67 percent of the screen and no album is reachable above the dock. (Not walked in r0; the controls row was not changed by the fixes, but the Songs/Albums chip row now truncates the selected "Albums".) | At accessibility sizes give the Albums controls the same treatment as Songs: icon-only sort and On phone chips (label in the accessibility label), count on its own line or hidden, chips never wrap their text (`lineLimit(1)`, `fixedSize`), and let the Songs/Albums row use shorter labels or scale. |
| L-A2 | P2 | Library Songs at AX5 | Pinned header still about 34 percent (title, chips, controls, 2-line count); with the dock about 1.5 rows remain visible. | Hide the count text at AX5 (it is in the accessibility label) or fold it into the actions menu; target under 25 percent. |
| L-A3 | P2 | Library Songs at AX5 | The Download label hyphenates to "Down-/load" beside the duration; the subtitle breaks so that "· 2016" sits on its own line. | `lineLimit(1)` and `minimumScaleFactor` or full-width Download in the stacked layout; keep "Artist · year" on one flow (year first line break). |
| L-A4 | P2 | Albums grid | Cover is capped at 144 pt but left-aligned in a 187 pt column, leaving about 40 pt of dead space to its right and uneven gutters (16 pt left, 56 pt between). | Center the cover in the column or let it fill the column up to the cap with the text sharing the same width. |
| L-A5 | P2 | Album screen | The info line runs on and wraps badly ("... · In library 8 of 8 · On / phone 1 of 8"); Download album sits on a second row under Play, Shuffle, Queue; track rows are still about 93 pt tall with an empty band under the title now that the subtitle is hidden. | Two short info lines (tracks and length; "8 of 8 · 1 on phone"); move Download album into the header or an icon; reduce row height when the subtitle is empty. |

### Player

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| P-A1 | P2 | Dock | Still about 106 pt: the row is about 64 pt, then a blank band of about 25 pt above a seek line that is centered in a 44 pt strip. Library rows still show in a gap below the dock. In dark mode the dock has almost the same fill as the ground. | Align the 3 pt seek line to the dock's bottom edge (keep the 44 pt hit area, overlaid), drop the dock to about 80 pt, and end the list under it. |
| P-A2 | P2 | Dock | The "Expand player" grabber is now an overlay of 16 pt (was 44 pt), under the 44 pt minimum and a smaller target than before. The dock body still opens Now playing, so no function is lost. | Keep the drawn bar at the top but give the button a 44 pt tall hit zone (`contentShape` with a taller frame, overlay allowed to extend). |
| P-A3 | P2 | Now playing | The 300 pt cover is centered with 51 pt side insets while the chips, slider and cards use a 16 pt gutter; about 20 percent of the screen stays empty at the bottom. | Fill the content width up to the cap (left edge on the gutter) or raise the cap a little (for example to the screen width minus gutters, limited by the height share). |
| P-A4 | P2 | Now playing at AX5 | The title overlay is 3 lines of subtitle plus the title and covers about 70 percent of the cover; the title still truncates ("State Of M..."). The Up next card is below the fold. | At accessibility sizes move title and subtitle below the cover (not overlaid), full lines. |
| P-A5 | P2 | Queue sheet | "Clear" (destructive) now sits next to "Done" in one capsule, two small text buttons side by side; the title is off center. The IOS-125 confirmation could not be confirmed on the simulator (only one song in the mock queue; two taps ended with the queue cleared and no dialog seen). | Keep Clear apart from Done (leading position with confirmation, or in a menu), and re-check the confirmation with 2 or more queued songs. |

### Details

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| D-A1 | P2 | Song Details at AX5 | The cover (200 pt) plus title, artist and year fill the first screen; the primary Download button is hidden behind the dock and below the fold. | At accessibility sizes shrink the cover (about 120 pt) so the primary action shows above the fold. |
| D-A2 | P2 | Song Details | The facts card has about 6 pt above the "Duration" label against about 16 pt below the last row; the card reads cramped at the top. | Equal vertical padding in the compact facts row. |

## Scope check

Working tree diff against HEAD, files in scope only (ios/Sources, 9 files, DesignTokens.swift and ios/MacSources untouched, no web or server file touched, no playback, queue, download or offline logic changed; the queue sheet only gained the confirmation dialog).

| # | Sev | File | Violation | Fix |
|---|---|---|---|---|
| S1 | P1 | `PlaybackView.swift` `coverCap` | Introduces the literal `300` (and `UIScreen.main.bounds.height * 0.4`) as a size outside the design tokens. | Derive the cap from a token (for example `DS.Component.detailsCover` times a factor, or the available width) and drop the literal. |
| note | - | `AlbumsView.swift` | `DS.Component.coverLg * 1.5` is derived from a token (accepted, but a named token would be cleaner); no other literal sizes, colours or radii were added. | - |

## Visual sanity

| Item | Before | After | Verdict |
|---|---|---|---|
| Now playing cover | about 370 pt | 300 pt | OK, not too small |
| Album card cover | 178 pt | 144 pt | OK |
| Album screen cover | 200 pt | 96 pt | OK |
| Dock | about 130 pt | about 106 pt | Better, still has dead space |
| Dock seek strip | 24 pt | 44 pt | OK |
| Dock grabber hit | 44 pt | 16 pt | Overcorrected (target below 44) |
| Download pill | outlined, 31 pt visible | text only | OK (quieter), 44 pt hit area |

## Notes

- Round 1 progress is clear on the default type size: the fold for the album screen holds (4 tracks above the dock), rows align, the Details screen is compact, no title collisions.
- The remaining P1 is accessibility-size Albums and one literal size; the next round should fix L-A1, S1, then P-A1, P-A2, P-A3, L-A2, L-A3.
- Library v5 items were not reported.
