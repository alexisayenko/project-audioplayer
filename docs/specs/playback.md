# Playback screen and play queue

Code: `web/js/player.js` (UI, audio, persistence), `web/js/queue-logic.js`
(pure queue rules, tested by `web/js/queue-logic.test.mjs`), `web/index.html`
(`#player`). Wireframes: [whole screen](../product/wireframes/playback-v3-detailed.png),
[controls](../product/wireframes/playback-v3-controls.png),
[rows](../product/wireframes/playback-v3-rows.png),
[scrollbar](../product/wireframes/playback-v3-scrollbar.png). Product
description: [`../product/screens.md`](../product/screens.md) section 3. Status values reflect code read on 2026-10-13; the web layout follows the Electrophone web artboards (WEB-014, WEB-016); the wireframes above are the older four-card layout and are history for layout.

## Screen

The layout is two columns (one below 900px): the player column (cover, seek bar, transport tray with volume, details) and the queue card. The four numbered blocks below keep their IDs; they are regions, not stacked cards.

- PLY-001 MUST: Playback is the regular tab `#/playback` (page title "Now playing"): the player column (cover, seek bar, transport tray and volume, details), and beside it from 900px (below it on narrower screens) the queue card. Status: implemented
- PLY-002 (changed 2026-10-13) MUST: the queue length shows as "N songs" in the queue card header when the queue is non-empty; the tab has no badge. Status: implemented
- PLY-003 MUST: one `<audio>` element plays every song; it streams `GET /files/{id}`. Status: implemented

## Block 1: song details

- PLY-010 MUST: the cover is a square with the title and a subtitle "Artist · Album · Year" (plus "Remix: <remixer>" when set) on a scrim at its bottom; a vinyl square with an accent disc shows when there is no art; with an empty queue it shows "Nothing playing". Below the transport, the details block shows tag chips, BPM (`<rounded> BPM`) and the links row (PLY-015). Status: implemented
- PLY-011 MUST: the Source link opens `source_url` in a new tab and is shown only for `http(s)` URLs. Status: implemented
- PLY-015 MUST: the overlay shows a links row after the BPM with up to three links, in order "Source" (`source_url`, `http(s)`), "Wikipedia (song)" (`wikipedia_song`) and "Wikipedia (band)" (`wikipedia_artist`, `https`), only those present, each `target=_blank rel="noopener noreferrer"` (`songLinks` in `web/js/wiki-links.js`, node test). Status: implemented
- PLY-012 SHOULD: tag chips in the details block wrap onto as many lines as needed (the old three-line clip is gone). Status: implemented
- PLY-013 MUST: a missing or failing cover is blanked, not shown as a broken image. Status: implemented
- PLY-014 MUST: chips on the overlay, queue rows, selected-tag chips and the tag picker use the same display names as Library (LIB-016); picker groups are Genre, Decade, Country, other keys, Tags. Status: implemented
- PLY-016 MUST: with a current song the cover is a real `<button>` (`#cover-toggle`) that toggles play/pause: `aria-label` "Play" / "Pause" (swapped, no `aria-pressed`), same title, visible focus ring, Space and Enter work natively; the global Space shortcut (PLY-090) ignores key events whose target is a button, so one press toggles once. A translucent round play/pause icon is centred over the cover: always visible while paused, shown on hover, keyboard focus and for 1.2 s after a click while playing, and always visible on touch (`(hover: none)`); the title and subtitle scrim stays above it and does not take clicks. With an empty queue the cover is not a button (hidden, "Nothing playing"). On a current song without server audio the button starts or requests the download instead (PLY-111). Status: implemented

## Block 2: play controls

