# Studio site

The Analyze and Synthesize tools as a public static site at https://studio.electrophone.cc ([ADR-0049](../tech/decisions.md), owner decision GR1, 2026-10-24, [task-0114](../tasks/task-0114.md)). Nothing is built yet: every requirement is planned. The tools themselves are specified in [web.md](web.md) (WEB-150 to WEB-202) and ADR-0048; this file says only what changes by moving them. Modify (the former Track tab) stays in the main app.

## Site and build

- STU-001 MUST: the site is static files (one HTML page, one hashed JS file, one hashed CSS file, the favicons) served by Cloudflare Pages (Direct Upload, project `electrophone-studio`) at `https://studio.electrophone.cc`; no server code, no API call, no sign-in, no cookie, no analytics, no third-party request. Status: planned
- STU-002 MUST: no module is copied. The entry (`studio/main.js`) imports the tool modules from `web/js`; `scripts/build-studio.mjs` bundles them with the esbuild version pinned for `build-web.mjs` and writes `studio/dist/` (git-ignored, deployed from the PC by `scripts/deploy-studio.sh`). Status: planned
- STU-003 MUST: the look comes from the design system only: the stylesheet is `web/tokens.css` (generated from `docs/brand/tokens.json`), `web/style.css`, `web/studio.css` and `studio/site.css` (header and layout, tokens only, no invented colour, size or radius), concatenated in that order; the page follows the system light or dark scheme and sets `<body data-route="studio">`. Status: planned
- STU-004 MUST: `index.html` has `noindex,nofollow`, `viewport-fit=cover`, a title "Electrophone Studio" and the favicons of the main app (copied at build time from `web/`, not committed twice). Status: planned

## Pages and navigation

- STU-005 MUST: a header shows "Electrophone Studio" and a link "Electrophone" to `https://electrophone.cc/` (same tab); below it a tab bar `Analyze | Synthesize` (`role="tablist"`, arrow keys, Home and End as in `studio-tabs.js`). Status: planned
- STU-006 MUST: hash routes `#/analyze` (the default, also for an empty or unknown hash) and `#/synthesize`; Analyze mounts the Live BPM (microphone) card and the "Pitch and harmonics" lab (`mountTools`), Synthesize mounts the "Simple tone" card (`mountSimple`); a tab loads its module on first use and is disposed (audio stopped) when the other tab opens. Status: planned
- STU-007 MUST: at 375 px width there is no horizontal page scroll, the header is one line, the tab bar is full width and every control keeps the tap size of the main app. Status: planned

## Degrade without the main app

- STU-008 MUST: nothing on the site needs the main app at run time; with electrophone.cc down the tools work. Status: planned
- STU-009 MUST: the harmonics lab's Player source (WEB-190) needs the shared audio graph of the main app and the `#audio` element. When `createPlayerInput().available` is false the Player segment is disabled (not hidden, so the choice is explained) and a caption says "Player needs the Electrophone app" with a link to `https://electrophone.cc/`; Synth and Microphone work unchanged and Synth is the initial source. Status: planned
- STU-010 MUST: wording that assumes the player ("The player and this tool can run together", `mic-tool.js` `CAPTION`) is left out on the site; the privacy sentence ("Listens in this browser only. Nothing is recorded or uploaded.") stays. Status: planned
- STU-011 MUST: the Live BPM card on the site takes no library BPM hint; today it takes none either (`setHint` is called only from `live-bpm-ctl.js` for the song card in the main app), and a hint added later is omitted when there is no library. Status: planned
- STU-012 MUST: no module reached from the entry reads `localStorage` or `sessionStorage` or calls `fetch`; a browser without Web Audio or `getUserMedia` shows the existing "cannot analyse" or "not supported" message, never a blank card. Status: planned

## Microphone and headers

- STU-013 MUST: the microphone is requested only after a tap on a start control, on the studio origin (the browser asks again: permission is per origin), and released on stop and on leaving Analyze (the dispose of `mountTools`), as in the main app; a denied permission shows the existing message. `Permissions-Policy: microphone=(self)` allows it; camera, geolocation, payment and USB are denied. Status: planned
- STU-014 MUST: `studio/_headers` sets on every path: a Content-Security-Policy `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`), `X-Robots-Tag: noindex`. No inline script, no inline `style` attribute (CSSOM `el.style` is allowed). Status: planned
- STU-015 MUST: assets are content-hashed and served `Cache-Control: public, max-age=31536000, immutable`; `/` and `index.html` are `no-cache`, so a deploy shows on the next load. The zone's Browser Cache TTL must respect these headers on the studio host (check before the first deploy: the zone value was 4 hours when [deploy.md](../tech/deploy.md#cloudflare-cache-rules) was written). Status: planned

## Main app

- STU-016 MUST: the main app's Studio page keeps Modify; `#/studio/tools` and `#/studio/simple` replace themselves (`location.replace`, a client-side redirect, since the hash never reaches a server) with `https://studio.electrophone.cc/#/analyze` and `#/synthesize`, and the Studio page offers two external links "Analyze" and "Synthesize" (new site, arrow icon) in place of the two moved tabs. The two tools' code leaves the main bundle in the same step. The iOS Tools screen (task-0113) and the Mac app (the Studio links open in the default browser) are unchanged. Status: planned
