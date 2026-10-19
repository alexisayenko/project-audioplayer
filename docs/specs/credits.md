# Credits and title display

How credits (who is on a song) are stored apart from the title, how a title from a source is split into credits on import, and how the credits are put back together for display. Decision: [ADR-0036](../tech/decisions.md) (Alex, 2026-10-18); work: [task-0048](../tasks/task-0048.md). Builds on the data model v2 ([data-model.md](data-model.md), DATA-144 to DATA-161; [ADR-0025](../tech/decisions.md)) and the parser of ADD-115. Concept in plain words: [concept-songs-versions-and-credits.md](../product/concept-songs-versions-and-credits.md).

Status: the parser of CRD-010 to CRD-016 and the With storage are built (task-0048 phase 1, ADD-165, API-165, DATA-168; not deployed, not checked in a browser); every other rule here is **planned**. They change how a stored title and a displayed title relate, and replace ADD-075 (feat credits kept in the title): from phase 1 on, new songs are stored clean.

Informative references, the Apple Music Style Guide v2.4 (help.apple.com/itc/musicstyleguide): 2.13 (featured artists: "feat." lowercase with a period, in parentheses or brackets, several as "A, B & C"), 2.9 and 3.14 (remixes: the original artist stays the artist, the remixer is named in the version text after the title). Section numbers were supplied by Alex on 2026-10-18 and are not re-verified; the rules below are ours and win over the guide.

## Roles

- CRD-001 MUST: a credit is a name in a role. Roles: **Primary** (the people the song is by; stored `mainArtists`), **Featuring** (guests; `featuredArtists`), **With** (a collaborator named "with", shown like Featuring with the word "with"; new list `withArtists`, DATA-162), **Remixer** (`version.artists` when `version.type` is remix), **Original** (whose song it was before; `version.originalArtists`, cover and mashup only). Other roles (Mixer, Producer, Composer, Lyricist) are reserved: not stored, not shown, not parsed. Status: partly implemented (Featuring and With are stored, parsed on add and edited in the form; phase 1)
- CRD-002 MUST: the stored `title` never holds a credit or a version: no "feat. X", "with X", "(X Remix)", "[Label]" or "(cover)". Those live in the credit lists and in `version`; the displayed title is composed (CRD-030 to CRD-040). `rawTitle` keeps the source text. Status: partly implemented (a feat or with group of a song added from now on; version and label groups were already cut by ADD-159)
- CRD-003 MUST: a name appears in one role per song; Primary wins over Featuring and With, Featuring over With; names are compared case- and diacritic-insensitively; each list keeps its order and has no duplicates. Status: implemented for the parser (a name in a stronger role is not repeated; storage-level enforcement planned)
- CRD-004 MUST: Featuring and With are song-level, not version-level: "Song (feat. C) [X Remix]" has Featuring C and a Remixer X. A remixer is never in Primary; a cover's original artist is never in Primary or in the artist part of the display (CRD-037). Status: planned

## Parsing a title on import

Applies to the Add preview (`POST /preview`, `suggested_credits`), the Add and Edit form suggestion panel (ADD-115, `credits_split.py` and its twin `credits-split.js`, same cases) and the migration (CRD-050). It runs after promo-noise removal (ADD-077) and the release-tag rule (ADD-131), so `[NCS Release]`, `[Free Download]`, `(Official Video)` and similar never reach it.

