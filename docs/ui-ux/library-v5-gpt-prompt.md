> Historical: superseded by docs/ui-ux/library-v5.md and the cloud artifacts.

# Message for ChatGPT: Electrophone Library v5 (context + corrections)

Thank you for v4: it is the most consistent so far. Before v5, here is the context you were missing, then the corrections. Treat this as the product brief; it overrides earlier assumptions.

## 1. What Electrophone is
A private, offline-first music player for iPhone (and a web app for the same library). One principle rules everything: "Songs I pick are on my phone and play reliably, offline, with the screen locked." Playback and offline reliability beat features; anything decorative or social is cut. No monetization, no recommendations, no feed.
Each user has ONE library. A song has metadata (title, artist, year, genres, tags, country, BPM, cover, source links) and, separately, audio that may or may not be on the phone. Audio is always AAC (m4a), best quality the source offers (usually 128 kbps).

## 2. Who uses it and how (flows)
- Signed out (no account needed): the library is stored ON THE IPHONE only. The user pastes a YouTube or SoundCloud link in the Add sheet (+ button); the song downloads to the phone and appears in the Library. No search, no cloud, no sync. Empty state text: "Your library is stored on this iPhone. Paste a YouTube or SoundCloud link to add songs, or sign in to search and sync." with two buttons: Add song, Sign in.
- Signed in (Google or Apple): the Library shows the full catalog from the user's server library (hundreds of songs). Each song's audio is in one of four states, shown calmly in the row: ON THE PHONE (plays offline), ON THE SERVER only (a "Download" pill), DOWNLOADING (progress %), NO AUDIO YET (row dimmed). Adding a song can also search YouTube. "Download all to iPhone" lives in Settings. Downloading never auto-plays.
- Playback: tap a song to play; a mini-player docks at the bottom while a song is loaded; the Now playing screen has the cover, seek bar, transport, shuffle/repeat and an Up next queue. Lock-screen and background playback work.
- Navigation: a LEFT drawer (opened by the hamburger) with Library, Now playing, Playlists (coming soon), Statistics, Settings, and an account row (Sign in or the email). There is no bottom tab bar.
- Settings: account, storage (downloaded audio size, free space, Open in Files, Remove all downloads), audio format note, mobile-data toggle, version.
- Downloaded files are visible in the iPhone Files app as "Artist - Title.m4a".
- Not in scope for this phase: the docked mini-player/Now playing redesign (separate later phase: keep the mini-player exactly as in v4), Playlists, Statistics, Settings.

## 3. Library functionality (must be respected)
- Header shows the TOTAL library count; it never changes with filters.
- Search (title, artist, album, remix, tags) filters live and combines with filters.
- Filters (one scrolling row, one line, with small outline icons): Tags, Genres, DECADES (values 2020s, 2010s, 2000s... with counts; there is no per-year filter), Countries, plus two toggles: Never listened and Downloaded (on this phone). Multi-select inside a category; categories combine. Each category opens its own bottom sheet with search, counts and a "Show N songs" button.
- Sort criteria (7): Recently added, Title, Artist, Year, BPM, Length, Last listened; a separate button reverses direction.
- Play all N plays the current result set in the current order (disabled at 0).
- Row actions: tap cover = play; tap title/artist = Song Details (read-only information with listening statistics and an Edit button); long-press = context menu (Play next, Add to queue, Edit, Remove from iPhone, Delete from library with confirmation). VoiceOver exposes the same actions.

## 4. Corrections to v4 (apply all)
1. Remove the "..." button from rows. Long-press replaces it. The row's trailing column is: duration, then the audio-state element. Nothing else.
2. Add an "in queue" marker on rows: a small queue glyph with a checkmark, shown ONLY when the song is in the current queue. The currently playing song keeps the playing tint and the equaliser glyph on its cover.
3. Remove the "N songs match" label. The count lives in the Play all button ("Play all 3"); the header keeps the total. Nothing may shift position when the count changes. Empty result: Play all 0 disabled plus the "No songs found" state.
4. Remove "Add all N". Adding is done per song from the long-press menu.
5. Remove the strip of selected-value chips under the filters. A filter category with selections is shown by a tinted chip with a count badge ("Genres 2"). There must be exactly ONE "Clear filters" action, in the results row, visible only while any filter or search is active. No "Clear all" anywhere else.
6. Replace the Years sheet with a Decades sheet (2020s, 2010s, ... with counts).
7. Search: keep the clear x; remove the separate "Cancel" text button (tapping the list or scrolling dismisses the keyboard).
8. Do not clip the last filter chip mid-word: let one chip peek obviously off-screen, or scroll-fade the right edge.
9. Do not redraw the mini-player; reuse v4's exactly.

## 5. Please draw (same canvas, scale, device frame and fixed cast of six songs as before)
A. Library default (light) | B. Search results | C. Sort sheet (7 criteria, direction button) | D. Genres sheet | E. Decades sheet | F. Tags sheet (with in-sheet search, many values) | G. Active filters state (Genres 2 tinted, one Clear filters, Play all 128) | H. Long-press menu | I. SONG DETAILS (read-only: cover, title, artist, version/year line, Play button, label-value table: Duration, BPM, Key, Release year, Genres chips, Tags chips, Country, Date added, File name, Source; Playback statistics card: Plays, Last played, First played; actions Play next, Add to queue, Share link, Download or Remove from iPhone; Edit top-right) | J. Left drawer open | K. Library dark mode | L. States: signed-out empty library, loading skeleton, "Can't reach the server" with Retry and an offline banner while downloaded songs still play, no results | M. Large-text (accessibility) layout.
Finish with a consistency checklist (every component reused identically; one accent colour; AA contrast; 44 pt targets).

## 6. Additional corrections (from review of v4 crops)
1. KEEP the icon style you used (clean outline glyphs, ~1.75 pt stroke, round caps) for all icons, and the black-vinyl app icon.
2. The bottom safe area, 34 pt, is kept clear on every screen; the home indicator is not drawn.
3. The results row is ONE line, always: [Sort: <criterion> ⌄ (flexible width)] [direction button 44 pt] [reset-filters icon button 44 pt, always present, faint when nothing is active, tinted when search or a filter is active] [Play all N (fixed width, right-aligned)]. Never wrap or stack the "Clear filters" action under Play all. Nothing in this row changes position when counts or states change.
4. Long-press menu: Play next, Add to queue, Edit, Remove from iPhone (only when the audio is on the phone). NO "Delete from library" in the menu: deletion lives only inside Song Details, at the bottom, as a text action "Delete from library" in the danger colour with a confirmation.
5. Respect the device size: every frame must be exactly 428 x 926 pt (aspect 0.462), the same size on every screen, with all content inside it: no overflow, no clipped controls, no content that ignores the frame's safe areas (status bar 54 pt top, bottom safe area 34 pt kept clear; the home indicator is not drawn). Lay out each screen from the 24 pt margins inward; if something does not fit, simplify it instead of shrinking text below 11 pt.
