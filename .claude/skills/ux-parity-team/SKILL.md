---
name: ux-parity-team
description: Run a team of agents that make one screen consistent with another in nature (not a copy), verified in the live local UI.
---

# UX parity team

Goal: screen B (e.g. Albums) behaves and looks like screen A (e.g. Songs) wherever the interaction is the same; it differs only where the data differs (tracks, linking, Discogs, cover art). The main thread only coordinates; every agent returns a COMPACT report (table or short list, no file dumps). Deploy and commit happen only on Alex's explicit `cpd` / commit request, never by the team.

## Local app

```sh
scripts/dev-local.sh seed     # fresh fixtures: 25 songs, 3 albums (some tracks linked), 1 playlist
scripts/dev-local.sh start    # http://127.0.0.1:${PORT:-8765}, pid file in the data dir
scripts/dev-local.sh cookie   # prints a document.cookie line; run it in each browser tab via javascript_tool, then reload
scripts/dev-local.sh stop
```

- Data lives in `${DEV_LOCAL_DIR:-$HOME/.cache/electrophone-dev}` (WSL home). Credentials are localhost-only test fixtures (owner `test-owner@localhost.test`, token `localtest-token`); never use real credentials, never touch production.
- Never log the cookie value anywhere else. Log in the built-in browser only.
- `AUDIO_WEB_BUNDLE=0`: the server serves `web/` sources directly, so edits show on reload. Port busy: set `PORT=...`.

## Roles

1. Songs analyst and 2. Albums analyst, in parallel, each in its OWN tab of the built-in browser (`mcp__Claude_Browser__*`, tabs_create) against the local app. Per screen: screenshots at 1200 px and 375 px, DOM and computed-style facts (spacing, sizes, fonts, colors, widths), interactions (search, sort, filters, row actions, open info box, keyboard). Write a compact checklist file to the scratchpad; return only its path and a 5-line summary.
3. Diff-and-plan (one agent): diff the two checklists and write a numbered change list. Every item is exactly one of: `same`; `intentionally different (reason)`; `gap` (severity high/medium/low, effort S/M/L, proposed fix).
4. Implementer: applies the gaps. Reuse shared components over copies; reuse the UI and flow where the interaction is the same, differ where the data differs. Never commits, never stages. Other sessions may touch `web/` and `server/`: run `git status` first and edit only what the plan needs.
5. Verifier: re-runs the checklist in the live UI against the plan and reports deltas (still-gap, regressions).

Loop implement -> verify at most 2 rounds.

## Stop criteria

- No `gap` of medium or high severity left, or 2 rounds done.
- Leftovers go back to Alex as lettered decisions (`A.` question, `1.` `2.` options).
- Alex approves the `intentionally different` list once.

## Pitfalls

- Sheet width rule `.sheet .btn { width: 100% }` stretches buttons inside sheets; check any new button placed in a sheet or info box.
- esbuild cache must stay in `~/.cache` (not the repo); the build scripts already set this, do not undo it.
- Network protection can block npm: Node tooling runs through WSL; if an install is blocked, tell Alex instead of working around it.
- Web UI is vanilla `web/` plus the `dist` build; rebuild `dist` only when asked to prepare a deploy.
- `scripts/dev-local.sh seed` wipes the dev data dir; it stops a running dev server first.
