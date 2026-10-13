# Style guide

The in-project visual and interaction reference, plus the
platform style guides we hold ourselves to. Sets the standards
the product looks and behaves under.

For identity-level direction (palette, typography family, voice
tone, mark), see [`../brand/README.md`](../brand/README.md).
This guide *operationalizes* brand at the UI layer — the
brand-derived rules below (color use, type scale, motion, voice
& copy) should trace back to decisions there.

## External references

Platform-level guides we conform to. Defer to these unless we
have a documented reason to diverge — record divergences in
[In-project conventions](#in-project-conventions) below with
their rationale.

- iOS — [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
- Android — [Material Design 3](https://m3.material.io/)
- Web a11y — [WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/)

## In-project conventions

Project-specific rules that go beyond — or deliberately override
— the platform defaults. Add as patterns crystallize; cite the
rationale per rule so future-us can revisit.

### Color

- [TODO: e.g. red = destructive (delete, irreversible). Used
  for destructive confirmations only.]
- [TODO: accent color use cases — call-to-action, success
  state, brand surfaces.]

### Typography

- [TODO: type scale — base size, line-height, weight ladder.]
- [TODO: typeface pairing — display + body + mono.]

### Motion

- [TODO: standard durations — e.g. fast 150ms, default 250ms,
  slow 400ms.]
- [TODO: easing curves and when each is used.]

### Interaction

- [TODO: popup dismissal — backdrop tap, swipe-down, both.]
- [TODO: tab placement — bottom (mobile), top (web), neither.]
- [TODO: gesture conventions — long-press, swipe-to-delete.]

### Voice & copy

- [TODO: tone — friendly / neutral / formal.]
- [TODO: capitalization in titles — sentence case / title case.]
- [TODO: error message conventions — user-actionable, no
  blame.]

## Open questions

- [TODO: open style decisions awaiting resolution.]

## Look: Warm analog / Quiet glass (current)

Single source of truth: the "Electrophone" Design System artifact
([`../brand/README.md`](../brand/README.md)). Warm paper / charcoal grounds,
a copper rim, flat glass slabs, one cyan accent, day and night. Tokens are
generated into `ios/Sources/DesignTokens.swift` and `web/tokens.css`; the
components (Transport, Chip + FilterSheet, Segment, TabBar, SongRow, Button)
are specified in the system and built in SwiftUI from it. Library shows four
category chips (Tags, Genres, Years, Countries) that open a filter sheet.
Decision: ADR-0009. Migration from the Vega 108 code: task-0005.

Web: `web/style.css` uses only the `tokens.css` variables and the `.t-*` text
styles (no hex, no literal colours). Layout: a 220px nav rail (64px icon rail
below 720px, floating tab bar below 480px), the library as a table (cover, Track, Genres, Time, menu; Genres drops below 900px, then the phone row below 720px), the player bar docked at the bottom, Playback as
cover + queue side by side from 900px. Text pairs are held at 4.5:1 in both
themes; where the system's own pair falls short, the web deviates:
selected chips and the primary button use `accent` with `on-accent` text
(`accent-strong` + white is 3.3:1; `on-accent` on it 4.45:1), danger buttons
and error messages use `ink` text with a `power` border (`power` text is 3.8:1
on `surface` by day), `ink-faint` is never used for controls, and secondary
text on `accent-tint` rows is `ink` (`ink-muted` is 4.0:1 there at night).

## iOS implementation of the Electrophone look

Colours, text roles, spacing and radii are `DS.Color` / `DS.Font` / `DS.Space` /
`DS.Radius` from the generated `ios/Sources/DesignTokens.swift`; `Components.swift`
holds the shared pieces (SongRow, category and value chips, FilterSheet is in
`LibraryFilter.swift`, transport tray, buttons; the tab bar and mini-player in `Views.swift`; the Add flow in
`AddSheet.swift`; `ServerStatus` and `LED` in `Components.swift`). Screen titles stand alone: the eyebrow is web only (design system 1791840724-5234). Sheets (Add, filters, song) are sized to their content, so they do not change height when the keyboard opens; the last tag pill wraps together with the "+". Text uses scalable Dynamic Type styles (`T.*`) with the same roles as
`DS.Font`; the layout caps at accessibility size 2. Day and night follow the system.

Contrast: every text pair is held at 4.5:1 in both themes. Where the system's own
pair falls short the app deviates: the primary button and selected chips use
`accent-strong` + `ink` by day (4.8:1) and `accent` + `on-accent` by night
(`accent-strong` with white is 3.4:1, with `on-accent` 4.4:1); `ok` and `power` are
dots and icons, their words are `ink`; secondary text on `accent-tint` rows is `ink`
(`ink-muted` is 4.0:1 there at night); `ink-faint` never carries a control. These
are gaps to close in the design system. The playing row's ⋯ is `accent-ink` and the other rows' ⋯ is `ink-muted` (the design's `ink-faint` is 2.4:1); the version line on Settings is `ink-muted`; the danger buttons keep `ink` text with a `power` border. Link errors in the Add sheet use `ink` text with a `power` icon and ring (red text is 3.9:1 by day). The "Fetch" button follows the primary-button pair above. The switch is 48 x 28: `accent-strong` track when on, `surface-sunken` when off, a 24pt thumb (`surface` by day, `ink` by night). Settings rows are 48pt with a `line` hairline between them; cards are `surface` slabs with 16pt side padding. A song row's second line keeps the artist whole where it fits and truncates the source mark ("· YouTube", `ink-faint`) first; at accessibility sizes the mark moves to its own line. The row's "⋯" is 24pt wide with a 44pt hit area. The audio state sits before the "⋯": the duration (`time`) for a song on the phone, an outline "Download" pill (32pt, 1.5pt `accent-ink` border, 13pt semibold `accent-ink` label) for a song that is not, "Downloading NN%" in `accent-ink` on one line while the file arrives, and "No audio yet" in `ink-muted` with the cover and text at 55% for a song with no audio anywhere (not in the design: the design shows only the first three; this fourth state comes from ADR-0010). The "Downloaded N" toggle beside the sort control is a 32pt pill with a 1.5pt `line` outline, `accent-tint` fill and `accent-ink` outline and text when on. Floating slabs (tab bar, mini player, transport tray) use `shadow-float`: a stronger lift and a 1px `line` ring (design system 1791844172-ea8e).

## Look: Vega 108 turntable (retired, history only)

The app was styled after the Soviet "Vega 108 Stereo" turntable: walnut veneer
bars, matte black panel rows, chrome bezels, piano keys and a ridged knob. That
code (`Theme.swift`, piano buttons, wood background, the deck) is deleted.
Decision: ADR-0007 in [`../tech/decisions.md`](../tech/decisions.md). Sketches:
[`vega-108/`](vega-108/) (`sketch-1.png` to `sketch-9.png`), generated from the
prompts in [`design-prompts.md`](design-prompts.md).

## Web UI (Electrophone, web; updated 2026-10-13)

Source of truth for the look is the Electrophone Design System
([brand README](../brand/README.md)); the web screens follow the "Electrophone
Screens" web artboards. No hex or rgb value appears in `web/style.css`,
`web/js` or `web/index.html`; everything comes from `web/tokens.css`.

- Navigation: Library, Playback, Settings. 220px rail, 64px icon rail, floating tab bar below 480px; the server LED sits at the bottom of the rail. Signed out, only Settings is reachable; there is no token field (WEB-001, WEB-005).
- Library: table card (cover, Track = title with a muted "Artist · Year" line, Genres, Time, menu; no row number, Album, Artist or Year column), 56px rows, playing row in `accent-tint`; four category chips; sort as accent-ink text button. Columns drop right to left (genres below 900px, then the phone song row below 720px). A song without server audio is greyed (title in muted ink, cover at 60%), has no play action and shows its service logo (YouTube / SoundCloud in brand colour, neutral glyph otherwise) as a link next to the menu; there is no "Not on the server" label (WEB-023, WEB-031).
- Add and Edit: one shared form in a dialog (WEB-033). Add opens from the accent "Add song" button with only the link field; the form appears after Fetch and the "Save to library" button sits in a sticky footer. Title, Artist and Remix & additional production are token pills (pencil menu, X, drag and drop; WEB-028, WEB-029); Genres and Countries are chip fields (Genres with autocomplete); the BPM is a read-only label (Re-detect in Edit only); "Get metadata" shows six service icons (grey, pulsing while running, brand colour as a link when found; Spotify, MusicBrainz and Discogs always grey) and a "Wikipedia says" hint; the two Wikipedia inputs show the article name only. One accent button with glow per surface.
- Playback: cover first with title and artist on it, seek bar, transport tray, volume row, details, queue card; no deck, tonearm or LED.
- Buttons: primary = `accent` + `on-accent` + `glow-accent`; "fill" = see substitutions; outline = `accent-ink` text and border; quiet = `ground` slab with `shadow-key`; danger = `ink` text with a `power` border.

### Contrast substitutions (4.5:1 for text)

The design system's own pairs that fail, and what the web uses instead:

| System pair | Ratio | Web uses |
| --- | --- | --- |
| white on `accent-strong` (selected chips, Fetch) | 3.4 | day: `ink` on `accent-strong` (4.8); night: `on-accent` on `accent` (8.5) |
| `on-accent` on `accent-tint` (tag chips), night | 1.6 | `ink` on `accent-tint` |
| `ink-muted` on `accent-tint` (playing row), night | 4.0 | `ink` |
| `ok` / `power` as text on `surface`, day | 3.9 / 3.8 | status text in `ink` with an `ok` / `power` dot or border |
| `ink-faint` "..." button on `surface` | 2.4 | `ink-muted` (it is a control, not decoration) |
| `surface` text on the cover gradient, night | n/a | `ink` (a light colour on `vinyl` in both themes) |

### Cache busting

Static files are versioned by the server (WEB-017, ADR-0009 amendment): never
link a web asset with an absolute path; use paths relative to `index.html`.

