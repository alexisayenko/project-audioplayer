# Release

Per-release launch material. One release = one checklist task in
[`../tasks/`](../tasks/README.md) (`target: release-N`, where
release 1 is the first public release).

Current state: internal TestFlight only, group "Alex", builds 20261012,
20261013, 20261021, 20261022, 20261023, 20261024, 20261025, 20261026, 20261027 and 20261028 to 20261037 uploaded; see [ADR-0008](../tech/decisions.md) and
[`../tech/architecture.md`](../tech/architecture.md#testflight).
The files below are templates for a public release that is not planned.

## What lives here

- **Launch checklist** — the release's checklist task, linked from
  here: [TODO: link to the release-1 checklist task].
- [`app-store-metadata.md`](app-store-metadata.md) — draft of the
  store listing fields.
- [`legal-draft.md`](legal-draft.md) — drafts of the privacy,
  terms, disclaimer and support pages.

## Rules

- Drafts are not published text; re-verify every answer against
  the build actually submitted.
- Mark unverified claims `TO CONFIRM` until checked.
- Per-release copies: when release 2 needs different answers,
  add `<name>-release-2.md` rather than overwriting history.
