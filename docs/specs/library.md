# Library screen

Code: `web/js/library.js`, `web/js/store.js`. Source of truth: the code and
[`../product/screens.md`](../product/screens.md) (no wireframe file exists
in `docs/product/wireframes/` yet; add a link here when it lands).

## Screen

- LIB-001 MUST: Library is the default route (`#/library`); without a stored token every route redirects to Settings. Status: implemented
- LIB-002 MUST: it loads `GET /library` once per session, refreshes after every add, edit, delete and BPM re-detect, and shows "Loading...", then on failure the error with a Retry button. Status: implemented
- LIB-003 MUST: a count line shows "N of M songs"; empty library shows "No songs yet. Use Add to import one from a YouTube link."; no match shows "No songs match. Clear the search or the tag filter." Status: implemented
- LIB-004 MUST: search, sort and tag filter persist while navigating between tabs in the same page session (not across reloads). Status: implemented

## Song card

- LIB-010 MUST: a card shows, in order: square cover (lazy-loaded, blank if missing); title; one line "Artist, Album, year" with missing parts omitted; duration (m:ss) and a BPM badge (`<bpm> BPM`, whole number) when known; two icon buttons; a row of tag chips. Status: implemented
- LIB-011 MUST: icon button Play now (`player.playNow`) inserts the song after the current one and plays it, keeping the user on Library. Status: implemented
- LIB-012 MUST: icon button Add to current playlist (`player.add`) appends to the queue; toast "Queued" (queue was empty, not played), "Added", or "Already in queue" (duplicate ignored). Status: implemented
- LIB-013 MUST: the currently playing song's card is highlighted. Status: implemented
- LIB-014 MUST: clicking the title (card body) opens the Edit dialog; there is no separate edit or delete button on the card. Status: implemented
- LIB-015 MUST: `key:value` tags render with the key as a highlighted prefix. Status: implemented
- LIB-017 MUST: `decade:` tags show as "the 90s" on chips and in filter groups (group "Decade" after Genre); search matches "90s". Status: implemented
- LIB-016 MUST: `country:` and `lang:` tags show a human name on chips and in filter groups ("Lithuania", "Russian", via `Intl.DisplayNames`, raw value as fallback, raw tag in the tooltip); search matches both the code and the name. Status: implemented

## Search

- LIB-020 MUST: search is a case-insensitive substring match over title, artist, album and all tags, updated on every keystroke. Status: implemented

## Tag filter

- LIB-030 MUST: chips grouped by key, plain tags under "Tags", with counts, single-select; see TAG-032, TAG-033. Status: implemented

- LIB-031 MUST: when a tag filter and/or search text is active and at least one song is listed, an "Add all N to playlist" button (N = songs currently listed) sits next to the count line; it is hidden when neither is active (no "add entire library"). Click appends all listed songs to the queue, de-duplicated, at the end, without starting playback (same as per-song Add), toast "Added X songs (Y already in queue)". With a tag filter the tag becomes a chip in the playlist controls (as in PLY-035, only the listed songs are added) so Clean playlist removes them; with search only, the songs are added as manual. Status: implemented

## Sort

- LIB-040 MUST: sort options: Newest first (`added_at` descending, default), Title (A-Z), Artist (A-Z, then title), Year (newest first, missing last), BPM (ascending, songs without BPM last). Status: implemented
- LIB-041 MUST: text sorts are case- and accent-insensitive (`localeCompare`, base sensitivity). Status: implemented

## Edit dialog

- LIB-050 MUST: fields: Title (required), Artist, Album, Year (0..3000), BPM (20..300, whole numbers, step 1, placeholder "Unknown") with a Re-detect button, Tags (shared tag editor, LIB-055). Status: implemented
- LIB-051 MUST: Save sends `PATCH` with all fields (empty year or BPM becomes `null`), closes, refreshes, toast "Saved"; a server error shows inline and keeps the dialog open. Status: implemented
- LIB-052 MUST: Re-detect calls `POST /songs/{id}/bpm/detect`, fills the BPM field and saves the new value immediately (independent of the Save button); a failure shows inline. Status: implemented
- LIB-053 MUST: Delete is inside the Edit dialog and asks for confirmation ("Delete song?"); it removes the record, audio file and cover; a 404 (already gone) just closes and refreshes. Status: implemented
- LIB-054 SHOULD: the label say BPM is a heuristic that may be off by half or double. Status: implemented
- LIB-055 MUST: the Tags field is the shared tag editor (`web/js/tag-editor.js`, also used by Add, ADD-004): a text input (Enter or comma adds a chip, accepts `key:value`, filters the list below as you type, matches code and display name), the song's current tags as chips with an x, and below them every library tag as a toggle chip (assigned ones selected) grouped Genre, Decade, Country, Language, other keys, Tags, most-used first with counts; the list scrolls inside the dialog (max height). Changing the Year input immediately shows the derived decade chip (preview only, TAG-038). Save sends the same tag array as before. Status: implemented

- LIB-056 MUST: the Edit dialog has "Wikipedia: song" and "Wikipedia: band" URL inputs (empty clears the link) and a "Fill from Wikipedia links" button with the same behaviour as ADD-051; Save sends `wikipedia_song` and `wikipedia_artist` with the other fields. Library cards do not show the links. Status: implemented

## Not in scope

- LIB-060 SHOULD: bulk edit, multi-select, drag-reorder. Status: planned
- LIB-061 SHOULD: multi-tag filter. Status: planned (TAG-035)
