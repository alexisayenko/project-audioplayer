# Concept: the digital phosphor LED display

Owner vocabulary, agreed 2026-10-15. This page explains the idea behind the visualizer preset Ice Blue Mirror 2 and fixes its names. It is a concept page, not a specification: the testable rules are [VIZ-104 and VIZ-105](../specs/visualizer.md), the measurements are in [concept-mirrored-spectrum.md](concept-mirrored-spectrum.md), the terms in [terminology.md](../specs/terminology.md). Reading order for a designer: sections 1 to 4, then 9.

## 1. The idea and where it comes from

Two familiar pictures meet here.

- The LED graphic equalizer: a row of columns, each built from small lit rectangles (sections), standing on a dark floor with a mirror reflection below. Normally the whole column is lit up to the current level.
- The digital phosphor display of a lab spectrum analyzer (oscilloscopes, RF analyzers): brightness or colour of a spot shows how often the signal visited that spot within a short persistence window. Rare visits are cool and dim, frequent visits are hot and bright.

The owner's insight: take the LED equalizer, but light only the section the level is at right now, and let the sections it visited recently glow in steps by how often it went there. The column stops being a bar that goes up and down and becomes a map of where the music has been over the last few seconds. The look came from a watermarked stock photo of a blue LED equalizer (not stored in the repo; only its measurements are kept). The photo shows the genre, not the rule: the visit-count idea is ours.

## 2. The display model

```
   column 1      column 2      column 3        one column, top to bottom
   [      ]      [      ]      [      ]        empty section        (background)
   [      ]      [ NOW  ]      [      ]        current sector        colour 10, soft glow
   [ dim  ]      [      ]      [ mid  ]        rarely visited        colours 1..3
   [ mid  ]      [ mid  ]      [      ]        often visited         colours 4..9
   [ dim  ]      [ dim  ]      [ dim  ]
 ===================== mirror gap =====================
   the same columns upside down, bluer and fading with depth
```

- Columns are frequency bars: bass on the left, treble on the right, as in every Mirror preset. Each column is judged on its own.
- Each column is a stack of LED sections (rows). The current sector is the one section at the bar's current level. It is the only section at full brightness (palette colour 10, flat) and it has a soft blue glow.
- The trail: every other section the sector visited in the last 10 seconds stays lit in palette colours 1 to 9, by how many visits it had. Level = visits divided by 3, at most 8: 1 to 2 visits give colour 1, 3 to 5 give colour 2, and so on, 24 or more give colour 9. Rows with no visit in the window are dark.
- Minimum dwell: a visit counts only after the sector has stayed on a row for 60 ms. Rows it merely passes over during a jump never count, so a fast sweep does not paint a stripe.
- No body: the lit column from the floor up to the level is not drawn. No cap (peak marker): the separate floating segment above the level is not used here. No afterimages: the fading ghosts of earlier marker positions are not used either, because the trail already answers "where was it" and ghosts would show a second, competing history.

Colours are exact palette colours, never blended and never grey or white; the trail is therefore readable as discrete steps, like a heat map in a few bands.

## 3. Colour system

The Ice 2 palette is an 11-stop blue ramp, numbered 1 to 11 here (CSS `--viz-ice2-0` to `--viz-ice2-10`), used exactly. dE2000 is the perceived colour step to the previous stop.

| No. | Hex | dE2000 | Role |
|---|---|---|---|
| 1 | #040d31 | | trail, lowest level |
| 2 | #061a53 | 6.8 | trail |
| 3 | #113b86 | 11.6 | trail |
| 4 | #2464ac | 14.1 | trail |
| 5 | #3077c2 | 7.2 | trail |
| 6 | #3d8bd9 | 7.5 | trail |
| 7 | #4a9ff0 | 6.5 | trail; also the glow colour |
| 8 | #6cc0f5 | 10.1 | trail |
| 9 | #98dcfa | 9.0 | trail, highest level |
| 10 | #d0f4ff | 9.4 | the current sector |
| 11 | #f4fdff | 8.9 | not used |

- The first four swatches were measured from the reference photo and are deliberately not smoothed; stops 5 to 11 climb to white-cyan. Luminance rises on every step and no step exceeds dE 15.
- Dim means the same hue at lower brightness: darker blue, never grey. This was an owner rule from the first prototype.
- The glow is palette colour 7 at low alpha, drawn in three growing halos behind the sector. Because cells are drawn on top, the halo shows only in the gaps and over empty neighbours.
- The background is #02050f, a blue-black. Ghost #08142d is defined but unused.
- Everything is drawn opaque with plain painting (source-over); only the glow adds light. That keeps a cell exactly its palette colour. (An early version let white and glow layers add up and produced white base cells and lavender patches; fixed 2026-10-15.)

The reflection is an exact mirror of the columns: same section size, pitch, width and gaps, separated by a dark mirror gap (12 px in the preset). Its colours are the original's palette colour shifted 4 steps darker (the now sector counts as step 9, so it reflects as step 5), saturation at least 0.8, brightness fading linearly with depth down to 30 percent; opaque, no glow, no blur. Measured on the reference (reflected colour, median of five columns):

| Depth (rows below mirror) | Reflected hue | Saturation | Brightness |
|---|---|---|---|
| 1 | 213 to 222 | 0.77 to 0.90 | 0.35 to 0.80 |
| 6 | 216 to 231 | 0.84 to 0.91 | 0.17 to 0.68 |
| 14 | 217 to 235 | 0.69 to 0.87 | 0.06 to 0.51 |

The reflection is vivid royal blue, never white or grey, and darkens with depth. The shifted rule is closer to the measurements than the plain darkening rule (mean dE2000 13.8 against 18.1), but still not close, because the photo's hue slides from cyan to royal blue.

## 4. Geometry

