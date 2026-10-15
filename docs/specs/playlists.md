# Playlists (PLS)

Planned (task-0034); only the menu item and an empty placeholder page exist (PLS-100). A top-level "Playlists" menu item: named, ordered lists of catalog songs, organised in folders, imported from YouTube, SoundCloud and Spotify or from files, exported to M3U8, CSV and JSON. Decision: ADR-0022 (accepted). Everything else here is not built.

Playlists own the playlist data model. [Connect YouTube](youtube-connect.md) (YTC) and the Spotify import (CAT-015) create playlists through it. A playlist is not the play queue ([terminology](terminology.md)): a playlist is saved and named, the queue is the transient "what plays next".

## Model

- A **playlist** has `id`, `name`, `description`, `cover` (default: the first song's cover; or a custom cover), an ordered list of entries, `parent_id` (a folder or none), `position`, optional `source` (`{kind, url, imported_at}`), `created`, `updated`.
- A playlist is **smart** when `smart: true`: instead of entries it holds `rules` (PLS-091 to PLS-099) evaluated live against the library. A smart playlist has no stored entries and no hand order.
- A **folder** has `id`, `name`, `parent_id`, `position`. It contains playlists and folders.
- An **entry** is `{song_id, added}`; it references a catalog song, so a playlist never copies a song and the 500-song cap (NFR-050) is not affected. The same song may appear in many playlists and, if the user allows it, more than once in one playlist (default: no, the second add is ignored with a toast).
- Counts and total duration are derived, never stored; songs with unknown duration are counted but add 0, and the total reads "about" when any is unknown.

## Requirements

- PLS-001 MUST: the navigation has a destination "Playlists" between Library and Genres map (WEB-012), route `#/playlists` (and `#/playlists/<id>`). Status: planned
- PLS-002 MUST: playlists and folders are stored per user in the git-synced store as `playlists.json` next to `library.json` (DATA-100, ADR-0022); ids are opaque server-generated strings, never reused; deleting a song from the library removes its entries from every playlist. Status: planned
- PLS-003 MUST: hierarchy: folders contain playlists and folders; the nesting depth is capped at `PLAYLIST_MAX_DEPTH` = 5 (root is depth 0); a move that would exceed it or put a folder inside itself or its own descendant answers 422. Status: planned
- PLS-004 MUST: names are 1 to 120 characters, trimmed; siblings may not share a name (case-insensitive; 409 `playlist_name_taken`); the UI offers "Name (2)" on a clash. Status: planned
- PLS-005 MUST: create, rename, edit the description, delete a playlist; create, rename, delete a folder. Deleting a playlist asks ("Delete playlist? The songs stay in your library."). Status: planned
- PLS-006 MUST: deleting a folder that is not empty asks with three choices: "Move contents to parent folder" (default), "Delete folder and contents", Cancel; an empty folder is deleted after a plain confirm. Status: planned
- PLS-007 MUST: move a playlist or folder by drag and drop in the tree and by a "Move to..." menu item that opens a folder picker (the keyboard and touch way); order among siblings is user-defined. Status: planned
- PLS-008 MUST: add songs to a playlist: row menu "Add to playlist..." (LIB-012) and the song card open a picker (folder tree, search, "New playlist..."); Library multi-select and the stats selection panel (STA-011) offer the same picker. Status: planned
- PLS-009 MUST: remove a song from a playlist (entry menu "Remove from playlist"; the song stays in the library); reorder entries by drag and drop and by "Move up", "Move down", "Move to top", "Move to bottom". Status: planned
- PLS-010 MUST: the order of entries is the user's own and is kept; there is no automatic sort, except a one-shot "Sort by..." (title, artist, year, BPM, added) that rewrites the order. Status: planned
- PLS-011 MUST: the playlist page shows cover, name, description, "N songs, H:MM total", and a list of entries with the Library row look; a song without server audio is shown dimmed with its Download or source link behaviour as in Library (LIB-130). Status: planned
- PLS-012 MUST: the playlist page has Play, Shuffle, "Add to queue" and "Play next"; Play replaces the queue with the playable (server-audio) entries in order and starts the first; entries without audio are skipped and a toast reads "N songs without audio skipped". Status: planned
- PLS-013 MUST: Playback's queue has "Save queue as playlist..." (name prompt, folder picker) that creates a playlist from the queue in its current order. Status: planned
- PLS-014 SHOULD: the cover is the first song's cover unless a custom image is uploaded (same limits as the song cover change); "Use first song's cover" resets it. Status: planned
- PLS-015 MUST: guests (WEB-060, ADR-0018) see the owner's playlist tree and playlist pages read-only, with the same per-IP limits as the Library; they see no create, edit, import, export-all or delete controls. Playlists are public like the library; there is no private flag in phase 1 (open item D4 in task-0034). Status: planned
- PLS-016 MUST: quotas for non-owner users (the owner is exempt, NFR-050): `USER_MAX_PLAYLISTS` (folders and playlists together) 200, `USER_MAX_PLAYLIST_ENTRIES` (all entries over all playlists) 20000, entries per playlist 5000; over a cap the server answers 409 with `playlist_limit` and the UI names the cap. Status: planned

## Import

- PLS-030 MUST: "Import playlist" (Playlists toolbar) takes a public link, or a file (PLS-050); the result is a new playlist whose `source` remembers the link; the user picks the target folder. Status: planned
- PLS-031 MUST: YouTube playlist links (`list=` links, public or unlisted) are read through yt-dlp flat extraction (no download); private lists and Liked videos need Connect YouTube (YTC-001 on). Status: planned
- PLS-032 MUST: SoundCloud public playlist and set links are read through yt-dlp flat extraction (no download, no login). Status: planned
- PLS-033 MUST: Spotify public playlist links are read through the Spotify Web API with client credentials (CAT-012, CAT-013): metadata only (title, artist, album, year, duration, cover), no audio ever (CAT-014); the user's Liked Songs need a one-time OAuth login and stay planned (CAT-015). Status: planned
- PLS-034 MUST: every imported item becomes a catalog entry without audio (CAT-011) unless it is already there; nothing is downloaded. Status: planned
- PLS-035 MUST: dedupe against the user's catalog: YouTube items by video id; SoundCloud and Spotify items by the source id first, then by normalised title + artist with duration within 3 seconds (fuzzy: case, accents, punctuation, "feat.", "official video" and similar noise removed). A match reuses the existing song; ambiguous fuzzy matches are not merged but listed in the summary. Status: planned
- PLS-036 MUST: the long-item cap `LONG_SONG_SECONDS` = 300 applies as in ADD-081 and YTC-052: items longer than the cap (or of unknown duration) are not imported unless the user ticks "Include long items" on the confirm step; the summary counts them. Status: planned
- PLS-037 MUST: import is a background job per user (one at a time, 409 `playlist_import_running`), polled like `GET /yt/import/{job_id}` (YTC-010); the summary reads "N added, M already in library, K skipped (long), J unavailable". The import also respects the library quotas (`USER_MAX_SONGS`; NFR-050). Status: planned
- PLS-038 MUST: imported playlists keep the source order. Status: planned
- PLS-040 MUST: "Refresh" on a playlist with a `source` re-reads the link and applies the difference: new items are added at the end (after the same dedupe and cap), items the source no longer lists are kept; the user's own order and manual additions are untouched. Summary as PLS-037. Status: planned
- PLS-041 SHOULD: Refresh offers "Also remove songs no longer in the source from this playlist" (off by default; the songs stay in the library). Status: planned
- PLS-042 MUST: Connect YouTube imports (YTC-010) create or update playlists through this model: one playlist per ticked list, `source = {kind: "youtube-connect", list_id}`; YTC-030 is satisfied by PLS-040 and no separate storage exists. Status: planned

## Export and file import

- PLS-050 MUST: `GET /playlists/{id}/export?format=m3u8|csv|json` returns the file with `Content-Disposition: attachment`; the UI action is "Export" with the format chosen in a menu, default M3U8. A folder exports as a ZIP of its playlists (one file per playlist, same format, folder structure as paths). Status: planned
- PLS-051 MUST: all files are UTF-8 without BOM, LF line endings. File names are `<playlist name>.<ext>` with `/ \ : * ? " < > |` and control characters replaced by `_`, trimmed to 100 characters; an empty result is `playlist`. Status: planned
- PLS-052 MUST: M3U8 (default, for players): first line `#EXTM3U`, then `#PLAYLIST:<name>`, then per entry `#EXTINF:<seconds or -1>,<Artist> - <Title>` (remix kept in the title) and one line with the song's link: the YouTube link, else SoundCloud, else Spotify, else a blank-safe `#` comment line `# no link`. Newlines inside names become spaces. Status: planned
- PLS-053 MUST: CSV: header `position,title,artist,remix,album,year,duration_seconds,bpm,tags,youtube_url,soundcloud_url,spotify_url,song_id`; RFC 4180 quoting (comma, quote, newline), tags separated by `;`; first line is the header; text cells starting with `= + - @` are prefixed with `'` on export against spreadsheet formula injection and the prefix is removed on import. Status: planned
- PLS-054 MUST: JSON (full fidelity, re-importable): `{"format":"electrophone-playlist","version":1,"name","description","cover":null|"<url>","source":null|{...},"exported":"<ISO date>","entries":[{"song_id","title","artist","remix","album","year","duration","bpm","tags":[],"youtube_url","soundcloud_url","spotify_url"}]}`; no audio, no user data, no tokens. A folder exports as `{"format":"electrophone-folder","version":1,"name","children":[...]}`. Status: planned
- PLS-055 MUST: import from a file (`.m3u8`, `.m3u`, `.csv`, `.json`, up to 2 MB; detected by content, not by extension): JSON and CSV entries match by `song_id`, then by link, then by PLS-035; M3U8 entries are read by link (YouTube and SoundCloud and Spotify links), then by `#EXTINF` title and artist; unmatched entries with a recognised link become catalog entries without audio, and entries without a link or a title are counted as skipped. The cap in PLS-036 applies to newly created entries. Status: planned
- PLS-056 MUST: file import never fetches arbitrary URLs from the file: only links on the known YouTube, SoundCloud and Spotify hosts are read, and only through the existing link cleaning (ADD-060 range, `url-clean`). Status: planned

## API

- PLS-070 MUST: `GET /playlists` answers the whole tree `{folders, playlists}` without entries (id, name, parent_id, position, count, duration, cover, source, smart; a smart playlist's count and duration are evaluated live); `POST /playlists` creates a playlist, smart playlist or folder (`{name, parent_id, kind: playlist|folder, smart?: bool, rules?: {...}}`; `smart` requires valid `rules`, PLS-092); `GET /playlists/{id}` answers one playlist with entries; `PATCH /playlists/{id}` renames, edits description, cover, `rules` (smart only), `parent_id`, `position`; `DELETE /playlists/{id}` (a folder takes `?contents=move|delete`, default 409 `folder_not_empty`). Status: planned
- PLS-071 MUST: `POST /playlists/{id}/songs` `{song_ids:[...], position?}` adds, `DELETE /playlists/{id}/songs` `{entry_ids|song_ids}` removes, `PUT /playlists/{id}/songs/order` `{song_ids:[...]}` reorders (the list must be a permutation of the current entries, else 422); each answers the updated playlist header. Status: planned
- PLS-072 MUST: `POST /playlists/import` `{url, parent_id?, include_long?}` (202 `{job_id}`; `GET /playlists/import/{job_id}`) and `POST /playlists/import/file` (multipart) import; `POST /playlists/{id}/refresh` refreshes (PLS-040); `GET /playlists/{id}/export?format=` exports. Status: planned
- PLS-073 MUST: every write goes to the signed-in user's own store (ADR-0012); a guest has `GET` only (a smart playlist evaluates against the owner's library); a write by a guest is 401. Writes use the existing git-synced write path (STO) and its revision conflict handling; reordering sends the full order so a lost update is last-writer-wins and never corrupts the list. Status: planned

## Smart playlists (phase 3, fully specified)

- PLS-091 MUST: a smart playlist is a playlist with `smart: true` and `rules` (a saved set of Library filter rules); it is created by "New smart playlist" or by "Save as smart playlist" on the Library filter bar (the current filters and sort become the rules). It lives in folders, shows in the tree with a distinct icon, and counts toward `USER_MAX_PLAYLISTS` (PLS-016). Status: planned
- PLS-092 MUST: `rules` is `{match: "all"|"any", conditions: [...], sort: {by, dir}, limit?: int}`. A condition is `{field, op, value}`; fields and ops: `genre`, `tag`, `country`, `language` (`is`, `is_not`, `any_of`; `value` is a tag value or list; lower-case keys as in TAG, `lang:` included), `year` and `decade` (`is`, `between`, `before`, `after`), `bpm` (`between`, `before` meaning below, `after` meaning above; BPM range), `added` (`since` with an ISO date or a relative `{days: N}`), `has_audio` (`is` true|false: server audio present), `text` (`contains`, matches title, artist, album and tags like Library search), `not_set` (`field` one of `genre`, `year`, `country`, `language`, `bpm`: the system "not set" entries of LIB-132). Unknown fields or ops answer 422. Status: planned
- PLS-093 MUST: `sort.by` is one of `title`, `artist`, `year`, `bpm`, `added`, `duration`, `random`; default `added` descending; `limit` (1 to 5000) keeps the first N after sorting (a "top 50 newest" list). Status: planned
- PLS-094 MUST: a smart playlist is evaluated live on every open, play and export, against the library visible to the viewer (the owner's for guests); it needs no refresh and updates itself when songs are added, edited or removed; the header count and duration are computed from the result. Status: planned
- PLS-095 MUST: a smart playlist cannot be hand-ordered and songs cannot be added to it or removed from it by hand: "Add to playlist..." pickers list only normal playlists, entry reorder and "Remove from playlist" are absent, and the API answers 409 `playlist_is_smart` for `POST/DELETE/PUT /playlists/{id}/songs`. It can be renamed, moved, deleted, its rules edited (`PATCH` with `rules`) and its cover and description set. Status: planned
- PLS-096 MUST: a smart playlist can be played, shuffled, added to the queue and exported like a normal one (PLS-012); playing takes a snapshot of the result at that moment, so later library changes do not alter the running queue. Status: planned
- PLS-097 MUST: export of a smart playlist evaluates the rules at that moment: M3U8 and CSV contain the resulting songs (PLS-052, PLS-053); JSON contains the resulting `entries` and also `"smart": true` and `"rules"`, and importing that JSON recreates a smart playlist with the same rules (a "Import as snapshot" choice makes a normal playlist from the entries instead). Status: planned
- PLS-098 MUST: "Convert to playlist" (menu item, confirm) freezes the current result into a normal playlist in the same folder, in the current sort order; the smart playlist is kept unless the user ticks "Replace the smart playlist". `POST /playlists/{id}/convert` `{replace?: bool}` answers the new playlist. Status: planned
- PLS-099 SHOULD: a rule editor shows the conditions as the Library filter chips (WEB-011) with a live preview count and the first rows; a rule that matches nothing shows "No songs match these rules". Status: planned

## Placeholder phase

- PLS-100 MUST: the navigation has the item "Playlists" between Library and Genres map (WEB-012; side rail, icon rail and phone tab bar), route `#/playlists`; the page is empty apart from the text "Playlists are coming soon". It is visible to signed-in users and guests alike. This rule is replaced by PLS-001 and PLS-011 when phase 1 ships. Status: implemented (placeholder; assigned to a code agent 2026-10-16)

## Later phases

- PLS-090 SHOULD: iOS (phase 3 of task-0034) shows the playlist tree and playlists read-only and plays a playlist offline from the songs already on the phone; songs not downloaded are shown dimmed; smart playlists are evaluated on the phone from the cached library. Status: planned
- PLS-101 SHOULD: share link for a playlist (a hash route like the song share link, SHARE area) for guests; needs a visibility decision (D4 in task-0034). Status: planned (phase 3)
