# iOS UI/UX loop, audit round 0

Auditor: first auditor. Device: Alex iPhone 18 Pro simulator, 402 x 874 pt. Appearance and type size were changed with `simctl ui` and restored (light, large). No source changed. Scope: Library Songs and Albums, album screen, dock, Now playing, Song Details.

Walked: Library Songs (default, search with no result, Genres filter active), Albums grid, album screen, dock paused and playing, Now playing with queue sheet (1 song, light and dark), Song Details (light, scrolled), AX5 on Library, Now playing, Song Details. Not reachable in the mock data: Library empty state (signed out only), empty queue, a Library row for a song on the phone other than the current one, dock and Now playing at AX5 in dark.

## Measures

| Measure | Value |
|---|---|
| p1 | 3 |
| p2 | 17 |
| belowMinTarget | 1 |
| oversized | 4 |
| scopeViolations | 0 |
| criteriaMet | false (P1 > 0; build and tests not run by the auditor) |

Below min target (hit area under 44 pt): the dock progress seek strip, 24 pt (`MiniProgress`, `DS.Space.space6`). The row duration, title and artist buttons in `LibrarySongRow` are 18 to 22 pt, but each only opens Song Details like the whole row does, so nothing is lost; not counted. All other controls reach 44 pt through frames or `contentShape`, though their visible shapes are 32 to 36 pt (chips, circle buttons, Download pill).

Oversized: Albums grid card (178 pt cover, 295 pt per card, 2 per screen); Now playing cover (about 370 pt, 42 percent of the height); the dock (about 130 pt, 15 percent of the height); the album screen header block (about 540 pt before the first track).

## Findings

### Library

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| L1 | P1 | Library at AX5 | The pinned header (title, stacked Songs/Albums, controls, count) fills 43 percent of the screen, leaving about 1.5 rows. The + button and the "..." menu are cut off at the right edge (no gutter), the count text is huge. | Stop the count row overflowing: let the count shrink or wrap (drop the `fixedSize` and the hidden sizing text at accessibility sizes), keep the "..." button inside the margins, and keep Songs/Albums on one row (shorter labels or icon plus label scaled down) so the pinned block stays under about 25 percent. |
| L2 | P1 | Album screen | Cover 200 pt, title, three info lines, Play/Shuffle/Queue and a second button row push the track list to 62 percent of the screen; with the dock only about 1 track shows. | Compact header: cover about 96 pt (`cover-lg`) beside title and info, merge "tracks, length" with the status line, put Download album on the same row as the transport keys or as an icon in the header; first 3 tracks must show above the fold. |
| L3 | P2 | Library Songs | A row with a play count (headphones) shifts duration and the Download pill about 28 pt left of other rows and cuts the subtitle to "Astral Projection ·...", dropping the year. | Reserve the play-count slot in the metadata line (small headphones glyph after the subtitle) or give it a fixed trailing column on all rows; never truncate before the year. |
| L4 | P2 | Library Songs | Server-only rows each carry a heavy outlined Download pill (44 pt zone, 31 pt visible) that dominates the right column; on-phone rows show no state except the cover badge. Library with mostly server-only songs reads as a wall of buttons. | Make the pill quieter (text or icon-only download glyph in `accentInk`, no outline) with the 44 pt hit area; keep the pill only while downloading. |
| L8 | P2 | Albums grid | Cards are 295 pt tall (178 pt cover, title, artist/year, two status lines); two albums per screen; the first cover touches the controls row. | Smaller cover (3 columns is too tight; try 2 columns with title and one status line, "9/9 · 1 on phone"), 12 pt gap under the controls row. |
| L9 | P2 | Album screen | Every track row repeats "Astral Projection · 1995", the album artist and year already in the header (no duplicated info rule); tracks have no number. | In album and playlist lists with a matching artist, show only the track number or the differing artist; show the track number in the cover slot corner. |
| L10 | P2 | Library at AX5 | Subtitle truncated to "Projection..." (year lost); the Download pill is flush with the card edge (no trailing padding). | Allow 2 to 3 lines for the subtitle at accessibility sizes (it is already 2; the stacked layout wastes width), add trailing padding of `space3` to the stacked row. |
| L11 | P2 | Library, Now playing | The horizontal chip row clips the chip shadows, leaving a lighter band behind the chips (light mode). | Add vertical padding inside the scroll view for the shadow, or clip with `scrollClipDisabled()`. |

