# Concept: the Mirrored spectrum

Owner vocabulary, agreed 2026-10-15. This page explains how to think about the Mirrored spectrum visualizer and names its parts. It is a concept page, not a specification: requirements live in [`../specs/visualizer.md`](../specs/visualizer.md) (VIZ-099 to VIZ-103 cover the target features described here, all planned).

The Ice Blue Mirror 2 preset (digital phosphor LED bars) has its own concept page: [concept-digital-phosphor-led.md](concept-digital-phosphor-led.md).

## Purpose

The Mirrored spectrum is the default visualizer mode. It turns the sound that is playing right now into a row of vertical bars that move with the music. It is calm and legible: you see at a glance where the energy is (low notes on the left, high notes on the right) and how loud it is.

The owner wants every part of this picture to be a named object with its own settings, so the look can be tuned part by part ("make the bars thinner", "make the tips fall slower") without a vocabulary problem. This page fixes that vocabulary.

## The visual model

```
          Upper space   (the area above the horizon line)
                           |
                  |   |    | |        |
   bars rise  | | | | | | || | |  | | | |
   upward     | | | | | | || | | || | | | |
 ================== Horizon line ====================
   the        | | | | | | || | | || | | | |   (fainter)
   reflection | | | | | | || | |  | | | |
                  |   |    | |        |
          Bottom space  (the area below the horizon line)
   low notes                                high notes
   (left)                                       (right)
```

Five objects: **Horizon line**, **Bars**, **Upper space** (no settings of its own), **Bottom space** (transparency, blurriness, plus mirroring distortions still to be decided) and **Frequency captions** (labels such as 100 Hz, 1k, 10k along the horizon line; property set chosen, details to be decided).

The horizon line is the mirror axis. The bars stand on it and grow upward into the upper space. Below the line the same bars appear upside down and fainter, like a reflection in water; that reflection lives in the bottom space. The picture is symmetric about the horizon line, except that the reflection is dimmer.

## The objects

### Horizon line

The horizontal line across the full width at the vertical middle of the picture. It has two roles: it is the axis the picture is mirrored around, and it is a visible element in its own right (today a soft glow along it). Everything above it is the upper space, everything below it the bottom space. Its properties are listed below.

### Bars

The row of vertical bars, one per slice of the sound spectrum. This is the owner's term. Do not call them "spikes" or "peaks": "peak" is reserved for the highest point a bar recently reached (see bar tips).

- **From audio to bars.** The sound is analysed into many narrow frequency bands (96 to 480 of them, about one per 4 CSS pixels of width, spaced like musical pitch: low notes on the left, high on the right). Each band's loudness becomes one bar's height.
- **Height.** A bar's height follows its band's loudness through a gentle curve: quiet sound still shows, loud sound levels off near the maximum instead of hitting the ceiling.
- **Smoothing.** The bars themselves are smoothed (this is separate from the tip motion described under Bar tips). Bars rise quickly when the sound gets louder and fall back more slowly when it gets quieter, so the motion feels fluid instead of jittery. Two numbers control it today, Rise speed and Fall speed; they smooth the bars (and the Ring mode, which shares them), not the tips.
- **Mirror.** Each bar is drawn twice: upward from the horizon line, and downward as the dimmer reflection.
- **Edges.** Bars near the far left and right edges fade out, so the row has no hard ends.

### Upper space

The area above the horizon line, where the bars rise. It is a defined object but has no settings of its own, by design (for now): the owner knows of no configuration for it. Anything that visually affects it (bar height, colours, transparency, glow, 3D) is a Bars setting. Today it shows the page background.

### Bottom space

The area below the horizon line. It holds the mirrored copy of the bars (the reflection). It never has data of its own: it shows the bars upside down. Its properties are Transparency, Blurriness and a group of mirroring distortions that are not decided yet (below).

### Frequency captions

The small labels that name frequencies, for example "100 Hz", "1k", "10k", placed along the horizon line under the bars they belong to. The owner decided they are a separate, fifth object.

Why separate:

- Not part of the Horizon line: the horizon line is only a line. Its colour, thickness and glow should not also decide how text looks.
- Not part of the Bottom space: the bottom space is the dimmed copy of the bars, and its transparency, blur and distortions (angles, shifts, scaling) would smear or move the labels so they no longer read or line up.

