# SonarCloud baseline (2026-10-24)

Read-only baseline taken before the refactoring and architecture pass, so the refactor targets real findings. No code was changed, no tests were run.

## How it was taken

- Setup: SonarCloud, organisation `alexisayenko`, project `alexisayenko_project-audioplayer` (public). **Automatic Analysis** runs on every push to `main`; there is no `sonar-project.properties`, no CI workflow, no scanner in the repo ([ci-cd.md](ci-cd.md#this-project-audioplayer)). 150 analyses so far.
- Snapshot: analysis of 2026-10-24 09:05 UTC, revision `c61777b` = `origin/main` HEAD at the time. Read from the public SonarCloud web API (`/api/measures`, `/api/issues/search`, `/api/hotspots/search`, `/api/duplications`), anonymous.
- No new scan was started: a scanner run would clash with Automatic Analysis, and the stored `SONAR_TOKEN` (`~/.config/sonar/token.env`) is rejected by `/api/authentication/validate` (`valid: false`, expired or revoked). A new token is the owner's step (sonarcloud.io, My Account, Security). Public reads do not need it; writes (marking issues won't-fix) do.
- Coverage: none imported (Automatic Analysis cannot read coverage reports). The "server about 99%, web about 96%" figures in the docs are manual measurements and are not in Sonar.
- Scope caveat: Automatic Analysis uses default scope. `server/tests`, `*.test.mjs`, and the big `server/data/*.json` files are counted as source; `web/dist/*.js` (generated bundle) is not (only `web/dist/manifest.json` shows up). This inflates lines of code and the issue count.

## Scope (owner decision FH1, 2026-10-24, step 1)

The numbers in this document are the "before" values, taken with Sonar's default scope. Step 1 narrows the scope to real source code and fixes the new-code period; the bugs (step 2) and the hotspot refactors (step 3) follow.

- **File.** [`.sonarcloud.properties`](../../.sonarcloud.properties) in the repo root. Automatic Analysis does **not** read `sonar-project.properties` (SonarCloud docs, "Automatic analysis": it ignores that file); it reads only `.sonarcloud.properties` from the default branch. The file honours `sonar.sources`, `sonar.exclusions`, `sonar.inclusions`, `sonar.tests`, `sonar.test.exclusions`, `sonar.test.inclusions`, `sonar.sourceEncoding`, `sonar.cpd.exclusions`, `sonar.python.version`; where the UI and the file differ, the file wins. `sonar.organization` and `sonar.projectKey` are not needed (the project is already bound), `sonar.coverage.exclusions` has no effect (Automatic Analysis imports no coverage). If a CI scan is ever added, a real `sonar-project.properties` is needed then ([ci-cd.md](ci-cd.md)), and Automatic Analysis must be turned off first.
- **Sources:** `server/app`, `web`, `scripts`, `ios/Sources`, `ios/MacSources`. **Tests:** `server/tests`, `ios/Tests`, and every `*.test.mjs` (in `web/js` and `scripts`, matched by `sonar.test.inclusions`).
- **Excluded:** all `*.json` (`server/data` 38k lines, fixtures, `web/data`, `server/app/data`), `web/dist`, `web/img`, the generated `web/tokens.css` and `ios/Sources/DesignTokens.swift`, `server/backups-*`, `docs`, `node_modules`. No `sonar.cpd.exclusions`: the excluded paths are already out of duplication, and the mirrored Swift and JS pairs are only 0.7% of the code, below the gate limit, so they are left visible.
- **Expected effect (to check after the first analysis):** ncloc falls from 159,482 to roughly 60k (JSON about 41k and test code about 40k leave the main code); the JSON smells and issues disappear; the 344 `python:S9073` composite-assertion smells and other issues in test files move to the test scope, where Sonar may still list them as issues (test code is analysed with a smaller rule set) but they do not count as lines of code, duplication or coverage; the bugs (27) and vulnerabilities (13) are unchanged because they sit in real source.
- **Not settable from the repo:** the gate stays ERROR until the new-code period is set in the UI (below). Whether wildcards work in `sonar.exclusions` of `.sonarcloud.properties` is documented ambiguously ("Wildcard patterns are not allowed", yet wildcards are allowed in `sonar.exclusions` but not in `sonar.sources`); the result of the first analysis is recorded in the changelog, and if the exclusions are ignored, the same patterns go into the UI (Administration, Analysis Scope).

### Owner steps in the SonarCloud UI

No token is available (the stored one is expired), so these are manual. All under the project `alexisayenko_project-audioplayer` at sonarcloud.io.

1. **New Code period.** Administration > New Code. Choose "Specific analysis" and pick the 2026-10-24 baseline analysis of `c61777b`, so the existing debt is not new code. If the list is awkward, "Number of days" with 30 is the fallback ("Reference branch" does not apply with one branch; "Previous version" stays unset because the project has no version). After this, `new_reliability_rating` and `new_security_rating` rate only code written after the baseline, and the gate can go green.
2. **Quality gate.** Administration > Quality Gate: keep "Sonar way" (the default), no change.
3. **Scope fallback (only if needed).** Administration > Analysis Scope: paste the exclusions from `.sonarcloud.properties` there if the first analysis ignored the file.
4. **False positives.** For each issue judged not real, open it > Resolve as "False positive" or "Won't fix" with a comment. The candidates are listed in the section "Vulnerability review 2026-10-24" of this document, or in `docs/tech/sonar-vulnerability-review.md`, whichever exists on `main` (the CLI scripts reading `sys.argv`: `pythonsecurity:S8705` and `S8707`; the non-security `random` in `web/js/play-recorder.js`; `PATH` in `scripts/build-web.mjs`). Marking issues needs a logged-in account with project administration; no token is required for that.
5. **Token (optional).** My Account > Security > Generate Tokens, only if scripted writes or a CI scan is wanted; store it in `~/.config/sonar/token.env`, `chmod 600`. Not needed for this scope change.

## Headline

| Item | Value |
|---|---|
| Quality gate | **ERROR**: `new_reliability_rating` E (needs A), `new_security_rating` E (needs A); duplication 0.7% (limit 3), hotspots reviewed 100%, new maintainability A pass |
| New-code period | "previous version", never set (`projectVersion: not provided`), so the whole project counts as new code and the gate cannot go green until the bugs and vulnerabilities below are fixed or resolved |
| Bugs | 27 (2 blocker, 4 critical, 20 major, 1 minor); effort 182 min |
| Vulnerabilities | 13 (3 blocker, 9 major, 1 minor); effort 355 min |
| Security hotspots | 0 to review |
| Code smells | 754: 1 blocker, 103 critical, 539 major, 111 minor; debt 5083 min (about 85 h) |
| Ratings | reliability E, security E, maintainability A, security review A |
| Duplication | 0.7% (1276 lines, 80 blocks); no block over 100 lines (largest 40) |
| Coverage | not available |
| Size | 886 files, 159,482 ncloc, 17,055 functions, 515 classes, cognitive complexity 22,373, cyclomatic 37,524 |

Trend (open issues, from analysis history): 244 on 10-13, 595 on 10-17, 48 on 10-19, 303 on 10-20, 794 on 10-24. The jump follows new code (genre work) and new rules (`python:S9073`); ncloc grew from 10k to 159k, mostly JSON data and tests entering scope.
## Lines of code per language

| Language | ncloc | Note |
|---|---|---|
| JavaScript | 63,359 | `web/js` 62,325 incl. `*.test.mjs` |
| JSON | 40,832 | `server/data` 38,389 (data, not code) |
| Python | 35,054 | `server/tests` 19,433, `server/app` 14,969, scripts |
| Swift | 17,088 | `ios/Sources`, `ios/MacSources` |
| CSS | 2,434 | `web/style.css` 1,053 |
| HTML / shell / YAML | 335 / 235 / 145 | |

## Issues by area

| Area | Issues | Main cause |
|---|---|---|
| `server/tests` | 349 | `python:S9073` split composite assertions (344 in total, nearly all tests) |
| `web/js` | 232 | nested ternaries, cognitive complexity, unhandled promises, regex backtracking |
| `server/app` | 64 | cognitive complexity, path-traversal flow findings |
| `scripts` | 52+14 | `genre-ops.py`, `genre-hierarchy-lib.mjs` |
| `ios/Sources` + `MacSources` | 62 | nested ternary, empty closures, hardcoded URIs |
| `web` (css, html) | 21 | duplicate selectors (`css:S4666` 13), accessibility (`Web:S6819`) |

## Dominant rule families (code smells)

| Count | Rule | What |
|---|---|---|
| 344 | python:S9073 | composite assertions should be split (tests) |
| 41 + 13 | javascript:S3358, swift:S3358 | nested ternaries |
| 38 + 37 | javascript:S3776, python:S3776 | cognitive complexity over 15 |
| 20 | javascript:S9382 | promises awaited sequentially in a loop |
| 19 | javascript:S2681 | multiline blocks without braces |
| 19 | javascript:S8786 | regex with non-linear backtracking |
| 15 | javascript:S6582 | prefer optional chaining |
| 14 | javascript:S9383 | promise left unhandled (also the main bug rule) |
| 13 | css:S4666 | duplicate selectors |
| 11 / 11 / 10 | swift:S1186 / S1075 / S1172 | empty closures, hardcoded URIs, unused parameters |
| 10 | javascript:S4624 | nested template literals |

Worst cognitive complexity per function (limit 15): `scripts/genre-ops.py:135` 49, `scripts/build-genre-sources.mjs:151` 47, `web/js/genre-crossing-anneal.js:79` 38, `scripts/genre-ops.py:194` 38, `web/js/genre-sim.js:56` 35, `web/js/genre-force-view.js:751` 34, `server/app/genre_vocab.py:349` 34, `scripts/genre-hierarchy-lib.mjs:145` 34, `server/app/genre_eras.py:79` 33, `server/app/migrate_removals.py:83` 32, `server/app/genre_vocab.py:504` and `:101` 32.

## Vulnerabilities (13)

| File:line | Rule | Description |
|---|---|---|
| `server/app/downloads.py:106` | pythonsecurity:S2083 (blocker) | path traversal via HTTP request in `_fetch_cover()` |
| `server/app/jsonio.py:51` | pythonsecurity:S2083 (blocker) | path traversal via HTTP request in `write_bytes_atomic()` |
| `server/app/features.py:309` | pythonsecurity:S2083 (blocker) | path traversal via file content in `record_deploy()` |
| `server/app/extractor.py:365` | pythonsecurity:S7044 | API traversal via HTTP request in `fetch_cover()` |
| `server/app/features.py:43` | pythonsecurity:S6350, S8705 | command argument injection (file content, LLM-supplied args) in `git()` |
| `server/app/features.py:248` | pythonsecurity:S8707 | path traversal via CLI args in `load_json()` |
| `scripts/genre-ops.py:41` | pythonsecurity:S8705 | command argument injection via CLI args |
| `scripts/genre-ops.py:244`, `:247` | pythonsecurity:S8707 | path traversal via CLI args |
| `scripts/gen-features.py:25` | pythonsecurity:S8707 | path traversal via CLI args |
| `web/js/play-recorder.js:22` | javascript:S2245 | pseudorandom generator; check it is not security-relevant |
| `scripts/build-web.mjs:45` | javascript:S4036 (minor) | `PATH` may contain writable directories |

Earlier `pythonsecurity:S2083` findings were fixed on 2026-10-13/14 ([ci-cd.md](ci-cd.md)); these are new flows. The `S8705`/`S8707` "LLM-supplied CLI arguments" findings are CLI scripts reading `sys.argv` (owner-only tools), likely resolvable as won't-fix after review.

## Bugs (27)

| File:line | Rule | Description |
|---|---|---|
| `web/js/drafts-model.js:24`, `:25` | javascript:S2189 (blocker) | `start` and `end` never modified in the loop (possible infinite loop) |
| `web/js/genre-force-view.js:285` | javascript:S930 (critical) | function called with an argument it does not take |
| `web/js/genre-map-graph.js:43`, `genre-radial.js:97`, `genre-tree-facts.mjs:4` | javascript:S2871 (critical) | `sort()` without a compare function |
| `web/js/player.js:261`, `:358` | javascript:S6544 | Promise used as a boolean condition |
| `web/js/player.js:261`, `:361`, `:721`, `:722` | javascript:S9383 | promise not awaited or caught |
| `web/js/play-recorder.js:117`, `:163`, `:168`, `:175`, `:188`, `:204`, `:206` | javascript:S9383 | promise not awaited or caught |
| `web/js/gapless-loop.js:13`, `media-retry.js:73`, `peaks.js:117` | javascript:S9383 | promise not awaited or caught |
| `web/js/playlist-add.js:92`, `library-data.js:101` | javascript:S7727 | function passed directly to `.map` or `.filter` |
| `server/app/loops.py:16` | python:S1764 | identical sub-expressions on both sides of `==` |
| `scripts/genre-hierarchy-lib.mjs:47` | javascript:S6324 | control character in a regex |
| `web/js/genre-data.js:105` | javascript:S4158 | `HIDDEN_FAMILY_NODES` can only be empty there |

## Top 15 files

By cognitive complexity (cog), with size (ncloc) and open issues (iss):

| File | ncloc | cog | iss |
|---|---|---|---|
| `web/js/genre-force-view.js` | 1085 | 758 | 26 |
| `web/js/genres-rework.js` | 883 | 567 | 18 |
| `server/app/wiki_lookup.py` | 784 | 387 | 2 |
| `web/js/genre-graph.js` | 535 | 328 | 0 |
| `web/js/viz-bars-baseline.test.mjs` | 577 | 326 | 0 |
| `server/app/genre_vocab.py` | 564 | 324 | 10 |
| `web/js/viz-terrain-math.js` | 999 | 321 | 0 |
| `server/app/genre_graph.py` | 512 | 264 | 1 |
| `web/js/viz-terrain-gl.js` | 1044 | 253 | 0 |
| `server/app/gitstore.py` | 771 | 249 | 0 |
| `web/js/viz-bars.js` | 710 | 247 | 0 |
| `web/js/viz-canvas.js` | 548 | 246 | 0 |
| `web/js/genre-levels.js` | 398 | 240 | 3 |
| `web/js/genre-data.js` | 440 | 216 | 2 |
| `web/js/player.js` | 713 | 207 | 7 |

By issue count: `server/tests/test_genre_levels.py` 65, `test_genre_others.py` 45, `test_anon.py` 33, `web/js/genre-force-view.js` 26, `scripts/genre-hierarchy-lib.mjs` 20, `web/js/genres-rework.js` 18. Largest non-data files: `web/style.css` 1053, `ios/Sources/Components.swift` 753.

## Duplication

0.7%, no block over 100 lines. Largest blocks (lines): `ios/Sources/Components.swift` against `ios/MacSources/LibComponents.swift` 40 and 26, against `LibTagFields.swift` 20 and 21; three regex tests `credit-title-regex.test.mjs`, `credits-split-regex.test.mjs`, `song-form-credits-regex.test.mjs` 64 each (merged into `credits-regex.test.mjs` on 2026-10-26, so this duplicate is gone); `viz-mirror-panel.js` and `viz-synth-panel.js` 49; `metafill.py` and `backfill.py` 36; `build-genre-sources.mjs` and `build-genre-hierarchy.mjs` 32.

## Refactor and architecture candidates (a list, not changes)

1. Scope first (done in step 1, see [Scope](#scope-owner-decision-fh1-2026-10-24-step-1)): a committed `.sonarcloud.properties` (excludes data, generated files and docs; marks tests as tests); the new-code baseline is the owner's UI step.
2. Fix the 27 bugs and 13 vulnerabilities (small, concrete); this alone turns reliability and security from E to the target and clears the gate. Most bugs are unhandled promises in `player.js` and `play-recorder.js`.
3. Path handling: one validated-path helper (resolve inside a base directory) used by `downloads.py`, `jsonio.py`, `extractor.py`, `features.py` and the scripts, to retire the traversal family at the source.
4. Genre map code: `genre-force-view.js` (758) and `genres-rework.js` (567) carry about a third of the web cognitive complexity; split into layout, simulation and rendering modules (done for the two web files, see [Refactor results](#refactor-results-2026-10-24)); same for `genre_vocab.py`, `genre-ops.py`, `build-genre-sources.mjs`.
5. `wiki_lookup.py`, `gitstore.py`, `genre_graph.py`: split by responsibility (fetch, parse, rank / commit, push, read).
6. Visualizer modules (`viz-terrain-*`, `viz-bars`, `viz-canvas`): long functions with zero open issues; refactor only if they are touched.
7. Mechanical sweeps: split composite assertions in tests (344), flatten nested ternaries (54), add braces (19), linearise regexes (19), optional chaining (15), duplicate CSS selectors (13).
8. Shared UI code between iOS and macOS (`Components.swift` vs `LibComponents.swift`/`LibTagFields.swift`), the two panel files `viz-mirror-panel.js`/`viz-synth-panel.js`, `metafill.py`/`backfill.py`, and the two genre build scripts.
9. `web/style.css` (1053 lines) after the one-stylesheet change: check for dead rules and duplicate selectors.

## Vulnerability review 2026-10-24

Owner decision FG1. Each of the 13 open vulnerabilities was checked against the code and Sonar's taint flow (`/api/issues/search?...&additionalFields=_all`). Result: 4 findings were real enough to fix (the other 9 are false positives, documented below); Sonar does not recognise the existing validation (strict id regexes, fixed paths, owner-only CLIs) as a sanitiser, so the flow findings stay open until they are resolved in the SonarCloud UI. No tests were run or written; each fix was exercised by hand against a local server with a throwaway data directory and token.

| # | File:line | Rule | Verdict | Reason | Fix / action |
|---|---|---|---|---|---|
| 1 | `scripts/build-web.mjs:45` | javascript:S4036 | TRUE (low) | `npm` was resolved through `PATH` in a build script that downloads and runs code | fixed in `a0927dd`: `process.execPath` runs `npm-cli.js` found next to node or in the standard install folders (verified with a fresh temp directory: esbuild installed and the bundle built) |
| 2 | `server/app/downloads.py:106` | pythonsecurity:S2083 | FALSE POSITIVE | `vid` comes from a route that calls `deps.valid_id` (`[A-Za-z0-9_-]{11}`, `soundcloud-<digits>` or a catalog id of letters, digits, `_` and `-`; the source flagged is `DELETE /songs/{id}/cover`, which does) or from `resolve_link` (a parsed YouTube id or a server-built SoundCloud id); `uid` is issued by the server, so `covers/<vid>.jpg` cannot leave the user's folder (in a local run an id of `..` answers 422 and an encoded `../x` matches no route) | false positive: mark in UI |
| 3 | `web/js/play-recorder.js:22` | javascript:S2245 | TRUE (low) | the value is only the idempotency key of a `POST /plays` batch, not a secret, but the fallback for contexts without `crypto.randomUUID` used `Math.random` | fixed in `24f1b39` (bundle `50dcba2`): `crypto.getRandomValues` (available in every context) |
| 4 | `scripts/genre-ops.py:41` | pythonsecurity:S8705 | FALSE POSITIVE | CLI run by the owner in a local checkout; `--base` is his own argument, passed to `git` as a list (no shell); the "HTTP request" source in the flow is Sonar's model of `argparse` | false positive: mark in UI |
| 5 | `scripts/genre-ops.py:244` | pythonsecurity:S8707 | FALSE POSITIVE | `--base-dir` is typed by the owner in a local CLI | false positive: mark in UI |
| 6 | `scripts/genre-ops.py:247` | pythonsecurity:S8707 | FALSE POSITIVE | `--out` is typed by the owner in a local CLI | false positive: mark in UI |
| 7 | `scripts/gen-features.py:25` | pythonsecurity:S8707 | FALSE POSITIVE | `--out` is typed by the owner in a local CLI | false positive: mark in UI |
| 8 | `server/app/features.py:43` | pythonsecurity:S6350 | TRUE (hardening) | the `hash` values of `_state/deploys.json` (a file in the data repo) went to `git log` unchecked; a value such as `--output=<file>` made git write that file (reproduced with the old code) | fixed in `f35bb82`: entries need a 7 to 40 hex hash and a `YYYY-MM-DD` date, and `read_log` refuses anything but `HEAD`, a hash or a hash range |
| 9 | `server/app/features.py:43` | pythonsecurity:S8705 | TRUE (hardening) | same `git()` sink, same values | fixed in `f35bb82` (same change as 8) |
| 10 | `server/app/features.py:248` | pythonsecurity:S8707 | FALSE POSITIVE | `load_json` only gets constant paths on the server (`state_path()`, `<checkout>/docs/releases-map.json`); the `--deploys` argument of `gen-features.py` is the owner's CLI | false positive: mark in UI |
| 11 | `server/app/features.py:309` | pythonsecurity:S2083 | FALSE POSITIVE | the written path is `state_path()` (data root plus a constant); the file content only becomes the JSON body, never the path | false positive: mark in UI |
| 12 | `server/app/jsonio.py:51` | pythonsecurity:S2083 | FALSE POSITIVE | generic writer; its callers build `path` from validated ids and server-issued uids (see 2), and `_target()` already rejects NUL bytes, resolves symlinks and refuses directories | false positive: mark in UI |
| 13 | `server/app/extractor.py:365` | pythonsecurity:S7044 | FALSE POSITIVE for exploitability, hardened anyway | the URL was already `https://i.ytimg.com/vi/<id>/hqdefault.jpg` with a validated id, or SoundCloud artwork that passed an `https` plus `sndcdn.com` host check; no user-chosen host reached `urlopen` | hardened in `088e160`: `_is_cover_address` re-checks the final address (https, port 443, no credentials, exact ytimg path with an 11-character id or an `sndcdn.com` host) before the request; mark in UI |

Not changed: redirects of `urlopen` are still followed (both hosts are fixed CDNs), and the CLI scripts keep their arguments as they are. To do by the owner in the SonarCloud UI (no token here): set rows 2, 4, 5, 6, 7, 10, 11, 12 and 13 to "Won't fix" / "False positive" with the reason above; rows 1, 3, 8 and 9 close by themselves on the next analysis of `main`.

## Bug review 2026-10-24

Owner decision FH1, step 2. The 27 open bugs were re-read against `origin/main` after the scope file and the vulnerability fixes (still 27; Sonar lines are those of the analysed revision `c61777b`, the files have moved by a line or two since). Result: 20 fixed, 7 false positives (documented here, not suppressed). No tests were run; the fixes were exercised in a local server with a throwaway data directory and fixture songs with generated audio (play, skip, pause and resume, song end, shuffle, song info, drafts, both genre maps; no `unhandledrejection` event, `POST /plays` answered 200 after a play).

| File:line (Sonar) | Rule | Verdict | Reason / fix |
|---|---|---|---|
| `web/js/drafts-model.js:24`, `:25` | javascript:S2189 | FALSE POSITIVE | `start` and `end` are the on/off flags of `trimSet`; the loops advance `from` and `to`, which are in the condition and bounded by each other, so every call ends (an input of only trim characters stops at `from == to`); mark in UI |
| `web/js/playlist-add.js:92` | javascript:S7727 | FALSE POSITIVE | `row(s, i)` takes exactly the song and the index that `.map` passes; the third argument is ignored; mark in UI |
| `web/js/library-data.js:101` | javascript:S7727 | FALSE POSITIVE | `missing` is a one-parameter predicate of `SORTS`; the extra `.filter` arguments are ignored; mark in UI |
| `server/app/loops.py:16` | python:S1764 | FALSE POSITIVE | `v == v` is the NaN test (NaN is the only value not equal to itself), next to the infinity test; mark in UI |
| `scripts/genre-hierarchy-lib.mjs:47` | javascript:S6324 | FALSE POSITIVE | `\u0001` is a private placeholder that hides the dots inside `[[links]]` while the first sentence is cut, then maps back to `.`; wikitext does not contain it; mark in UI |
| `web/js/genre-data.js:105` | javascript:S4158 | FALSE POSITIVE | `HIDDEN_FAMILY_NODES` is an exported configuration list that is empty on purpose (no family hidden today); `isHiddenFamily` must keep working when it is filled; mark in UI |
| `web/js/player.js:261`, `:358` | javascript:S6544 | TRUE (style) | the queue wait is a promise or `null` and was tested as a boolean; now compared with `=== null` (`fa01e9a`) |
| `web/js/player.js:261`, `:361` | javascript:S9383 | TRUE (low) | the wait promise had no handler; a throw in the continuation was an unhandled rejection; now `void wait.then(...).catch(fail)`, which shows the existing "Cannot play this song" toast (`fa01e9a`) |
| `web/js/player.js:721`, `:722` | javascript:S9383 | TRUE (low) | `openSongCard` returns the lazy-load promise (load failures are already reported inside `withUi`); now `void`, as in the other callers (`fa01e9a`) |
| `web/js/play-recorder.js:117`, `:163`, `:168`, `:175`, `:188`, `:204`, `:206` | javascript:S9383 | TRUE (low) | `flush` is async and was called without a handler; the post errors are handled inside, anything thrown before it was lost; all internal calls now go through `flushQuiet`, which writes a rejection to the play diagnostics log (`fa01e9a`) |
| `web/js/media-retry.js:73` | javascript:S9383 | TRUE (low) | a rejecting probe or a throwing continuation was an unhandled rejection; a rejecting probe now counts as `retry` (as the default probe does) and a throwing continuation sets the state to `failed` (`fa01e9a`) |
| `web/js/gapless-loop.js:13`, `web/js/peaks.js:117` | javascript:S9383 | TRUE (low) | `res.body.cancel()` returns a promise that can reject; now caught (`fa01e9a`) |
| `web/js/genre-force-view.js:285` | javascript:S930 | TRUE (low) | `draw(now)` passed an argument to `draw()`, which takes none; the argument is gone (`837a008`) |
| `web/js/genre-map-graph.js:43`, `web/js/genre-radial.js:97`, `web/js/genre-tree-facts.mjs:4` | javascript:S2871 | TRUE (low) | `sort()` on string ids without a compare function; new `byCode` (code-unit order, the old default) and `pairKey` in `genre-levels.js`, so the edge keys and the fact lists are identical (`837a008`) |

The bundle was regenerated in `8785a32` (ADR-0047). To do by the owner in the SonarCloud UI (no token here): set the 7 false positives above to "False positive" with the reason; the 20 fixed ones close by themselves on the next analysis of `main`.

## Refactor results 2026-10-24

Owner decision FI1 (FH1 step 3): behaviour-preserving refactor of the two worst complexity hotspots. Cognitive complexity per function, before (SonarCloud, revision `1375616`) and after (measured with the same rules locally; the SonarCloud figures of the new analysis are in the last paragraph). The limit is 15.

| File and function | Before | After |
|---|---|---|
| `genre-force-view.js` `endDrag` | 34 | split into `dropMovedNode`, `finishNodeDrag`, `endDrag`: all under 10 |
| `genre-force-view.js` `frame` | 25 | 12 (`stepLayout`, `tickSim`, `settlePull` carry the rest) |
| `genre-force-view.js` `drawLinks` | 25 | 9 or less, in `genre-force-links.js` (`classifyLinks`, `strokeAll`, `arrowAll`) |
| `genre-force-view.js` `enterNodes` | 19 | 11, in `genre-force-enter.js` (`liftAncestors`, `fanGroups`, `nearNeighbours`) |
| `genre-force-view.js` `focusState` | 17 | 10 or less, in `genre-force-focus.js` |
| `genre-force-view.js` `followItems` | 17 | 10 or less, in `genre-force-follow.js` |
| `genre-force-view.js` `drawNode` | 16 | under 10 (`drawAdornments`, `drawHighlight`; painters in `genre-force-draw.js`) |
| `genre-force-view.js` `pointermove` handler | 16 | under 10 (`onPointerMove`, `pinchMove`, `dragMove`, `panBy`) |
| `genres-rework.js` `renderGenresRework` | 27 | under 11 |
| `genres-rework.js` `nowNode` | 22 | 8, now `findNowNode` in `genres-rework-now.js` |
| `genres-rework.js` `load` | 19 | under 10 (`fetchVocab`, `fetchLayout`, `rememberLayout`, `showLoadFailure`; helpers in `genres-rework-load.js`) |
| `genres-rework.js` `buildRow` | 17 | 9, in `genres-rework-row.js` |

After the refactor the highest function in `genre-force-view.js` is 15 (`setGraph`) and in `genres-rework.js` 13 (`select`); no function of the two files or of the 15 new modules is over the limit. The 8 nested ternaries (S3358), the duplicate import (S3863), the optional-chain, `NaN`, unused-variable, loop-condition (S1994), "statement not executed conditionally" (S2681) and "move function to the outer scope" (S7721) findings of the two files are fixed too; the two `for...of` over a spread copy (S7747) are gone with the move.

Checked without the test suites: (a) pure parity: the old inline code, cut from `git show 1375616:web/js/...`, against the new functions over generated inputs and the real vocabulary (`fanSlots`, `fanCenter`, focus state, link classification and drawing call sequences, subtree walk, tether and follow steps, node shifting and bounds, playing-genre lookup, status and empty texts, load-result helpers: about 93,000 cases, 0 differences); (b) whole-view parity: the force view driven with a recording canvas and a fixed clock through 11 scenarios (v1, v2, rigid and non-rigid, reduced motion, drill-down, hover, click, empty click, pan, drag of leaves and parents, touch, pinch, wheel, double click, saved layout, visibility changes): 532 checkpoints in two clock modes, byte-identical; the Genres map panel driven through a fake DOM with recording views: 495 DOM, view-call and storage checkpoints, 0 differences; the harnesses were sensitive to deliberate one-token mutations of each new module; (c) the real browser pane, old and new served side by side from two worktrees against a local API: the same canvas pixels, node positions, selection, status text and stored values over 42 and 17 interaction steps on the Genres map (drill-down off and on) and 11 steps on Genres map v2 including the saved layout round trip (drag a family, wait 6 s, reload: same position and selection), no console errors.

## Web, studio and scripts cleanup 2026-10-26

Owner plan "fix all Sonar issues" (web and scripts side; the server side is a separate pass). Open issues in JavaScript, CSS and HTML (`web`, `studio`, `scripts`): 59 at the analysis of 2026-10-26 20:19 UTC (12 critical `javascript:S3776`, 36 major, 11 minor), 0 bugs, 0 vulnerabilities, 0 hotspots to review. After the earlier cleanup commits (`8b5697ab`, `c48db10d`: complexity splits, linear regexes, the `.sonarcloud.properties` scopes) and the last batch (`ac7b6eec` and the `genre-map-graph.js` follow-up): 0 open code issues in those folders at the analysis of 2026-10-26 20:30 UTC plus the follow-up.

| Rule | Fix |
|---|---|
| S3776 | `visibleIds` in `genre-map-graph.js` split into `hiddenBySubfamily` and `passesRules` |
| S4624 | `test-dom.mjs` inspect output built from two named parts |
| S7780 | `String.raw` for the regex sources in `drafts-import.js` and the Windows git path in `build-studio.mjs` |
| S3782 | `PHRASES` in `genre-hierarchy-lib.mjs` are `{ re, kind }` objects |
| S7778 | one `push` call in `build-genre-sources.mjs` |

Marked "False positive" in SonarCloud with a comment (reasons in [`.sonarcloud.properties`](../../.sonarcloud.properties)): `Web:S6819` x4, `Web:S6825` (the custom player group, sliders and visualizer dialog in `web/index.html`), `css:S4666` (`.side-toggle` in `web/style.css`), and `javascript:S7785` x2 in `web/js/app.js` (the background load and the update check are fire-and-forget on purpose; a top-level await would hold the module, and DOMContentLoaded, until the whole library prefetch ends). The multicriteria ignores in the properties file do not clear `Web:*` and `css:*` issues that were already open, hence the manual transitions.

## Server cleanup 2026-10-26

Owner plan "fix all sonar issues", `server/` (app and tests). Open code issues for `server/` at the analysis of 2026-10-26 20:19 UTC (`92fdbf2`): 19 (1 critical, 18 major; 12 `S8786`/`S5843` regexes, 3 `S3415`, `S5754`, `S1172`, `S8415`, `S8495`); 0 bugs, 0 vulnerabilities, 0 hotspots to review. Earlier commits of the same day (`3bd295c`, `b554d10`, `38cc361`) had already fixed most of them; the analysis of `2a9ff93` (20:34 UTC) shows 5 open, all marked below, so 0 open.

| Rule | Fix |
|---|---|
| python:S8415 | `_read` in `routes/playlists.py` no longer raises the 404 for an unknown playlist; the routes that document it call `_stored` themselves |
| python:S8495 | `table_families` in `genre_graph.py` builds the group colour tuple from one expression instead of returning 1-tuples and 0-tuples |
| python:S8786 | the album bracket pattern rescanned to the end of the title for every unclosed opener (about 6 s on 20000 openers, a real quadratic case); `_strip_brackets` in `album_youtube.py` now scans in one pass with the same result (300000 random strings, 0 differences) |
| python:S5843 | the album noise pattern shares its album words through a named part |

Marked "False positive" in SonarCloud with a comment: `python:S8786` x5 on the album title patterns `_NOISE_TAIL`, `_SEP`, `_TOPIC`, `_TRAIL_SQUARE`, `_TRAIL_YEAR` in `album_youtube.py`. Each starts with a single-character lookbehind, so a whitespace run is only tried from its first character; measured at 80000 characters in about 10 ms and guarded by `test_album_title_patterns_stay_linear`; Sonar does not model the lookbehind. New tests: playlist route 404s and create, list, read and export; the album title patterns stay linear; `_strip_brackets` cases. Full server suite: 4537 passed, 19 skipped, 0 failed.

## Swift cleanup 2026-10-26

Owner plan "fix all sonar issues", `ios/Sources` and `ios/MacSources`. Open Swift issues at the analysis of 2026-10-26 20:34 UTC: 62 (S3358 nested ternaries, S1186 empty closures, S1075 hardcoded URIs, S1172 unused parameters, S1659, S108, S117, S107, S1940, S3087, S3661). Refactor only, no behaviour change; the next analysis confirms the count.

| Rule | Fix |
|---|---|
| swift:S1075 | route, theory-data and Wikipedia paths now come from `Endpoints` (`meUsage`, `genresGraph`, `songCover`, `theoryTerms`, `wikiArticles`, `anonPrefix`, ...) |
| swift:S1186 | optional callbacks instead of `{ _ in }` defaults (`LibrarySearchField`, `MetronomeCard`, `StatChartModel`); the other empty bodies carry a comment |
| swift:S3358 / S1659 / S1172 / S108 / S117 | plain statements, one declaration per line, unused parameters removed or `_`, empty catch bodies filled, snake_case init names kept as labels only |
| swift:S107 / S3087 | `LibraryMatching.results` split into `filtered` and `sorted`; the nested closures of `CoverCache` moved into helpers |
| swift:S3661 / S1940 | `try?` on the job id regex (fails closed); NaN-safe comparisons in `LiveBPM` |

Checked: both schemes build (`AudioPlayer` for the iOS Simulator, `ElectrophoneMac` for macOS) and the 34 existing unit tests pass.

## Album-from-video cleanup 2026-10-26

The analysis of `c982fbf` (20:48 UTC, the then `origin/main`) left 53 open issues (52 code smells, 1 vulnerability): 40 `python:S9073` composite assertions in `test_video_split.py`, `test_tracklist.py` and `test_albums_video.py`; in the new album-from-video code `python:S3776` x5 (`_build`, `_clean_track`, `public`, `check_request`, `run_split`), `S8786` x2, `S4790` (`sha1` of non-secret ids), `S3358`, `S1172`; in Swift `S117` x2 (init labels in `AnonAPI.swift`) and `S1301`. Refactor only, no behaviour change.

| Rule | Fix |
|---|---|
| python:S3776 / S3358 | `video_split.py`: `_percent`, `_check_cut`, `_split_one`, `_run_tracks`, `_finish`; `tracklist.py`: `_read_entry`, `_is_valid`; `album_video.py`: `_clean_times` |
| python:S8786 | the topic suffix pattern gets the same lookbehind as `album_youtube._TOPIC`; `_NUM_TRACK` has no adjacent optional whitespace runs |
| python:S4790 / S1172 | `usedforsecurity=False` on the two ids; unused `vid` removed from `_clean_album` |
| python:S9073 | one assertion per condition |
| swift:S117 / S1301 | `errorCode` and `expiresAt` init labels (no caller used them); `if case` instead of a one-case `switch` |