### Player

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| P1 | P2 | Dock | About 130 pt tall: a 44 pt grabber row holding a 4 pt bar, a 64 pt row, a 24 pt progress strip. Library rows show below the floating dock (about 43 pt gap) and the dock has the same fill as rows in dark mode. | Overlay the grabber on the dock's top edge (about 12 pt) and keep the full-height tap zone; keep the progress strip at the bottom of the row; the dock should sit no higher than the home-indicator inset, with the list ending under it. |
| P2 | P2 | Dock | The seek strip is 24 pt (under 44 pt), the only interactive item below the minimum. | Extend the hit area to 44 pt (`contentShape` with a taller frame, drawn 3 pt line unchanged). |
| P3 | P2 | Now playing | The cover is a letterboxed, side-cropped video thumbnail ("TRUST IN TRANC", black bar on top), about 370 pt tall, the largest element; the title overlay covers the bottom of the art. | Cap the cover (about 300 pt max) and fit the thumbnail without cropping, or fill-crop to the square so no black bar shows. |
| P4 | P2 | Now playing at AX5 | The header wraps to two lines and the menu button is misaligned; the cover subtitle is cut to "Astral Projection · 1..."; the Up next card is below the fold. | At accessibility sizes shrink the cover (about 40 percent of the height), allow 3 lines for the subtitle, align the menu button to the first title line. |
| P5 | P2 | Now playing | The "..." menu item "Song details" opens the edit sheet ("Song" with Cancel/Save), not the Song Details screen. | Rename to "Edit song". |
| P6 | P2 | Now playing | Read-only genre chips look like the tappable filter chips. | Drop the shadow and use the tag style (flat tint) so they do not read as buttons. |
| P7 | P2 | Queue sheet | Rows read "Artist · YouTube" in faint ink, unlike the Library item style "Artist · year" (ux-preferences); the source in `inkFaint` is low contrast. | Use `librarySubtitle` ("Artist · year") in `inkMuted`. |
| P8 | P2 | Queue sheet | "Clear" is in the leading toolbar slot next to Done and clears at once, while Now playing's Clear queue asks first (IOS-125). | Ask for the same confirmation; move Clear out of the leading position (menu or trailing text button). |

### Details

| # | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| D1 | P1 | Song Details at AX5 | The title "Song Details" collides with "Edit" ("Detai[Edit]"); the Download label wraps with a misplaced icon. | At accessibility sizes put the title on its own line below the back and Edit row, or hide the centered title; let the primary label wrap with the icon above it. |
| D2 | P2 | Song Details | The year appears under the artist and again as "Release year" in the facts (duplicated info). | Drop the "Release year" row when the header line already shows it. |
| D3 | P2 | Song Details | The 200 pt cover is a letterboxed thumbnail (black bars top and bottom). | Fit without bars, as in P3. |
| D4 | P2 | Song Details | Duration, BPM and year take 48 pt rows each, with the dock on top; the action rows (Play next, Add to queue, Add to playlist) start below the second screen. A trailing hairline doubles the card edge in the facts and action cards. | Two-column compact facts (Duration, BPM, Year on one row); remove the last hairline in each card. |

## Notes

- Design-token use looks sound in the code read (no literals in the flagged views); all fixes stay inside tokens.
- Library v5 items (controls-line rework, Era chip, Play matched, collapse-on-scroll) were not reported. Three candidate findings on the controls line (sort label, visible Clear button, Songs/Albums order) were dropped as v5 scope; L1 asks only for overflow and gutter fixes, not a new layout.
- Fixes touch `LibraryComponents.swift`, `LibrarySongRow.swift`, `AlbumsView.swift`, `AlbumDetailView.swift`, `SongListScreen.swift`, `Views.swift` (dock), `PlaybackView.swift`, `SongRowViews.swift`, `SongDetailsView.swift`.
