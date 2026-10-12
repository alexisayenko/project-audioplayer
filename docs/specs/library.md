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

- LIB-010 MUST: a card shows, in order: square cover (lazy-loaded, blank if missing); title; one line "Artist, Album, year" with missing parts omitted; duration (m:ss) and a BPM badge (`<rounded> BPM`) when known; two icon buttons; a row of tag chips. Status: implemented
- LIB-011 MUST: icon button Play now (`player.playNow`) inserts the song after the current one and plays it, keeping the user on Library. Status: implemented
- LIB-012 MUST: icon button Add to current playlist (`player.add`) appends to the queue; toast "Queued" (queue was empty, not played), "Added", or "Already in queue" (duplicate ignored). Status: implemented
- LIB-013 MUST: the currently playing song's card is highlighted. Status: implemented
- LIB-014 MUST: clicking the title (card body) opens the Edit dialog; there is no separate edit or delete button on the card. Status: implemented
- LIB-015 MUST: `key:value` tags render with the key as a highlighted prefix. Status: implemented

## Search

- LIB-020 MUST: search is a case-insensitive substring match over title, artist, album and all tags, updated on every keystroke. Status: implemented

## Tag filter

- LIB-030 MUST: chips grouped by key, plain tags under "Tags", with counts, single-select; see TAG-032, TAG-033. Status: implemented

## Sort

- LIB-040 MUST: sort options: Newest first (`added_at` descending, default), Title (A-Z), Artist (A-Z, then title), Year (newest first, missing last), BPM (ascending, songs without BPM last). Status: implemented
- LIB-041 MUST: text sorts are case- and accent-insensitive (`localeCompare`, base sensitivity). Status: implemented

## Edit dialog

- LIB-050 MUST: fields: Title (required), Artist, Album, Year (0..3000), BPM (20..300, step 0.1, placeholder "Unknown") with a Re-detect button, Tags (comma-separated text with suggestions from existing tags). Status: implemented
- LIB-051 MUST: Save sends `PATCH` with all fields (empty year or BPM becomes `null`), closes, refreshes, toast "Saved"; a server error shows inline and keeps the dialog open. Status: implemented
- LIB-052 MUST: Re-detect calls `POST /songs/{id}/bpm/detect`, fills the BPM field and saves the new value immediately (independent of the Save button); a failure shows inline. Status: implemented
- LIB-053 MUST: Delete is inside the Edit dialog and asks for confirmation ("Delete song?"); it removes the record, audio file and cover; a 404 (already gone) just closes and refreshes. Status: implemented
- LIB-054 SHOULD: the label say BPM is a heuristic that may be off by half or double. Status: implemented

## Not in scope

- LIB-060 SHOULD: bulk edit, multi-select, drag-reorder. Status: planned
- LIB-061 SHOULD: multi-tag filter. Status: planned (TAG-035)
