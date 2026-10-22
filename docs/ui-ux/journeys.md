# Journeys

Multi-screen paths — onboarding, first-add → save, recovery
flows. One section per journey while the list is short.

Starts as this flat file. Extracts to `journeys/<journey>.md` when
journeys accrue their own branch tables, screen-by-screen notes,
or open questions — see
[`../README.md#section-file-folder`](../README.md#section-file-folder).

For the journey concept and how it relates to screens, see
[`README.md`](README.md).

## Add a song and play it offline (iPhone)

Paste a link, keep the song on the phone, play it with no network.

- **Entry:** the + button in the Library header (or Search inside the Add sheet).
- **Screens (in order):** Add sheet (paste, preview, edit tags, Save to iPhone) -> sheet closes, Library row
  shows "Downloading NN%" -> Playback (mini-player on other tabs); Settings first when no token or sign-in exists.
- **Branches:** no token or unreachable server -> error on Preview, go to
  Settings; song already in library -> 409 message; song added on the web
  (a catalog entry only, no audio) -> whether it shows on the phone follows the iOS catalog sync (`../specs/ios.md`); paste its link in Add to be sure.
- **Exit / success:** the song plays from the phone with the screen locked
  and no connection (`../specs/ios.md`).

## Add a song on the web (catalog only)

Paste a link, keep the song's details in the library; play it from its original link or on the iPhone.

- **Entry:** the "Add song" button in the Library header (or `#/add`); signed-in users only (Settings first when signed out).
- **Screens (in order):** Add dialog (link field, "Already in your library" check while typing, Fetch) -> form opens with the preview (Title / Artist / Remix pills, Get metadata, Genres, Countries, Tags, Wikipedia) -> "Save to library" -> dialog closes, toast "Saved to library", the row appears in Library.
- **Branches:** the link is already in the library -> the hint with "Show in library" and Fetch disabled; unsupported, private, not found or preview-only link -> error text in the dialog; closing the dialog at any point discards the form.
- **Exit / success:** the song is in the library without audio (greyed, service logo link); songs that already have server audio play in the web player.


## Queue playback and temporary audition (agreed target)

Accepted 2026-10-22 in [ADR-0043](../tech/decisions.md#adr-0043-persistent-queue-and-ephemeral-visible-song-audition);
**not implemented** ([task-0085](../tasks/task-0085.md)). Earlier journeys
above describe existing screens; the flows below define the new behavior.

### Build the continuing queue

1. Find a song in Library, the collection of all songs.
2. Use Add to queue (the quick action under duration or the separate queue action); this changes membership without starting audition or queue playback.
3. Start/resume the queue from the playback dock/Now playing and control its progression there.
4. Browse other screens, lock or background the app: the queue continues independently, including offline for downloaded songs.

Playlists will be another explicit queue source when implemented; no playlist
flow is delivered here. Existing Play all matched/Play next/Play now semantics
need reconciliation before the new model ships.

### Try a song while the queue continues

1. With the queue playing, keep the desired Library row visible and press its cover Play.
2. The separate audition starts; the queue remains audible and the dock keeps its queue song, progress and controls.
3. Press the row's Pause to pause only audition; press dock Pause to pause only the queue.
4. Play another visible row: it replaces audition alone, without changing the queue.
5. Scroll the audition row offscreen or filter it out: audition stops; scrolling it back does not restart it.

Audition has only Play/Pause, no seek, volume or next/previous controls;
there is only one audition song, without auto-next.

### Try a song in Song Details

1. Open a song's details from Library; any Library-owned audition stops because its owning view has been left.
2. Press Play in the visible Song Details view to start a new audition; the queue continues independently.
3. Press Pause there to affect only audition.
4. Close/dismiss Details or navigate elsewhere: audition stops; the queue retains its own playback state.

Returning to Library does not restart the row audition. Opening a details view
is not an implicit transfer or continuation of audition playback.

### Lock, leave and return

1. While audition and queue are both playing, lock the phone or switch away from the app.
2. Audition stops immediately; queue playback can continue in the background or locked, with its existing offline guarantees.
3. Unlock/return: audition stays stopped until explicit Play on a visible song.
4. Exiting the app stops audition too; continuation or automatic restoration of a terminated queue process is not promised.

System/headphone transport ownership, audition resume/availability, statistics
and platform interruption rules remain [open implementation decisions](../specs/playback.md#open-decisions-before-implementation).
