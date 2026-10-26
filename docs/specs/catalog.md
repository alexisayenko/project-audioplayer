# Catalog and audio

ADR-0010 is Accepted. Server side (CAT-001..004, CAT-010 ids, CAT-033 server part) is implemented (task-0006); clients and later sources are planned. Concept:
[`../product/concept-catalog-and-audio.md`](../product/concept-catalog-and-audio.md).
Related, not rewritten: DATA-005, ADD-001..009, IOS-030..032. When ADR-0010 is
accepted (now) these are superseded as noted below.

## Catalog and audio state

- CAT-001 MUST: the catalog holds every song record, with or without audio; this supersedes DATA-005. Status: implemented (server)
- CAT-002 MUST: audio state is derived: `none` (no `file` or file missing on the server), `server` (file on the server), `phone` (local copy on the device); it is never written to `library.json`; the server derives `none`/`server`, `phone` is client-side. Status: implemented (server)
- CAT-003 MUST: the song record has `sources` (list of `{source, id, url}`, first is primary) and `file` may be `null`; old records without `sources` get one derived at read time. Status: implemented (server)
- CAT-004 MUST: `GET /library` returns every catalog record with its server-side audio state; `GET /catalog` is the metadata-only sync endpoint (ETag, `since`). Status: implemented (server)
- CAT-005 MUST: the phone syncs the whole catalog on launch and on refresh and keeps the last copy for offline use. Status: implemented (iOS, IOS-035; web already lists the library)
- CAT-006 MUST: a downloaded song plays offline and never depends on the server. Status: implemented (iOS: the cached catalog lists every song offline and phone audio plays; verified with the server stopped)

## Sources and ids

- CAT-010 MUST: ids are the YouTube id (unchanged), `soundcloud-<id>`, or `spotify-<id>` or `applemusic-<id>` (or `shazam-<id>`) for metadata-only songs; attaching audio from another source keeps `id` and appends to `sources`. Status: implemented (id validation and `sources`; attaching is task-0009)
- CAT-011 MUST: Add means "add to catalog": a YouTube, SoundCloud or Spotify link, or manual entry, saves a record; audio is not fetched until Get audio, except that a YouTube or SoundCloud add may offer "Save and get audio" in one step. Status: implemented for YouTube and SoundCloud (`POST /songs` with `audio:false`); Spotify and manual entry planned
- CAT-012 MUST: a Spotify track link yields metadata only (title, artist, album, year, cover) via the Spotify Web API with client credentials; the preview shows "No audio yet". Status: planned
- CAT-013 MUST: the Spotify client id and secret live only in the git-ignored server env and never reach a client or the repos. Status: planned
- CAT-014 MUST: no audio is ever taken from Spotify. Status: planned
- CAT-015 SHOULD: public Spotify playlists import as many records, as a playlist (PLS-033); the user's Liked Songs need a one-time OAuth login, a separate optional step. Status: planned

## Get audio

- CAT-020 MUST: Get audio is a separate action per song and in bulk. Status: per-song implemented (`POST /songs/{id}/audio`, API-060); bulk planned
- CAT-021 MUST: for a song with no audio source the server proposes a YouTube match (title, channel, duration, thumbnail); nothing downloads until the user confirms. Status: planned
- CAT-022 MUST: the user can pick another candidate or reject the match; rejected matches are not proposed again for that song. Status: planned
- CAT-023 MUST: after confirmation the audio downloads like any YouTube song and the state becomes `server`, then `phone` after the copy. Status: planned
- CAT-024 MUST: SoundCloud Go+ preview-only tracks are refused with a clear message. Status: planned
- CAT-025 SHOULD: bulk Get audio starts unambiguous sources immediately and queues matches that need confirmation as a review list. Status: planned

## Library

- CAT-030 MUST: Library lists the whole catalog; each row shows its audio state; this supersedes the phone-only list of ADR-0009 (IOS-030..032 are rewritten). Status: implemented (iOS)
- CAT-031 MUST: a filter shows only songs with a local copy; on iOS it is the "Downloaded N" toggle of the design. Status: implemented (iOS)
- CAT-032 MUST: Play is available only for state `phone` on the phone (and `server` on the web); other rows offer Download (server audio) or "No audio yet"; Get audio is per song (API-060); bulk and match proposals (CAT-021..025) are planned. Status: implemented (iOS, except Get audio)
- CAT-033 MUST: Delete from library removes the catalog record; a separate "Remove download" frees the phone copy and keeps the record. Status: implemented (server: `DELETE /songs/{id}` and `DELETE /songs/{id}/audio`); the iOS actions are "Delete from library" (server delete, then the phone) and "Remove from iPhone" (frees the audio, keeps the record)

