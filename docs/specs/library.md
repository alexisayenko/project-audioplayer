# Library screen

Code: `web/js/library.js`, `web/js/store.js`, `web/js/playable.js`, `web/js/track-sub.js`, `web/js/genre-cell.js`. Status values reflect code read on 2026-10-13. Source of truth: the code and
[`../product/screens.md`](../product/screens.md) (no wireframe file exists
in `docs/product/wireframes/` yet; add a link here when it lands).

## Screen

- LIB-001 MUST: Library is the default route (`#/library`); a signed-out visitor is redirected to Settings (sign-in only, WEB-001). Status: implemented
- LIB-002 MUST: it loads `GET /library` once per session, refreshes after every add, edit, delete and BPM re-detect, and shows "Loading your library...", then on failure the error with a Retry button. Status: implemented
- LIB-003 MUST: the header shows the total ("N songs"); when a filter or search is active a status line shows "N songs match" plus up to three selected value names; an empty library shows a "No songs yet" card ("Paste a YouTube or SoundCloud link to save the song to your library.") with an "Add song" button; no match shows "No songs match. Clear the search or the filters." Status: implemented
- LIB-004 MUST: search, sort and filter selection persist while navigating between tabs in the same page session (not across reloads). Status: implemented

## Song card

- LIB-010 MUST: a Library row is one line of the table (WEB-031): cover (lazy-loaded, blank if missing); Track (title, with a muted "Artist · Year" line below it); Genres (from 900px); Time (m:ss) or, for a song without server audio, the service logo link (WEB-023); the row menu button. The row shows no album, BPM badge or tag chips. Status: implemented
- LIB-011 MUST: Play now (`player.playNow`; the title of a row with server audio, or the row menu item "Play now") inserts the song after the current one and plays it, keeping the user on Library. Rows without server audio have neither (WEB-023). Status: implemented
- LIB-012 MUST: the row menu item "Add to playlist" (`player.add`; only on rows with server audio) appends to the queue; toast "Queued" (queue was empty, not played), "Added", or "Already in queue" (duplicate ignored). Status: implemented
- LIB-013 MUST: the currently playing song's card is highlighted. Status: implemented
- LIB-014 MUST: the row menu (the "..." button, `aria-label` "More: <title>") offers "Edit song" (opens the Edit dialog); clicking the title plays the song when it has server audio (changed 2026-10-13: it used to open Edit). There is no separate edit or delete button on the row; Delete lives in the Edit dialog. Status: implemented
- LIB-015 MUST: where tag chips are shown (Playback details, tag editor, tag picker) `key:value` tags render with the key as a highlighted prefix; Library rows show only the genre text (LIB-010). Status: implemented
- LIB-017 MUST: `decade:` tags show as "the 90s" on chips and in the Years filter sheet (chronological); search matches "90s". Status: implemented
- LIB-016 MUST: `country:` tags show a human name on chips and in the Countries filter sheet ("Lithuania", via `Intl.DisplayNames`, raw value as fallback, raw tag in the tooltip); search matches both the code and the name. Status: implemented
- LIB-018 MUST: on the web the list columns are cover / Track / Genres / Time (plus the menu button), with no row-number, Album, Artist or Year column (WEB-031, LIB-010); the iOS list is unchanged. Status: implemented

## Search

- LIB-020 MUST: search (placeholder "Search songs, artists, albums") is a case-insensitive substring match over title, artist, album and all visible tags, updated on every keystroke. Status: implemented

## Tag filter

- LIB-030 MUST: four category chips (Tags, Genres, Years, Countries, with counts) open a filter sheet of value pills with counts, multi-select (values in a category are OR, categories are AND), Clear, and a "Show N songs" button (WEB-011); changed 2026-10-13: single-select chips grouped by key are gone (TAG-033 is the iOS-era rule). Status: implemented

- LIB-031 MUST: when a filter and/or search text is active and at least one song is listed, an "Add all N to playlist" button (N = songs currently listed) sits in the sort bar; it is hidden when neither is active (no "add entire library"). Click appends the listed songs that have server audio (WEB-023) to the queue, de-duplicated, at the end, without starting playback (same as per-song Add), toast "Added X songs (Y already in queue)". With exactly one filter value selected it becomes a chip in the playlist controls (as in PLY-035, only the listed songs are added) so Clear removes them; otherwise (several values, or search only) the songs are added as manual. Status: implemented

## Sort

