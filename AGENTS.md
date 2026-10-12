# AGENTS.md

Mirror of CLAUDE.md — keep identical.

Fast-path context for Claude Code. Full human-oriented docs:
[docs/](docs/). `AGENTS.md` mirrors this file; both are kept in step.

## Key principle

> Songs I pick are on my phone and play reliably, offline, with the screen locked.

Playback and offline reliability beat features. Anything that does not
make downloading, storing or playing a song more dependable (accounts,
social, recommendations, a public release) is cut.

## Product

A personal iOS app, one user (the owner), distributed via TestFlight
internal testing only. Search YouTube, download a song's audio through a
private server, keep it in an on-device library, play it with background
audio and lock-screen controls. No monetization. Downloading may violate
YouTube's ToS; the app is not for distribution.

## Tech stack

`ios/` — SwiftUI app (iOS 17, XcodeGen `project.yml`, AVPlayer). `server/` —
FastAPI wrapper around `yt-dlp` (Python 3.11+), run on an always-on machine with an
`X-API-Token` header (Cloudflare Tunnel planned, Tailscale until then;
see [docs/tech/decisions.md](docs/tech/decisions.md)). Status: scaffold; the iOS app builds for the Simulator but has
not yet run on a device; server tests pass.

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