## More sources

Order: YouTube/SoundCloud (done) -> Spotify -> Apple Music -> ShazamKit Listen -> Shazam import. All produce metadata-only records; Get audio finds the YouTube match. Facts are unverified; each task starts by checking them (task-0012..0015).

- CAT-040 SHOULD: an Apple Music song or album link yields metadata only (title, artist, album, year, genre, large artwork, duration) via the keyless iTunes Lookup API; id `applemusic-<id>`. Status: proposal
- CAT-041 MUST: no audio is ever taken from Apple Music. Status: proposal
- CAT-042 SHOULD: the Apple Music preview and Save work like the Spotify ones ("No audio yet"). Status: proposal
- CAT-043 SHOULD: the iOS Add sheet has a Listen button that records through the microphone and shows a result card (title, artist, artwork, genres) from ShazamKit. Status: proposal
- CAT-044 MUST: a Listen match saves a metadata-only record; no audio is taken or stored, and the recording is not kept. Status: proposal
- CAT-045 MUST: Listen needs the microphone permission and the network; denied permission, offline and no match each show a clear message. Status: proposal
- CAT-046 MUST: the ShazamKit App Service is enabled on the App ID in the Apple Developer portal (manual step) before Listen ships. Status: proposal
- CAT-047 COULD: Shazam history imports once as metadata-only records, duplicates skipped; the format is decided by research first. Status: proposal
- CAT-048 MUST: the import keeps no Shazam or Apple credentials in the repos. Status: proposal

## Albums (task-0120, ADR-0050)

- CAT-050 MUST: an Album is a first-class concept (id, page, status, expected track list) but light: derived from songs, rebuildable, with no fact that lives only in the album. The stored part is the sparse per-user file `albums.json` (DATA-203). Status: planned
- CAT-051 MUST: a song belongs to the album whose key equals its `albums[0]` plus its album artist (`albumArtist`, else its main artists), both normalised (case, whitespace, punctuation, diacritics); exact match only, nothing fuzzy is merged automatically (ADR-0039 curated matching); the id is `alb_` + the first 8 hex of the sha1 of `title|artist key`. Status: planned
- CAT-052 MUST: the expected track list comes from a MusicBrainz release (keyless), a Discogs release (`DISCOGS_TOKEN`) or a pasted YouTube playlist; the user picks the release from candidates, nothing is linked silently; the list is cached with the album and refetchable from its external ids. Status: planned
- CAT-053 MUST: a track of the release matches a song by the same normalised base title and main artists (album artist for a compilation); a remaster bracket matches the song with the version `remaster` (DATA-191), any other version is a different track; a manual link or unlink wins; the match is computed, not stored. Status: planned
- CAT-054 MUST: the album is "Complete" when every counted track of the linked release is in the library, "Partial N of M" otherwise; bonus tracks are not counted; no linked release means no status. Status: planned
- CAT-055 MUST: missing tracks are added only after the user confirms: from a pasted playlist (the import table, ADD-150 to ADD-159, marked "This is an album"), from the release track list as metadata-only entries or drafts, and with a per-track YouTube search whose candidate the user picks (CAT-021 to CAT-025). Status: planned
- CAT-056 MUST: "Download album" (iOS) runs per track in track order on the Download all machinery: server fetch for state `none`, then the phone copy; it shows the cost first (tracks, bytes, fetches left this hour), obeys ADR-0012 quotas, pauses on `hourly_limit` and resumes, and skips tracks already on the phone. Status: planned
- CAT-057 MUST: compilations use the album artist "Various Artists" and keep each track's own artist; multi-disc albums order by disc then track; singles and EPs are albums with a `type`. Status: planned
- CAT-058 MUST (task-0120 phase 1): an album can start from a YouTube playlist in one dialog and NOTHING is created before the last step: the playlist is read (API-255), its title proposes an artist, album and year, Discogs candidates for that guess are listed with their track lists and a proposed track-to-video matching (API-255, API-256), the user picks a candidate (or none), ticks the playlist tracks to keep and presses "Create album and download marked tracks"; only then are the marked tracks created as metadata-only songs, the album is created and the songs are linked by the matching (API-259). The audio is fetched afterwards one song at a time by the client as for any catalog song. Status: built on the server, not deployed; the dialog is the web agent's slice
