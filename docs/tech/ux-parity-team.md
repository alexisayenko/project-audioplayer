# UX parity team

A repeatable way to make one screen consistent with another "in nature, not a copy": where the interaction is the same (search, sort, filters, row actions, info box, keyboard) the second screen reuses the first one's UI and flow; where the data differs (tracks, linking, Discogs, cover art) it differs on purpose. Agent version: `.claude/skills/ux-parity-team/SKILL.md`.

## When to run

After a new list screen (for example Albums) is built, or when two screens drift apart. Not for new features.

## Roles

1. Songs analyst and 2. Albums analyst run in parallel, each in its own tab of the built-in browser against the local app. Per screen: screenshots at 1200 and 375 px, DOM and computed-style facts, interactions (search, sort, filters, row actions, info box, keyboard). Each writes a compact checklist file.
3. Diff-and-plan agent diffs the two checklists into a numbered list. Each item is `same`, `intentionally different (reason)` or `gap` (severity high/medium/low, effort S/M/L, proposed fix).
4. Implementer applies the gaps, reusing shared components over copies. Never commits.
5. Verifier re-runs the checklist in the live UI against the plan and reports deltas.

Implement -> verify loops at most 2 rounds. The main thread only coordinates; agents return compact reports.

## Stop criteria

- No medium or high `gap` left, or 2 rounds done.
- Leftovers return to Alex as lettered decisions.
- Alex approves the `intentionally different` list once.
- Deploy and commit happen only on Alex's explicit request, never by the team.

## Local app

```sh
scripts/dev-local.sh seed     # 25 songs, 3 albums (some tracks linked), 1 playlist
scripts/dev-local.sh start    # http://127.0.0.1:${PORT:-8765}
scripts/dev-local.sh cookie   # prints a document.cookie line; run it in the browser tab, reload
scripts/dev-local.sh stop
```

Runs from Git Bash or WSL (re-executes itself in WSL; needs the `~/ap2venv` venv). Data is in `${DEV_LOCAL_DIR:-$HOME/.cache/electrophone-dev}`. Everything is a localhost-only test fixture (owner `test-owner@localhost.test`); no git sync, no external lookups, `AUDIO_WEB_BUNDLE=0` so `web/` edits show on reload.

## Pitfalls

- `.sheet .btn { width: 100% }` stretches buttons inside sheets.
- Keep the esbuild cache in `~/.cache`, not in the repo.
- Network protection can block npm; run Node tooling through WSL.
- `seed` wipes the dev data directory.