How the labels line up with the bars. The bars are spaced on a logarithmic frequency scale, the way pitch is heard (each octave takes the same width). Bar number i of n covers the band from f(i) to f(i+1), where f(i) = 20 Hz x (16000 / 20)^(i / n), so the row runs from 20 Hz on the left to 16 kHz on the right (limited to half the sample rate on unusual devices). The inverse tells a caption where to stand: the bar index for a frequency f is n x ln(f / 20) / ln(800), which is a fraction of the width, independent of how many bars there are. For example 100 Hz sits about 24% of the way from the left, 1 kHz about 58% and 10 kHz about 93%. This is the same band layout the bars use in `viz-spectrum.js` (`barEdges`, `barsDb`); `viz-bars.js` then spreads the n bars evenly across the width. Because the spacing is logarithmic, labels at 1-2-5 steps (100, 200, 500, 1k, 2k, 5k, 10k) are unevenly spaced in pixels but evenly meaningful.

Captions have no data of their own: they are fixed to the frequency scale, not to the music. The owner has chosen their property set (below); the details are still to be decided.

Properties (chosen by the owner; ranges, defaults and exact behaviour are to be decided later):

| Property | Idea (details to be decided) |
| --- | --- |
| Show / Hide | Turn the captions on or off. |
| Color | Caption colour, from the design-token colours only. |
| Font size | How large the labels are. |
| Which frequencies and density | Only a few anchor labels (100, 1k, 10k) or many; how crowded is allowed before labels are dropped on a narrow screen. |
| Position | Above the horizon line, below it, or sitting on it. |
| Opacity | How strong the labels are against the bars. |
| Mirror into Bottom space | Whether the captions also appear in the reflection (the smearing concern above applies if they do). |

## How the objects relate

- The horizon line splits the picture into upper and bottom space and is the mirror axis.
- The bars stand on the horizon line. Their height is limited by the room between the line and the top (and, for the reflection, the bottom) of the picture.
- The bottom space shows a copy of the bars; it never has data of its own.
- Frequency captions sit along the horizon line, aligned with the bars they name, but are drawn on their own so that nothing done to the bottom space or to the line itself affects them.
- All colours come from the app's design tokens (the single design system). No object may invent a colour.

## Horizon line properties

The owner defined three properties. Colours come from the design-token colours only.

| Property | Meaning | Range | Default | Visual effect |
| --- | --- | --- | --- | --- |
| Color | The colour of the line. | one of the design-token colours | the line colour (white), a little softer at the left and right ends | Changes the tone of the axis; a theme colour ties it to the bars, white keeps it neutral. |
| Thickness | How thick the bright core of the line is. | about 1 to 8 px (suggested) | 3 px | Thin: a hairline separating the two halves. Thick: a strong band that the bars visibly stand on. |
| Glowing | A soft halo of light around the line, today called Horizon glow. | Off, or strength 0% to 100% (suggested) | On, at today's strength | Off: a crisp line. Higher: the line looks lit and bleeds light into the upper and bottom space. |

Today: Glowing exists as the Horizon glow on/off switch (the glow is two soft layers around the core). Color and Thickness are fixed and have no controls yet; they are the target. Reflection opacity is not a horizon property: it belongs to the bottom space.

## Bottom space properties

### Transparency

| Property | Meaning | Range | Default | Visual effect |
| --- | --- | --- | --- | --- |
| Transparency | How much the mirrored copy is dimmed. At the fully transparent end the mirror is invisible, which is the same as not mirroring at all. | 0% to 100% transparent (suggested) | about 65% transparent, i.e. the copy shows at 35% of the bars' strength (today's look) | Low transparency: a strong, almost equal reflection. High: a faint ghost. 100%: the bottom space shows nothing. |

Transparency is the same setting as today's Reflection opacity, seen from the other side: reflection opacity 35% is 65% transparency. It belongs to the bottom space, not to the bars (the Bars' own transparency is a separate property) and not to the horizon line. The owner's wording was slightly garbled; this page reads it as "the more transparent, the less visible the mirror, and fully transparent equals no mirroring" (to confirm, see open questions).

### Blurriness

