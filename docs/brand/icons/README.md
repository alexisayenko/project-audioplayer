# Icons

Icons come from one shared set. A screen never draws its own glyph and never mixes in another set: if a role has no icon here, the icon is added here first (SVG, role, SF Symbols fallback), then used. The same three glyphs are specimens in the Icon component of the Electrophone design system (https://claude.ai/artifact/1SLwpCK4m4Xi5uWxFoFgSa, v37); the drawings in the Electrophone Screens artifact (https://claude.ai/artifact/5K2BS7LFpb9qsKX7TtNyBm, v53) use them.

## Drawing rules

| Rule | Value |
| --- | --- |
| Box | 24 x 24 `viewBox` (`icon-grid`), live area 20 (`icon-live`, 2 padding) |
| Stroke | 1.75 in viewBox units, round caps, round joins, no fills |
| Colour | `currentColor`; the container supplies it (`ink` default, `select-ink` when the control is tinted) |
| Rendered size | `icon-nav` 20 inside a 36 circle in a 44 slot (the Library controls line); other sizes from `DS.Icon` |
| Files | One SVG per glyph in this folder, no `<style>`, no embedded images |

The design system token `icon-stroke` currently reads 1.8; these files use 1.75 as drawn for the sort set. The 0.05 difference is invisible at 20 pt; unify the token and the files together in the next token export (open question Q10 in `docs/ui-ux/library-v5.md`).

## The sort set

| File | Role | iOS | Notes |
| --- | --- | --- | --- |
| [`sort-criteria.svg`](sort-criteria.svg) | Sort criterion button in the Library controls line: opens the Sort sheet. A card with three text lines and a funnel across its lower right corner. | Custom symbol `sort.criteria` (template image in the asset catalog). Fallback while it is not drawn: `line.3.horizontal.decrease.circle`. | VoiceOver "Sort by, <criterion>". Tinted (`select-ink` on `select-tint`) when the criterion is not Recently added. |
| [`sort-direction-desc.svg`](sort-direction-desc.svg) | Sort direction button when the effective order is descending: bars shrink from top to bottom, arrow points down. | Custom symbol `sort.direction.desc`. Fallback: `arrow.down.to.line`. | VoiceOver "Sort direction, descending". |
| [`sort-direction-asc.svg`](sort-direction-asc.svg) | The same control when the effective order is ascending: bars grow from top to bottom, arrow points up. | Custom symbol `sort.direction.asc`. Fallback: `arrow.up.to.line`. | VoiceOver "Sort direction, ascending". Tinted when the order is reversed from the criterion's default. |

`sort-direction-asc.svg` is `sort-direction-desc.svg` mirrored top to bottom. The control swaps between them as the direction changes (the arrow flips and the bars reorder); there is no rotation, so Reduce Motion needs no special case.

There is no reset glyph: the Library's Clear action is a text link under the count, and `arrow.counterclockwise` is not part of the set.

## iOS delivery

1. Preferred: ship the three glyphs as custom symbols (SF Symbols template export: the SVG is drawn on the same 24 grid, weight Regular) in `Assets.xcassets`, rendering mode template, so the tint follows `foregroundStyle`. Names: `sort.criteria`, `sort.direction.desc`, `sort.direction.asc`.
2. Until they are in the catalog: use the fallback names above, drawn at `DS.Icon.iconNav`, regular weight.
3. Web and the macOS app load the SVG files (or inline them through `web/js/icons.js`, which stays the one place web icons are registered).

## Everything else

Every other icon is already in the shared set: SF Symbols on iOS (names listed in `docs/ui-ux/library-v5.md`) and `web/js/icons.js` (Lucide paths, ISC) on the web. Only glyphs that have no SF Symbol or Lucide equivalent live in this folder.
