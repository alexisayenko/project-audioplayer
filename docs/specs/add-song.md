# Add song

Code: `web/js/add.js`, `server/app/main.py` (`preview`, `create_song`,
`_run_download`), `server/app/extractor.py`, `server/app/bpm.py`.

## Flow

1. Paste a YouTube URL, press Preview (`POST /preview`).
2. Edit fields and tags in the preview card.
3. Save and download (`POST /songs`, 202).
4. Poll `GET /songs/{id}/status` every 1 s; progress bar.
5. On `done`: library refreshes, "Saved to your library." with Play now and Add another.

## Requirements

- ADD-001 MUST (Add becomes "add to catalog" when ADR-0010 is accepted, see CAT-011): the Add screen accepts a YouTube URL and shows a preview card with cover (YouTube thumbnail), title, duration, and editable Title, Artist, Album, Year, BPM and Tags. Status: implemented
- ADD-002 MUST: preview prefills `title` from yt-dlp `track` else `title`; `artist` from `artist`, `creator`, `uploader`; `year` from `release_year`, else `release_date`/`upload_date`; `tags` per [tags.md](tags.md) (genre, country and language suggestions). Status: implemented
- ADD-003 MUST: preview downloads nothing and writes nothing. Status: implemented
- ADD-004 MUST: the user may edit every field and tag before saving using the shared tag editor (LIB-055): current tags as removable chips, a "Suggested" row with the preview's tags (toggle), all library tags as toggle chips, a text input (Enter or comma adds, accepts `key:value`). Status: implemented
- ADD-005 MUST: Save starts a background download of the best m4a audio (`bestaudio[ext=m4a]/140`) to the user's audio directory (`<music_root>/users/<uid>/`) as `<id>.m4a`, one video only (no playlists). Status: implemented
- ADD-006 MUST: after the audio is saved the server fetches the cover from `https://i.ytimg.com/vi/<id>/hqdefault.jpg` to `covers/<id>.jpg`; a failed fetch leaves `cover: null` and does not fail the add. Status: implemented
- ADD-007 MUST: on success the song record is appended and committed (`audioplayer: <uid8> add <id>`); `added_at` is the UTC completion time. Status: implemented
- ADD-008 MUST: progress is 0..1 from yt-dlp byte counts, rounded to 3 decimals; it may stay at 0 when the size is unknown. Status: implemented
- ADD-009 MUST: on any failure the partial `<id>.m4a` is deleted and the job becomes `error` with a short message; the UI shows "Download failed: <message>" and re-enables Save. Status: implemented

## Wikipedia links

- ADD-005 MUST: the year of the preview (including `suggested_year` when yt-dlp gave none) produces the `decade:` chip in the tag editor, and editing Year updates it (TAG-038); the server derives the stored tag on save (TAG-051). Status: implemented
- ADD-050 MUST: the preview card has two optional URL inputs, "Wikipedia: song" and "Wikipedia: band", pre-filled from `preview.wikipedia_song` / `wikipedia_artist` (MusicBrainz url-rels, see [tags.md](tags.md) TAG-040); they are saved with the song (`metadata.wikipedia_song`, `wikipedia_artist`); an input that is not a Wikipedia/Wikidata link is outlined red and dropped by the server. Status: implemented
- ADD-051 MUST: "Fill from Wikipedia links" calls `POST /lookup/wikipedia` with the two inputs; the suggested year fills Year when it is empty, or after a confirm when it differs; suggested tags go to the Suggested row, not onto the song. Status: implemented

## BPM

- ADD-020 MUST: BPM is optional; empty means auto-detect after download (placeholder "Detected after saving"); a typed value (20..300, whole number, fractions rounded) is kept and skips detection. Status: implemented
- ADD-021 MUST: detection decodes the saved file with `ffmpeg` to mono 44.1 kHz float PCM (120 s timeout), runs aubio tempo, takes the median of per-beat estimates (needs >= 4 beats), folds into 70..180 and rounds to a whole number. Status: implemented
- ADD-022 MUST: any detection failure (no ffmpeg, no aubio, too few beats) is logged and stored as `bpm: null`; it never fails the download. Status: implemented
- ADD-023 MUST: BPM is a heuristic and may be off by half or double; the UI says so and lets the user edit it or re-detect from the Edit dialog (`POST /songs/{id}/bpm/detect`). Status: implemented
- ADD-024 SHOULD: detection run off the request path for slow files. Status: implemented (the job runs in a background task; re-detect runs in a thread pool)

## Duplicates

