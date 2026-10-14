# Song stats (web)

Code: `web/js/stats.js` (page), `stats-chart.js` (canvas render and pointer/keyboard handling), `stats-data.js` (pure logic), `stats-table.js` (table view), `web/stats.css`. Tests: `stats-data.test.mjs`, `stats-table.test.mjs`, `stats.test.mjs`. Why: [ADR-0016](../tech/decisions.md) sub-note. No server change: the page plots the songs already in the store.

## Page

- STA-001 MUST: `#/stats` ("Song stats", nav item after Genres map, icon: axes with four dots) is a full-viewport workspace like the Genres map: a canvas fills the area right of the sidebar down to above the mini-player; a translucent toolbar top-left holds the title, the count "N of M songs plotted", a Colour by select, Legend, View as table and (only while zoomed or panned) Reset. Status: implemented (not checked in a browser)
- STA-002 MUST: one dot per song that has a numeric year and a numeric BPM; the others are not plotted and a note reads "N songs without year or BPM are not shown". With nothing plottable the page says "Songs need a year and a BPM to appear here"; before the library has loaded it says "Loading songs...". Status: implemented
- STA-003 MUST: x axis = year (integer ticks, range min..max padded by 1 year, at least 10 years wide); y axis = BPM (default 60..200, extended in steps of 20 to include outliers, ticks every 20 at the default zoom); light grid, muted tick labels, axis titles "Year" and "BPM". The canvas is DPR-aware and follows a ResizeObserver. Status: implemented
- STA-004 MUST: dots are 5px radius, 55% opaque so overlaps show; a deterministic jitter seeded by the song id (under 0.34 year and 1.4 BPM) keeps songs with the same year and BPM from hiding each other. Tooltips and tables show the true values. Status: implemented
- STA-005 MUST: Colour by Decade (default, from the year), Genre family (Genres map family colours, via `GET /genres/graph`; songs without a resolvable family, or when the graph is unavailable, are "Other" in neutral grey), Audio on server (has audio or not) or None; the choice is remembered in `localStorage` (`stats.color`). The colours are CSS variables `--st-0..11` and `--st-n` in `stats.css`, with light and dark values. Status: implemented
- STA-006 MUST: a collapsible legend lists each colour with its count; clicking an item hides or shows that group (dots, selection and table follow). Status: implemented
- STA-007 MUST: nothing animates continuously: the base canvas is redrawn only when data, view, size or hidden groups change; hover, selection and focus are drawn on a second canvas; draws are coalesced with `requestAnimationFrame`. Hit testing uses a spatial grid (9px hit radius, nearest dot wins) so about 5000 dots stay smooth. The route's cleanup disconnects the observer and cancels the pending frame. Status: implemented

## Interaction

- STA-010 MUST: hovering a dot highlights it and shows a tooltip with the title (remix part via `display-title.js`), artist, year and BPM; clicking a dot opens the song card (falls back to the edit dialog if `song-card.js` is missing). Status: implemented
- STA-011 MUST: dragging on empty chart draws a rubber-band rectangle that selects the visible dots inside it; a floating panel reads "N selected:" with Show in Library, Add to playlist, Play and Clear. Add to playlist and Play call `player.addListed` / `player.playListed` with the selected songs, exactly like the Library buttons (auto-download behaviour included); Clear (or Escape, or a click on empty chart) empties the selection. Show in Library is shown disabled with the tooltip "Coming soon" until Library gets an id filter. Status: implemented (Show in Library: planned)
- STA-012 MUST: the wheel zooms both axes around the cursor (limited to 2 years and 8 BPM minimum span); Shift+drag or middle-button drag pans; double-click, `0` or the Reset button restores the full view. Status: implemented (not checked in a browser)

## Accessibility

- STA-020 MUST: the chart canvas is focusable with `role="img"` and the label "Scatter plot of N songs: year on the horizontal axis, BPM on the vertical axis."; arrow keys move a dashed focus ring to the nearest dot in that direction, Enter opens the song, and a polite live region announces the focused song (title, artist, year, BPM). Status: implemented
- STA-021 MUST: "View as table" swaps the chart for a sortable table of the plotted songs (Title, Artist, Year, BPM, Decade; header buttons set `aria-sort`); a row's title opens the song card like a dot click. Status: implemented
- STA-022 SHOULD: tempo bands (shaded 90-110, 120-130, 170-180). Status: planned

## Tests

- STA-023 MUST: the toolbar and selection panel use the same raised card style as the Genres map (GEN-024); the page runs under the mini-player, the x-axis and the selection panel sit above it. Status: implemented (not checked in a browser)
- STA-030 MUST: node tests cover year and BPM exclusion, jitter determinism and bounds, extents (padding, minimum span, outliers), ticks, scale and zoom/pan maths, decade/audio/family/none grouping and colour keys, the grid hit test, rectangle selection, arrow-key neighbour search and table sorting; DOM-shim smoke tests cover the page (toolbar, legend toggle, empty and loading states, remembered colour, table toggle and sort, selection panel buttons calling the queue functions with the selected ids, wheel zoom and Reset, keyboard focus announcement). Status: implemented