- CRD-010 MUST: input is the source artist and title strings; output is `{mainArtists, featuredArtists, withArtists, title, version, notes}` with a CLEAN title (no feat or with group, CRD-002). Featuring and With parts are applied to the form fields on import (deterministic: a keyword names them); splits of the Primary names by `&`, `,`, `x` or `vs.` stay suggestions with Apply and Dismiss (ADD-115, DATA-122), and stored songs are never re-parsed on open. Status: partly implemented (`credit_title.parse`/`split` give `{mainArtists, featuredArtists, withArtists, title, notes}`; applied to the form fields on import; stored songs are not re-parsed; the Suggested split panel still uses `credits_split.py` for `&`, `,`, `x`, `vs.`)
- CRD-011 MUST: the Featuring keywords are the whole words `feat.`, `feat`, `ft.`, `ft`, `featuring` (case-insensitive; the bare `feat` and `ft` need a following name that starts with a capital or a digit, and not right after a number, the ADD-075 rules for "5 ft tall" and "Defeat" stay). The With keyword is `with`, taken ONLY as the first word of a trailing bracket group "(with X)" / "[with X]" or between names in the artist string "A with B"; never in the free text of a title ("Dancing with Myself" has no With). Status: implemented with one difference: the With keyword is read only in a trailing bracket group (owner recommendation, 2026-10-18), not in "A with B" of the artist text, which would split bands like "Sleeping with Sirens"; its name must start with a capital, digit or uncased letter
- CRD-012 MUST: the recognised forms, each moving the credit into its list and leaving the rest as the clean title (the example uses Primary A, Featuring C, title T):

  | Source | Result |
  | --- | --- |
  | `A - T (feat. C)` and `A - T [feat. C]` | Primary A, Featuring C, title T |
  | `A - T feat. C` (unbracketed, up to the end, a `|` or the next bracket group) | same |
  | `A feat. C - T` (in the artist part) | same |
  | `T feat. C - A` and `T [Version] feat. C - A` (reversed title-first, ADD-135) | same, title-first reading kept |
  | `A & B - T (feat. C)` | Primary A, B (suggested split), Featuring C |
  | `A x B - T`, `A vs. B - T` | Primary A, B (suggested split); not Featuring |
  | `A - T (with C)` | Primary A, With C |
  | `A - T (feat. C) [Label]` | noise removed first, then as the first row |
  | `A - T (feat. C) (D Remix)` and `A - T (D Remix) feat. C` | Featuring C and version remix by D (CRD-014) |

  Status: implemented for the forms with Primary, Featuring and With (bracketed, unbracketed, in a pill, title-first through ADD-135, with a version group after the feat group, noise first); the `A & B` / `x` / `vs.` rows stay suggestions of ADD-115
- CRD-013 MUST: after a keyword the names are split on `,`, ` & `, ` and `, ` + `, a spaced lowercase ` x ` and ` vs. ` / ` vs `; `A, B & C` gives three names. A piece that already is a known artist (a name credited elsewhere in the library) stays whole, so "feat. Simon & Garfunkel" is one name when that artist is known; with no evidence the split is applied to the Featuring list and flagged in `notes` (`feat_split_guess`) for the user to check. Status: partly implemented (split on `,`, ` & `, ` and `, ` + `, ` x `, ` vs. ` with the note `feat_split_guess`; the "known artist stays whole" check needs the library and is planned)
- CRD-014 MUST: a trailing remix group "(D Remix)" / "[D Remix]" becomes `version {type: remix, name: "D Remix", artists: [D]}` and the group's bracket kind is remembered (CRD-035); cover, mashup, live and the other version words keep the rules of ADD-126 to ADD-128 and ADD-132, which now also leave the title clean. A "feat." inside the version group ("(D Remix feat. Z)") makes Z Featuring, leaves "D Remix" as the version name and sets the note `feat_in_version`. Status: planned
- CRD-015 MUST: a title is never reduced to nothing: when removing the credit group would leave an empty title the title stays as it was and the note `title_empty` is set. Evidence from structured sources (a MusicBrainz artist credit, DATA-142) still beats the typed title and is a suggestion. Status: implemented for the title (`title_empty`); structured-source evidence unchanged
- CRD-016 MUST: the parser is pure and shared: one JSON table of cases (`server/tests/fixtures/credit_title_cases.json`, input strings to expected lists, title, version and notes) is read by the Python and the JavaScript test suites, like `title_clean_cases.json`. Status: implemented (`server/tests/test_credit_title.py`, `web/js/credit-title.test.mjs`, 68 cases)