- PLY-020 MUST: one transport tray: Shuffle, Previous, Play/Pause, Next, Repeat (WEB-016); the seek bar above it shows elapsed time on the left and remaining time ("-M:SS") on the right. There are no Back 5 s / Forward 5 s buttons; the Left and Right arrow keys seek 5 s (PLY-090). Status: implemented
- PLY-021 MUST: the seek bar seeks on release; while dragging, the elapsed time follows the thumb and progress updates are suspended (details in PLY-120..122). Status: implemented
- PLY-022 MUST: relative seeks (Left/Right keys: 5 s; Media Session seek backward/forward: the offset given, default 10 s) are clamped to 0 and the duration. Status: implemented
- PLY-120 MUST: the Playback seek bar and the mini-player progress bar are the same draggable slider (`web/js/scrubber.js`, maths in the pure `web/js/scrub.js`, tested in `scrub.test.mjs`): a `role="slider"` element with `aria-valuemin` 0, `aria-valuemax` the duration in seconds, `aria-valuenow` the position and `aria-valuetext` "m:ss of m:ss". Pointer events cover mouse, touch and pen: pressing jumps the thumb to the pointer, dragging moves it, the pointer is captured (`setPointerCapture`) so the drag continues outside the bar, text selection and touch scrolling are off on it (`user-select: none`, `touch-action: none`). The target time follows the pointer (`positionToTime(clientX, rect, duration)`, clamped to 0..duration), shown in a bubble above the thumb and in the elapsed label; `timeupdate` does not move the thumb while dragging; the audio seeks once, on release (`audio.currentTime`), and the Media Session position state is updated at once. A cancelled pointer (`pointercancel`, lost capture) seeks nothing. Status: implemented (not checked in a browser)
- PLY-121 MUST: the slider is keyboard-operable (tab stop): Left/Down and Right/Up seek 5 s back / forward, with Shift 15 s, Home goes to 0 and End to the duration (`keyTime`); results are clamped to 0..duration; each key seeks immediately and the key does not reach the global Left/Right handler (PLY-090). Status: implemented (not checked in a browser)
- PLY-122 MUST: while `audio.duration` is NaN, Infinity or 0 (no metadata yet, no audio) the slider is disabled (`aria-disabled="true"`, dimmed, out of the tab order, ignores pointer and keys) and enables on `durationchange`. The visible bar stays 6 px (3 px along the bottom edge of the mini-player on phones) while the hit area is 28 px tall (24 px on phones) and the thumb is 16 px; on desktop the mini-player slider sits in the fixed 720px layout between the time label and the volume slider. Status: implemented (not checked in a browser)
- PLY-123 MUST: the download poll runs about every 1 s while the server reports movement (percent, speed or phase changing) and backs off to 2 s, 3 s, 5 s when idle (supersedes the unchanged-progress wording of PLY-112); it uses the `state`, `percent`, `speed` and `eta` fields of API-062, falls back to `status` and `progress` for older servers, and treats `queued` on the server as "Queued" and `converting` as "Converting". Polling pauses while the tab is hidden (`visibilitychange`) and resumes with an immediate request when it is visible again. A finished job holds at 100% for 0.6 s before it is removed (LIB-099). Status: implemented (not checked in a browser)
- PLY-125 MUST: with Auto-download off, Next, Previous, the Media Session actions and automatic advance skip songs without server audio and go to the nearest playable song in that direction, with ONE aggregate toast "Skipped N not downloaded". No playable song ahead: Next follows loop mode (loop all wraps to the first playable; otherwise playback stops with "No more downloaded songs in the playlist"); none behind: Previous restarts the current song. Shuffle draws only playable songs ("No downloaded songs to shuffle" when none). With Auto-download on nothing changes (PLY-110..116, PLY-114). Clicking a not-downloaded song directly still shows "Not downloaded" with the Download button. Pure logic: `nextPlayable` / `prevPlayable` in `web/js/queue-logic.js`. Status: implemented (not checked in a browser)
- PLY-124 MUST: queue rows without audio and the mini-player (its artist line) show "Downloading 42%", "Converting", "Queued" or "Download failed" with Retry for the current song while it waits for audio; the text updates in place on every poll. Status: implemented (not checked in a browser)
- PLY-023 MUST: Previous restarts the song when more than 3 s have played, otherwise goes to the previous song; at the first song (or with no shuffle history) it restarts the song. Status: implemented
- PLY-024 MUST: Next is disabled when no next song exists (last song, no loop, no shuffle remainder). Status: implemented
- PLY-025 MUST: with an empty queue Previous, Next and Play are disabled and the cover shows "Nothing playing". Status: implemented
- PLY-026 MUST: when a song ends the next one starts automatically by the same rules as Next; at the end of the queue playback stops. Status: implemented
- PLY-027 MUST: a playback failure shows the toast "Cannot play this song". Status: implemented

## Block 3: playlist controls

