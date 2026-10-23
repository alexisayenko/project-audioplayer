# Tech

Stack, infrastructure, and architectural decisions. The "how it
runs" layer — what's used to build and operate the product.
Product / business / UX live in their own sections.

## Common slots

Don't pre-create — extract on first real entry. See
[Section, file, folder](../README.md#section-file-folder).
([`ci-cd.md`](ci-cd.md) is the one scaffolded file here;
[`architecture.md`](architecture.md) holds the system design.)

- **`stack.md`** — the v1 stack: framework, hosting, storage,
  payments, language, etc., with rationale per pick.
- **`architecture.md`** — system overview, data flow, key
  components.
- **`ci-cd.md`** (scaffolded) — CI/CD playbook: manual workflows, test layers,
  cost model, deploy and mobile release paths, secrets, setup
  checklist, starter workflow files.
- **`metadata-model-design.md`** — design of the structured credits and versions (ADR-0024, task-0036): schema, compatibility projection, migration, API and test plan. Data model v2 (final names, version block, Artist table): ADR-0025 and [task-0043](../tasks/task-0043.md).
- **`ddex-terminology.md`** — which DDEX words Electrophone adopts and which it does not, checked against the official allowed-value file (ADR-0025).
- **`metadata-model-decisions-AR.md`** — decision AR: where the release year may come from.
- **`genre-terminology.md`** — glossary, the genre model (genres, groups, modifiers, four axes), tests and open decisions (ADR-0038, ADR-0034).
- **`microgenre-candidates.md`** — PROPOSAL: criteria, a review table of 53 microgenre candidates and what a `microgenre` flag would do (task-0100, phase 1).
- **`genre-references-library-candidates.md`** — PROPOSAL (nothing saved): owner library songs that could be reference tracks per genre, by role and confidence (task-0093, ADR-0044).
- **`genre-references-goa-trance.md`** — verified goa trance reference-track review: picks by role and era with sources and confidence; supersedes the goa rows of the candidates file (task-0093, ADR-0044).
- **`genre-references-psytrance.md`** — verified psytrance reference-track review (read-only, nothing saved): picks by role with sources and confidence; supersedes the psytrance row of the candidates file (task-0093, ADR-0044).
- **`genre-electronic-forms.md`** — PROPOSAL (not applied): where the 146 Electronic genres go when Electronic becomes a group and the forms move to level 1 (task-0066).
- **`genre-levels.md`**, **`genre-flavours-proposal.md`** — the genre tree (no depth cap since ADR-0037) and the modifiers (formerly flavours; the proposal file keeps its name) (ADR-0023).
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

One environment: the live server at https://electrophone.cc (LXC 106 `tools` on perkunas), deployed by `scripts/deploy.sh`; runbook [`deploy.md`](deploy.md). CI playbook: [`ci-cd.md`](ci-cd.md).

[TODO: one row per further environment or pipeline — how it is deployed,
which workflow, where secrets live. Playbook:
[`ci-cd.md`](ci-cd.md).]

## Known gaps

[TODO: shortcuts taken on purpose and risks accepted, each with
the date and who accepted it.]

## Open questions

- [TODO: architectural decisions still open.]
