# Web UI sign-in

Code: `web/js/settings.js`, `web/js/api.js`, `web/js/app.js`; server side in
[api.md](api.md) (API-020..024) and ADR-0006. Status values reflect code read
on 2026-10-12; none has been tried live with Google or Apple yet.

- WEB-001 MUST: a signed-out visitor (no session, no API token) sees only Settings; Library, Add, Playback and the mini-player are hidden and routed away. Status: implemented
- WEB-002 MUST: Settings offers "Sign in with Google" (Google Identity Services, `accounts.google.com/gsi/client`) and "Sign in with Apple" (Apple JS SDK, popup mode), each shown only when its client id is returned by `GET /auth/config`; the SDK scripts load on Settings only. Status: implemented (not yet tested live)
- WEB-003 MUST: the ID token goes once to `POST /auth/session` and is never stored by the page or put in a URL; afterwards the HttpOnly session cookie authenticates, and audio and cover URLs carry no token. Status: implemented (not yet tested live)
- WEB-004 MUST: when signed in Settings shows the email and a Sign out button (`POST /auth/logout`, clears the in-memory library and stops playback). Status: implemented
- WEB-005 MUST: the API token field stays as a fallback; with a token and no session the old `X-API-Token` and `?token=` behaviour applies. Status: implemented
- WEB-006 MUST: every web request sends `X-Requested-With: audioplayer` (CSRF, API-009). Status: implemented
- WEB-007 MUST: a 401 on a signed-in session returns the UI to the sign-in screen. Status: implemented
- WEB-008 MUST: no service worker or cache stores authenticated data (NFR-041, API-024). Status: implemented
- WEB-009 SHOULD: checks for the URL rules live in `web/js/api.test.mjs` (`node web/js/api.test.mjs`); the sign-in flow itself is manual. Status: implemented
- WEB-010 MUST: the web UI is styled only from `web/tokens.css` (generated, ADR-0009) and `web/style.css`; no hex or rgb literal appears in `web/style.css`, `web/js` or `index.html`. Day and night follow `prefers-color-scheme`. Status: implemented
- WEB-011 MUST: Library offers four category chips (Tags, Genres, Years, Countries; plain, `genre:`, `decade:`, `country:`; other keys such as `lang:` fold into Tags) that open a filter sheet with multi-select values and counts, Clear, and a "Show N songs" button; values in one category are OR, categories are AND; Escape or the scrim closes without applying. Status: implemented
- WEB-012 MUST: navigation is a rail (>= 720px), icon rail (480-719px) or floating tab bar (< 480px); the layout works from 360px up; every control has a visible focus ring, a 44px target (chips 36px) and an accessible name. Status: implemented
- WEB-013 SHOULD: every text/ground pair holds 4.5:1 in both themes (see the style guide for the deviations from the system's own pairs). Status: implemented (checked by computation, not by an automated test)