- PLY-030 MUST: Shuffle is a toggle (`aria-pressed`, label "Shuffle: on/off"); Repeat is one button that cycles off, whole list, one song (label "Repeat: off / whole list / one song", `aria-pressed` when not off, a different icon for one song); the mini-player has the same two controls. Status: implemented
- PLY-031 MUST: Shuffle plays each song once per round in random order; "Previous" walks back through songs actually played; when the round is over it stops, or with Repeat whole list starts a new round. Changing the shuffle setting resets the round. Status: implemented
- PLY-032 MUST: repeat "one song" repeats the current song on natural end; the Next button still advances. Repeat "whole list" wraps from the last song to the first. Status: implemented
- PLY-033 MUST: the tags that filled the queue are shown as chips above the queue, each with an x button that removes the tag and the not-yet-played songs only that tag contributed; toast "Removed N song(s)" (or "Tag removed"). Status: implemented
- PLY-034 MUST: "Clear" in the queue header removes every song after the current one (manual and tag-derived) and all tag chips; the current song and the ones already played stay and playback continues (`clearUpcoming` in `queue-logic.js`, node test `queue-clear.test.mjs`). It is disabled, with the tooltip "Nothing upcoming to clear", when nothing is upcoming and no chip is set. Toast "Cleared N song(s)" (or "Tag chips cleared"). The tag picker (PLY-035) and the chip x buttons (PLY-033) are unchanged. Status: implemented (a bug before: Clear was disabled unless a tag chip existed and only removed tag-derived songs, so a hand-built queue could not be cleared)
- PLY-035 MUST: "Add by tag" opens a tag picker dialog ("Add songs by tag"; chips grouped by key as in Library, with counts, multi-select, already selected tags pre-picked). "Add songs" appends the union of playable songs carrying any picked tag; unpicking a selected tag and applying removes it as in PLY-033. Status: implemented
- PLY-036 MUST: the queue count "N song(s)" is shown in the queue card header when the queue is non-empty. Status: implemented

## Block 4: current playlist

- PLY-040 MUST: every queue entry is a row: position number, cover, title (a button that plays it), artist, duration, and a menu button; there are no tag chips and no separate play/pause button on a row. Status: implemented
- PLY-041 MUST: the current row is highlighted (`aria-current`); clicking its title toggles pause, clicking another row's title jumps to that song. Status: implemented
- PLY-042 MUST: the row menu has Edit song (opens the Library Edit dialog, WEB-033; after saving the row shows the new title and artist), Download (only for a song with server audio, as in the Library menu), Move up, Move down and Remove, for EVERY row including songs already played and the current one. Move up is disabled only for the first row and Move down only for the last. Status: implemented
- PLY-046 MUST: queue edits keep the current song current by identity, not by position (`moveItem`, `removeItem` in `queue-logic.js`, node test `queue-edit.test.mjs`): moving a row only changes positions; removing a row before the current song shifts the index and never interrupts playback; removing the current song while playing advances to the next playable song after it and keeps playing (a paused queue is cued on it instead); if none is playable, or the last song was removed, playback stops and the cursor rests on the last remaining song (an empty queue shows the empty state, PLY-044). Shuffle and loop settings are untouched, and tag-derived items can be removed one by one without removing their chip (PLY-033 chip removal still works). Status: implemented
- PLY-043 MUST: the list scrolls inside its card (the card is at most 78% of the viewport height). Status: implemented
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

- PLY-070 MUST: while a song is loaded a mini-player bar (cover, title, artist, play/pause, next, thin progress bar, elapsed / duration, volume; shuffle, previous and repeat from 640px) shows on every tab; tapping its left part opens `#/playback`. Status: implemented
- PLY-071 MUST: the browser tab title is "<title> - Electrophone", else "Electrophone". Status: implemented
- PLY-072 MUST: the Playback song-details card has an Edit icon button (pencil, aria-label and tooltip "Edit song") for the current song that opens the Edit dialog (WEB-033); it is shown whenever a song is loaded, also when the song has no server audio. There is no "..." menu on this card. Status: implemented

## Media Session

- PLY-080 MUST: where supported, metadata (title, artist, album, cover artwork) and position state are published, and handlers exist for play, pause, previous track, next track, seek to, seek backward and forward (default 10 s). Status: implemented

## Keyboard

- PLY-090 MUST: Space toggles play/pause and Left / Right seek 5 s back / forward when a song is loaded, except when focus is in an input, textarea, select, button, link, dialog or editable element, or a modifier key is held. Status: implemented

## Offline

- PLY-100 MUST: the web player is online only: audio, covers and the library are fetched from the server; there is no offline cache; with "Auto-download songs" off (the default) songs without server audio are never added to the queue by Add, Play now, Add all or tag adds, and the queue's next/previous/shuffle skip any that are in it with the toast "Skipped N song(s) without audio" (they link to their source, WEB-023); with it on see PLY-110..PLY-116. Status: implemented
- PLY-101 MUST: Library "Play all" (LIB-092) calls `player.playListed` (`playListed` in `queue-logic.js`): the queue items become the listed songs, the shuffle round and history reset, the chips become the selected filter tags (`tags` of each item: those of the selected tags the song has; songs matching none are manual), the current index is 0 or random when Shuffle is on, and the first song plays at once. Status: implemented
- PLY-102 MUST: the Playback screen has a download icon button (aria-label "Download", WEB-034) for the current song, hidden when it has no server audio; it sits beside the Edit button (PLY-072) and is the only Download control on the card. Status: implemented

