# Concept: the Mirrored spectrum

Owner vocabulary, agreed 2026-10-15. This page explains how to think about the Mirrored spectrum visualizer and names its parts. It is a concept page, not a specification: requirements live in [`../specs/visualizer.md`](../specs/visualizer.md) (VIZ-099 to VIZ-103 cover the target features described here, all planned).

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
| Ice Blue Mirror 2 | none (our own renderer) | working copy of the liked Ice Blue Mirror, the one that gets modified from now on (the original stays frozen, tag `mirror-liked-1`); reverse-engineered LED look: 40 px wide blocks 35 px tall (about 4x the original), black background, no horizon band, white base row glow, the History trail (current sector plus visit-count trail, no peak marker or afterimages), the Ice 2 palette, tone jitter, dark gap before a blurred reflection, 6 degree tilt (thumbnail is a copy of the original's until recaptured) | the perspective skew (needs a 3D transform), per-column hue shifts |
| Classic | captured | all defaults, today's look | nothing |

## Reverse-engineered reference: LED equalizer

Source: a stock photo of a blue LED equalizer (about 1984 x 1126 px, watermarked; the owner's reference, not stored in the repo because it is public: only measurements are kept here). Owner corrections: the background is plain black, there is no horizon band, and brightness means how long a segment has been active.

Measured facts:

- Geometry: about 24 columns across 1984 px (pitch about 85 px, bar about 75 px), so a column is about 4x the old preset's 10 px; segments are wide rectangles about 3.5:1 (about 75 x 21 px), pitch about 27 px vertically, thin dark gaps (about 6 px) both ways. Ice Blue Mirror 2 uses 40 px bars, 6 px gap, 35 px section pitch (segment gap ratio 0.2), max height 280 px (8 rows), about 26 bars at 1200 px.
- Shading: each lit segment is a flat rounded block with a lighter inner edge; colour runs from white-cyan through cyan and azure to deep blue. Neighbouring segments differ by about 6 percent in tone (`shadeJitter`, deterministic per column and row). 
- Body, peak marker, afterimages (owner decision BH1, from the owner's crop: a lit body at the bottom, a dark gap, then one or two dimmer detached segments higher up): (1) the BODY is contiguous segments from the base to the current level, shaded by position only (whitest at the base row, through cyan and azure to deep blue at the tip), no history; (2) a PEAK MARKER is one segment above the body at the recent maximum: it rises instantly with the level, is held `PEAK_HOLD_S` (0.6 s, setting `peakHold`), then falls one segment per `PEAK_STEP_S` (0.12 s, speeding up by 10 percent per step) until it reaches the body; (3) AFTERIMAGES: each segment the marker occupied keeps a fading ghost, alpha = exp(-time since last lit / `AFTERIMAGE_TAU_S`) (0.35 s, setting `afterTau`), drawn only where the segment is neither body nor the current marker. Because the marker steps down and can jump up, the ghosts appear as dim detached segments separated from the body by dark gaps, which is exactly the crop's pattern. Settings `peak` (marker alpha, 0 = off) and `afterimage` (ghost alpha, 0 = off); with solid bars they have no effect.
- Base row: the innermost row is the brightest (white) with a soft glow (`baseGlow`); there is no separate horizon band or streak. Below it a dark gap about one segment gap tall (`mirrorGap`), then the reflection.
- Background: black, no vignette that matters (`backdrop` Black). No horizon band (horizon off, band 0).
- Reflection: mirrored rows are dimmer (about half, 0.5, still an open question to the owner), deeper blue, softened (`reflectionBlur`, a cheap two-tap alpha stack, not a real blur).
- Tilt: the whole scene is rotated about 6.5 degrees counter-clockwise (the mirror line rises to the right), matched by `tilt` 6. A perspective skew (columns narrowing to the right) is not reproduced: canvas 2D transforms are affine only.
- Not copied: the photo, its watermark and its texture.

New Mirror settings (all default to 0 or off, so existing presets draw identically): Section height (px) 0 to 80 (Auto), Tone variation 0 to 0.15, Peak marker 0 to 1, Peak hold 0.1 to 2 s, Afterimage 0 to 1, Afterimage fade 0.1 to 1.5 s, Base row glow 0 to 1, Mirror gap 0 to 12 px, Reflection blur 0 to 1, Tilt -12 to 12 degrees; Colours gains Ice reversed (white at the base), Backdrop gains Black; Bar width up to 80 px. For bars wider than 12 px the minimum bar count is 8 instead of 48, so large blocks stay large on a phone.

### History trail (Ice Blue Mirror 2, owner-named)

Owner decisions BP1 and the one-bar prototype. Each bar column is judged on its own. Display: only the CURRENT SECTOR (the one LED segment at the column's level, row = floor(level x rows), clamped) is drawn at full brightness with a thin white outline, plus a HISTORY TRAIL; no body, no peak marker, no afterimages in this mode (`sectorMode` = trail; the `peak` and `afterimage` settings stay in the schema for other uses).

- Visit count: per column and row a counter. A visit counts +1 only after the sector has stayed on the row continuously for the MINIMUM DWELL (`minDwell`, 60 ms, 0 to 300 ms); rows the sector only passes over during a jump never count; the +1 is applied once when the threshold is first reached (frames count, so 4 frames at 60 fps = 66 ms counts, 3 = 50 ms does not; at 30 fps 2 frames count).
- Leak: every count falls linearly by `loss` per second (default 1.0), floor 0, dt from real elapsed time (capped at 0.1 s, frozen while paused).
- Level: `min(maxLevel, floor(count / visitsPerStep))`, defaults 6 and 5 (steps at 5, 10, 15 visits, ...).
- Trail: rows with count >= 0.5 are drawn with alpha `min(trailMax, 0.15 + 0.7 x level / maxLevel)` and a lift toward white of `min(0.9 x trailMax, level x stepGain)` (`trailMax` 0.8, `stepGain` 0.14). The current sector always draws at alpha 1 and lift 0.9, so it is the brightest element. The reflection mirrors the same drawing at the preset's reflection alpha (0.5), without the outline.
- Memory resets when the bar count, row count or canvas size changes, and on preset change. Cost: one `Float32Array` of columns x rows reused across frames, 600 x 48 stays well under one frame; only rows with count >= 0.5 are drawn, batched per brightness level.
- Settings (group "History trail"): Current sector (off, trail), Minimum dwell (ms), Visits per step, Loss per second, Max level, Trail brightness, Step lightening.

### Ice 2 palette (measured)

From the owner's blue LED equalizer crop (not stored; values only). Median colours of the brightest pixels per height zone and 8-cluster k-means over all lit pixels, ordered tip to base: `--viz-ice2-0` #1b59a6, `-1` #3e749d, `-2` #5593b5, `-3` #61afd3, `-4` #76cce4, `-5` #95e1f0, `-6` #d4f8f8, `-7` #fafcfa (white-cyan base). Background `--viz-ice2-bg` #07080a (median of the dark pixels); dim ghost segments `--viz-ice2-ghost` #102b54 (defined, unused by the trail rule). The gradient option Ice 2 runs the ramp from the base (whitest) to the tip, evenly spaced; the Ice 2 backdrop is the flat `--viz-ice2-bg`. The photo is noisy and perspective-shifted, so the mid steps are the cluster centres rather than exact segment centres.
