# Playback screen and play queue

Code: `web/js/player.js` (UI, audio, persistence), `web/js/queue-logic.js`
(pure queue rules, tested by `web/js/queue-logic.test.mjs`), `web/index.html`
(`#player`). Wireframes: [whole screen](../product/wireframes/playback-v3-detailed.png),
[controls](../product/wireframes/playback-v3-controls.png),
[rows](../product/wireframes/playback-v3-rows.png),
[scrollbar](../product/wireframes/playback-v3-scrollbar.png). Product
description: [`../product/screens.md`](../product/screens.md) section 3.

## Screen

- PLY-001 MUST: Playback is the regular tab `#/playback`; the page shows four stacked cards: song details, play controls, playlist controls, current playlist. Status: implemented
- PLY-002 MUST: the Playback tab shows the queue length as a badge when the queue is non-empty. Status: implemented
- PLY-003 MUST: one `<audio>` element plays every song; it streams `GET /files/{id}`. Status: implemented

## Block 1: song details

- PLY-010 MUST: the card shows the current song's cover as the card background, with a dark scrim overlay carrying, in order: title, "Artist, Album, year" (missing parts omitted), tag chips, BPM (`<rounded> BPM`) and the links row (PLY-015). Status: implemented
- PLY-011 MUST: the Source link opens `source_url` in a new tab and is shown only for `http(s)` URLs. Status: implemented
- PLY-015 MUST: the overlay shows a links row after the BPM with up to three links, in order "Source" (`source_url`, `http(s)`), "Wikipedia (song)" (`wikipedia_song`) and "Wikipedia (band)" (`wikipedia_artist`, `https`), only those present, each `target=_blank rel="noopener noreferrer"` (`songLinks` in `web/js/wiki-links.js`, node test). Status: implemented
- PLY-012 SHOULD: tag chips on the overlay are clipped to about three lines. Status: implemented
- PLY-013 MUST: a missing or failing cover is blanked, not shown as a broken image. Status: implemented
- PLY-014 MUST: chips on the overlay, queue rows, selected-tag chips and the tag picker use the same display names as Library (LIB-016); picker groups are Genre, Decade, Country, Language, other keys, Tags. Status: implemented

## Block 2: play controls

- PLY-020 MUST: one row of buttons: Previous, Back 5 s, Play/Pause, Forward 5 s, Next, then "M:SS / M:SS" (elapsed / duration). Status: implemented
- PLY-021 MUST: below it a thin scrubber seeks on release; while dragging, the elapsed time follows the thumb and progress updates are suspended. Status: implemented
- PLY-022 MUST: Back 5 s and Forward 5 s seek relative to the current position, clamped to 0 and the duration. Status: implemented
- PLY-023 MUST: Previous restarts the song when more than 3 s have played, otherwise goes to the previous song; at the first song (or with no shuffle history) it restarts the song. Status: implemented
- PLY-024 MUST: Next is disabled when no next song exists (last song, no loop, no shuffle remainder). Status: implemented
- PLY-025 MUST: with an empty queue the transport buttons are disabled and the details card shows "Nothing playing". Status: implemented
- PLY-026 MUST: when a song ends the next one starts automatically by the same rules as Next; at the end of the queue playback stops. Status: implemented
- PLY-027 MUST: a playback failure shows the toast "Cannot play this song". Status: implemented

## Block 3: playlist controls

- PLY-030 MUST: toggle buttons Shuffle, Loop one song and Loop whole list, each with `aria-pressed` and a labelled state. Loop one and Loop whole list are mutually exclusive; pressing the active one turns repeat off. Status: implemented
- PLY-031 MUST: Shuffle plays each song once per round in random order; "Previous" walks back through songs actually played; when the round is over it stops, or with Loop whole list starts a new round. Changing the shuffle setting resets the round. Status: implemented
- PLY-032 MUST: Loop one repeats the current song on natural end; the Next button still advances. Loop whole list wraps from the last song to the first. Status: implemented
- PLY-033 MUST: tag chips of the selected tags are shown, each with an x button that removes the tag and the not-yet-played songs only that tag contributed; toast "Removed N song(s)". Status: implemented
- PLY-034 MUST: "Clean playlist" removes all selected tags and the songs they contributed (same rule as PLY-033, see PLY-052); it is disabled when no tag is selected. Toast "Removed N song(s)" or "Tags cleared". Status: implemented
- PLY-035 MUST: the "+" button opens a tag picker (chips grouped by key as in Library, with counts, multi-select, already selected tags pre-picked). "Add songs" appends the union of songs carrying any picked tag; unpicking a selected tag and applying removes it as in PLY-033. Status: implemented
- PLY-036 MUST: a count "N song(s)" is shown when the queue is non-empty. Status: implemented

