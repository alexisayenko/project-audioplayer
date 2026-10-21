# Brand

The Electrophone look is **defined in one place, outside this repo**: the
"Electrophone" Design System artifact on claude.ai (owner: Alex; private —
open it from the claude.ai artifacts gallery). This folder holds the
committed export and the workflow. Decision: ADR-0009 in
[`../tech/decisions.md`](../tech/decisions.md).

- **Design system** (SSOT): tokens, text styles, spacing, radii, shadows,
  component guidelines with previews, the brand book, mockups as assets.
  Artifact: `claude.ai/code/artifact/0389e2c5-e8e8-49c9-935a-f1c324194457` (the same artifact is `claude.ai/artifact/1SLwpCK4m4Xi5uWxFoFgSa`, the link the Artifact tool takes; it is a Design System type artifact whose content is files under `project/`).
- **Screens**: the "Electrophone Screens" Design artifact, two pages —
  iOS (Library, Library · Add sheet, Playback day/night, Settings, Library ·
  Genres sheet) and Web (Library, Library · Add dialog, Playback, Settings),
  built on the system.
  Artifact: `claude.ai/artifact/5K2BS7LFpb9qsKX7TtNyBm`.

## Name and domain

- **Full brand name**: **Electrophone Vega 108**. Short forms:
  **Electrophone** (current UI title and wordmark, unchanged for now) and
  **Vega 108** (compact form where space is tight).
- **Status**: the full name is the intended brand; the UI and docs still say
  "Electrophone" until Alex decides to rebrand. Pending decision: rebrand the
  UI title, page titles, README and docs to the full name, with "Vega 108" as
  the short form.
- Technical identifiers (repo `project-audioplayer`, service name
  `audioplayer`, paths) are **not** changed by branding.

### Domain candidates

Chosen: `electrophone.cc` (purchased 2026-10-14; EUR 2.80 first year, then EUR 7.43 per year; expires about 2027-10-14, verify at the registrar; auto-renew unknown; invoice in the private project-meta repo, `audioplayer/invoices/`).
Prices, assessment, follow-up steps and the checks history: [`domains.md`](domains.md).

## Workflow

1. Change the look in the design system (values, usage notes, components).
2. Export its `project/tokens.json` here as [`tokens.json`](tokens.json).
3. `python3 scripts/sync-design-system.py` regenerates
   `ios/Sources/DesignTokens.swift` and `web/tokens.css`.
   `python3 scripts/sync-design-system.py --check` writes nothing and exits
   1 if the generated files differ from what the script would write.
4. Run `--check`, then commit the export and the two generated files together. Never edit the
   generated files; never add a colour, size or radius in code that the
   system does not define — add it to the system first. Partially followed: the web still has literal colours, radii, shadows and px sizes (WEB-010 Known gaps) and the iOS app has hand-built shadows, literal radius 16, literal sizes and `.white`/`.black` on the Sign in with Apple button (IOS-050 Known gaps); `sync-design-system.py --check` verifies only that the generated files are current, and `check.sh` has no literal-colour lint.

### Rules for native code

Everything that is not a colour, text style, spacing or radius still comes from tokens: strokes from `DS.Stroke` (never a literal `lineWidth`), shadows from `DS.Shadow` through `.dsShadow(_:)` (never a hand-built `.shadow(...)`), animation durations and curves from `DS.Motion` through `.dsAnimation(...)`, `dsWithAnimation` and `Animation.ds(...)` (Reduce Motion is honoured by the helpers), icon sizes and weights from `DS.Icon`, fixed part dimensions from `DS.Component` and `DS.Control`, text from `T.*` (which reads `DS.Dynamic`). `ios/Sources/DSModifiers.swift` is the one hand-written file beside the generated `DesignTokens.swift`. A value the system lacks is added to the system first.

### How to add a token

1. Edit `project/tokens.json` in the artifact (the Design System type keeps it as a file; additive changes keep every existing name and value). Append `{ "name", "value", "usage" }` to the family's `tokens` list: colours take `{ "light", "dark" }` hex values, shadows a single layer `x y blur #rrggbbaa` per theme (iOS: `"platform": "ios"`), motion `NNNms` or `cubic-bezier(...)`, lengths `NNpx`. Names are unique across all families.
2. Document it in the artifact README and set `lastChange` in the index (written last).
3. Export `project/tokens.json` to `docs/brand/tokens.json`, run `python3 scripts/sync-design-system.py`, then `--check` (also part of `scripts/check.sh`).
4. A new family needs a line in `CSS_FAMILIES` (web) and in `swift_native_families` (iOS) in the script.

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
- **Token families**: colour (including the chart palette, `select-tint` / `select-ink` for the selected navigation row, and the web-only `scrim`, `fill`, `on-fill`, `ring-color`, `caret`, `selection`), type (also generated as `DS.Dynamic`, the Dynamic Type counterparts), space, radius (with `radius-select`), shadow plus `stroke`, `state`, `motion`, `elevation`, `overlay`, `icon`, `control` and `component`. Reach Swift: colour, chart, type, space, radius, stroke, motion, icon, control, component, and the shadow tokens marked `"platform": "ios"` (`depth-*`, as `DS.Shadow`). Web-only: `state`, `elevation`, `overlay` and the web shadows. Tokens marked `"platform": "ios"` are skipped in `web/tokens.css`.
- **History**: Vega 108 skeuomorphic look (ADR-0007), sketches in
  `../ui-ux/vega-108/`, retired by ADR-0009.

The visualizer palettes (`--viz-*` in `web/viz.css`, including the Ice palette `--viz-ice-*` and the Ice 2 palette `--viz-ice2-*`) are viz-local: they are not part of the design tokens and are not generated by `sync-design-system.py`.

## Where applications live

| Where it appears | Location |
| --- | --- |
| iOS tokens | `ios/Sources/DesignTokens.swift` (generated) |
| Web tokens | `web/tokens.css` (generated) |
| iOS app icon | `ios/Sources/Assets.xcassets/AppIcon.appiconset/` (the plated image, see [logo/README.md](logo/README.md)) |
| Web favicon | `web/favicon.svg` (embeds the vinyl PNG), `web/favicon-32.png` (vinyl) and `web/apple-touch-icon.png` (plated app icon); social cards not yet |
| Web in-app mark | `icon('mark')` in `web/js/icons.js`, an `<image>` of `web/img/electrophone-vinyl.png` (vinyl only; the sidebar lockup, login, cover placeholder and empty states) |

## Logo and app icon

The vinyl logo and the app icon (masters, usage rules, archive of the first icon) are in [logo/README.md](logo/README.md).
