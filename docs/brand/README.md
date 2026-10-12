# Brand

The Electrophone look is **defined in one place, outside this repo**: the
"Electrophone" Design System artifact on claude.ai (owner: Alex; private —
open it from the claude.ai artifacts gallery). This folder holds the
committed export and the workflow. Decision: ADR-0009 in
[`../tech/decisions.md`](../tech/decisions.md).

- **Design system** (SSOT): tokens, text styles, spacing, radii, shadows,
  component guidelines with previews, the brand book, mockups as assets.
  Artifact: `claude.ai/code/artifact/0389e2c5-e8e8-49c9-935a-f1c324194457`.
- **Screens**: the "Electrophone Screens" Design artifact, two pages —
  iOS (Library, Library · Add sheet, Playback day/night, Settings, Library ·
  Genres sheet) and Web (Library, Library · Add dialog, Playback, Settings),
  built on the system.
  Artifact: `claude.ai/artifact/5K2BS7LFpb9qsKX7TtNyBm`.

## Workflow

1. Change the look in the design system (values, usage notes, components).
2. Export its `project/tokens.json` here as [`tokens.json`](tokens.json).
3. `python3 scripts/sync-design-system.py` regenerates
   `ios/Sources/DesignTokens.swift` and `web/tokens.css`.
4. Commit the export and the two generated files together. Never edit the
   generated files; never add a colour, size or radius in code that the
   system does not define — add it to the system first.

Screens are designed in the Screens artifact before they are built; a
component used on a screen must exist in the system.

## Current state

- **Name**: Electrophone (locked, 2026-10-12). Mockups and the App Store
  Connect record still say "Gramophone Offline" (ADR-0008).
- **Direction**: Warm analog / Quiet glass — warm paper and charcoal
  grounds, copper rim, flat glass slabs, one cyan accent, day + night.
- **Typography**: SF Pro (system) + SF Mono for times. No font files.
- **Mark**: the record on the platter (cyan disc, teal stripes, paper
  frame); the app icon is derived from it. Source file: the system's
  `assets/Mockups2/mockup-11.png` until a vector mark is drawn.
- **History**: Vega 108 skeuomorphic look (ADR-0007), sketches in
  `../ui-ux/vega-108/`, retired by ADR-0009.

## Where applications live

| Where it appears | Location |
| --- | --- |
| iOS tokens | `ios/Sources/DesignTokens.swift` (generated) |
| Web tokens | `web/tokens.css` (generated) |
| iOS app icon | `ios/Sources/Assets.xcassets/AppIcon.appiconset/` (the record on the platter, drawn programmatically) |
| Web favicon | `web/favicon.svg` (hand-drawn record mark; social cards not yet) |