## Block 4: current playlist

- PLY-040 MUST: every queue entry is a row like a Library card: cover, title, "Artist, Album, year", duration, tag chips, play/pause button and a menu button. Status: implemented
- PLY-041 MUST: the current row is highlighted (`aria-current`); the play button on it toggles pause, on others jumps to that song. Status: implemented
- PLY-042 MUST: the row menu has Move up, Move down, Remove. Songs already played and the current song cannot be removed or moved, and nothing can be moved above the current song; unavailable items are disabled. Status: implemented
- PLY-043 MUST: the list scrolls inside its card with a persistent thin scrollbar (reserved gutter, always visible). Status: implemented
- PLY-044 MUST: an empty queue shows "Queue is empty - add songs from Library". Status: implemented
- PLY-045 SHOULD: the menu closes on outside click, Escape, resize and list scroll; Escape returns focus to the menu button. Status: implemented

## Queue source rules

- PLY-057 MUST: the Library "Add all N to playlist" button (LIB-031) calls `player.addListed` (`addListed` in `queue-logic.js`), which for a tag filter reuses `addTags` (the tag-picker logic): the tag becomes a chip and the listed songs are added as tag-derived; with search only they are added as manual. Nothing starts playing unless the queue was empty, and then the first song is only loaded (as PLY-035). Status: implemented
- PLY-050 MUST: every queue entry is either manual (added one by one with Library Add or Play now) or tag-derived (brought in by one or more selected tags); a tag-derived entry records which tags brought it. Status: implemented
- PLY-051 MUST: manual wins: a song added manually stays in the queue when its tags are removed or cleaned; adding a song that is already tag-derived makes it manual (result "added"), adding a manual duplicate is ignored ("Already in queue"). Status: implemented
- PLY-052 MUST: removing tags drops a song only if it comes after the current song, is not manual and has no other selected tag left; songs already played, the current one and manual ones stay. Status: implemented
- PLY-053 MUST: tag matching is case-insensitive; adding tags is a union (any tag), de-duplicated by song id; a song brought in again by another tag gains that tag. Status: implemented
- PLY-054 MUST: Play now inserts the song right after the current one (moving it there if already queued), marks it manual and plays it. Status: implemented
- PLY-055 MUST: adding to an empty queue selects the first song as current but does not start playing (toast "Queued"). Status: implemented
- PLY-056 MUST: songs deleted from the library are dropped from the queue; if the current song is deleted playback stops and the cursor moves to the nearest remaining song. Status: implemented

## Persistence

- PLY-060 MUST: the queue (`items`, `index`, `tags`) is saved in `localStorage` key `ap2.queue`; shuffle (`1`/`0`) in `ap2.shuffle`; repeat (`off`, `all`, `one`) in `ap2.repeat`. Status: implemented
- PLY-061 MUST: on reload the queue is restored and the current song is loaded paused (no autoplay) once the library has loaded; corrupt or unavailable storage yields an empty queue. Status: implemented
- PLY-062 SHOULD: the legacy format `{ids: [...]}` is read as all-manual entries. Status: implemented
- PLY-063 MUST: the playback position is not persisted. Status: implemented

## Mini-player

- PLY-070 MUST: while a song is loaded a mini-player bar (cover, title, artist, play/pause, next, thin progress bar) shows on every tab; tapping its left part opens `#/playback`. Status: implemented
- PLY-071 MUST: the browser tab title is "<title> - Electrophone", else "Electrophone". Status: implemented

## Media Session

- PLY-080 MUST: where supported, metadata (title, artist, album, cover artwork) and position state are published, and handlers exist for play, pause, previous track, next track, seek to, seek backward and forward (default 10 s). Status: implemented

## Keyboard

- PLY-090 MUST: Space toggles play/pause when a song is loaded, except when focus is in an input, textarea, select, button, link, dialog or editable element, or a modifier key is held. Status: implemented

## Offline

- PLY-100 MUST: the web player is online only: audio, covers and the library are fetched from the server; there is no offline cache. Status: implemented
