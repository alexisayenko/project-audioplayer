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

## Look: Vega 108 turntable (superseded by ADR-0009)

The app is styled after the Soviet "Vega 108 Stereo" turntable: walnut veneer
bars (navigation), matte black panel rows, chrome bezels, rectangular piano
keys (one lit cyan, a red power key), ridged volume knob with min/max ticks,
small-caps labels with Cyrillic accompaniments. All tokens and components
live in `ios/Sources/Theme.swift` (tokens) and `Components.swift` (piano
buttons, LEDs, knob, platter). Playback shows a rotating platter and a
tonearm that follows playback progress. The app icon is the whole turntable
seen from above.
Decision: ADR-0007 in [`../tech/decisions.md`](../tech/decisions.md). Sketches:
[`vega-108/`](vega-108/) (`sketch-1.png` to `sketch-9.png`), generated from the
prompts in [`design-prompts.md`](design-prompts.md). The web UI keeps its
plain style.
