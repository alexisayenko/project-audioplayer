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

- **Entry:** Add tab (or Search under Add).
- **Screens (in order):** Add (paste, preview, edit tags, save) -> status
  polling -> Playback (mini-player on other tabs); later Library with the
  Phone / Server switch; Settings first when no token or sign-in exists.
- **Branches:** no token or unreachable server -> error on Preview, go to
  Settings; song already in library -> 409 message; song added elsewhere
  (web) -> Library Server list, swipe Download or "Download all".
- **Exit / success:** the song plays from the phone with the screen locked
  and no connection (`../specs/ios.md`).
