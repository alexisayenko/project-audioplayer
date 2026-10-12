# Tech

Stack, infrastructure, and architectural decisions. The "how it
runs" layer — what's used to build and operate the product.
Product / business / UX live in their own sections.

## Common slots

Don't pre-create — extract on first real entry. See
[Section, file, folder](../README.md#section-file-folder).
([`ci-cd.md`](ci-cd.md) is the one scaffolded file here.)

- **`stack.md`** — the v1 stack: framework, hosting, storage,
  payments, language, etc., with rationale per pick.
- **`architecture.md`** — system overview, data flow, key
  components.
- **`ci-cd.md`** (scaffolded) — CI/CD playbook: manual workflows, test layers,
  cost model, deploy and mobile release paths, secrets, setup
  checklist, starter workflow files.
- **`decisions.md`** (or **`decisions/adr-NNNN-<slug>.md`** once a
  decision warrants its own file) — ADRs. Substantive
  architectural decisions with date, alternatives considered,
  rationale. Don't delete superseded decisions — strikethrough
  and add the new one underneath.
  - Open each ADR with a status line: `Status: Proposed | Accepted
    | Superseded by ADR-NNNN · YYYY-MM-DD` and the task it serves.
  - Record a later change as a dated **Amendment** section in the
    same file; don't rewrite the decision in place, so the trail
    stays readable.
  - The tech and UI/UX decision logs
    ([`../ui-ux/README.md`](../ui-ux/README.md)) are numbered
    separately.

## Deploy and CI

[TODO: one row per environment or pipeline — how it is deployed,
which workflow, where secrets live. Playbook:
[`ci-cd.md`](ci-cd.md).]

## Known gaps

[TODO: shortcuts taken on purpose and risks accepted, each with
the date and who accepted it.]

## Open questions

- [TODO: architectural decisions still open.]