- Section aspect 4:1: a section is 80 x 20 px. The bar width is derived (4 x section height), not set.
- Section gap 0.40 of the section height: 8 px, so the pitch is 20 x 1.4 = 28 px. With 20 sections the derived bar height is 20 x 28 = 560 px.
- Bar gap 6 px between columns, so a column slot is 86 px; 14 columns fit at 1200 px width. Bars wider than 12 px have a minimum of 8 columns (a phone at 375 px shows 8); up to 600 columns are possible with small sections.
- Fit to room: when the half height available is smaller than 560 px, the sections shrink together (count and gap ratio kept, aspect kept, minimum 3 px). The settings never change by themselves; the panel shows the effective size and suggests Visualizer height Full when sections shrank by more than 25 percent.
- Full room: in the full-screen overlay this preset uses the whole canvas height instead of the Visualizer height setting (about 500 px at 1080p, so sections come out near 17 px). Only this preset turns it on.

## 5. Behaviour

- Timing is dt-based: the simulation clock advances by the frame time, capped at 0.1 s, so counts behave the same at 30 and 60 fps. Visits expire exactly 10 s after they happened.
- Pause freezes the clock, so nothing expires while paused.
- All memory resets when the canvas size, bar count, row count or preset changes (the trail starts empty).
- Storage is one ring of 128 visit events per column plus a count per row, kept incrementally (+1 on visit, -1 on expiry); allocated once and reused, no per-frame allocation. 128 events cover about 12 visits per second, more than the display needs.
- Performance: designed for up to 600 columns x 48 rows. Only rows with a visit are drawn, batched per colour; cells use source-over; only the glow is additive, and it is skipped when the frame-rate governor is in lite mode.

## 6. Settings and the preset

Group, label, default, range, meaning (schema in `web/js/viz-mirror-settings.js`). The preset column is the value Ice Blue Mirror 2 sets.

| Setting | Default | Range | Preset | What it does |
|---|---|---|---|---|
| Current sector | off | off, trail | trail | Turns the whole display on |
| Minimum dwell | 60 ms | 0 to 300 | 60 | Time a row must hold the sector to count as a visit |
| Visits per step | 3 | 1 to 30 | 3 | Visits per brightness level |
| Window | 10 s | 2 to 60 | 10 | Persistence time |
| Max level | 8 | 1 to 8 | 8 | Highest trail level (colour 9) |
| Glow | 0.8 | 0 to 1 | 0.8 | Halo strength behind the sector |
| Glow size | 1 | 0.5 to 2 | 1 | Halo size |
| LED sections | 0 | 0 to 48 | 20 | Rows per column |
| Section height | 0 (from count) | 0 to 80 px | 20 | Height of one section |
| Section aspect | 0 (off) | 0 to 8 | 4 | Bar width = N x section height |
| Section gap | 0.3 | 0.1 to 0.6 | 0.4 | Gap as a share of section height |
| Gap (px) | 2 | 0 to 20 | 6 | Space between columns |
| Max bar height / Bar width | Auto | 0 to 600 / 0 to 80 | 560 / 80 | Reference only; derived when sections and aspect are set |
| Use the whole screen | off | on, off | on | Full room in the overlay |
| Colours, Backdrop | theme, none | | ice2, ice2 | The palette and the #02050f background |
| Reflection style | alpha | alpha, shade, shifted | shifted | The exact mirror above |
| Reflection | 0.35 | 0 to 0.8 | 0.5 | Scales brightness (0.5 is full strength in the exact styles) |
| Mirror gap | 0 px | 0 to 12 | 12 | Dark gap before the reflection |
| Base row glow | 0 | 0 to 1 | 0.8 | Soft palette-7 halo around the bottom row, never white |
| Tone variation | 0 | 0 to 0.15 | 0.06 | Tone difference between sections |
| Horizon glow, Horizon band, Tilt | on, 0, 0 | | off, 0, 0 | Not used by this look |
| Peak marker, Afterimage | 0 | 0 to 1 | 0 | Discarded for this look, still in the schema for other presets |

## 7. Decisions log

Owner decisions, in order.

1. Only the current sector is lit; no trail at first (a single bright section per column).
2. Count visits to each row and show them in steps of N visits.
3. First a leaky counter (counts fade by a loss rate), then replaced by a sliding window of 10 s, which is easier to explain and to tune.
4. Minimum dwell 60 ms, so passing over rows does not count.
5. Trail uses palette colours 1 to 9, the current sector colour 10.
6. Dim means darker blue, not grey.
7. The palette is saturated; reflection too.
8. Section aspect 4:1.
9. Section gap 0.40.
10. Full room only for this preset.

Alternatives discarded along the way: a lit body under the level (owner: body off); the peak marker as a separate cap (not used here); fading afterimages (the trail replaces them); a trail by recency, dark blue for old and cyan for now, replaced by the count-based rule.

## 8. Prior art and licensing

Segmented LED spectrum analyzers with peak hold and a mirror reflection are a standard genre. audioMotion-analyzer has an LED bars mode and is AGPL-3.0: it is prior art only; this renderer was written independently and nothing was copied. The reference photo and its watermark are not in the repo.

Git tags: `mirror-liked-1` (001814c) is the original Ice Blue Mirror look, frozen and pinned by a test. Ice Blue Mirror 2 has no liked tag yet; it is the working copy that gets modified from now on.

## 9. Open ideas

- Recency colouring instead of visit counts (dark blue old, cyan now): the owner's question "recency or visit count, or both?" is still unanswered.
- Recapture the preset thumbnail from the real renderer (it still shows the reference).
- Tilt (about 6.5 degrees in the photo) and the perspective skew were removed: the preset is horizontal; skew is not possible with canvas 2D.
- A 3D view of the columns.
