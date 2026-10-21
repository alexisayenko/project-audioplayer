# Concept: songs, versions and credits

Status: accepted 2026-10-16 ([ADR-0024](../tech/decisions.md), [ADR-0025](../tech/decisions.md)); the cover rule, mashup and the `of` list are built, data model v2 is planned ([task-0043](../tasks/task-0043.md)). Specs: [credits.md](../specs/credits.md) (CRD, planned), [data-model.md](../specs/data-model.md) (DATA-120 to DATA-155), [add-song.md](../specs/add-song.md), [library.md](../specs/library.md). The Music theory page tells the same ideas in short terms.

## The idea

A song is one thing in the library. If what you have is not the plain original recording, the song carries a **version**: a small block that says what kind of derivation it is and who is credited for it. The library never mixes up "the song" and "this particular take of it".

## Who is credited where

- **Main artists**: the people the song is by. Several allowed (a duet is two main artists).
- **Featured artists**: guests ("feat.").
- **Version artists**: extra people credited only on this version, for example a remixer.
- **Original artists**: whose song it was before, only for a cover or a mashup.

## Examples

| Song | Main artists | Featured | Version | Version artists | Original artists |
| --- | --- | --- | --- | --- | --- |
| Plain song | New Order | | none | | |
| Two artists, "Cold Heart" | Elton John, Dua Lipa | | none | | |
| Featured guest | Teemid | Joie Tan | none | | |
| Live version | Dua Lipa | | live | | |
| Slowed or edit | the original artist | | edit | | |
| Cover, "Crazy (Gnarls Barkley Cover)" | Teemid | | cover | | Gnarls Barkley |
| Mashup, "Кончится лето" | whoever made the mashup | | mashup | | the source songs' artists |
| Remix, "Voodoo People (Pendulum Remix)" | The Prodigy | | remix | Pendulum | |

Rules behind the table:

- **Cover**: someone else re-performs the song. The performer is a main artist, never a version artist. Shown as `Teemid - Crazy (cover)` with "Cover of Gnarls Barkley" in the details, not `Crazy (cover Teemid)`.
- **Remix**: a reworking of the original recording. The original artist stays a main artist; the remixer is a version artist.
- **Mashup**: a new work made from several songs. Its makers are the main artists; the sources are the original artists.
- **Live, acoustic, extended, instrumental, remaster, edit**: the same artist, no new person, unless a remixer or mixer is credited.
- A version is a different recording: its MusicBrainz or Discogs link, album and genres are not borrowed from the original (a hint may show them).

## Two credits that look alike

- MusicBrainz credits one recording "Gisele & Bob Sinclar" (both main) while the video title says "Gisele Bündchen - Heart of Glass ft. Bob Sinclar". The structured credit beats the typed title: the app suggests both as main artists, for the user to confirm.
- "Crazy (Gnarls Barkley Cover)" names the original artist, but "(Sofia Karlberg Cover)" could name the performer instead. When the name in the brackets is a credited artist it is read as the performer; with no artist to compare, the reading is ambiguous and nothing is applied.

## Featured artists and how titles are shown (planned, ADR-0036)

A featured artist is a credit, not part of the title: the stored title of "Song (feat. C)" is just "Song" and C is in the Featuring list. How the credits are put back together is a per-user setting, "Credit display" in Settings:

| Preset | Shown as |
| --- | --- |
| Apple / YouTube (default) | `Artist A & Artist B - Title (feat. Artist C) [Version]` |
| Spotify / MusicBrainz | `Artist A & Artist B feat. Artist C - Title [Version]` |

The version (remix, cover, live, edit, ...) is written the same way in both and always comes after the title; a remix is `[Tiesto Remix]` or `(Tiesto Remix)` after the title, the original artist stays the artist. Existing songs with "(feat. X)" in the title are moved to credits once by a safe migration. Rules: [credits.md](../specs/credits.md).

## Derived legacy fields

Old clients (the iOS app) read `artist`, `remixer`, `year`, `remix_year` and `album`. They are not stored: `artist` is the main artists joined plus "feat." and the featured ones; `remixer` is the version name, else the version artists; `year` is the release year; `remix_year` the version's year; `album` the first album. Decade (and the country, from the artist) are computed or looked up, not stored as tags.

## Remaster spelling

A remaster is written `remaster`, lowercase, with its year first when there is one (`2024 remaster`), whatever the source says ("Remastered", "re-mastered", "Remastered 2009", "Remastered Version"): the version name is a type like remix, cover or live, shorter, and sorts by year (DATA-191).

## Years

`releaseYear` is the year of the original recording and comes only from Wikipedia, MusicBrainz or Discogs, never from the upload date. The upload year may suggest the version's own year, marked as a suggestion.

## Not in scope

Works (compositions), a recording chain or tree, full artist identities and the full DDEX message model are deferred (freeze BT1, DATA-155) until a feature needs them.
