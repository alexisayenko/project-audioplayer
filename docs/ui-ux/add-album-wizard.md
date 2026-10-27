# Add album as a five-step wizard

Status: BUILT on the web, 2026-10-27, not deployed. Checked only in unit tests and a static browser harness (desktop and 375 px), not with a real account or a real Discogs, Wikipedia or YouTube. This page is the source of truth for the flow; the rules are LIB-265 to LIB-273 in [library.md](../specs/library.md). Related: [task-0120](../tasks/task-0120.md) (albums), [task-0038](../tasks/task-0038.md) phase 1B (album from a time-coded video), [ADR-0050](../tech/decisions.md) (Album entity), [screen-flow.md](screen-flow.md) section 4.3, [ux-preferences.md](../product/ux-preferences.md).

## 1. Scope (Alex's decisions)

Add album accepts ONLY:

1. a YouTube playlist link;
2. a YouTube video link, normally time-coded (chapters or description). A video without time codes is NOT blocked at step 1: it goes on with no tracks, and the Review step offers "No time codes? Paste a track list" (time-coded text, or a lengths-only list, LIB-261); the same step offers "Edit or paste a track list" when the found time codes look wrong.

The field says "YouTube playlist or video address". Any other address is refused with "Add album takes a YouTube playlist or a video with time codes. Paste one of those."; a Discogs link also gets "Discogs fills the details after you add the YouTube link." The Discogs-release-address mode is gone (web only; `POST /albums/preview` stays on the server for shipped clients). Discogs remains the metadata filler: year, type, genres, cover, link, tracklist with lengths.

Case built now: no pre-existing tracks in the library. Linking tracks that already exist (video "Use existing", playlist "In library") keeps today's behaviour and is not extended (section 8).

## 2. The five steps

