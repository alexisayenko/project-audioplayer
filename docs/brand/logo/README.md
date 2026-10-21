# Logo and app icon

Source: a GPT-generated image chosen by Alex in October 2026 (glass plate, black vinyl with a copper rim, cyan label with stripes, on warm ivory).

| File | What it is |
| --- | --- |
| `source-gpt-2026-10.png` | The original image converted from webp (1254 px, opaque). |
| `electrophone-app-icon.png` | App icon master: the plated image, 1024x1024, sRGB, no alpha. Used as `AppIcon.png` in the iOS asset catalog and, scaled to 180 px, as `web/apple-touch-icon.png`. |
| `electrophone-vinyl.png` | Logo master: the vinyl disc only, 1024x1024, transparent, circular alpha mask exactly on the outer edge of the copper rim. |
| `archive/v1-vinyl-2026-10/` | Archive: first icon, black vinyl with cyan label on ivory, used until build 20261026; kept for reference, not used in the app. |

Derived files (regenerate from the masters, never edit by hand):

- iOS: `ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`, `DrawerLogo.imageset/DrawerLogo@2x.png` (84 px) and `@3x.png` (126 px); the drawer shows the logo in a circle at 42 pt.
- Web: `web/favicon-32.png`, `web/favicon.svg` (embeds a 128 px vinyl PNG), `web/apple-touch-icon.png`, `web/img/electrophone-vinyl.png` (192 px, the `mark` icon in `web/js/icons.js`: sidebar brand, login, cover placeholders).

## Usage rules

- App icon = the plated version. In-app and on the web the logo = the vinyl only, never the plate.
- No recolouring, no filters, no extra outline or shadow.
- Minimum size 20 pt.
- Clear space = 1/4 of the disc diameter on every side.
- Do not pre-round the app icon; the system applies the mask.