## Display

- CRD-030 MUST: the display of credits depends on one per-user preset `creditDisplay` (CRD-045): `apple` ("Apple / YouTube", the default) or `spotify` ("Spotify / MusicBrainz"). Status: planned
- CRD-031 MUST: the full display string is `artistPart - titlePart`. Each part is composed from the stored fields:
  - Primary text `P`: Primary names joined `A`, `A & B`, `A, B & C` (the existing `artistLine` rule; `x` and `vs.` never appear in the display).
  - Guest text `G`: `feat. C` for Featuring (several `C, D & E`), then `with W` for With (`feat. C with W`); empty when there are no guests.
  - Version slot `V`: the version label in the song's bracket kind (CRD-035); empty without a version.
  - `apple`: `artistPart` = `P`; `titlePart` = `Title (G) V` (the guest group in parentheses, empty parts skipped).
  - `spotify`: `artistPart` = `P G`; `titlePart` = `Title V`.
  - The Version slot is identical in both presets and always follows the title.

  | Stored | `apple` | `spotify` |
  | --- | --- | --- |
  | Primary A, B; Featuring C; title T; remix by D, square | `A & B - T (feat. C) [D Remix]` | `A & B feat. C - T [D Remix]` |
  | Primary A; Featuring C, D, E; title T | `A - T (feat. C, D & E)` | `A feat. C, D & E - T` |
  | Primary A; With W; title T | `A - T (with W)` | `A with W - T` |
  | Primary A; title T; no guests | `A - T` | `A - T` |
  | Primary Teemid; title Crazy; cover of Gnarls Barkley | `Teemid - Crazy (cover)` | `Teemid - Crazy (cover)` |

  Status: planned
