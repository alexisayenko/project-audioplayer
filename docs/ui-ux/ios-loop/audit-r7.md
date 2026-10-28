# iOS UI/UX loop, audit round 7 (fresh re-audit)

Re-auditor: fresh agent, did not write the fixes. Device: Alex iPhone 18 Pro simulator, 402 x 874 pt. Installed binary (07:49) is newer than the last source edit (07:47). Type size changed with `simctl ui` (AX5 for one pass) and restored (light, large). No source changed. Method as in audit-r0.md.

Walked: Library Songs (default top and scrolled, AX5), Albums grid, album screen (Sian), dock, Now playing, drawer, Song Details (top and scrolled). Not walked: dark mode, album screen and Now playing at AX5, Increase Contrast, Reduce Motion, empty states.

## Measures

| Measure | Value |
|---|---|
| p1 | 1 |
| p2 | 3 |
| belowMinTarget | 0 |
| oversized | 0 |
| scopeViolations | 0 |
| visualSanityOk | false (the new inline trailing group in Library rows collides; see L-G1) |
| Build and tests | ElectrophoneMac: BUILD SUCCEEDED. AudioPlayer: 173 tests, 3 failures, all in `ReachabilityTests` (same flake as r6, code untouched by the diff); not a clean run this time. |
| criteriaMet | false (one P1, visual sanity not OK) |

## Round 6 findings, status

| # | Status | Note |
|---|---|---|
| L-F1 Library pinned block at AX5 | Fixed | Count hidden, controls row compact; pinned block now about 28 percent; rows read. |
| L-F2 Library rows about 94 pt | Changed, regressed | Download moved inline (rows about 72 to 80 pt, 5 rows show), but the inline trailing group now overlaps (L-G1). |
| L-F3 Album track rows at AX5 | Not re-walked | |
| P-F1 Dock at AX5 | Not fixed | Title still cut to "State Of Mi..."; artist gone (P-G1). |
| D-F1 Details at AX5 | Not re-walked | Default layout fine. |

## Findings

### Library

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| L-G1 | P1 | Library Songs, Album screen (default size) | In every server-only row the duration text runs into the word "Download" ("8:4" over "D", "9:2" over "D") because the trailing group has 0 padding between the two and `Download` hugs the card edge; with a play count the headphones glyph overlaps the year ("2016") and, on long artists, the truncated subtitle ("Static Movement &... 2016", "C..."). The Download action and the duration are the core-path labels in the list, so they are unreadable on most rows. | In `LibrarySongRow.inlineLayout` give the trailing group real spacing (`DS.Space.space2` between duration and Download) and a trailing inset; keep `trailingWidth` as a minimum but size it from the content (`fixedSize` on the group, subtitle gets `layoutPriority` lower), or put the duration above Download again (r6 layout, about 94 pt) until the inline version is clean. Move the headphones count after the duration, not before the subtitle. |
| L-G2 | P2 | Library Songs, album screen | Row subtitle collides with the play-count glyph (see L-G1); same root cause, listed for the album screen. | As L-G1. |

### Player

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| P-G1 | P2 | Dock at AX5 | Title cut to "State Of Mi..." on two lines, artist gone; the dock keeps a blank band under the text at default size (accepted in r5). | Allow the artist line at accessibility sizes or drop the blank band. |

### Details

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| D-G1 | P2 | Song Details | Artist and year sit on two centred lines (artist, then "2016") before Download, so the primary action starts at 56 percent of the height with the dock on top; "Source" row is the only tappable row styled like the facts. | Put "Artist · year" on one line (Library item style) to save one line. |

## Scope check

Working tree diff against HEAD: the same 10 files in `ios/Sources` plus `docs/tasks/C1.md` (not part of this loop) and untracked `docs/tasks/task-0125.md`. `DesignTokens.swift`, `ios/MacSources`, `ios/Tests`, web and server untouched. No Library v5 control. No change to playback, queue, download or offline calls (layout and labels only; Download keeps its action and gets an accessibility label). No new colour or radius literals beyond the pre-existing `spacing: 2` and gradient opacities that moved. Violations: 0.

## Visual sanity

| Item | Before (r0) | After (r7) | Verdict |
|---|---|---|---|
| Library row | about 94 pt in r6 | about 80 pt, 5 rows above the dock | Size OK, content collides |
| Library trailing group | stacked, readable | duration and Download overlap | Overcorrected, fails |
| Dock | about 130 pt | about 96 pt | OK |
| Album screen | cover 200 pt, 1 track above dock | cover 96 pt, 5.5 tracks | OK |
| Albums grid card | 295 pt | about 245 pt | OK |
| Now playing | cover 370 pt, all above fold | same, all above fold | OK |
| Details | letterboxed cover | no bars, facts in two columns | OK |
| Touch targets | dock seek 24 pt | 44 pt | OK |

## Notes

- Fold holds at default size on Library, Album screen, Now playing and Details.
- The regression came from the last edits (LibrarySongRow, 07:47); r6 had no overlap.
- Simulator note: the test run reinstalled the app on the simulator; it was relaunched afterwards.
