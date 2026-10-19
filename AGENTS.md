# AGENTS.md

Mirror of CLAUDE.md — keep identical.

Fast-path context for Claude Code. Full human-oriented docs:
[docs/](docs/). `AGENTS.md` mirrors this file; both are kept in step.

## Key principle

> Songs I pick are on my phone and play reliably, offline, with the screen locked.

Playback and offline reliability beat features. Anything that does not
make downloading, storing or playing a song more dependable (social,
recommendations, a public release) is cut. Accounts are limited to what storage needs:
open signup with per-user storage ([ADR-0012](docs/tech/decisions.md)), anyone with a
verified Google or Apple identity gets their own library within quotas, Alex is the owner
(exempt from quotas; the API token is his, for scripts). Offline playback never depends on sign-in.

## Product

Electrophone: an iOS app (owner: Alex; distributed via TestFlight internal testing only) and a web UI
open to anyone with a Google or Apple sign-in, each user with their own library and storage on
Alex's server (ADR-0012). Search YouTube (or paste a YouTube or SoundCloud track
link), download a song's audio through a private server (iOS only; the web UI saves catalog entries without audio and plays only audio already on the server), keep it in an on-device library, play it with background
audio and lock-screen controls. No monetization. Downloading may violate
YouTube's ToS; the app is not for distribution.
The web UI is publicly viewable read-only without sign-in (the owner's library, with per-IP limits; [ADR-0018](docs/tech/decisions.md)); signed-in users get their own library.

A native macOS app (`ElectrophoneMac`, task-0047, ADR-0029, [spec](docs/specs/macos-gui.md)) shows the web GUI with Library, Playback, Add/Edit, Settings, Playlists (placeholder), Genres map, Song stats, Music theory and a visualizer (Mirrored spectrum, Ring); it streams from the server and downloads no audio to the Mac. Status: builds, not tested with a real account or seen on a real UI; no icon; visualizer tap unverified on the real stream (needs Range support on `/files`).

Songs carry an optional version (remix, cover, mashup, live, ...) with its own credits: [concept](docs/product/concept-songs-versions-and-credits.md), ADR-0024 (deployed) and ADR-0025 (data model v2, planned, task-0043).

Catalog and audio are separate ([ADR-0010](docs/tech/decisions.md), server side done): the catalog (metadata: YouTube and SoundCloud links; in git) lists every song, audio is fetched on demand (state none/server/phone). The web is catalog-only (saves metadata, plays audio already on the server); audio reaches the server only through the iOS download. The Library has a Drafts list (switch "Songs | Drafts N"; [ADR-0032](docs/tech/decisions.md), built, not deployed): the owner and signed-in users paste "Artist - Title" lines and links and keep them per user in `drafts.json` (not in `library.json`; guests get none), then "Add to Library" through the Add dialog. Add and Edit use one shared song form with Title, Artist and Remix token pills on both platforms. Spotify is not used for now. See [concept](docs/product/concept-catalog-and-audio.md).

## Tech stack

`ios/` — SwiftUI app (iOS 17, XcodeGen `project.yml`, AVPlayer; second target `ElectrophoneMac` for macOS 14 in `ios/MacSources/`, sharing `ios/Sources/`; open: no Mac icon, Google client id for Mac, share link, song info and Genres map rework not built; explicit schemes `AudioPlayer` and `ElectrophoneMac`). `server/` —
FastAPI wrapper around `yt-dlp` (Python 3.11+), run on the home server `perkunas` behind a Cloudflare
Tunnel (live at https://electrophone.cc, LXC 106 `tools`, deploy runbook [docs/tech/deploy.md](docs/tech/deploy.md); Tailscale is not used) with Apple/Google sign-in in the apps and the web UI (open signup,
per-user storage; the owner's `X-API-Token` stays server-side for scripts); see [docs/tech/decisions.md](docs/tech/decisions.md). Web UI in `web/`.
Status 2026-10-15: the server and web UI are live at https://electrophone.cc (perkunas LXC `tools`; `scripts/deploy.sh`, `scripts/check.sh`; what shipped: [docs/CHANGELOG.md](docs/CHANGELOG.md)). The iOS app (tabs Library, Playback, Settings, Add as a sheet; shared song form; Electrophone look, task-0005) is on internal
TestFlight (build 20261025); its server flows are not yet tested on a device; check script and server tests pass (server about 99% line coverage, web about 96%, measured manually; module structure: ADR-0017). Web pages: Library, Playback, Playlists (placeholder), Genres map, Song stats, Music theory, Settings; Playback has the visualizer (Mirrored spectrum, Ring, Terrain; [visualizer spec](docs/specs/visualizer.md)) and share links ([share spec](docs/specs/share.md)); "Identify from audio" (AcoustID, Discogs) is implemented but needs `ACOUSTID_API_KEY`, `DISCOGS_TOKEN` and `fpcalc` on the server ([deploy](docs/tech/deploy.md#identification-keys)).

## Design: single source of truth

The look is defined ONLY in the "Electrophone" Design System artifact on claude.ai
([docs/brand/README.md](docs/brand/README.md) has the link and workflow). Its `tokens.json` is
committed at `docs/brand/tokens.json`; `scripts/sync-design-system.py` generates
`ios/Sources/DesignTokens.swift` and `web/tokens.css` from it. Never hand-edit the generated
files or invent a colour, size or radius in code: change the system, re-export, re-run the script.
Screens: the "Electrophone Screens" Design artifact (same README). ADR-0009.

## Working in a shared checkout

Several sessions may work in this one checkout at once:

- Run `git status` first; files already modified or untracked belong
  to other work — never edit, stage or commit them.
- Stage explicit paths only (`git add <file>`), never `git add -A`
  or `git add .`.
- Never `git stash pop` / `apply` blindly — an old, unrelated stash
  may sit in the list.
- Pushing commits to `origin/main` of this repo is pre-approved by the
  owner (2026-10-13); never force-push, never push another repo without
  asking.

## Docs change with code

A change that makes a doc wrong fixes that doc in the same commit.
Task-file updates ship with the work they describe
([docs/tasks/README.md](docs/tasks/README.md)).

## Repo

[alexisayenko/project-audioplayer](https://github.com/alexisayenko/project-audioplayer)
(public — consider making it private).

## Where to look for more

- [README.md](README.md) — repo entry point + structure
- [docs/README.md](docs/README.md) — docs subtree map
- [docs/tech/ci-cd.md](docs/tech/ci-cd.md) — CI/CD playbook
- [docs/tech/architecture.md](docs/tech/architecture.md) — server/app design, setup, TestFlight