| # | Step | What the user does | Calls |
| --- | --- | --- | --- |
| 1 | Link | Enters the address, presses Fetch (the accent button inside the field, at its right end). A video with no time codes still goes on (no tracks yet). | playlist: `POST /albums/youtube/preview`; video: `POST /albums/from-video/preview` or `/preview-text` |
| 2 | Details | Sees Artist, Album name and Year suggested from the title, channel and description (the server's guess, `album` of the preview). Artist and Album name are token pills like the song form (LIB-266); Year is wide enough for four digits. The found tracks are NOT listed here: one line, a link to the video or playlist, reads "channel · title · N tracks · h:mm:ss". An artist taken from a non-Topic channel name is flagged for a check. Adjusts the three fields. | none; Next starts the Discogs search |
| 3 | Discogs | Confirms the album: ONE row per Discogs master (a deduplicated release when it has no master), "Show all releases", or "None of these". | `POST /albums/discogs/search {artist, title, year, all?}` (API-301), `POST /albums/discogs/resolve` (API-309) |
| 4 | Review | One screen: album strip with Type; album art; genres; the Discogs tracklist with the matching YouTube track under each; one final button. | `POST /albums/genres/suggest` (API-310) |
| 5 | Import | Watches the job. | video: `POST /albums/from-video` then `GET /jobs/{id}`; playlist: `POST /albums/youtube/commit` |

The step line "Step n of 5 · Name" is a polite status; the dots are decoration.

### 2.1 Auto-skip of step 3

Step 3 is skipped when exactly one candidate has the same artist and album title as the fields (normalised) and a year within one of the typed year (or either year is empty). The album is resolved at once and the wizard lands on step 4; the dot of step 3 is shown as skipped. Back from step 4 then returns to step 2. No fuzzy match is trusted silently: two exact candidates, or none, show the list. If the resolve call fails the list is shown with the message.

### 2.2 Step 3 states

- Candidates: radio group "Discogs albums", the album (master) first. Each row: cover, "Artist - Title", year, track count, label and country for a release, "Master" or "Release".
- "Show all releases" repeats the search with `all: true` (every pressing).
- No candidates: "No match on Discogs. You can go on without it." with "None of these" preselected. Discogs not set up: "Discogs search is not set up on this server."; unreachable: "Discogs could not be reached. Try again later." Neither blocks.
- Resolve failure: "Discogs could not be read for this album. Pick another one or choose None of these."

### 2.3 Step 4 (Review)

1. Album strip: "Artist - Album · year" and a Type select (type read from the Discogs formats unless the user changed it).
2. Album art: radio thumbnails, Discogs cover first, the YouTube thumbnail as fallback; the first is preselected. The note says the art goes on the album and on every new song.
3. Genres: the existing editable pills (vocabulary list, free text refused). Below them suggestion pills, each with its source (Discogs, Wikipedia, Rate Your Music) and a tooltip; names outside the genre tree are shown struck through, flagged "not in tree" and cannot be added (RYM is the genre source of truth; the tree is grouping, not lineage). Discogs genres and styles are mapped by the server with the existing vocabulary code and the first four mapped ones are preselected until the user edits the pills. A field accepts a Rate Your Music link (stored as the album's `links.rateyourmusic`, shown as a link, never fetched) or genre text pasted from the RYM page (parsed and mapped by the server). English Wikipedia genres (infobox) come from the same call.
4. Tracks: the Discogs tracklist (number, title, length). Under each Discogs track the YouTube track the wizard paired with it (by title, then by order when nothing matches and the counts are equal) with its estimated length (a video: from its time codes; a playlist: the video's own duration) in a select: another YouTube track (the one that held it moves here) or "No match, skip this track". A pencil edits title, artist, version and, for a video, the start time; "Use the Discogs title" replaces the YouTube-derived title. A length difference over 20 s shows "Length differs, check the match". YouTube tracks no Discogs track claimed follow under "Other tracks from the video", unticked; ticking one adds it after the Discogs numbers. Without a Discogs pick the rows are the YouTube tracks.
5. The user ticks the tracks to import. The summary line sits above the list with Select all or none. Problems (empty title, bad start, overlap) show on the row and the first one in a line above the footer; the button is disabled while any exists.
6. One final button: a video "Download, cut and import" (one download and one split, counted as one add), a playlist "Import and download N tracks" (the web still fetches playlist audio client-paced, up to 20 an hour, pausing on the hourly limit) with the quota line for non-owners.

### 2.4 Step 5 (Import)

- Video: the existing split progress (bar `role=progressbar`, one status line "Waiting for the server to start." / "Downloading the video audio." / "Cutting 3 of 10 tracks: Title."). Done toasts and opens the album page. A job error shows the text with "Try again" (posts the same body; the server reuses the job of the same cut) and "Open the album"; four failed polls show "Lost contact with the server. The split may still be running." A "Close" button is always there: "You can close this. The split continues on the server." Closing stops polling and leaves the job to the server. There is no Cancel (the server has none).
- Playlist: "Album created, N songs added; downloading K tracks." with the live download status line (it pauses on the hourly limit and shows Resume now), "Open the album" and "Close". Downloads continue when the dialog is closed.

## 3. Back, Next and kept state

- One draft object (`album-wizard-model.js`) is owned by the shell; steps render from it and write back on input, so Back never loses typed text, the Discogs pick, the pairing, ticks or genres.
- Next validates only the current step. Back never validates.
- Fetch with an unchanged address reuses the stored preview and makes no call.
- Changing the address after the user edited anything asks once: "Start over from this link? Your edits to the album and tracks will be replaced." The Fetch button becomes "Replace" (accessible name "Replace my edits"); typing in the field cancels the question.
- Changing Artist, Album name or Year makes Next search Discogs again and drops the pick and the review (the genre pills the user edited are kept). Unchanged fields reuse the list and the pick.
- A dirty draft is not closed by a backdrop click (existing `backdropClose` rule); Cancel and Esc close.
- Enter in the address field fetches; Enter in a Details field goes next; Enter in a row field closes only that row editor.

## 4. Errors and states

All texts reuse the existing helpers (`previewErrorText`, `youtubeErrorText`, `createErrorText`). They appear in a `role=alert` region directly above the footer, so they are on screen next to the button that caused them.

| Situation | Where | Text or action |
| --- | --- | --- |
| Empty address | Link | "Paste a YouTube playlist or video address." |
| Mix, private list | Link | the existing Mix and private messages |
| Not YouTube (also Discogs) | Link | section 1 |
| 400, 404, 413, 429, 502 on preview | Link | existing texts; field and address kept |
| Video with no time codes | Review | "No time codes were found in this video, so there are no YouTube tracks yet." and the link "No time codes? Paste a track list"; the final button stays disabled |
| Pasted text without tracks | Review (paste box) | "No tracks found in this text. Each line needs a time, like 03:45 Artist - Title." |
| Playlist without playable videos | Link | "This playlist has no playable videos." |
| Offline (`navigator.onLine` false) or the server unreachable | any step with a call | "You are offline. Adding an album needs the server." or "The server could not be reached. Check the connection and try again." Nothing is lost. |
| Library or storage full, hourly limit, album limit | Review | the existing create texts; the draft is kept |
| 409 already exists | Review | "This album already exists." with "Open it" |
| 404 `unknown_song` (video) | Review | existing text; every "Use existing" is cleared |
| Wikipedia unreachable | Review genres | "Wikipedia could not be reached, so its genres are missing." |
| Genre suggestions failed | Review genres | "Genre suggestions are not available right now. Add genres by hand." |

## 5. Keyboard, accessibility, narrow widths

- Native `<dialog>` focus trap and Esc. On a step change focus goes to the step's first field (Link, Details, Discogs) or the step heading (`tabindex=-1`); the step line is a polite status.
- The Discogs list is a radio group (arrow keys); the art picker is a radio group; the pairing select has a label naming the Discogs track; row checkboxes name the track; icon buttons keep tooltip and `aria-label`.
- The disabled final button always has its reason in the problems line.
- The dialog footer is sticky, so Back and the primary button stay on screen on a phone; rows follow the two-line rule (line 1 checkbox, number, label, icons; the pairing select and the editor below); no horizontal scroll at 375 px; long names wrap.
- Tokens only (`web/tokens.css`); new classes `wiz-*` in `web/albums.css`.

## 6. What each new track gets (case: no pre-existing tracks)

Every newly created, downloaded, cut and imported song gets: the album's name; the album's art (server `coverToSongs: true` copies the stored album cover onto only the songs of that request, never reused songs); the album's YouTube address as source (a video: its own start and end of the track, as `youtubeAt` links them; a playlist: the song's own video); the album artist unless the track has its own artist (compilations); the album's genres. Each track keeps its own title and its number (the Discogs number when paired, else its place among the ticked tracks). Details: API-266, API-303.

## 7. Code

| File | Role |
| --- | --- |
| `album-wizard-model.js` | pure state machine: address check, preview to draft, step order and auto-skip, pairing, numbering, bodies, art options |
| `album-wizard-flow.js` | async glue with injectable api: Discogs search and resolve, genre suggestions |
| `album-wizard.js` | shell: dialog, step line, footer, busy and error region, offline listeners |
| `album-wizard-link.js`, `-details.js`, `-pick.js`, `-review.js`, `-rows.js`, `-extras.js`, `-run.js` | the steps; `extras` holds the art picker, genre area and type select |
| `album-genre-editor.js` | the editable genre pills (moved out of `albums.js`) |
| kept | `album-form.js` (Edit album), `album-video-model.js`, `album-youtube-model.js`, `album-draft-model.js`, `album-tracklist.js` (lengths-only paste), `album-video-progress.js`, `albums-youtube.js` (client-paced downloads), `dialog-backdrop.js` |
| removed | `album-video.js`, `album-youtube-flow.js`, `album-draft-view.js`, `album-discogs.js`, `album-tracklist-panel.js`, the Discogs-link client functions (`albumPreview`, `createAlbum`, `albumDiscogsSearch`) and `album-candidates.js` helpers of the old candidate picker |

Tests: `album-wizard-model.test.mjs` (no DOM), `album-wizard.test.mjs` (the steps end to end with a faked server), `albums-youtube.test.mjs` (playlist import and downloads), `albums-youtube-contract.test.mjs` (the commit body, recorded in `fixtures/yt-commit-album-request.json` and replayed by the server contract test), `album-video-progress.test.mjs`. Server: `test_albums_video.py`, `test_albums_youtube_album_form.py` (`coverToSongs`, `trackNo`), `test_albums_genres.py` (API-310, fake MediaWiki).

## 8. Not covered, and open points

- The existing-songs case is unchanged: video rows with a library match start unticked with "Use existing"; playlist rows already in the library are linked, not added twice. The new data rules of section 6 do not extend to linking existing songs beyond what the server did before.
- Per-track artists from Discogs (compilations) are not read: a track's own artist comes from the YouTube title only.
- A pasted lengths-only list is not scaled to the video length (the old "Scale to video length" link is gone).
- The album page does not show a running split; closing the dialog leaves the job to the server and the songs appear as the cuts finish.
- No server fixture records the video create body (only the playlist commit body is replayed).
- iOS has no Add album (IOS-098 to IOS-110 are the album screens). The same five steps map to a SwiftUI sheet with a `NavigationStack`, one `@Observable` draft and a pure `nextStep` function mirroring `album-wizard-model.js`; it needs permission to edit `ios/` and a device run.
- Alex's open choice W8 (playlist videos that are not tracks, such as a trailer) is left to the ticks; the pairing flags a length difference only.