- CRD-032 MUST: the keyword is always the lowercase `feat.` (never "Feat.", "ft." or "featuring"), the guest group in the `apple` preset is round parentheses (Apple 2.13 also allows brackets; we use parentheses so it is told apart from the Version slot), and the order inside a title part is fixed: title, then the guest group, then the Version slot. Status: planned
- CRD-033 MUST: the surfaces that show two lines use the parts separately so the preset moves the guest text between them: the title line is `titlePart`, the muted subtitle line is `artistPart · Year` (`subtitleString`, LIB-010, PLY-010); the single-string places use `artistPart - titlePart`. A song without a Featuring or With list renders the same in both presets. Status: planned
- CRD-034 MUST: functions (web `web/js/credits.js`, the only formatter, LIB-134; `display-title.js` stays a facade): `creditLine(song, preset)` is the artist part, `titleLine(song, preset)` the title part, `displayString(song, preset)` the full string, `subtitleString(song, preset)` the artist part and year; `preset` is optional and defaults to the stored user preference (CRD-045), then to `apple`. They are pure: same song and preset, same text; the preset never changes search, sort, filters, URLs or share ids. Tested with a table of songs by preset. Status: planned
- CRD-035 MUST: the Version slot keeps the bracket kind of the source: `version.brackets` is `round` or `square` (DATA-162), set from the title on import (CRD-014), `round` when unknown (today's display, LIB-134), editable in the form's Version block; the label is `version.name` (tokens joined with `, `), else `<remixer names> Remix` for a remix without a name, else the lowercase `type` word (nothing for `other`). So a remix shows as `[Tiesto Remix]` or `(Tiesto Remix)` after the title, the original artist stays Primary and the remixer is never in the artist part (Apple 2.9, 3.14). Status: planned
- CRD-036 MUST: a plain song from a legacy-only object (no credit arrays, LIB-135) displays exactly as before in both presets. Status: planned
- CRD-037 MUST: a cover shows the performer as Primary; the original artist is never in the artist part, only in the details ("Cover of X", ADD-126). Status: planned
- CRD-038 MUST: a medley or mashup keeps its combined name in `title` (as the user or the source gave it, for example "A / B" or "Track one x Track two"); the parts are not parsed out of it and the title is never split by this feature. Optional part lists (`version.originalArtists` today, per-part titles later) are planned separately and never change the display. Status: planned
- CRD-039 MUST: the preset applies on every surface that shows a song name: Library rows and the search-result rows, the song card header, Now playing, the mini-player (title and artist lines), the queue menu, the Media Session (`title` and `artist`), `document.title`, the visualizer overlay, the Stats tooltip and table, the share dialog, the share page header and `navigator.share` title, "Already in your library" and the Add preview header. The iOS app and the macOS app follow later (CRD-049). Status: planned
- CRD-040 MUST: the preset is a view and each viewer's own: a guest, a signed-out visitor and a viewer of a share link use their own stored preference (local value, else `apple`), never the owner's or the sharer's; search text always covers all credits (LIB-141), so a search for a featured artist finds the song under either preset. Status: planned

## The setting

- CRD-045 MUST: `creditDisplay` is a per-user setting stored with the user's settings (DATA-163), returned by `GET /me` and changed by `PATCH /me/settings` (API-148); the web keeps a copy in `localStorage` (`ap2.creditDisplay`) for the first paint and for signed-out viewers. The Settings row is WEB-104. Status: planned
- CRD-046 SHOULD: the legacy derived `artist` key (DATA-149) is the same in every response whatever the preset: Primary names joined plus `feat.` Featuring plus `with` With; the preset is never sent to the server by a display request. Status: planned

## Migration

- CRD-050 MUST: `server/app/migrate_credit_titles.py`, one idempotent startup migration per user, after `migrate_model2` (and so after task-0043 is deployed): for a song whose `title` holds an unambiguous credit group (a bracketed `(feat. X)` / `[feat. X]` / `(with X)` at the end, or a trailing `feat. X` up to the end), the names are appended to `featuredArtists` or `withArtists` (deduplicated, CRD-003), the title becomes the clean title, and the old title is kept in the new field `legacyTitle`. A `mainArtists` entry that contains a feat keyword ("Kato feat. Jon", the ADR-0024 migration never split) is split at that keyword only; `&`, `,`, `x` and `vs.` in Primary are never split by the migration (DATA-122). A title with no group is untouched, so a second run changes nothing. Status: planned
- CRD-051 MUST: ambiguous songs are not changed and are listed in `backups-credit-titles/review-<uid>.json` (not under the git-synced tree): two credit groups, a feat group before the end, a feat inside a version group, a name that may contain `&`, an empty result title. Status: planned
- CRD-052 MUST: safety like DATA-151 and DATA-158: dry run by default on the command line with a report (songs changed, names moved, songs left for review), numbered backup `backups-credit-titles/<uid>/`, one git commit per user, `updated_at` untouched. The legacy-field equality of the earlier migrations cannot hold here (title and `artist` change on purpose), so the check is: the display string of the migrated song under the `spotify` preset with the keyword normalised to `feat.` equals the normalised old display string, for every changed song; any difference aborts the run. `credits_schema` is bumped once so clients refetch (API-135). Status: planned
- CRD-053 MUST: `legacyTitle` stays until Alex has verified the result (a later task removes it); it is dropped from the guest view like `rawTitle` (DATA-154) and is not editable. Status: planned
- CRD-054 SHOULD: `scripts/clean-titles.py` and other title rewriters keep the new keys (`withArtists`, `legacyTitle`, `version.brackets`) like API-134. Status: planned

## iOS and macOS

- CRD-049 MUST: the iOS and macOS apps keep reading the derived legacy fields until their own task; with CRD-002 the iOS title then shows without the feat group and the artist line carries it (the `spotify` shape), which is intended. The apps later read `creditDisplay` from `GET /me` and use the same composition, tested against the shared case table (display cases in `server/tests/fixtures/credit_display_cases.json`). Status: planned
