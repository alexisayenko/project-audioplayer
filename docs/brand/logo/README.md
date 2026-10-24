# Logo and app icon

Source: a GPT-generated image chosen by Alex in October 2026 (glass plate, black vinyl with a copper rim, cyan label with stripes, on warm ivory).

| File | What it is |
| --- | --- |
| `source-gpt-2026-10.png` | The first original image converted from webp (1254 px, opaque). |
| `source-gpt-2026-10b.png` | The second original image (1254 px, opaque): glass rounded-square plate with the vinyl, on cream; source of the current app icon. |
| `electrophone-app-icon.png` | App icon master: full-bleed liquid-glass plate with the vinyl, 1024x1024, sRGB, no alpha. Cropped just inside the plate outline of `source-gpt-2026-10b.png` (no ivory background, outline or shadow; the extreme corners filled from the plate edge). Used as `AppIcon.png` in the iOS asset catalog and, scaled to 180 px, as `web/apple-touch-icon.png`. |
| `electrophone-vinyl.png` | Logo master: the vinyl disc only, 1024x1024, transparent, circular alpha mask exactly on the outer edge of the copper rim. |
| `electrophone-vega108-lockup.png` | Drawer lockup master: transparent 2169x725 RGBA artwork with “Electrophone” above the right-aligned “Vega 108”; approved black and deep-teal colors are preserved. The Electrophone wordmark is 1.3x taller than the prior lockup, while Vega 108 is scaled to 77% in both dimensions. |
| `archive/v1-vinyl-2026-10/` | Archive: first icon, black vinyl with cyan label on ivory, used until build 20261026; kept for reference, not used in the app. |
| `archive/v2-plated-2026-10/` | Archive: second icon, the glass plate as a small rounded square floating on ivory; replaced by the full-bleed version; kept for reference, not used in the app. |

Derived files (regenerate from the masters, never edit by hand):

- iOS: `ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`, `DrawerLogo.imageset/DrawerLogo@2x.png` (84 px) and `@3x.png` (126 px); the drawer shows the logo in a circle at 42 pt; `VinylRecord.imageset/electrophone-vinyl.png` is an unchanged copy of the transparent 1024 px master retained from the first missing-cover placeholder iteration.
- The drawer lockup master is copied unchanged to `ios/Sources/Assets.xcassets/ElectrophoneVega108Lockup.imageset/electrophone-vega108-lockup.png` and displayed to the right of the circular vinyl mark, trailing-aligned and aspect-fit. Electrophone is emphasized over the smaller Vega 108 line. It replaces the earlier standalone Vega 108 wordmark; that supplied image remains unused in the asset catalog.
- Web: `web/favicon-32.png`, `web/favicon.svg` (embeds a 128 px vinyl PNG), `web/apple-touch-icon.png`, `web/img/electrophone-vinyl.png` (192 px, the `mark` icon in `web/js/icons.js`: sidebar brand and login), `web/img/electrophone-lockup.png` (396x132, 23 KB, the lockup master scaled for the web sidebar; regenerate from the master).

## Usage rules

- App icon = the full-bleed liquid-glass plate with the vinyl. In-app and on the web the logo = the vinyl only, never the plate.
- No recolouring, no filters, no extra outline or shadow.
- Minimum size 20 pt.
- Clear space = 1/4 of the disc diameter on every side.
- Do not pre-round the app icon; the system applies the mask.

## Possible later upgrade

A native iOS 26 Liquid Glass layered `.icon` (Icon Composer: glass plate and vinyl as separate layers) is a possible later upgrade; the flat 1024 master above is what ships now.

## Missing-cover thumbnail artwork

Missing-cover artwork is separate from the brand logo and app icon: `ios/Sources/Assets.xcassets/ThumbnailRecord.imageset/thumbnail-record.png` and `web/img/thumbnail-record.png` use the same generated transparent circular disc (iOS 1254x1254; the web copy is the same artwork scaled to 192x192 and palette-reduced to about 4.3 KB because the web shows it at most about 180 px wide). On 2026-10-22, Alex requested the minimal style of his supplied black vinyl / copper rim / striped cyan label reference without its rounded rectangular plate. The built-in image generation tool produced the isolated disc; actual song covers, the brand masters, login mark and Vega 108 wordmark are unchanged.

Generation prompt: keep the black circular disc, narrow copper-orange rim, cyan label with diagonal teal stripes and cream spindle hole; remove the whole rectangular tile/background, shadows, texture and grooves; use a clean circular edge and true transparent exterior for a minimal thumbnail.
