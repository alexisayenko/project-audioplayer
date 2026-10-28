# iOS UI/UX loop, audit round 8 (fresh re-audit)

Re-auditor: fresh agent, did not write the fixes. Device: Alex iPhone 18 Pro simulator, 402 x 874 pt. Installed binary (08:05) is newer than the last source edit (08:03). Type size (AX5 pass) and appearance (dark pass) changed with `simctl ui` and restored (light, large). No source changed. Method as in audit-r0.md.

Walked: Library Songs (top and scrolled, default, AX5, dark), Albums grid, album screen (Sian), dock, Now playing, Song Details (top and scrolled). Not walked: album screen and Now playing at AX5, Increase Contrast, Reduce Motion, empty states, queue sheet.

## Measures

| Measure | Value |
|---|---|
| p1 | 1 |
| p2 | 4 |
| belowMinTarget | 0 |
| oversized | 0 |
| scopeViolations | 0 |
| visualSanityOk | false (the inline trailing group is now so wide that titles and subtitles are cut; see L-H1, L-H2) |
| Build and tests | ElectrophoneMac: BUILD SUCCEEDED. AudioPlayer: 173 tests, 0 failures, TEST SUCCEEDED. |
| criteriaMet | false (one P1, visual sanity not OK) |

## Round 7 findings, status

| # | Status | Note |
|---|---|---|
| L-G1 Duration and Download overlap | Fixed | Duration, headphones count and Download read cleanly in Library and album rows; no collision. |
| L-G2 Subtitle collides with play-count glyph | Fixed (collision), but see L-H1 | |
| P-G1 Dock at AX5 | Not fixed | Title "State Of Mi...", artist "Antino..."; the dock is about 24 percent of the screen at AX5. |
| D-G1 Details artist and year on two lines | Fixed | "Vini Vici · 2016" on one line; Download button starts at 51 percent of the height. |

## Findings

### Library

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| L-H1 | P1 | Album screen (default size) | Track titles are cut to a few characters ("Light & L...", "Dreamin...", "Northern...", "Like A Di...") because each row spends width on a number, a 64 pt thumbnail (the same album cover on every row) and a 165 pt trailing group (duration, headphones count, Download). The title is the label that identifies the track; at most 2 of 6 titles are readable. | In album rows drop the repeated thumbnail (the number already identifies the track, ux-preferences: no duplicated info) or shrink it, and let the trailing group shrink: show the headphones count only in Song Details, or put the count under the duration. Allow the title two lines before truncating. |
| L-H2 | P2 | Library Songs | Rows with a play count lose the year: "Static Movemen..." (no "· 2016") for 7 of the first 8 server-only rows, while rows without a count show "Vini Vici · 2016". "Artist · year" is the Library reference format and the rule is no truncation before the year. | Same cause as L-H1: narrow the trailing group (move the count into the metadata line after the year, or under the duration) so the subtitle keeps about 200 pt. |
| L-H3 | P2 | Library Songs, row 3 | "Expand Cons..." title cut while 20 pt of the row stays empty above and below; titles of 15 characters already truncate with a count. | Covered by L-H2; allow the title to wrap to two lines at default size when the trailing group is wide. |
| L-H4 | P2 | Library at AX5 | The pinned block (title, Songs/Albums, controls) is 29 percent and the dock 24 percent, leaving 38 percent for rows: one row at a time. Search and chips scroll with the list, so the list reads. | Acceptable below AX3; at AX5 drop the Albums switch label to an icon or shrink the dock (see P-H1). |

### Player

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| P-H1 | P2 | Dock at AX5 | Title and artist are cut ("State Of Mi...", "Antino..."), the dock takes 24 percent of the height; at default size a blank band of about 25 pt remains under the text. | Hide the progress band's reserved padding at default size and cap the dock title to one line at accessibility sizes with the artist visible. |

### Details

No findings. Default layout fits: cover 200 pt, one-line "Artist · year", Download, facts in two columns, statistics and action rows above the second screen.

## Scope check

Working tree diff against HEAD: the same 10 files in `ios/Sources` plus `docs/tasks/C1.md` (not part of this loop) and untracked `docs/tasks/task-0125.md`. `DesignTokens.swift`, `ios/MacSources`, `ios/Tests`, web and server untouched. No Library v5 control. Playback, queue, download and offline calls unchanged (the diff only moves them into `queueButton` and a row list; Clear queue now asks for confirmation, IOS-125). The raw literals in the diff (`spacing: 2`, `.padding(.bottom, 14).padding(.top, 56)`, grabber `36 x 4`, `space2 + 2`) all exist in HEAD and only moved. Violations: 0.

## Visual sanity

| Item | Before (r0) | After (r8) | Verdict |
|---|---|---|---|
| Library row | about 94 pt in r6 | about 80 pt, 5 rows above the dock | Size OK, but the wide trailing group cuts year and title |
| Album track row | one-line title with subtitle | thumbnail plus 165 pt trailing group, title cut | Overcorrected, fails |
| Dock | about 130 pt | about 96 pt (24 percent at AX5) | OK at default |
| Album screen header | cover 200 pt, 1 track above dock | cover 96 pt, 6 tracks | OK |
| Albums grid card | 295 pt | about 245 pt | OK |
| Now playing | cover 370 pt, all above fold | same, all above fold | OK |
| Details | letterboxed cover | no bars, facts in two columns | OK |
| Touch targets | dock seek 24 pt | 44 pt | OK |

## Notes

- Fold holds at default size on Library, Album screen, Now playing and Details.
- Dark mode Library reads well; rows there had no play counts, so the cut subtitles appear only in light mode data.
- The tests run reinstalled the app on the simulator; it was relaunched afterwards.
