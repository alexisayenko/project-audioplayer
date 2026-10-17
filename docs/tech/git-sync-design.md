# Git sync design: per-save local commit, timer push

Status: Accepted design for build (ADR-0026, [task-0021](../tasks/task-0021.md)); built, not deployed (2026-10-16). Written by the architect pass 2026-10-16 from the code at `d651a29`. This file is the working contract for the three builders (`server`, `web`, `ops`). The decision itself is not reopened here; where the ADR was silent or wrong about the code, the correction is listed in [Clarifications](#clarifications-to-adr-0026) and in the [Contract changes](#contract-changes-append-only) appendix.

## 1. Current call graph (code at d651a29)

`server/app/gitstore.py` (`GitSync`, one instance `deps.SYNC = gitstore.from_env()`, `None` when `AUDIO_DATA_REPO` is unset: plain files, `/health` `sync` always `ok`).

| Function | What it does today | Commits | Pushes | Pulls |
| --- | --- | --- | --- | --- |
| `transaction()` | takes `self.lock` (RLock), `pull()`, yields; on any exception `git checkout -- .` in every repo (tracked changes only) and re-raises | no | no | yes: `pull --rebase` in both repos on EVERY save (rebase aborted on failure) |
| `commit(message)` | under the lock: per repo `git add -A -- audioplayer`, `diff --cached --quiet`, `git commit -m` if changed, repo added to `_dirty`; then `_push_all()` | yes | yes (inside the request) | no |
| `_push_all()` | under the lock: `git push` per `_dirty` repo; first failure: `_fails += 1`, `_ensure_retry()`, return False; success clears `_dirty`, `_fails = 0` | no | yes | no |
| `_ensure_retry()` / `_retry_loop()` | one daemon thread; backoff 2 s doubling to 300 s; each round under the lock `pull()` then `_push_all()` | no | yes | yes |
| `resync()` | startup only (`main._startup`, before `migrate_tags.run()` and `migrate_credits.run()`): `rev-list --count @{u}..HEAD`; repos ahead go into `_dirty`, retry thread started. It does NOT push synchronously and does NOT pull | no | via retry thread | no |
| `status()` | in-memory: `ok` (no `_dirty`), `error` (`_fails >= 5`), else `pending` | no | no | no |
| `stop()` | sets the stop event, joins the retry thread 5 s; no final push | no | no | no |

Callers (grep-verified):

- `deps.tx(uid, verb)` is the ONLY caller of `transaction()` and `commit()`: user lock (`users.user_lock`) -> `SYNC.transaction()` -> body -> `SYNC.commit(f"audioplayer: {uid[:8]} {verb}")`. Lock order: user lock, then git lock; the git lock is never held while taking a user lock.
- `tx` call sites (each is one commit per save): `routes/songs.py` (edit), `routes/removal.py` (delete, delete audio), `routes/covers.py` (cover set `_store`, cover off), `routes/analyze.py` (bpm), `downloads.py` (add, audio, add) , `metafill.py` (get metadata), `backfill.py` (bpm batch), `deps.admit` (signup, writes `profile.json`), `migrate_tags.py` and `migrate_credits.py` (startup, per user).
- `routes/health.py`: `{"status":"ok","sync": SYNC.status()}` (string). Web: `web/js/app.js` `checkSync()` (top banner `#sync-warn`, polls every `SYNC_POLL_MS` = 30 s) and `web/js/settings.js` `libraryCard()` ("Sync" cell, `SYNC_TEXT`).
- Other `SYNC` users: `deps.data_root()` / `covers_root()` (paths), `migrate_*.backup_path()` (`SYNC.data_repo`).

Files written inside a save (all under the git lock via `tx`):

| Writer | Path | Atomic today | Tracked by `git add -A -- audioplayer` |
| --- | --- | --- | --- |
| `library.save_doc` -> `jsonio.write_json_atomic` | `<data>/audioplayer/users/<uid>/library.json` | yes (temp in same dir, fsync, `os.replace`) | yes |
| `users.write_profile` -> `write_json_atomic` | `<data>/audioplayer/users/<uid>/profile.json` | yes | yes |
| `routes/covers._store` | `<covers>/audioplayer/users/<uid>/covers/<id>.jpg` via `dest.write_bytes` | NO (truncate then write) | yes (LFS) |
| cover off / delete | `unlink` of the same jpg | n/a | yes (deletion) |
| `migrate_tags`, `migrate_credits` backups | `<data repo root>/backups-genre-merge/...`, `backups-credits/...` | copy | NO: outside `audioplayer/`, never staged, never pushed. ADR-0026 "committed like any file" is wrong for them; they stay local-only |
| leftover `.json-*.tmp` from a crash between `mkstemp` and `os.replace` | inside `audioplayer/users/<uid>/` | n/a | YES, by accident (`add -A`): a pre-existing bug that the new design must close |

Who relies on "push finished": no production caller (the request returns after `commit`, push failures are swallowed into `_dirty`). Only tests assert the remote after a save: `server/tests/test_gitstore.py` (save then clone/inspect remote, `/health` `sync` string polling, `test_resync_pushes_leftover_commits`), `test_gitstore_failures.py` (`commit` pushes and status ok, push failure -> pending -> error -> recovery, retry backoff, rollback), `test_api_edges.py`, `test_migrate_credits.py`. Those tests are rewritten in `request` mode or for the new contract.

## 2. Clarifications to ADR-0026

1. Startup "pull" does not exist today (`resync` only detects unpushed commits). New startup (timer mode): see section 5. A startup pull must not rebase or merge silently: fetch, then fast-forward only; divergence is `error`.
2. `/health` is public (no auth, API-001), so it cannot carry counts for everybody. Detailed `sync` only for the owner (valid `X-API-Token`, or a session/bearer of the owner); everyone else, including signed-in non-owners and guests, gets the generic form. See section 3.
3. With 60 s pushes, `pending` is the NORMAL state for up to a minute after every save. The top banner `#sync-warn` (STO-033) must therefore stop showing on `pending`; it shows on `stale` and `error` only.
4. The timer cannot be observed by the app directly. A heartbeat in a state file written by the CLI on every run makes "timer not installed or not running" detectable (section 3, `timer`).
5. The backup folders are outside the tracked tree (table above); the `.json-*.tmp` leak is closed by pathspec exclusion and a startup sweep.
6. `Persistent=true` only affects `OnCalendar=` timers; with the monotonic `OnBootSec`/`OnUnitActiveSec` it is harmless and kept as decided. `AccuracySec=1s` is added: systemd's default accuracy is 1 min and would add up to a minute of jitter to a 60 s timer.
7. The planned unit text in deploy.md lacks `WorkingDirectory=/opt/audioplayer/server`; `python -m app.gitsync` cannot import `app` without it.
8. Commit message stays as today: `audioplayer: <uid8> <verb>` (for example `audioplayer: 1a2b3c4d edit abc123`); the ADR example `edit: <artist> - <title>` is illustrative and not required.

## 3. Sync contract

### 3.1 Configuration

| Env | Default | Meaning |
| --- | --- | --- |
| `GIT_SYNC_MODE` | `timer` | `timer`: save = atomic write + local commit, no pull, no push. `request`: the old synchronous path (pull --rebase, commit, push, retry thread), kept for one release as rollback. Unknown value -> `timer` with a startup warning |
| `GIT_SYNC_INTERVAL_S` | `60` | timer interval, used only to derive the stale threshold and the heartbeat window; it must match the unit |
| `GIT_SYNC_STALE_GRACE_S` | `30` | `stale_after_s = interval + grace` (default 90) |
| `GIT_SYNC_STATE_FILE` | `<parent of AUDIO_DATA_REPO>/gitsync-state.json` (LXC: `/var/lib/audioplayer/gitsync-state.json`) | state shared by the CLI (writer) and the server (reader); never inside a repo |

The server reads the same env file as the CLI (`EnvironmentFile=/etc/audioplayer/env`), so the values cannot drift.

### 3.2 Sync object

Owner form (`GET /health` with owner credentials; also what the Settings sync card renders):

```json
{
  "status": "ok",
  "sync": {
    "state": "pending",
    "unpushed": 3,
    "oldest_unpushed_age_s": 41,
    "last_push_at": "2026-10-16T09:12:03Z",
    "stale_after_s": 90,
    "mode": "timer",
    "timer_seen": true,
    "last_run_at": "2026-10-16T09:12:03Z",
    "last_error": null,
    "repos": [
      {"name": "data",   "state": "pending", "unpushed": 3, "oldest_unpushed_age_s": 41, "rejected": false, "failures": 0},
      {"name": "covers", "state": "ok",      "unpushed": 0, "oldest_unpushed_age_s": null, "rejected": false, "failures": 0}
    ]
  }
}
```

| Field | Type | Rule |
| --- | --- | --- |
| `state` | `"ok"\|"pending"\|"stale"\|"error"` | worst of the repos, precedence `error` > `stale` > `pending` > `ok` |
| `unpushed` | int >= 0 | commits in `@{u}..HEAD`, summed over repos |
| `oldest_unpushed_age_s` | int >= 0 or `null` | `floor(now - committer time of the oldest unpushed commit)`, max over repos; `null` when `unpushed == 0` |
| `last_push_at` | ISO-8601 UTC string or `null` | last successful push by the CLI (or by the server in `request` mode); from the state file; `null` if none recorded |
| `stale_after_s` | int | `GIT_SYNC_INTERVAL_S + GIT_SYNC_STALE_GRACE_S` |
| `mode` | `"timer"\|"request"` | the configured mode |
| `timer_seen` | bool | `mode == "timer"` and `last_run_at` is within `3 * interval` of now; `true` always in `request` mode. `false` means the timer is not installed or not running |
| `last_run_at` | ISO-8601 UTC string or `null` | last CLI run end time (heartbeat, written even when there was nothing to push) |
| `last_error` | string or `null` | last failure line, at most 200 characters, with the SSH key path removed |
| `repos[]` | array, 1 or 2 items | `name` `data`\|`covers`; per-repo `state`, `unpushed`, `oldest_unpushed_age_s`, `rejected` (bool, sticky), `failures` (consecutive failed pushes) |

Generic form (anonymous, guests, signed-in non-owners): `{"status":"ok","sync":{"state":"ok"|"degraded"}}`. `degraded` = `stale` or `error`; `pending` and `ok` map to `ok`. No counts, times, repo names, mode or error text. With no git store configured: `{"status":"ok","sync":{"state":"ok"}}` for both forms (owner form with `unpushed: 0`, `mode: "none"`).

Breaking change: `sync` was a string. The web client is updated in the same release and tolerates both shapes (`typeof sync === "string" ? sync : sync.state`) for one release. iOS does not read `/health`.

### 3.3 State machine and thresholds

Per repo, evaluated on each `/health` call (git read, cached 5 s):

1. `error` if `rejected` is set, or `failures >= 5`, or the repo has no upstream / git read fails (`last_error` says which).
2. else `ok` if `unpushed == 0`.
3. else `stale` if `oldest_unpushed_age_s > stale_after_s` (strictly greater; 90 s is still `pending`, 91 s is `stale`).
4. else `pending`.

Transitions: `ok -> pending` on a save; `pending -> ok` after a push; `pending -> stale` when the oldest unpushed commit passes 90 s; `stale -> ok` after a push; `* -> error` on rejection or the 5th consecutive failed run; `error(failures) -> ok` after one successful push; `error(rejected)` clears only when the repo has `unpushed == 0` and `HEAD` contains `@{u}` (the operator fixed it by hand, runbook) or via `python -m app.gitsync --clear-rejected <data|covers>`. An idle server with nothing unpushed is `ok` forever because the age comes from commit time, never from the last push. A skipped tick (60 to 90 s) stays `pending`. 5 consecutive failures at 60 s = 5 minutes, so the usual path is `pending -> stale -> error`.

### 3.4 State file (CLI writes, server reads)

`gitsync-state.json`, written atomically (`write_json_atomic`), mode 0600:

```json
{"last_run_at": "...Z", "last_push_at": "...Z", "last_error": null,
 "repos": {"data": {"failures": 0, "rejected": false, "last_ok_at": "...Z"}, "covers": {...}}}
```

Missing or unreadable file = no heartbeat (`timer_seen:false`), zero failures. The server never writes it in `timer` mode. In `request` mode the server keeps failures in memory as today and writes `last_push_at` to the same file after each successful push.

### 3.5 Alerts

No external channel (open question E stays open). Alert = (a) log at ERROR with logger `audioplayer.git` (server) or `audioplayer.gitsync` (CLI, journal unit `audioplayer-gitsync`): on rejection (every run while rejected), on the 5th consecutive failure and every run after it, on "no upstream"; the server logs ERROR once per transition into `error`/`stale` when it computes `/health`; (b) the `error` state and `last_error` in `/health` owner form; (c) Settings marks.

## 4. Change plan

### 4.1 `gitstore.py` refactor (server)

- `GitSync.__init__(..., mode, interval_s, grace_s, state_file)`; `from_env()` reads the variables above.
- `transaction()`: `lock` -> (request mode only: `pull()`) -> yield -> on exception rollback as today, plus remove untracked new files created by the failed body: `git clean -fdq -- audioplayer` in both repos (a failed save must not leave a half save for the next commit; untracked `.json-*.tmp` and a new cover are covered).
- `commit(message)`: under the lock; per repo `git add -A -- audioplayer ":(exclude)*.tmp"` (pathspec exclusion; staging only that tree), commit if `diff --cached --quiet` fails. `request` mode: then `_push_all()` as today. `timer` mode: return; no network, no `_dirty`, no retry thread.
- `unpushed(repo) -> (count, oldest_commit_ts)`: `git rev-list --count @{u}..HEAD` and `git log @{u}..HEAD --format=%ct` (last line = oldest); no lock; returns an error marker when `@{u}` is missing.
- `push_repo(repo) -> PushResult(ok|failed|rejected, error)`: `git push` (timeout 120 s), classification below; shared by the CLI and by `request` mode.
- `sync_status(owner: bool) -> dict`: section 3, cached 5 s (invalidated by `commit` and by a push), never takes the git lock.
- `recover_on_startup()`: section 5.
- `flush(timeout=20)`: `timer` mode shutdown hook: one push pass through the same flock as the CLI (skip if the timer run holds it). Wired to FastAPI `shutdown`.
- `status()` kept for the old tests only as `sync_status(owner=False)["state"]`-like helper in `request` mode; remove when `request` mode goes.
- `_dirty`, `_fails`, `_retry*`, `_backoff` are used only when `mode == "request"`.
- Push failure classification (`push_repo`): stderr containing `[rejected]` with `non-fast-forward` or `fetch first`, then `git fetch`, then `git merge-base --is-ancestor @{u} HEAD`: not an ancestor = `rejected` (single-writer broken); ancestor (a concurrent push of the same commits, or a stale tracking ref) = retry once, not a rejection. Everything else (network, auth, lock timeout, LFS upload failure, timeout) = `failed`.

### 4.2 `gitsync.py` CLI (server)

`python -m app.gitsync [--clear-rejected data|covers] [--status]`. Imports only `gitstore` (never `app.main` or `deps`). Flow: `from_env()` (none configured -> print and exit 0); take `fcntl.flock(LOCK_EX|LOCK_NB)` on `<state file>.lock` (held -> exit 0 "busy"); load state; for each repo: if `rejected` and still diverged -> skip, log ERROR; if `unpushed == 0` -> clear `failures`, clear stale `rejected`; else `push_repo`: ok -> `last_push_at`, `failures = 0`; failed -> `failures += 1`, `last_error`; rejected -> `rejected = true`, ERROR log, no further push attempts; write `last_run_at` always; atomic state write. Exit codes: 0 all ok or nothing to push, 1 at least one push failed, 2 at least one repo rejected (wins over 1), 3 config or state-file error. `--status` prints the owner-form JSON and changes nothing (used by the operator script). No repo lock is taken: a save committing during `git push` is safe because `git push` reads refs and objects only and does not touch the index or working tree; the commit lands after the pushed tip and is counted next run. Order of repos: data then covers; a failure in one does not skip the other.

### 4.3 Startup, shutdown (server)

`main._startup`: `SYNC.recover_on_startup()` replaces `resync()` before the migrations. Sequence per repo under the git lock: (1) sweep `audioplayer/**/.json-*.tmp`; (2) if `git status --porcelain -- audioplayer` is non-empty (crash between write and commit): `git add` + commit `audioplayer: recover uncommitted changes`; (3) `git fetch` (best effort, 30 s); (4) remote not ahead: nothing; remote ahead and no unpushed commits: `git merge --ff-only @{u}`; both ahead (diverged): mark `rejected` in the state file (timer mode) or memory, ERROR log, do not touch the tree; (5) `timer` mode: if unpushed > 0, one `push_repo` pass with a 30 s budget BEFORE the migrations run and the server accepts writes (startup is synchronous; failure is not fatal, the server starts and shows `pending`/`stale`). `request` mode: the old `resync()`. Shutdown: `flush()`.

### 4.4 `/health` and API (server)

`routes/health.py`: `GET /health` returns section 3.2. Viewer detection `deps.sync_viewer(request, x_api_token, authorization) -> "owner"|"other"`: never raises, never creates a profile (no `admit`), owner = valid `X-API-Token`, or a verified session cookie / bearer whose uid is `users.owner_uid()`. Responses stay `Cache-Control: no-store` (default of the middleware). `/health` stays exempt from the canonical-host redirect (NFR-091). The Settings card calls `/health` with the session cookie; there is no separate endpoint.

### 4.5 Web

`web/js/sync-status.js` (new, pure, no DOM): `normalizeSync(raw)` (string or object -> object), `describeSync(sync, nowMs)` -> `{level: "none"|"warn"|"error", text, label, dot: bool}`; `app.js` `checkSync()` keeps the only poll (`SYNC_POLL_MS`), stores the object in `store` (`store.sync`) and fires `sync-changed`; sets `data-sync="warn|error"` on the Settings nav link (`a[data-route="settings"]`); the top banner shows for `stale`/`error` only. `settings.js` sync cell and card mark render from `describeSync`; the card re-renders on `sync-changed`. Strings (English, exact):

| Condition | Text on the card | Accessible label | Level |
| --- | --- | --- | --- |
| `ok`, `pending` | "In sync with git" / "Saving to git" (no mark) | none | none |
| `stale`, owner | "last pushed N min ago, M changes not pushed" | "Sync is behind: M changes not pushed" | warn |
| `stale`, owner, `timer_seen:false` | "Git push timer not installed or not running, M changes not pushed" | "Sync is behind: M changes not pushed, push timer not running" | warn |
| `error`, owner | "Sync failed: " + short reason ("push rejected" / "not reaching git" / "no upstream") | "Sync failed" | error |
| `degraded` (non-owner) | "Sync is behind" | "Sync is behind" | warn |
| guest | no mark | none | none |
| `/health` unreachable | "Server unreachable" (existing) | none | none |

N = `max(1, round((now - last_push_at)/60))`; `last_push_at == null` -> "no push recorded" in place of "last pushed N min ago". Styles use tokens only (WEB-010): warn = `--power-text` style already used by `.sync-warn`; error = stronger token pair; the dot is a CSS pseudo-element on the nav item, `position:absolute`, no pixel literals outside tokens. Marks clear on the next poll that shows `ok`/`pending`.

### 4.6 Ops

Files: `deploy/systemd/audioplayer-gitsync.service`, `deploy/systemd/audioplayer-gitsync.timer`, `deploy/systemd/README.md` (root install runbook), `scripts/check-gitsync.sh`. Units:

```ini
# audioplayer-gitsync.service
[Unit]
Description=Electrophone git push
After=network-online.target
[Service]
Type=oneshot
User=audioplayer
WorkingDirectory=/opt/audioplayer/server
EnvironmentFile=/etc/audioplayer/env
ExecStart=/opt/audioplayer/venv/bin/python -m app.gitsync
TimeoutStartSec=90
Nice=10

# audioplayer-gitsync.timer
[Unit]
Description=Run the git push every minute
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=1s
Persistent=true
[Install]
WantedBy=timers.target
```

Install (root, once): copy both files to `/etc/systemd/system/`, `systemctl daemon-reload`, `systemctl enable --now audioplayer-gitsync.timer`, run `scripts/check-gitsync.sh`, then set `GIT_SYNC_MODE=timer` (already the default after the release) and restart `audioplayer`. Until installed, the app works: saves commit locally, `/health` goes `pending` then `stale` ("Git push timer not installed or not running"). `scripts/check-gitsync.sh`: POSIX sh, read-only; calls `systemctl is-enabled`/`list-timers` when available, `curl -s -H "X-API-Token: ..."` is NOT used (the token must not be handled by a script); instead it runs `python -m app.gitsync --status` as the service user via the venv, prints `state`, `unpushed`, `oldest_unpushed_age_s`, `last_push_at`, `timer_seen`, exits 0 for `ok`/`pending`, 1 for `stale`, 2 for `error`, 3 when it cannot read the state; it makes no data changes (`--status` never pushes, never writes).

## 5. Lock rules

| Lock | Holder | Rule |
| --- | --- | --- |
| user lock (`users.user_lock(uid)`) | `deps.tx` | taken first, never while holding the git lock |
| git lock (`GitSync.lock`, RLock, in-process) | `transaction()`/`commit()`, startup recovery | held for the file write and the local commit only (tens of ms); no network under it in `timer` mode; `request` mode unchanged |
| CLI flock (`<state file>.lock`) | `python -m app.gitsync`, server `flush()` | serialises pushers; never held by a request; a busy lock = skip, exit 0 |
| none | `/health`, `sync_status`, `unpushed()`, `git push` from the CLI | read-only git plumbing; a save during any of them is safe |

The CLI never takes the git lock (separate process; it could not anyway). Saves never wait for the timer. Two commits from two users stay ordered by the git lock.

## 6. Failure modes and how each shows

| Failure | Behaviour | State |
| --- | --- | --- |
| Timer not installed or stopped | commits accumulate locally | `pending` -> `stale` after 90 s; card says timer not installed or not running; `timer_seen:false` |
| Network or GitHub down, SSH or LFS error | push fails, `failures += 1` per run, commits kept | `pending` -> `stale` -> `error` at the 5th failure; ERROR log; recovers to `ok` on the first good push |
| Rejected push (remote moved, non-ancestor) | repo marked `rejected`, no more pushes, no merge, tree and commits untouched | `error` (sticky); ERROR log each run; runbook in deploy.md |
| Crash between write and commit | dirty tree; startup recovery commits it | none visible; next push carries it |
| Crash during atomic write | temp file left, target untouched; tmp excluded from staging and swept at startup | none |
| Crash after commit, before push | commit survives locally; CLI or startup pushes it | `pending`/`stale` until pushed |
| Disk loss before the push | up to about 1 minute of saves lost (accepted, ADR-0026 risk 1); `flush()` on clean shutdown and the startup push narrow it | n/a |
| No upstream configured / repo missing | cannot count | `error`, `last_error` "no upstream" |
| State file missing | no heartbeat, zero failures | `timer_seen:false` |
| Save fails inside `tx` (disk full, git commit error) | tracked changes reverted and new files cleaned; request returns the error | no state change |
| Concurrent push by CLI and shutdown flush | flock serialises; a lost race is retried once | none |

## 7. Module plan (one owner per file)

| File | Owner | Content |
| --- | --- | --- |
| `server/app/gitstore.py` | server | refactor (4.1), mode switch, `sync_status`, `recover_on_startup`, `flush` |
| `server/app/gitsync.py` | server | CLI (4.2), state file read/write |
| `server/app/jsonio.py` | server | add `write_bytes_atomic` |
| `server/app/routes/covers.py` | server | cover write via `write_bytes_atomic` |
| `server/app/deps.py` | server | `sync_viewer` |
| `server/app/routes/health.py` | server | section 3.2 |
| `server/app/main.py` | server | startup/shutdown wiring |
| `server/tests/test_gitstore.py`, `test_gitstore_failures.py`, `test_api_edges.py`, new `test_gitsync.py`, `test_sync_status.py` | server | section 8 (the existing tests move to `request` mode or are rewritten) |
| `web/js/sync-status.js` (+ `.test.mjs`) | web | pure state -> view |
| `web/js/app.js`, `web/js/settings.js`, `web/js/store.js`, `web/js/constants.js`, `web/index.html`, `web/style.css`, their tests | web | banner, nav dot, card, `sync-changed` |
| `docs/specs/web.md` | web | WEB-094 rewritten to this file's texts, new WEB-095 (nav dot), WEB-096 (banner only on stale/error), WEB-097 (timer-not-installed text) |
| `deploy/systemd/*`, `scripts/check-gitsync.sh` | ops | section 4.6 |
| `docs/tech/deploy.md` | ops | replace "Planned: git sync timer" with the install/verify/rollback/rejected-push runbook; Metadata row "pushed on every write" -> "committed on every write, pushed by the timer" |
| `docs/specs/non-functional.md` | ops | NFR-111..114 status; new NFR-115 (heartbeat and `timer_seen`), NFR-116 (atomic cover write and tmp exclusion), NFR-117 (startup recovery) |
| `docs/specs/storage-and-sync.md`, `docs/specs/api.md` (API-019 and the `/health` row; new API-137 owner/generic forms) | ops | STO-030..035 rewritten for the two modes (STO-031 states, STO-033 banner on stale/error); new STO-054 (commit-only save), STO-055 (CLI), STO-056 (startup recovery) |
| `docs/tech/decisions.md` (ADR-0026 status "Accepted, built"; fix the backup-folder and startup-pull lines), `docs/tasks/task-0021.md`, `docs/CHANGELOG.md`, `docs/tech/architecture.md` | ops | status updates |
| `docs/tech/git-sync-design.md` | architect | this file; only the appendix grows |

Spec ids (current maxima STO-053, API-136, WEB-094, NFR-114): new ids are STO-054..056, API-137, WEB-095..097, NFR-115..117; write them in that order wherever the table above says new. Before finishing, `cat docs/specs/*.md | grep -o -E '^- [A-Z]{2,5}-[0-9]+' | sort | uniq -d` must print nothing.

## 8. Test plan

Server (`pytest`, local bare remotes as in `test_gitstore_failures.py`, a `slow_remote` wrapper script via `core.sshCommand`/a `pre-receive` sleep for latency):

1. Save latency independent of remote delay: remote with a 3 s `pre-receive` sleep, `timer` mode, 10 saves each under 1 s, remote untouched.
2. A save leaves a local commit with message `audioplayer: <uid8> <verb>`, `unpushed == 1`, state `pending`, no push, no pull.
3. Concurrent save during push: thread A runs `push_repo` against a slow remote, thread B saves meanwhile; B returns immediately; after A, `unpushed == 1`; next pass pushes it; remote history linear.
4. Push failure then recovery: remote path removed, 5 runs -> `failures` 1..5, state `pending`/`stale`/`error` (clock injected), ERROR logged on the 5th; remote restored, one run -> `ok`, `failures == 0`.
5. Rejected push: another clone pushes a commit; CLI run -> exit 2, `rejected`, `error`, no pull/merge/rebase (HEAD and tree unchanged), subsequent runs skip the repo, the other repo still pushes; manual fix (rebase + push) -> auto-clear; `--clear-rejected` works. A concurrent push of the same commits is NOT classified as rejected.
6. Covers-only push: data-only edit leaves covers `unpushed == 0` and the covers remote ref unchanged; a cover set pushes covers; cover-only commit leaves data untouched.
7. Startup with unpushed commits: pushed before the first request and before migrations; with a dirty tree: recovery commit then push; with a remote that is ahead and local clean: fast-forward; both ahead: `error`/`rejected`, tree untouched; remote unreachable at startup: server starts, `pending`.
8. Atomic write interrupted: patch `os.replace` to raise: target unchanged, tmp removed; simulate a leftover `.json-x.tmp`: not staged by `commit`, swept at startup; `write_bytes_atomic` same; a failing `tx` body leaves no untracked file and no dirty tree.
9. Stale threshold boundaries (injected clock): age 89 -> `pending`, 90 -> `pending`, 91 -> `stale`; custom interval/grace gives `interval + grace`; nothing unpushed with an old last push -> `ok`; age uses commit time, not last push; ok -> pending -> stale -> ok.
10. Guests and viewers: anonymous, guest (public view), signed-in non-owner, owner by token, owner by session; only the owner sees counts; others see `{"state":"ok"|"degraded"}` only, no extra keys; `pending` maps to `ok`; the owner form field set and types match section 3.2; `GIT_SYNC_MODE` unset = `timer`; no store = `ok`.
11. Heartbeat: no state file -> `timer_seen:false`; run older than 3 intervals -> false; fresh -> true.
12. `request` mode regression: the old tests pass unchanged against `mode=request` (push in request, retry thread, `/health` states).
13. CLI: exit codes 0/1/2/3, `--status` read-only, busy flock skips, no repo configured exits 0, two simultaneous runs push once.
14. Concurrent saves from two users: two commits, consistent files (existing test kept).
15. NFR-111 performance guard: save returns in under 1 s with the slow remote (marked, not flaky: asserts no network call by counting `git` subprocess names).

Web (`node --test`): `describeSync` table for every row of 4.5 including `last_push_at` null, string `sync` back-compat, `timer_seen:false`, N rounding (59 s -> 1 min); app.js poll sets `data-sync` on the Settings link for `stale`/`error` and clears it for `ok`/`pending`; banner hidden on `pending`; guests never get a mark; accessible labels present on the dot and the card mark; no color literals in the new CSS (existing token test).

Ops (manual, on the LXC): `scripts/check-gitsync.sh` exit codes, `systemctl list-timers`, one save then `pending` -> `ok` within about 60 s, timer stopped -> `stale` after 90 s -> restart -> `ok`. `scripts/check.sh` stays green (duplicate-id grep).

## 9. Out of scope / open

Alert channel beyond log and `/health` (open E). Whether to keep `request` mode past one release (F). Single-writer assumption confirmed with Alex (G, NFR-114). Per-user notification, iOS display of sync state, a database (task-0021 "Later direction").

## Contract changes (append-only)

Append new entries below; never edit or delete an earlier one. Format: date, id, who, change, reason.

- 2026-10-16, C1, architect: `GET /health` `sync` changes from a string (`ok|pending|error`) to an object; owner form has the full field set, everyone else gets `{state: ok|degraded}`. Reason: counts must not leak on a public endpoint; one place for state.
- 2026-10-16, C2, architect: new state `stale` (oldest unpushed commit older than interval + grace, strictly greater); `pending` no longer shows a banner. Reason: pending is normal for up to a minute after every save.
- 2026-10-16, C3, architect: heartbeat fields `timer_seen`, `last_run_at` and state file `GIT_SYNC_STATE_FILE`. Reason: the app cannot otherwise tell that the timer is not installed.
- 2026-10-16, C4, architect: startup does fetch plus `merge --ff-only`, never a rebase; divergence is `rejected`/`error`. Reason: ADR "never merge automatically".
- 2026-10-16, C5, architect: backup folders (`backups-credits/`, `backups-genre-merge/`) are outside the tracked tree and are not pushed; ADR-0026 consequences line corrected. Cover writes become atomic; `.tmp` files are excluded from staging.
- 2026-10-16, C6, architect: detailed sync is owner-only (non-owner signed-in users get the generic form). Reason: global counts reveal other users' activity; revisit if Alex wants users to see their own state.
- 2026-10-16, O1, ops: `scripts/check-gitsync.sh` accepts `--status` output either as the bare sync object or wrapped as `{"sync": {...}}`; it runs as the service user directly, via `runuser` as root, or `sudo -n -u audioplayer` otherwise, and sources `/etc/audioplayer/env` itself. Reason: the `claude` deploy user is not the service user.
- 2026-10-16, O2, ops: service unit adds `Wants=network-online.target`; deploy.md heading renamed "Git sync timer" (anchor `#git-sync-timer`), links in ADR-0026 and task-0021 updated. STO-033 states only the stale/error banner rule and refers to WEB-094..097 for texts.
- 2026-10-16, W1, web: card/banner/label texts use "1 change" for a count of 1 and "N changes" otherwise (contract says "M changes"). `degraded` (non-owner) also sets the nav dot and banner ("Sync is behind"). The banner shows the same text as the card; hidden for guests and when `/health` is unreachable. The accessible label of the nav link is "Settings, <label>" via `aria-label`. `window` event `sync-changed` carries no payload; `store.sync` holds the raw `/health` `sync` value.
- 2026-10-16, C7, server: the pusher pass lives in `GitSync.push_pass()` (flock, per-repo push, state file) and is shared by the CLI (`app.gitsync`), startup (`recover_on_startup`, 30 s push budget) and shutdown (`flush`); the server therefore also writes the state file in `timer` mode (pass results, `rejected` mark on startup divergence), always under the same flock except the startup divergence mark. Reason: one implementation of the push rules.
- 2026-10-16, C8, server: `main._startup` always calls `SYNC.recover_on_startup()`, which delegates to `resync()` in `request` mode. `GitSync` constructor default mode is `timer`; tests of the old path pass `mode="request"`.
- 2026-10-16, C9, server: `sync_status` caches only the git counts (5 s, `GitSync.cache_ttl_s`), ages are recomputed from the injected `clock` on every call. A repo with no upstream is `error` ("no upstream"); the CLI counts it as exit 1 without incrementing `failures`. `last_error` is cleared by a fully clean pass. `GitSync.status()` is unchanged (request-mode in-memory state).
- 2026-10-16, C10, server: `transaction()` rollback also runs `git reset -q` before `checkout -- .` so a failed commit cannot leave staged changes behind.
- 2026-10-17, CI1, server: ADR-0027 amends this contract: the timer pass also fetches and fast-forwards (`GitSync.inbound_repo`), under a cross-process flock (`<state file>.write.lock`, `GitSync.exclusive()` / `try_exclusive()`) that `transaction()`, `commit()`, cover writes and startup recovery also take; a diverged repo is a non-sticky `error`, not `rejected` (unless `GIT_SYNC_INBOUND=0`). The "takes no lock, never pulls" statements above describe the push-only design.