## Auto-download (ADR-0010 sub-decision, 2026-10-14)

- PLY-110 MUST: Settings has a "Playback" card with a checkbox "Auto-download songs" (`localStorage` key `ap2.autodl`, default off, every access in try/catch; WEB-036). It only changes what the client requests automatically; nothing is downloaded to the device (NFR-041). Status: implemented
- PLY-111 MUST: with it on, a song without server audio can be queued (Add, Play now, Add all, Play all, tag picker, Add by tag, a restored queue) and its audio is requested with `POST /songs/{id}/audio` (API-060). The current song is requested first; when it is ready and the user wanted to play it, it starts playing by itself. While waiting, the Playback card shows a banner "Queued for download" / "Downloading N%" and the queue row shows the same state (`aria-live` status). With it off nothing is requested automatically: a current song without audio shows the banner "Not downloaded" with a "Download" button (an explicit request, plays when ready); Play on it only toasts "Not downloaded". Status: implemented
- PLY-112 MUST: queue rows without server audio show one of: nothing extra when ready, "Not downloaded" (off), "Queued", "Downloading N%", "Download limit reached - resumes in N min", or "Download failed" with a "Retry" button. Downloads run one at a time per client (the server also limits per user, API-045) and are polled with `GET /songs/{id}/status` at 1 s, 2 s, 3 s then every 5 s while nothing changes. Status: implemented
- PLY-113 MUST: when the hourly add limit answers 429 `hourly_limit` (API-042, API-060), the download goes back to the head of the queue, all downloads pause for `retry_after_minutes`, every waiting row and the banner show "Download limit reached - resumes in N min" (refreshed every 30 s), and downloading resumes by itself when the time is up. Status: implemented
- PLY-114 MUST: Next, Previous, auto-advance and shuffle skip queue entries that cannot play now (no audio with auto-download off, or a failed download) with the toast "Skipped N song(s) without audio"; entries that are queued or downloading are waited for. If the awaited current song fails, the toast "Could not download <title>" shows and playback moves to the next playable song; if none exists it stays on the failed song with Retry. Status: implemented
- PLY-115 MUST: turning the setting off drops every queued and failed download job (a running one finishes); turning it on requests the current and upcoming songs that lack audio. Removing a song from the queue drops its waiting job. Status: implemented
- PLY-116 MUST: the pure state machine is `web/js/dl-queue.js` (enqueue, front priority, prune, retry, startable under a concurrency cap and the limit pause, resume, per-song view, poll backoff), tested by `dl-queue.test.mjs`; `web/js/autodl.js` runs it against the API; `web/js/player.js` wires queue and banner. Status: implemented
- PLY-117 MUST: the mini-player bar (from 480px) has a fixed width of 720px (less than the stage minus 16px margins on narrow windows), centred in the area right of the sidebar, never stretching; two rows: cover, title and artist, shuffle, previous, play/pause, next, repeat and the action buttons; then elapsed / duration, a progress bar and volume. It is visually separate from the list: opaque raised surface, 1px `--line` border, strong shadow, 16px margin; Library and Settings reserve bottom padding for its height. Below 480px it keeps the compact one-row bar with only the Add to current playlist toggle (Edit details and Show in list are hidden). Status: implemented (not checked in a browser)
- PLY-118 MUST: the mini-player has icon buttons for the playing song: "Edit details" (the Edit dialog), "Show in list" (LIB-097) and "Add to current playlist", a toggle (PLY-119). Status: implemented (not checked in a browser)
- PLY-119 MUST: "Add to current playlist" shows `aria-pressed` and an accent fill when the song is in the queue (tooltip "In playlist - click to remove", check icon), otherwise "Add to current playlist"; clicking a selected one removes the song from the queue (`player.toggleInPlaylist`, `queue-logic.toggleQueued`); removing the playing song follows PLY-042 (advance to the next playable song and keep playing, or stop). Status: implemented (not checked in a browser)

- PLY-130 MUST: the song title is shown with its remix part in parentheses (LIB-112, `displayTitle`) in queue rows, the mini-player, the Playback song details, `document.title` and the Media Session title; rows and the mini-player ellipsise the remix part separately. Status: implemented (not checked in a browser)
