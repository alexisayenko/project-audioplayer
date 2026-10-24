# Milestones

Dated project events — launches, releases, public posts, evidence
artifacts. Newest first.

Starts as this flat file. Extracts to `milestones/` (with
`history.md` index + dated deep-dive files + evidence) when
events accumulate enough to warrant their own pages — see
[`README.md#section-file-folder`](README.md#section-file-folder).

## Events

One bullet per event: ISO date, an em dash, what happened in a
sentence or two, and a link to the task or artifact that carries
the detail. Newest first; several events on one date are fine.

- 2026-10-14 — public read-only guest view ADR-0018, audio visualizer, copyright note and no-index, BPM backfill and year-range changes deployed to LXC 106 after SSH access was restored, see [task-0027](tasks/task-0027.md); later visualizer and share-link work (task-0028) is live too.
- 2026-10-14 — domain `electrophone.cc` bought; migration phases 0-3 done (zone active, both hostnames serve the app, Google and Apple sign-in verified); iOS URL, canonical redirect and HSTS open, see [task-0026](tasks/task-0026.md), ADR-0019.
- 2026-10-14 — iOS TestFlight builds 20261020 to 20261034 uploaded.
- 2026-10-13 — server and web UI deployed live at https://play.isayenko.net (perkunas LXC `tools`, ADR-0004).
- 2026-10-13 — ADR-0010 accepted; server side of the catalog (task-0006: audio state, `/catalog`, metadata-only add) built and tested.
- 2026-10-13 — concept "catalog and audio" proposed (ADR-0010): Library lists every
  song, audio is fetched on demand; see
  [concept](product/concept-catalog-and-audio.md), task-0006 to task-0015.
- 2026-10-12 — iOS app uploaded to internal TestFlight (builds 20261012
  and 20261013, record "Gramophone Offline" (now Electrophone), group "Alex"), after the app
  was restyled as the Vega 108 turntable, rebuilt to match the web flow
  and given owner-only Apple and Google sign-in; see
  [task-0001](tasks/task-0001.md), [task-0002](tasks/task-0002.md).
- 2026-10-12 — web UI, server (git-backed library, Wikipedia links, BPM,
  decade tags) and iOS scaffold built; specs and ADRs written;
  deployed to `play.isayenko.net` on 2026-10-13.