- LIB-040 MUST: sort options (a select styled as an accent text button): Recently added (`added_at` descending, default), Title (A-Z), Artist (A-Z, then title), Year (newest first, missing last), BPM (ascending, songs without BPM last). Status: implemented
- LIB-041 MUST: text sorts are case- and accent-insensitive (`localeCompare`, base sensitivity). Status: implemented

## Edit dialog

- LIB-050 MUST: the Edit dialog is the shared song form of the Add dialog (WEB-033): Title (required), Artist and Remix & additional production as token pills (WEB-028, WEB-029), the "Wikipedia says" hint, "Get metadata" with service icons (fills only empty fields, `POST /metadata` with the song's current title, artist, Wikipedia links and sources), Album, Year (0..3000), a read-only BPM label ("<n> BPM" rounded, or "Not detected yet") with a Re-detect button (no manual entry; the Add dialog shows the muted line "BPM is detected after saving"), Genres (with autocomplete, WEB-030) and Countries chip fields (WEB-024), Tags (shared tag editor, LIB-055), and the two Wikipedia inputs (always visible, article name only). The dialog has Cancel, Save and "Delete from library". Status: implemented
- LIB-051 MUST: Save sends `PATCH` with all fields except `bpm` (empty year becomes `null`), closes, refreshes, toast "Saved"; a server error shows inline and keeps the dialog open. Status: implemented
- LIB-052 MUST: Re-detect calls `POST /songs/{id}/bpm/detect`, updates the BPM label (the server saves the new value immediately, independent of the Save button); a failure shows inline. Status: implemented
- LIB-053 MUST: Delete is inside the Edit dialog and asks for confirmation ("Delete song?"); it removes the record, audio file and cover; a 404 (already gone) just closes and refreshes. Status: implemented
- LIB-054 SHOULD: the BPM value carries a tooltip saying BPM is a heuristic that may be off by half or double. Status: implemented
- LIB-055 MUST: the Tags field is the shared tag editor (`web/js/tag-editor.js`, also used by Add, ADD-004; WEB-033): a text input (Enter or comma adds a chip, accepts `key:value`, filters the list below as you type, matches code and display name), the song's current tags as chips with an x (without `genre:`, `country:` and `lang:` tags, which the Genres and Countries fields hold, WEB-024), in Add a "Suggested" row, and below every other library tag as a toggle chip (assigned ones selected) grouped Decade (chronological), other keys, Tags, most-used first with counts; the list scrolls inside the dialog (max height). Changing the Year input immediately shows the derived decade chip (preview only, TAG-038). Save sends the full tag array. Status: implemented

- LIB-056 MUST: the Edit dialog has "Wikipedia: song" and "Wikipedia: band" inputs showing the article name only (WEB-032; empty clears the link; no fill button, see ADD-051); Save sends `wikipedia_song` and `wikipedia_artist` with the other fields. Library rows do not show the links. Status: implemented

## Not in scope

- LIB-060 SHOULD: bulk edit, multi-select of rows, drag-reorder of rows. Status: planned
- LIB-061 SHOULD: multi-tag filter. Status: implemented (superseded by LIB-030 and WEB-011; TAG-035 is the old plan)

## Per-user library (ADR-0012)

- LIB-090 MUST: the Library, Tags, catalog and every song action work on the signed-in user's own library only; a new user starts empty ("No songs yet..."). Status: implemented
- LIB-091 MUST: Settings shows the signed-in email and the meter "N / 500 songs · X / 5 GB" from `GET /me/usage` (for the owner, who has no limits: "N songs · X"). Status: implemented
- LIB-092 MUST: the sort bar has a "Play all N" button (N = songs currently listed, after filters, search and sort), always visible when at least one song is listed (with no filter it plays the whole listed library). Click REPLACES the queue with the listed songs that have server audio (list order, de-duplicated), starts playing the first one (a random one when Shuffle is on), and stays on Library. Toast "Playing N songs", with " (queue replaced)" when the queue still had upcoming songs and ", M without audio skipped" when some listed songs have no server audio. Tag filters become playlist chips with tag-derived items; search-only gives manual items (PLY-101). "Add all" (LIB-031) keeps its own visibility rule. Status: implemented
- LIB-093 MUST: the row menu of a song with server audio also offers "Download" (WEB-034, API-061), between Add to playlist and Edit song. Status: implemented
- LIB-094 MUST: with "Auto-download songs" on (PLY-110) the Library row menu of a song without server audio also offers "Play now" and "Add to playlist" and its title is a play button; "Add all N to playlist" and "Play all N" then include those songs and their toasts add ", M downloading" (the number of listed songs now waiting for audio) instead of ", M without audio skipped". With it off nothing changes (WEB-023). Status: implemented
