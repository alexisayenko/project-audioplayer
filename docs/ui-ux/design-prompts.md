# Design prompts

Prompts for an image-capable assistant to produce graphical sketches of the
iOS app. Attach the current Playback screenshot as a starting point; for
prompt A also attach the Vega 108 photo.

## A. Vega 108 turntable (chosen: ADR-0007; results in `vega-108/`)

```
You are a senior iOS product designer. Design graphical sketches (high-fidelity mockups) for "Gramophone Offline", a personal iPhone music player.

Concept: a skeuomorphic homage to the Soviet turntable-receiver "Vega 108 Stereo" (Вега-108-стерео); I attached a photo. Capture its look: glossy walnut/orange-brown wood veneer frame, matte black control panel, chrome ridged knobs with min/max ticks, a row of rectangular piano-style push buttons (one lit cyan-blue), a red power key with a small red LED, small white Cyrillic panel labels (ГРОМКОСТЬ, БАЛАНС, ВХОД, СЕТЬ, ОЧЕРЕДЬ), a black platter with a record, a chrome tonearm with a headshell, smoked-glass dust cover.

Product: one user, plays downloaded songs offline with the screen locked. Playback and offline reliability matter more than features. Portrait iPhone 15/16 Pro, iOS look and proportions (status bar, Dynamic Island, home indicator), thumb-reachable controls, readable text.

Screens to draw (one image each, same iPhone frame):
1. Library: search, sort, tag chips (genre/decade), song rows on black panel, small LED showing the server is reachable, a Phone / Server toggle, "Add all".
2. Add: paste a YouTube link, preview (cover, title, artist, year, BPM, tags), Save button.
3. Playback: rotating record on the platter, tonearm, seek bar, transport as piano buttons, a volume knob, a queue list.
4. Settings: server URL, API token, "Test connection" with a green or red LED.
5. Mini player above the tab bar.
6. App icon 1024x1024: the whole turntable seen from above, readable at small size.

Tab bar: Library, Add, Playback, Settings, styled as the front-panel buttons.

Style rules: warm wood vs. cold black panel contrast, cyan as the only accent, realistic light and shadow but clean flat enough to build in SwiftUI (gradients and vector shapes, no photo textures). English UI text with Cyrillic as small secondary labels.

Output: the six images, then a short palette (hex values), the fonts you used, and notes on which elements are knobs, buttons or LEDs.
```

## B. Open style, best fit for 2026

```
You are a senior iOS product designer with a strong point of view. Design graphical sketches (high-fidelity mockups) for "Gramophone Offline", a personal iPhone music player.

Product: one user (the owner), no social features, no accounts. He searches YouTube, downloads a song's audio through his own private server, keeps it in an on-device library, and plays it offline with the screen locked. The core promise: songs I picked are on my phone and play reliably. Playback and offline reliability beat features. A friendly, personal tool, not a streaming service.

Visual direction: your call. Choose the style that fits this product best in 2026 and commit to it fully. Think about what feels current, distinctive and still timeless in a year (for example: iOS 26 Liquid Glass done tastefully, editorial/typographic, tactile hardware-inspired, brutalist-minimal, warm analog). Do not default to generic dark-mode-with-purple-gradient. Briefly justify the choice in three sentences before showing the screens.

Platform: portrait iPhone 16 Pro proportions, iOS conventions (status bar, Dynamic Island, home indicator, safe areas), thumb-reachable controls, accessible contrast, text that survives Dynamic Type. Light and dark variants of Playback.

Screens (one image each, same device frame):
1. Library: search, sort, tag chips (genre and decade), song rows, a Phone / Server toggle, a small indicator that the server is reachable, "Add all".
2. Add: paste a YouTube link, preview (cover, title, artist, year, BPM, suggested tags), editable fields, Save with download progress.
3. Playback: artwork, title and artist, seek bar, transport, volume, shuffle / repeat, queue list.
4. Song edit: metadata, tags, BPM with "re-detect", Wikipedia links, delete.
5. Settings: server URL, API token, "Test connection" with a clear success or failure state, storage used.
6. Mini player above the tab bar, plus the lock-screen player.
7. App icon, 1024x1024, readable at small sizes.

Tab bar: Library, Add, Playback, Settings.

Constraints: it must be buildable in SwiftUI with vector shapes, gradients and system materials; no photo textures. English UI text.

Output: the seven images, then the palette (hex, light and dark), the typefaces (prefer system or free fonts), spacing and corner-radius scale, and a short list of the signature elements a developer should reproduce.
```
