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

Proposed ([ADR-0010](docs/tech/decisions.md)): the catalog (metadata: YouTube, SoundCloud, Spotify links; in git) is separate from audio (fetched on demand, state none/server/phone). Library lists the whole catalog; downloaded songs still play offline without the server. See [concept](docs/product/concept-catalog-and-audio.md).

## Tech stack

`ios/` — SwiftUI app (iOS 17, XcodeGen `project.yml`, AVPlayer). `server/` —
FastAPI wrapper around `yt-dlp` (Python 3.11+), run on the home server `perkunas` behind a Cloudflare
Tunnel (live at https://play.isayenko.net, LXC 106 `tools`, deploy in [architecture.md](docs/tech/architecture.md#deploy); Tailscale is not used) with Apple/Google sign-in only in the apps (open signup,
per-user storage; the owner's `X-API-Token` stays server-side for scripts); see [docs/tech/decisions.md](docs/tech/decisions.md). Web UI in `web/`.
Status: the iOS app (tabs Library, Playback, Settings, Add as a sheet that opens the edit form after Fetch; Electrophone look, task-0005) is on internal
TestFlight; its server flows are not yet tested on a device; server tests pass.

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

## Docs change with code

A change that makes a doc wrong fixes that doc in the same commit.
Task-file updates ship with the work they describe
([docs/tasks/README.md](docs/tasks/README.md)).

## Repo

[alexisayenko/project-audioplayer2](https://github.com/alexisayenko/project-audioplayer2)
(public — consider making it private).

## Where to look for more

- [README.md](README.md) — repo entry point + structure
- [docs/README.md](docs/README.md) — docs subtree map
- [docs/tech/ci-cd.md](docs/tech/ci-cd.md) — CI/CD playbook
- [docs/tech/architecture.md](docs/tech/architecture.md) — server/app design, setup, TestFlight
