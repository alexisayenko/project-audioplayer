# Journeys

Multi-screen paths — onboarding, first-add → save, recovery
flows. One section per journey while the list is short.

Starts as this flat file. Extracts to `journeys/<journey>.md` when
journeys accrue their own branch tables, screen-by-screen notes,
or open questions — see
[`../README.md#section-file-folder`](../README.md#section-file-folder).

For the journey concept and how it relates to screens, see
[`README.md`](README.md).

## Add a song and play it offline (iPhone)

Paste a link, keep the song on the phone, play it with no network.

- **Entry:** the + button in the Library header (or Search inside the Add sheet).
- **Screens (in order):** Add sheet (paste, preview, edit tags, Save to iPhone) -> sheet closes, Library row
  shows "Downloading NN%" -> Playback (mini-player on other tabs); Settings first when no token or sign-in exists.
- **Branches:** no token or unreachable server -> error on Preview, go to
  Settings; song already in library -> 409 message; song added on the web
  (a catalog entry only, no audio) -> whether it shows on the phone follows the iOS catalog sync (`../specs/ios.md`); paste its link in Add to be sure.
- **Exit / success:** the song plays from the phone with the screen locked
  and no connection (`../specs/ios.md`).

## Add a song on the web (catalog only)

Paste a link, keep the song's details in the library; play it from its original link or on the iPhone.

- **Entry:** the "Add song" button in the Library header (or `#/add`); signed-in users only (Settings first when signed out).
- **Screens (in order):** Add dialog (link field, "Already in your library" check while typing, Fetch) -> form opens with the preview (Title / Artist / Remix pills, Get metadata, Genres, Countries, Tags, Wikipedia) -> "Save to library" -> dialog closes, toast "Saved to library", the row appears in Library.
- **Branches:** the link is already in the library -> the hint with "Show in library" and Fetch disabled; unsupported, private, not found or preview-only link -> error text in the dialog; closing the dialog at any point discards the form.
- **Exit / success:** the song is in the library without audio (greyed, service logo link); songs that already have server audio play in the web player.
