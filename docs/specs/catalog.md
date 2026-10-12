# Catalog and audio

Planned, pending acceptance of ADR-0010. Concept:
[`../product/concept-catalog-and-audio.md`](../product/concept-catalog-and-audio.md).
Related, not rewritten: DATA-005, ADD-001..009, IOS-030..032. When ADR-0010 is
accepted these are superseded as noted below.

## Catalog and audio state

- CAT-001 MUST: the catalog holds every song record, with or without audio; this supersedes DATA-005 when ADR-0010 is accepted. Status: planned
- CAT-002 MUST: audio state is derived: `none` (no `file` or file missing on the server), `server` (file on the server), `phone` (local copy on the device); it is never written to `library.json`. Status: planned
- CAT-003 MUST: the song record has `sources` (list of `{source, id, url}`, first is primary) and `file` may be `null`. Status: planned
- CAT-004 MUST: `GET /library` returns every catalog record with its server-side audio state. Status: planned
- CAT-005 MUST: the phone syncs the whole catalog on launch and on refresh and keeps the last copy for offline use. Status: planned
- CAT-006 MUST: a downloaded song plays offline and never depends on the server. Status: planned

## Sources and ids

- CAT-010 MUST: ids are the YouTube id (unchanged), `soundcloud-<id>`, or `spotify-<id>` for metadata-only songs; attaching audio from another source keeps `id` and appends to `sources`. Status: planned
- CAT-011 MUST: Add means "add to catalog": a YouTube, SoundCloud or Spotify link, or manual entry, saves a record; audio is not fetched until Get audio, except that a YouTube or SoundCloud add may offer "Save and get audio" in one step. Status: planned
- CAT-012 MUST: a Spotify track link yields metadata only (title, artist, album, year, cover) via the Spotify Web API with client credentials; the preview shows "No audio yet". Status: planned
- CAT-013 MUST: the Spotify client id and secret live only in the git-ignored server env and never reach a client or the repos. Status: planned
- CAT-014 MUST: no audio is ever taken from Spotify. Status: planned
- CAT-015 SHOULD: public Spotify playlists import as many records; the user's Liked Songs need a one-time OAuth login, a separate optional step. Status: planned

## Get audio

- CAT-020 MUST: Get audio is a separate action per song and in bulk. Status: planned
- CAT-021 MUST: for a song with no audio source the server proposes a YouTube match (title, channel, duration, thumbnail); nothing downloads until the user confirms. Status: planned
- CAT-022 MUST: the user can pick another candidate or reject the match; rejected matches are not proposed again for that song. Status: planned
- CAT-023 MUST: after confirmation the audio downloads like any YouTube song and the state becomes `server`, then `phone` after the copy. Status: planned
- CAT-024 MUST: SoundCloud Go+ preview-only tracks are refused with a clear message. Status: planned
- CAT-025 SHOULD: bulk Get audio starts unambiguous sources immediately and queues matches that need confirmation as a review list. Status: planned

## Library

- CAT-030 MUST: Library lists the whole catalog; each row shows its audio state; this supersedes IOS-030 and IOS-031 (phone-only list, no Download all) when ADR-0010 is accepted. Status: planned
- CAT-031 MUST: a filter "On phone" shows only songs with a local copy. Status: planned
- CAT-032 MUST: Play is available only for state `phone` on the phone (and `server` on the web); other rows offer Get audio. Status: planned
- CAT-033 MUST: Delete from library removes the catalog record; a separate "Remove download" frees the phone copy and keeps the record. Status: planned
