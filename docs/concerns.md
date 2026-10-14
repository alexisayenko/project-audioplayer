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

The iPhone app: three tabs like the web, offline playback, owner-only
sign-in, Electrophone look, internal TestFlight builds. Spans `ios/`, `server/`
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
  - Build numbers must rise on every upload (date-based, last 20261025);
    App Store Connect rejects a repeated or lower one (ADR-0008).
  - TestFlight builds expire after 90 days.
  - Add, edit, download and sign-in flows are not yet tested live on a device.
  - Catalog vs audio (ADR-0010, accepted): a record may have no file, or a stale
    state after a server file is removed; state is derived, never stored.
  - Spotify Web API and terms: client credentials, rate limits, personal use,
    secret only in the server env; no audio from Spotify.
  - ShazamKit (task-0013): needs the App Service enabled on the App ID (manual, Apple Developer portal), the microphone permission and the network; Shazam may not know a song.
  - Apple Music and Shazam facts (keyless Lookup API, ShazamKit limits, history export, SHLibrary) come from memory and are unverified; tasks 0012..0014 start by checking them.
  - Link scraping (SoundHound share links) is fragile; the Houndify platform is commercial with no consumer history export (task-0015, parked).
  - Third-party recognition (AudD, ACRCloud) uploads audio clips and costs money; not recommended.
  - Mismatched YouTube matches (live, remix, lyric video): the owner confirms each.
  - SoundCloud Go+ previews (ADR-0011): yt-dlp may only see the 30 s snippet; the server refuses it (`preview_only`) from the format list, and again after download if the file is under 35 s for a much longer track. The heuristic is unverified against live Go+ tracks.
  - SoundCloud artist vs label: with no `artists` metadata the uploader name is used, which may be a label or a re-uploader; the owner edits it in the preview. Wikipedia/MusicBrainz suggestions run on that name and usually find nothing.
  - SoundCloud downloads are unverified live (yt-dlp extractor changes, client-id rotation, private links) and may violate SoundCloud's terms like the YouTube path.

## C2 — Server, library and web UI

The FastAPI server, the git-backed library, the web UI and their deployment
at `electrophone.cc`.

- Lives in: `server/`, `web/`
- Source spec: [`specs/README.md`](specs/README.md) (API, DATA, TAG, ADD,
  LIB, STO, PLY, NFR), ADR-0001 to ADR-0005