- ADD-030 MUST: preview returns `in_library: true` when the id is already stored; the UI shows "This song is already in your library." and disables Save. Status: implemented
- ADD-031 MUST: `POST /songs` returns 409 `already in library` or `already downloading` (checked under the lock). Status: implemented
- ADD-032 MUST: the identity of a song is its id (YouTube video id or `soundcloud-<track id>`); two URLs for the same video or track are the same song. Status: implemented
- ADD-033 MUST: pasted links are cleaned before use: YouTube forms (`youtu.be/<id>`, `watch?v=`, `m.` and `music.` hosts, `shorts/`, `embed/`, `live/`) become `https://www.youtube.com/watch?v=<id>`, dropping `si`, `t`, `list` and every other parameter; other http(s) links lose only `si`, `feature`, `pp`, `fbclid`, `gclid` and `utm_*`. The web cleans on paste, drop, bulk input (paste/drop/replacement input events or multi-character insertions; single keystrokes are left alone), blur and submit, moves the caret to the end, extracts the first YouTube or http(s) link from surrounding text (otherwise the first line) and shows the result in the field (`cleanPasted` in `web/js/url-clean.js`); the server applies the same rules (`server/app/urlclean.py`) and tolerates clean input. Status: implemented

## SoundCloud

- ADD-060 MUST: Add also accepts a SoundCloud track link (no search): `soundcloud.com/<artist>/<track>` with `www.`/`m.` hosts, an optional private `/s-<secret>` segment, and `on.soundcloud.com/<code>` short links. Cleaning (web `cleanPasted`, iOS port, server `urlclean.py`) gives `https://soundcloud.com/<artist>/<track>[/s-<secret>]`, dropping the query and fragment; the server resolves a short link by following its redirect once (https only, host `soundcloud.com`/`www.`/`m.`). Status: implemented (live SoundCloud download not verified)
- ADD-061 MUST: playlists, sets, albums, likes and profile links are refused with 422 `{"error":"unsupported"}` and the message "Only single tracks are supported". Status: implemented
- ADD-062 MUST: the song id is `soundcloud-<numeric track id>` (known only after the server resolves the link, so preview returns it); the record gets `source: "soundcloud"`; YouTube ids and records are unchanged ([ADR-0011](../tech/decisions.md)). Status: implemented
- ADD-063 MUST: SoundCloud preview uses yt-dlp metadata without downloading: `title` (`track`, else `title`), `artist` from `artists`/`artist`/`creator`, else the uploader (which may be a label, see [concerns](../concerns.md)), `thumbnail` the artwork upgraded to `-t500x500`, `duration`, `genres` as suggested `genre:` tags, `year` only from `release_year`/`release_date`. Status: implemented
- ADD-064 MUST: save downloads the best audio and re-encodes it to `<id>.m4a` (ffmpeg `FFmpegExtractAudio` m4a), then fetches the artwork (https `*.sndcdn.com` only) to `covers/<id>.jpg`; a cover failure does not fail the add. Status: implemented (live download not verified)
- ADD-065 MUST: SoundCloud Go+ tracks that only offer the 30 s preview are refused with 422 `{"error":"preview_only","detail":"Preview only — SoundCloud Go+ track, can't be downloaded in full."}` at `POST /preview` and `POST /songs`; detection is a yt-dlp format id containing `preview` with no full format, or at download time a chosen preview format or a file under 35 s while the page duration exceeds it by over 60 s (partial file deleted, job `error` with `code: "preview_only"`). Clients show "Preview only — SoundCloud Go+ track, can't be downloaded in full." Status: implemented
- ADD-066 MUST: the preview card shows a small source tag ("YouTube" / "SoundCloud"). Status: implemented

## Errors shown to the user

- ADD-040 MUST: not a YouTube video or SoundCloud track URL gives 422 `{"error":"unsupported","detail":"not a YouTube video or SoundCloud track URL"}`. Status: implemented
- ADD-044 MUST: SoundCloud failures: a missing track gives 404 `{"error":"not_found"}`, a private track without its secret link 403 `{"error":"private"}`, anything else 502 `{"error":"failed"}`; the message is `preview failed: <short yt-dlp message>`. Status: implemented
- ADD-041 MUST: unavailable or blocked video gives 502 `preview failed: <short yt-dlp message>` at preview, or a job `error` at download. Status: implemented
- ADD-042 MUST: server unreachable shows "Server unreachable"; 401 shows "Wrong or missing API token (see Settings)". Status: implemented
- ADD-043 SHOULD: leaving the Add screen mid-download stops polling but not the server job; reopening Add does not resume the progress view. Status: to-confirm

## Limits (ADR-0012)

- ADD-050 MUST: the server checks the user's quotas before it resolves or downloads the link (API-041); the Add dialog shows a readable message for each refusal and keeps the form: 429 "Hourly limit reached. Try again in N minutes.", 403 `library_full_songs` "Your library is full. Delete some songs to add more.", 403 `library_full_bytes` "Your storage is full. Delete some songs to free space.", 503 `server_full` "The server is out of storage right now. Try again later." (`web/js/limits.js` `friendly`, tested). Status: implemented
- ADD-051 MUST: when the user or the server is at its download cap the add is accepted with status `queued` and starts in order; the Library row shows the usual progress once it runs. Status: implemented
- ADD-052 MUST: a sign-in refused because signup is closed shows "Sign-up is closed on this server." on Settings (403 `signup_closed`). Status: implemented
