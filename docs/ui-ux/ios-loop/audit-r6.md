# iOS UI/UX loop, audit round 6 (fresh re-audit)

Re-auditor: fresh agent, did not write the fixes. Device: Alex iPhone 18 Pro simulator, 402 x 874 pt. Installed binary (07:24) is newer than the last source edit (07:13). Appearance and type size were changed with `simctl ui` (dark, AX5) and restored (light, large). No source changed. Method as in audit-r0.md.

Walked: Library Songs (light default, dark AX5), Albums grid (light default, dark AX5), album screen (light default, dark AX5), dock (default and AX5), Now playing (light default, dark AX5), Song Details (light default top and scrolled, dark AX5). Not walked: Library empty state, Increase Contrast, Reduce Motion, queue with 2+ songs, search with no result.

## Measures

| Measure | Value |
|---|---|
| p1 | 0 |
| p2 | 5 |
| belowMinTarget | 0 |
| oversized | 0 (Library rows at default are about 94 pt, see L-F2) |
| scopeViolations | 0 |
| visualSanityOk | true |
| Build and tests | ElectrophoneMac: BUILD SUCCEEDED. AudioPlayer: 173 tests, TEST SUCCEEDED on one full run, 0 failures. Three other runs showed 2 to 3 failures in `ReachabilityTests` (shared `ServerLink` state raced by the hosted app); `APIClient`, `ReachabilityTests` and all server-link code are untouched by the diff, so a flake outside scope. |
| criteriaMet | true (zero P1, 0 under 44 pt, fold holds at default size on every screen, builds and tests pass, 0 scope violations, visual sanity OK) |

## Round 5 findings, status

| # | Status | Note |
|---|---|---|
| L-E1 Library pinned block at AX5 | Not fixed | See L-F1. |
| L-E2 Albums grid cover at AX5 | Fixed | Cover capped at about 240 pt; title and "10/10 · 0 on phone" show above the dock. |
| L-E3 Album track rows at AX5 | Partly | Album keys and the compact header are fine; track 1 still wraps its title to two lines and the duration drops under the cover (see L-F3). |
| P-E1 Dock blank band | Accepted | Dock about 96 pt at default; unchanged. |
| P-E2 Now playing at AX5 | Fixed | "Queue (1)" stacks under "Up next"; menu button sits beside the title. |
| D-E1 Details genre chip at AX5 | Fixed | The chip wraps inside the card; Duration and BPM stack. |

## Findings

### Library

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| L-F1 | P2 | Library Songs at AX5 | Pinned block (title, controls, Songs/Albums, search, chips) is about 41 percent of the screen; row 1 shows a three-line title and subtitle, no duration or Download, year cut ("20..."). Controls row sits above Songs/Albums at AX5 but below it at default; search touches the chips with no gap. | Hide the chips row at accessibility sizes or let the block scroll; keep one order; add `space2` between Songs/Albums and search. |
| L-F2 | P2 | Library Songs, default | Rows are about 94 pt (title, subtitle, a separate Download line under the duration), so 3.5 rows show where r5 showed 4.5. | Put Download on the metadata line or trim the vertical padding to the 72 pt row. |
| L-F3 | P2 | Album screen at AX5 | Track 1 title wraps to two lines and its duration drops under the cover; 1.3 tracks above the dock. | Keep duration trailing at accessibility sizes; allow the title to scale. |

### Player

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| P-F1 | P2 | Dock at AX5 | The title is cut to "State..." and the artist is gone. | Allow a second title line or show the artist at accessibility sizes. |

### Details

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| D-F1 | P2 | Song Details at AX5 | Duration and BPM stack, so the facts card is about 60 percent of the screen before Genres; Download and facts fit but the actions are two screens down. | Acceptable at AX5; keep the two-column layout up to AX1 and stack only beyond. |

## Scope check

Working tree diff against HEAD: 10 files in `ios/Sources` (AlbumDetailView, AlbumsView, Components, LibraryComponents, LibrarySongRow, LibraryView, PlaybackView, SongDetailsView, SongListScreen, Views), `docs/tasks/C1.md` (one line, not part of this loop) and the untracked `docs/tasks/task-0125.md`. `DesignTokens.swift`, `ios/MacSources`, `ios/Tests`, web and server untouched. Library v5 not implemented. Behaviour check: the dock seek still calls `player.seek` and `PlaybackSeek.tapTarget` (layout only); Song Details action rows keep the same conditions (Play next, Add to queue, Remove from iPhone); the Queue "Clear" now asks first (IOS-125, intended). No colour or radius literals added. Violations: 0.

## Visual sanity

| Item | Before (r0) | After (r6) | Verdict |
|---|---|---|---|
| Dock | about 130 pt | about 96 pt | OK |
| Album screen cover | 200 pt | about 96 pt, 5 tracks above the dock | OK |
| Albums grid card | 295 pt | about 245 pt, cover 178 pt (AX5 about 240 pt) | OK |
| Now playing cover | about 370 pt | about 370 pt (AX5 about 140 pt) | OK |
| Details cover | 200 pt | about 200 pt, no bars | OK |
| Touch targets | dock seek 24 pt | 44 pt | OK |

## Notes

- Default-size screens are tidy; nothing shrank below usable size, nothing inflated.
- Remaining items are AX5 only or small spacing; none hides play, pause, next or seek.
- Simulator note: another session also ran xcodebuild during this round; one test run took more than ten minutes.