| Property | Meaning | Range | Default | Visual effect |
| --- | --- | --- | --- | --- |
| Blurriness | How soft the edges of the mirrored copy are. | 0 (sharp) to a maximum, suggested 0% to 100% | 0 (sharp, today's look) | Low: a crisp mirror image. High: the reflection melts into soft shapes, like a reflection in disturbed water. |

How it differs from the other properties: Transparency changes how strong the copy is but keeps its edges sharp; Blurriness changes how sharp it is and leaves its strength alone (the two can be combined). Bars glowing is a halo around the bars above the horizon line and adds light; Blurriness only softens the copy below it and adds none.

Open questions: is the blur uniform over the whole copy, or does it grow with the distance from the horizon line (sharp at the line, softer further down, like a real reflection)? Does blurring also soften the bar gaps, so neighbouring bars merge?

Cost note: blurring a canvas is expensive and must stay light for a phone CPU (VIZ-034). Cheaper options than a live full-size blur are a few pre-blurred copies of the reflection layered at different strengths, or drawing the reflection into a small low-resolution offscreen canvas and scaling it up, which softens it for free. The final look and the cost need to be weighed together.

### Mirroring distortions (not yet decided)

A planned group, to be discussed later. There are no settings yet; the ideas below are concepts only.

- **Angles** (not yet decided): tilt or skew the reflection so it leans instead of being an exact upside-down copy. Open: one angle for the whole row or per side, and is it a fixed look or a control?
- **Shifts and offsets** (not yet decided): move the copy sideways or away from the horizon line, so it no longer lines up with the bars. Open: horizontal, vertical or both, and should the gap be visible?
- **Show only halves** (not yet decided): draw only part of the reflection, for example the left or right half, or only the bottom part of it. Open: which halves, and what fills the rest?
- **Scaling** (not yet decided): make the reflected lines or bars bigger or smaller than the originals. Open: scale height, width or both, and how it combines with the bar width setting?

## Bars properties

The owner named these properties. For each: what it means, its range, its default and what you see.

| Property | Meaning | Range | Default | Visual effect |
| --- | --- | --- | --- | --- |
| Max height | The tallest a bar can grow, as a share of the room above the horizon line. | to be tuned | today's maximum (80% of the room, scaled by the mode height) | Low: a flat, calm strip. High: bars reach toward the top. |
| Width | How much of its slot a bar fills. The rest is the gap to the next bar. | 30% to 95% of the slot | 60% | Narrow: airy, thin lines. Wide: a dense wall. |
| Color gradient | How colours are spread over the bars. Off: one solid colour. Horizontally: colours change from left to right across the spectrum. Vertically: colours change along each bar's height, bottom to top. | Off / Horizontally / Vertically | Horizontally | Horizontal tints low notes differently from high notes. Vertical makes loud moments climb through the colours, like a level meter. |
| Colors | The colours used. At least 1; the owner can add up to 5, each chosen from the design-token colours only. With the gradient on they are its stops in order; with 1 colour, or the gradient Off, the bars are solid. | 1 to 5 colours | the four theme colours | More colours make a richer gradient; one colour makes a clean solid look. |
| Sections number | Splits each bar into this many stacked segments with small gaps, like an LED level meter. 1 is a solid bar. | 1 to 10 | 1 | 1: smooth bars. 5 to 10: a column of lit blocks that grows and shrinks one block at a time. |
| Bars transparency (bar opacity) | How see-through the bars are. 100% is fully opaque. This is about the bars above the horizon line; the reflection has its own, separate Reflection opacity in the bottom space, and the reflection stays dimmer than the bars it copies. | 0% to 100% (suggested) | 100% (fully opaque, today's look) | Lower values let the background show through and make overlapping glow and colours softer; 0% hides the bars. |
| Bars glowing | A soft halo of light around the bars. This is the bars' own glow; Horizon glow is a different thing, the glow along the horizon line, and belongs to the Horizon line. | Off, or strength 0% to 100% (suggested) | Off (today's bars have no halo of their own) | Low strength: a faint aura. High strength: bars look lit from within and bleed light into the upper space. |
| Bar style (dimension) | Whether the bars are flat or have depth. 2D: flat rectangles, as today. 3D: bars drawn with depth, for example a lighter top face and a darker side face (shaded extrusion), or a true perspective view. | 2D / 3D | 2D (today's look) | 2D: the clean flat look. 3D: bars read as solid blocks or columns standing on the horizon line. |
| Bar tips | A small cap that rides above each bar. When the bar drops, the tip stays up and then sinks slowly, so you see where the bar recently peaked. | see below | hidden | A floating dash above the bars that trails their peaks. |

Bar tips (usually called peak caps or peak hold in audio software; "bar tips" is the name used here) have three settings. Their motion is the fall: a tip jumps up with its bar, holds, then sinks at the fading speed.

- **Color**: the cap's colour, from the design-token colours only. Default: the line colour (white).
- **Show / Hide**: whether the caps are drawn. Default: hide.
- **Fading speed**: how fast a cap falls (or fades) back down after its bar dropped. Slow keeps the previous peak visible for a long time; fast makes the cap hug the bar.

Bar width (px, 2 to 40, 0 = Auto = the classic look) and Gap (px, 0 to 20) replace the old Bar count and Bar width: bar pitch = width + gap, bar count = canvas width / pitch clamped to 48..600 (clamped counts stretch the bars to keep the ratio and fill the canvas); the panel shows the resulting count as "~N bars". Max bar height (px, 20 to 600, 0 = Auto = today's height) replaced the Height multiplier: the tallest bar's height in CSS px above the horizon, capped at 95% of the available half height. Old saved density, width and height values are converted once (at a 1200 px canvas and a 200 px half height). Status: built.

### Bar style (3D) and the other properties

- **Gradient and Colors:** the colours stay the face colours of the front; in 3D the top and side faces are darker or lighter shades of the same colour, never new colours.
- **Sections:** each segment becomes its own small block, so the 3D effect repeats per segment.
- **Transparency and glowing:** apply to the whole solid, faces included; the glow follows the 3D outline.
- **Bar tips:** the cap becomes a thin slab with the same depth as the bars.
- **Reflection:** the bottom space mirrors the 3D bar, fainter, so the sides appear upside down below the line.
- **How it would be drawn:** it must stay light for a phone CPU (VIZ-034). The cheapest approach is a flat extra shape per bar (a parallelogram for the top face and one for the side) drawn with the same batched canvas calls as today, not a 3D engine. Cost grows with the number of bars and sections, so the bar count may need to be capped in 3D.

## Today versus the target

Exists today (a settings panel for the Mirrored spectrum, saved on this device; the panel code is not committed yet):

- Bars: Bar width (px), Gap (px), Max bar height (px); LED Sections (0 to 48, with a Section gap), Bar tips (show, fading speed); a colour choice of Theme, Reversed or Accent; Rise speed and Fall speed.
- Bottom space: Reflection opacity (the Transparency property, shown inverted).
- Horizon line: Horizon glow on or off (the Glowing property).
- Part toggles (bass, mids, highs; beats, melody, other) that filter which sound the bars show.

Defined by the owner as the target, not built yet:

- Bars: Max height, Color gradient (Off / Horizontally / Vertically), 1 to 5 Colors, Sections number 1 to 10, Bar tips (colour, show or hide, fading speed), Bars transparency, Bars glowing and Bar style 2D / 3D. They replace the current colour choice and take over Height.
- Horizon line: Color and Thickness (Glowing exists today as the on/off switch).
- Bottom space: Transparency (exists as Reflection opacity) and Blurriness.
- Frequency captions: the whole object.
- Mirroring distortions: undecided, nothing planned yet.

Rise and Fall speed, Reflection opacity and Horizon glow keep working and will be regrouped under the objects they belong to.

## Open questions for the owner

- **Horizon line**: its three properties are defined; still open is whether it can be hidden and whether it can move away from the exact middle.
- **Bottom space, transparency**: confirm the reading that fully transparent means an invisible mirror, the same as no mirroring.
- **Bottom space, distortions**: angles, shifts and offsets, showing only halves and scaling are all undecided (see above).
- **Rise speed and Fall speed**: today they smooth the bars themselves (and Ring), not the tips. Does the owner want them kept as bar properties, or dropped? The motion the owner had in mind belongs to the tips (Fading speed).
- **Bar style (3D)**: which kind of 3D: an isometric extrusion (fixed oblique angle, cheap), real perspective (bars shrink toward a vanishing point, likely WebGL, heavier) or only faked shading (gradients that suggest a rounded or lit surface)?
- **Depth and angle**: does the owner want controls for how deep the bars are and the viewing angle, or one fixed look?
- **3D and Ring**: should the Ring mode get the same flat or 3D choice, or is it only for the Mirrored spectrum?
- **Max height** and the reflection: should the reflection's height follow the same maximum?
- **Frequency captions**: the property set is chosen; the details are open: ranges and defaults, and the exact behaviour of position and of mirroring. Are labels fixed (100, 1k, 10k) or chosen by screen width? Do they use the vocabulary "Hz / kHz" or the short "1k"?
- **Frequency captions and accessibility**: they are decorative (the canvas is hidden from screen readers); is that fine?

## Naming decisions

- **Bars**, not "spikes" or "peaks". The things that rise from the horizon line are bars.
- **Bar tips** is the primary name for the little caps on top of the bars. "Peak caps" (or peak hold) is the usual industry synonym and may appear in explanations, not in the interface.
- **Horizon line**, **Upper space**, **Bottom space**: the words for the line and the two areas it divides. Not "sky" and "ground", or "top half" and "bottom half".
- **Frequency captions**, not "axis labels" or "scale": the labels naming frequencies along the horizon line.
- **Reflection** is what the bars look like in the bottom space; it is not a separate object.

## Presets

One-click looks at the top of the Mirrored spectrum panel, like the Synthwave presets. A preset overwrites every setting the panel has today (bar count, width, height, colours, reflection opacity, horizon glow, rise and fall speed) and is highlighted while the settings equal it exactly; any later tweak clears the highlight. Names are working names and easy to rename. Thumbnails 1 to 5 are the owner's reference images used directly (watermarks included, accepted by the owner), kept in full under `docs/brand/mirror-references/`; Classic is captured from the real renderer. Colours can only be the three theme choices the panel has (Theme, Reversed, Accent), all from design tokens, so each look is an approximation.

| Preset | Image | Set today | Not yet reproducible |
| --- | --- | --- | --- |
| Neon Cylinders | `01-neon-cylinders.webp` | few wide bars, theme gradient, faint reflection, glow on | the 3D glowing cylinders, rainbow colours (more than the theme stops), the frequency captions along the base, the perspective view |
| Cyan Magenta Wave | `02-cyan-magenta-wave.png` | many thin bars, reversed gradient, strong reflection | cyan-to-magenta vertical gradient with rounded bar ends, bars fading to nothing at the sides |
| Neon Blocks | `03-neon-blocks.png` | medium wide bars, theme gradient, strong reflection | LED sections (sections number), glowing bars, blue to pink to orange colours across the width, blurred reflection |
| Pink Cyan Blocks | `04-pink-cyan-blocks.png` | few wide bars, reversed gradient, faint reflection, no horizon glow | LED sections, the vertical pink-to-cyan gradient, bar tips |
| Ice Blue Mirror | `05-ice-blue-mirror.png` | built: wide pixel bars (10 px, gap 2), 20 LED sections, the Ice palette as a vertical gradient, a Horizon band, the Ice backdrop, reflection 0.8 (the thumbnail is still the owner's reference image); liked, tag `mirror-liked-1` (parameters: [visualizer.md](../specs/visualizer.md)) | the perspective view |
| Ice Blue Mirror 2 (digital phosphor LED bars) | none (our own renderer) | working copy of the liked Ice Blue Mirror, the one that gets modified from now on (the original stays frozen, tag `mirror-liked-1`); reverse-engineered LED look: 40 px wide blocks 35 px tall (about 4x the original), black background, no horizon band, white base row glow, the History trail (current sector plus visit-count trail, no peak marker or afterimages), the Ice 2 palette, tone jitter, dark gap before a blurred reflection, 6 degree tilt (thumbnail is a copy of the original's until recaptured) | the perspective skew (needs a 3D transform), per-column hue shifts |
| Classic | captured | all defaults, today's look | nothing |

## Reverse-engineered reference: LED equalizer

Source: a stock photo of a blue LED equalizer (about 1984 x 1126 px, watermarked; the owner's reference, not stored in the repo because it is public: only measurements are kept here). Owner corrections: the background is plain black, there is no horizon band, and brightness means how long a segment has been active.

Measured facts:

- Geometry: about 24 columns across 1984 px (pitch about 85 px, bar about 75 px), so a column is about 4x the old preset's 10 px; segments are wide rectangles about 3.5:1 (about 75 x 21 px), pitch about 27 px vertically, thin dark gaps (about 6 px) both ways. Ice Blue Mirror 2 uses 6 px gap, 20 LED sections of 20 px (`segments` 20, `sectionHeight` 20, segment gap ratio 0.4 so 8 px gaps, pitch 28 px, Derived bar height 20 x 28 = 560 px; `maxHeight` 560 is kept for reference only) and a Section aspect of 4 (owner: bar width 4x the section height), so the bar is 80 px wide (`barWidth` 80 is kept for reference only), pitch 86 px, 14 bars at 1200 px (8 at 375 px, the minimum for bars above 12 px). Earlier values: section height 35 with count 0 gave only 4 to 5 rows, then 21 sections at max height 280.

Height rules (owner: "calc automatically bar height based on sections number"):

| Section height | LED sections | Bar height | Section height used |
|---|---|---|---|
| 0 | N | Max bar height (or Auto) | derived: height / N |
| H | 0 | Max bar height (or Auto), rows = round(height / (H + gap)) | H |
| H | N | Derived: N x (H + gap); Max bar height ignored and disabled | H, or smaller by Fit to room |

Width rule (Section aspect, `sectionAspect`, 0 = off, 1 to 8 step 0.5): when Section aspect A is above 0 and Section height is above 0, the bar width is DERIVED = A x the effective section height (after Fit to room, so the sections keep the A:1 proportion when they shrink); Bar width is then ignored and disabled in the panel (shows e.g. "80, from 4 x 20 px"). The bar count follows from the derived pitch (width + Gap (px)); Gap (px) stays independent of the section gap. The derived width is not limited by the Bar width slider maximum (80). Example: Small height with sections shrunk to 6 px gives width 24 px.

Fit to room: the room is 0.95 x the available half height (Visualizer height setting in the background; the whole canvas in the full-screen overlay only when the Full room setting `fullRoom` ("Use the whole screen in full-screen mode", default off, on only for Ice Blue Mirror 2) is on, about 500 px at 1080p, which already shrinks the 560 px stack to about 17 px sections; every other preset keeps the Visualizer height in the overlay). When the Derived bar height does not fit, the section height shrinks proportionally (count and gap ratio kept, minimum 3 px). The panel shows "effective: 20 rows x 6 px, width 24 px (room 140 px)" (the width part only with Section aspect) and, if sections shrank by more than 25 percent, the hint "More room: set Visualizer height to Full"; the Visualizer height setting is never changed automatically.
- Shading: each lit segment is a flat rounded block with a lighter inner edge; colour runs from white-cyan through cyan and azure to deep blue. Neighbouring segments differ by about 6 percent in tone (`shadeJitter`, deterministic per column and row). 
- Body, peak marker, afterimages (owner decision BH1, from the owner's crop: a lit body at the bottom, a dark gap, then one or two dimmer detached segments higher up): (1) the BODY is contiguous segments from the base to the current level, shaded by position only (whitest at the base row, through cyan and azure to deep blue at the tip), no history; (2) a PEAK MARKER is one segment above the body at the recent maximum: it rises instantly with the level, is held `PEAK_HOLD_S` (0.6 s, setting `peakHold`), then falls one segment per `PEAK_STEP_S` (0.12 s, speeding up by 10 percent per step) until it reaches the body; (3) AFTERIMAGES: each segment the marker occupied keeps a fading ghost, alpha = exp(-time since last lit / `AFTERIMAGE_TAU_S`) (0.35 s, setting `afterTau`), drawn only where the segment is neither body nor the current marker. Because the marker steps down and can jump up, the ghosts appear as dim detached segments separated from the body by dark gaps, which is exactly the crop's pattern. Settings `peak` (marker alpha, 0 = off) and `afterimage` (ghost alpha, 0 = off); with solid bars they have no effect.
- Base row: the innermost row is the brightest (white) with a soft glow (`baseGlow`); there is no separate horizon band or streak. Below it a dark gap about one segment gap tall (`mirrorGap`), then the reflection.
- Background: black, no vignette that matters (`backdrop` Black). No horizon band (horizon off, band 0).
- Reflection: Ice Blue Mirror 2 uses Reflection style `shifted` (below); the legacy style `alpha` (dimmer by `reflection`, softened by `reflectionBlur`) stays for the other presets.

Reflection, measured on the reference crop (reflection region of the LED equalizer; median colours of 80 x 11 px patches, five columns; depth d = rows below the mirror line; the original is the cell at the mirrored row above):

| depth d | original cells (5 columns) | reflected cells | reflected HSV (hue / sat / value) |
|---|---|---|---|
| 1 | #6ac0de #5690ac #07142f #071236 #2b88dc | #10429f #133059 #0b2258 #1865cb #1c4578 | 213-222 / 0.77-0.90 / 0.35-0.80 |
| 3 | #80dff1 #204577 #6daecb #8fe8f6 #214a7e | #1553b9 #0e2450 #0a1f57 #1659bf #11336d | 217-224 / 0.82-0.89 / 0.31-0.75 |
| 6 | #71d9ee #27507b #69a6c2 #7fdaed #173767 | #114aae #0d2652 #050b2b #0f429f #134187 | 216-231 / 0.84-0.91 / 0.17-0.68 |
| 10 | #97edf8 #2a5278 #8dcadc #80d3e7 #0e234e | #1a61c0 #1b4471 #040615 #103f98 #11479a | 211-233 / 0.76-0.89 / 0.08-0.75 |
| 14 | #6ed8f0 #162b4b #6bcde5 #80cade #24415d | #133d82 #0c1f3f #050610 #0f2d65 #0f3372 | 217-235 / 0.69-0.87 / 0.06-0.51 |

Facts: (a) geometry is a literal vertical mirror (same section size, pitch, width and gaps, not squashed, not blurred), with a dark separator at the mirror line about 1.5 x the section gap (the preset: `mirrorGap` 12 px for 8 px gaps), and the reflected column is as tall as the original; (b) colour is vivid saturated blue (hue 211 to 235, saturation mostly 0.8 to 0.9), the light cyan originals reflect as azure, never white or grey; (c) the value falls roughly linearly with depth, about 0.75 near the line to about 0.3 to 0.5 at depth 14 (darker for dim originals); (e) no glow. Comparison with two rules, mean dE2000 over the five columns (rule applied to each original cell, then compared with the measured reflected cell; 20 reflected rows assumed): `shade` (value x 0.65 falling to 0.2, saturation x 1.1) 18.1; `shifted` (original palette index minus 4, saturation at least 0.8, value x 1.0 falling to 0.3) 13.8 (shift 3: 15.2, shift 2: 18.2). Neither is close (both above 10, because the reference hue slides from cyan to royal blue, which a value-only shade cannot do), but `shifted` is closer at every depth, so it is the preset's default.

Reflection style (`reflectionMode`, Look group, "Reflection style"): `alpha` (default, the old dimmed and blurred reflection), `shade` (original palette colour, saturation x 1.1, value x 0.65 falling linearly to 0.2 over the rows), `shifted` (palette index of the original cell minus 4, saturation raised to at least 0.8, value x 1.0 falling linearly to 0.3 over the rows; the now sector uses index 9 minus 4). Both exact styles apply only with the History trail, are fully opaque (alpha 1, source-over), have no glow and no blur, and the `reflection` setting scales the value (reflection / 0.5, capped at 1, so the preset's 0.5 is full strength).
- Tilt: the whole scene is rotated about 6.5 degrees counter-clockwise (the mirror line rises to the right), measured in the reference; the preset itself uses `tilt` 0 (owner: horizontal); the Tilt setting stays for other uses. A perspective skew (columns narrowing to the right) is not reproduced: canvas 2D transforms are affine only.
- Not copied: the photo, its watermark and its texture.

New Mirror settings (all default to 0 or off, so existing presets draw identically): Section height (px) 0 to 80 (0 = from count and bar height; above 0 it is used together with the count, see the height rules), Section aspect 0 to 8 (0 = off; see the width rule), Tone variation 0 to 0.15, Peak marker 0 to 1, Peak hold 0.1 to 2 s, Afterimage 0 to 1, Afterimage fade 0.1 to 1.5 s, Base row glow 0 to 1, Mirror gap 0 to 12 px, Reflection blur 0 to 1, Tilt -12 to 12 degrees; Colours gains Ice reversed (white at the base), Backdrop gains Black; Bar width up to 80 px. For bars wider than 12 px the minimum bar count is 8 instead of 48, so large blocks stay large on a phone.

### History trail (Ice Blue Mirror 2, owner-named)

Owner decisions BP1 and the one-bar prototype. Each bar column is judged on its own. Display: only the CURRENT SECTOR (the one LED segment at the column's level, row = floor(level x rows), clamped) is drawn flat in palette colour 10 (#d0f4ff), plus a HISTORY TRAIL; no body, no peak marker, no afterimages in this mode (`sectorMode` = trail; the `peak` and `afterimage` settings stay in the schema for other uses).

- Visit count: per column and row the number of visits within the last `window` seconds (integers). A visit counts +1 only after the sector has stayed on the row continuously for the MINIMUM DWELL (`minDwell`, 60 ms, 0 to 300 ms); rows the sector only passes over during a jump never count; the +1 is applied once when the threshold is first reached (frames count, so 4 frames at 60 fps = 66 ms counts, 3 = 50 ms does not; at 30 fps 2 frames count).
- Window: each visit is stamped with the simulation clock and expires exactly `window` seconds later (`window` 2..60 s, default 10; the clock uses dt capped at 0.1 s and does not advance while paused, so counts do not expire while paused). Storage: one event ring per column (`SECTOR_EVENTS` = 128 entries of row and time) with per-row counts kept incrementally (+1 on visit, -1 on expiry, oldest event evicted when the ring is full); cheaper than a timestamp ring per row, 600 columns use about 0.7 MB for rings plus one byte per row cell, all allocated once and reused (no per-frame allocation). The old leaky counter (`loss`) is removed; stored `loss` values are ignored.
- Level: `min(maxLevel, floor(count / visitsPerStep))`, defaults 8 and 3 (steps at 3, 6, ..., 24 visits in the window; level 8 needs 24 visits of one row within 10 s, which only hot rows reach; the event ring of 128 per column holds about 12 visits per second, enough; if level 8 proves unreachable in practice, set Visits per step to 2).
- Trail: rows with count >= 1 are drawn in the EXACT palette colours 1 to 9 (ramp indices 0 to 8: #040d31 ... #98dcfa), level k = colour k + 1, no interpolation, no value scaling (the `trailMax` setting is removed; stored values are ignored), alpha 1, never mixing white or grey. The CURRENT ("now") sector is palette colour 10 (#d0f4ff, `SECTOR_RAMP_INDEX` = 9, taken from the ramp so it follows palette changes), a flat fill at alpha 1 for every row (no row tint, no white lift pass, no outline); palette colour 11 (#f4fdff) is not used by the trail or the sector. The brightest trail colour (#98dcfa) differs from the now colour by dE2000 about 9 (tested). All of it is drawn with source-over (no additive blending) so a cell shows its palette colour exactly; only the glow halos are additive.
- Glow: behind each current sector three expanded rectangles (8 %, 16 %, 28 % of the segment height, minimum 2 px, times `glowSize`) in the ramp stop 6 colour (#4a9ff0) at alpha 0.30, 0.16, 0.08 times `glow`, drawn additively ('lighter') BEFORE the cells, so the exact cell colours cover them and the halo shows only in gaps and empty neighbours; no shadowBlur; the reflection has no glow in the exact reflection modes. Glow is skipped when the pace governor is lite. Settings `glow` (0..1, default 0.8) and `glowSize` (0.5..2, default 1).
- Base row glow in this mode: a soft halo in palette colour 7 (#4a9ff0) around the innermost row (additive, alpha 0.18 x `baseGlow`), never white, and the base row cells follow the same trail/now colours as any row. Why the base cells were white before 2026-10-15: `drawBaseRow` filled row 0 with `colors.line` (#fff) at alpha `baseGlow` plus a 3 px white halo, on top of the trail and the now sector; the now sector also got the row gradient colour (whitest at row 0) plus a 90 % white lift; everything was blended with 'lighter', so overlaps summed (grey and lavender cells where azure met white halos, flat #5b9fd3 where trail colour, halos and neighbours added up, near-black where no bar was lit).
- Reflection: see "Reflection, measured on the reference crop" in the reference section above.
- Memory resets when the bar count, row count or canvas size changes, and on preset change. Cost: typed arrays reused across frames, 600 x 48 stays well under one frame; only rows with count >= 1 are drawn, batched per brightness level.
- Settings (group "History trail"): Current sector (off, trail), Minimum dwell (ms), Visits per step, Window (s), Max level (1 to 8), Glow, Glow size.

Related industry ideas (concept only, nothing copied): the trail is a "digital phosphor" or persistence display as known from oscilloscopes and RF spectrum analyzers, where brightness or colour shows how often the signal visits a spot within a persistence window (rare = cool blue, frequent = hot white). Our `window` is the persistence time and our level steps are the density colouring. LED segmented spectrum analyzers with peak hold and a mirrored reflection are also a standard visual genre; audioMotion-analyzer (LED bars mode, peak hold, reflex) is prior art only, it is AGPL-3.0, so we implement our own and copy nothing.

### Ice 2 palette

Owner-approved 11-stop ramp (prototype 11), tip to base, used exactly; CIE L* and CIEDE2000 step to the previous stop below. Stops 0 to 3 are the owner's four dark blue swatches and are deliberately not regularised (hue 212 to 228, saturation 79 to 92 %); stops 4 to 10 climb to white-cyan. Luminance is monotonic and no step exceeds dE 15 (pinned by a test).

| Variable | Hex | L* | dE2000 |
|---|---|---|---|
| `--viz-ice2-0` | #040d31 | 4.8 |  |
| `--viz-ice2-1` | #061a53 | 12.0 | 6.8 |
| `--viz-ice2-2` | #113b86 | 26.6 | 11.6 |
| `--viz-ice2-3` | #2464ac | 41.9 | 14.1 |
| `--viz-ice2-4` | #3077c2 | 49.1 | 7.2 |
| `--viz-ice2-5` | #3d8bd9 | 56.5 | 7.5 |
| `--viz-ice2-6` | #4a9ff0 | 63.8 | 6.5 |
| `--viz-ice2-7` | #6cc0f5 | 74.5 | 10.1 |
| `--viz-ice2-8` | #98dcfa | 84.4 | 9.0 |
| `--viz-ice2-9` | #d0f4ff | 94.0 | 9.4 |
| `--viz-ice2-10` | #f4fdff | 98.7 | 8.9 |

Dim ladder `--viz-ice2-dim-0..3` = stops 0 to 3 (the darkening path of the trail and the reflection). Background `--viz-ice2-bg` #02050f (blue-black); ghost `--viz-ice2-ghost` #08142d (defined, unused). The gradient option Ice 2 runs the ramp from the base (whitest) to the tip, evenly spaced; the Ice 2 backdrop is the flat `--viz-ice2-bg`. The earlier measured-from-crop ramp (k-means, then segment centres) is superseded.
