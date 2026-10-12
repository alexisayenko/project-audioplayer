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

- ADD-001 MUST: the Add screen accepts a YouTube URL and shows a preview card with cover (YouTube thumbnail), title, duration, and editable Title, Artist, Album, Year, BPM and Tags. Status: implemented
- ADD-002 MUST: preview prefills `title` from yt-dlp `track` else `title`; `artist` from `artist`, `creator`, `uploader`; `year` from `release_year`, else `release_date`/`upload_date`; `tags` per [tags.md](tags.md) (genre, country and language suggestions). Status: implemented
- ADD-003 MUST: preview downloads nothing and writes nothing. Status: implemented
- ADD-004 MUST: the user may edit every field and tag before saving using the shared tag editor (LIB-055): current tags as removable chips, a "Suggested" row with the preview's tags (toggle), all library tags as toggle chips, a text input (Enter or comma adds, accepts `key:value`). Status: implemented
- ADD-005 MUST: Save starts a background download of the best m4a audio (`bestaudio[ext=m4a]/140`) to the music directory as `<id>.m4a`, one video only (no playlists). Status: implemented
- ADD-006 MUST: after the audio is saved the server fetches the cover from `https://i.ytimg.com/vi/<id>/hqdefault.jpg` to `covers/<id>.jpg`; a failed fetch leaves `cover: null` and does not fail the add. Status: implemented
- ADD-007 MUST: on success the song record is appended and committed (`audioplayer: add <id>`); `added_at` is the UTC completion time. Status: implemented
- ADD-008 MUST: progress is 0..1 from yt-dlp byte counts, rounded to 3 decimals; it may stay at 0 when the size is unknown. Status: implemented
- ADD-009 MUST: on any failure the partial `<id>.m4a` is deleted and the job becomes `error` with a short message; the UI shows "Download failed: <message>" and re-enables Save. Status: implemented

## BPM

- ADD-020 MUST: BPM is optional; empty means auto-detect after download (placeholder "Detected after saving"); a typed value (20..300, whole number, fractions rounded) is kept and skips detection. Status: implemented
- ADD-021 MUST: detection decodes the saved file with `ffmpeg` to mono 44.1 kHz float PCM (120 s timeout), runs aubio tempo, takes the median of per-beat estimates (needs >= 4 beats), folds into 70..180 and rounds to a whole number. Status: implemented
- ADD-022 MUST: any detection failure (no ffmpeg, no aubio, too few beats) is logged and stored as `bpm: null`; it never fails the download. Status: implemented
- ADD-023 MUST: BPM is a heuristic and may be off by half or double; the UI says so and lets the user edit it or re-detect from the Edit dialog (`POST /songs/{id}/bpm/detect`). Status: implemented
- ADD-024 SHOULD: detection run off the request path for slow files. Status: implemented (the job runs in a background task; re-detect runs in a thread pool)

## Duplicates

- ADD-030 MUST: preview returns `in_library: true` when the id is already stored; the UI shows "This song is already in your library." and disables Save. Status: implemented
- ADD-031 MUST: `POST /songs` returns 409 `already in library` or `already downloading` (checked under the lock). Status: implemented
- ADD-032 MUST: the identity of a song is its YouTube video id; two URLs for the same video are the same song. Status: implemented
- ADD-033 MUST: pasted links are cleaned before use: YouTube forms (`youtu.be/<id>`, `watch?v=`, `m.` and `music.` hosts, `shorts/`, `embed/`, `live/`) become `https://www.youtube.com/watch?v=<id>`, dropping `si`, `t`, `list` and every other parameter; other http(s) links lose only `si`, `feature`, `pp`, `fbclid`, `gclid` and `utm_*`. The web cleans on paste, blur and submit and shows the result in the field (`web/js/url-clean.js`); the server applies the same rules (`server/app/urlclean.py`) and tolerates clean input. Status: implemented

## Errors shown to the user

- ADD-040 MUST: not a YouTube video URL gives 422 `not a YouTube video URL`. Status: implemented
- ADD-041 MUST: unavailable or blocked video gives 502 `preview failed: <short yt-dlp message>` at preview, or a job `error` at download. Status: implemented
- ADD-042 MUST: server unreachable shows "Server unreachable"; 401 shows "Wrong or missing API token (see Settings)". Status: implemented
- ADD-043 SHOULD: leaving the Add screen mid-download stops polling but not the server job; reopening Add does not resume the progress view. Status: to-confirm
