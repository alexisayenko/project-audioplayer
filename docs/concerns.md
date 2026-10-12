# Concerns

Cross-cutting axes the project organizes work around — orthogonal
to sections (`brand/`, `business/`, `tech/`, etc.). Each concern
carries an ID (`C1`, `C2`, …) so it can be referenced
unambiguously in conversation and frontmatter.

A concern captures a real-world unit of work that touches multiple
sections. Two common shapes:

- **Persistent layers** — product capabilities that live on once
  shipped. Example: a *subscription layer* touches business
  (pricing, legal terms), ui-ux (paywall screens), features
  (unlock, restore), and tech (billing integration, entitlement
  storage). Stays in play across the lifetime of the product.
- **Bounded release goals** — coherent bodies of work that close
  on a release event. Example: *first release on App Store*
  touches tech (stack picks, build pipeline), product
  (concepts + features), ui-ux (polish), brand (icons, store
  listing), business (pricing, store metadata). Concern closes
  once shipped; subsequent app-store work goes under a new
  concern (`v2 launch`, etc.).

Both shapes are referenced the same way — task frontmatter
(`concern: C2 - Subscription layer`). Persistent concerns
accumulate tasks indefinitely; bounded concerns close once their
event ships.

Concerns cut across spec sections: a single concern draws on
multiple sections simultaneously. That's why they live at the
top of `docs/`, not inside any one section.

Per-concern roll-ups live alongside as `tasks/C1.md`,
`tasks/C2.md`, …, regenerated when underlying task frontmatter
changes — see [`tasks/README.md`](tasks/README.md).

When a new area of work appears that doesn't fit any existing
concern, add a new `Cn` here first, then start tagging tasks
against it.

---

## C1 — iOS app and TestFlight

The iPhone app: tabs matching the web, offline playback, owner-only
sign-in, Vega 108 look, internal TestFlight builds. Spans `ios/`, `server/`
(OAuth, library endpoints), `docs/ui-ux/`, `docs/release/`.

- Lives in: `ios/`, `server/app/oauth.py`, `docs/ui-ux/`, `docs/specs/ios.md`
- Source spec: [`specs/ios.md`](specs/ios.md), ADR-0006 to ADR-0008 in
  [`tech/decisions.md`](tech/decisions.md)
- Known risks:
  - Server covers are blank offline after a relaunch (memory cache only);
    task-0004.
  - Apple ID tokens cannot refresh silently; after expiry the API token is
    the fallback until the owner signs in again (ADR-0006).
  - A new Google OAuth client may take hours to start working; the consent
    screen is External in Testing with the owner as the only test user.
  - Build numbers must rise on every upload (date-based, last 20261013);
    App Store Connect rejects a repeated or lower one (ADR-0008).
  - TestFlight builds expire after 90 days.
  - Add, edit, download and sign-in flows are not yet tested live on a device.

## C2 — Server, library and web UI

The FastAPI server, the git-backed library, the web UI and their deployment
at `play.isayenko.net`.

- Lives in: `server/`, `web/`
- Source spec: [`specs/README.md`](specs/README.md) (API, DATA, TAG, ADD,
  LIB, STO, PLY, NFR), ADR-0001 to ADR-0005
