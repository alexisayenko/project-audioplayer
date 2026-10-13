# Specs

What the product MUST do, derived from the code (`server/app/`, `web/js/`, `ios/Sources/`)
and checked against [`../product/screens.md`](../product/screens.md),
[`../tech/decisions.md`](../tech/decisions.md) and
[`../tech/architecture.md`](../tech/architecture.md).

## Specs vs ADRs

- **ADRs** ([`../tech/decisions.md`](../tech/decisions.md)) say **why**
  a choice was made and what it replaced.
- **Specs** (this folder) say **what** the system does, as testable
  requirements. When a spec and an ADR disagree, fix the one that is
  wrong in the same commit; the code is the tiebreaker.

## Conventions

Each requirement is one line:

`ID MUST|SHOULD: statement. Status: implemented | planned | to-confirm`

- IDs are `<AREA>-<NNN>`, stable, never reused. Areas: `DATA`, `API`,
  `TAG`, `ADD`, `LIB`, `STO`, `PLY`, `IOS`, `WEB`, `NFR`, `CAT`.
- **MUST** is mandatory; **SHOULD** is desirable and may be waived with a reason.
- **implemented**: verified in code on 2026-10-13. **planned**: decided, not
  built. **to-confirm**: behaviour exists or is proposed but nobody has
  decided it is intended.

## Index

| File | Area | Content |
| --- | --- | --- |
| [data-model.md](data-model.md) | DATA | Song record, `library.json`, validation, migration |
| [api.md](api.md) | API | Every HTTP endpoint, auth, errors |
| [tags.md](tags.md) | TAG | Tag semantics, normalisation, genre and Wikipedia/Wikidata suggestions, filter grouping |
| [add-song.md](add-song.md) | ADD | URL and paste cleaning, preview, Wikipedia links, save, download, BPM, duplicates, errors |
| [library.md](library.md) | LIB | Library screen and song card |
| [storage-and-sync.md](storage-and-sync.md) | STO | Git store, audio location, write path, sync states, env vars |
| [playback.md](playback.md) | PLY | Playback screen, play queue, persistence, mini-player, Media Session |
| [catalog.md](catalog.md) | CAT | Planned: catalog vs audio, audio state, Spotify metadata, Get audio with YouTube match (ADR-0010) |
| [ios.md](ios.md) | IOS | iOS app: tabs, Settings and sign-in, Add, Library Phone/Server, offline playback, look, build number |
| [web.md](web.md) | WEB | Web UI sign-in with Google and Apple, session cookie, signed-out screen |
| [non-functional.md](non-functional.md) | NFR | Auth, hosting, scale, browsers, offline, CPU |
