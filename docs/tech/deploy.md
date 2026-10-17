# Deploy runbook

Status: Accepted · 2026-10-14. Live at https://electrophone.cc since 2026-10-13 (ADR-0004). Design background: [architecture.md](architecture.md); env vars and limits: [architecture.md](architecture.md#limits-and-environment-adr-0012).

## Where things live

| What | Where |
| --- | --- |
| Host | `perkunas` (Proxmox), LXC 106 `tools` (Debian 13, `192.168.0.10`), shared with Immich |
| Service | systemd `audioplayer.service`, user `audioplayer`, code in `/opt/audioplayer` (git clone of this repo, branch `main`) |
| Public URL | Cloudflare Tunnel ingress `electrophone.cc` -> the service on `192.168.0.10:8000` (uvicorn `--host 0.0.0.0 --port 8000`). `cloudflared` does not run on LXC 106; its host, config path and ingress line are not verified. Tailscale is not used |
| Venv | `/opt/audioplayer/venv` (`ExecStart=/opt/audioplayer/venv/bin/uvicorn app.main:app`, working dir `/opt/audioplayer/server`) |
| Env file | `/etc/audioplayer/env`, loaded by the unit (secrets; never in a repo, never printed). Keys present: `AUDIO_API_TOKEN`, `AUDIO_DATA_REPO`, `AUDIO_COVERS_REPO`, `AUDIO_HOSTS`, `AUDIO_DATA_DIR`, `ALLOWED_EMAIL`, `GOOGLE_WEB_CLIENT_ID`, `APPLE_WEB_CLIENT_ID`, `APPLE_AUDIENCE`, `GOOGLE_CLIENT_ID`, `AUDIO_SESSION_SECRET`; optional host keys `PUBLIC_HOSTS`, `CANONICAL_HOST`, `OAUTH_REDIRECT_URIS` (ADR-0019, see [Hostnames](#hostnames)); no limit keys are set, so the defaults apply |
| Audio | ZFS dataset `pool-3/music` (single disk, no redundancy), mounted in the LXC at `/srv/music`; audio resolves via `AUDIO_MUSIC_ROOT` / `AUDIO_HOSTS` (STO-010; `AUDIO_DATA_DIR` holds only `library.json`, `covers/` and `genre-ontology.json`); files under `/srv/music/users/<uid>/` |
| Metadata | the server's own clones, in `/var/lib/audioplayer/`, of `data-storage` (`audioplayer/users/<uid>/{profile,library}.json`) and `data-storage-lfs` (covers), committed on every write and pushed by the git sync timer (ADR-0005, ADR-0012, ADR-0026) |
| yt-dlp | `audioplayer-ytdlp-update.timer` (`OnCalendar=weekly`, Mondays 00:00 UTC, `Persistent=true`) starts `audioplayer-ytdlp-update.service`: `venv/bin/pip install -q -U yt-dlp`, then restarts `audioplayer` (NFR-013) |
| Backups | `/var/backups/audioplayer-<YYYYMMDD-HHMMSS>/` with `data-storage.bundle`, `data-storage-lfs.bundle` and the SHA files `app.HEAD`, `data-storage.HEAD`, `data-storage-lfs.HEAD`; taken by hand, not by the deploy helper |

## Deploy

From the PC, after `scripts/check.sh` prints `check ok` and the change is pushed to `origin/main`:

```sh
scripts/deploy.sh
```

It runs `sudo -n /usr/local/sbin/audioplayer-deploy` over SSH (`claude@192.168.0.10`), then prints the deployed revision and the HTTP status of the web index. The root-owned helper does:

1. As user `audioplayer`: `git pull --ff-only` in `/opt/audioplayer` (never a merge; a diverged clone fails the deploy), then `venv/bin/pip install -q -r server/requirements.txt`.
2. `systemctl restart audioplayer` (the LXC is not restarted), wait 3 s, print `is-active`.
3. `curl http://127.0.0.1:8000/health` and print the status.

After the helper, `scripts/deploy.sh` also writes `/opt/audioplayer/BUILD` (`sha=`, `committed_at=`, `deployed_at=`, git-ignored) over the same SSH user, best effort: if the `claude` user cannot write there the script prints a note and carries on. The server reports its build in the owner form of `/health` (`build`, NFR-119) from git, falls back to `BUILD`, and uses its own start time as the deploy time when `BUILD` is missing or older than the restart. The sidebar and Settings show it to the owner only (WEB-102). Check: `curl -s -H "X-API-Token: $T" https://electrophone.cc/health`.

It takes no backup. Before a deploy that touches data handling, bundle the clones by hand: `git bundle create /var/backups/audioplayer-<ts>/<name>.bundle --all` in each clone under `/var/lib/audioplayer/`, and record the `HEAD` SHAs.

In-flight downloads are forgotten by a restart (API-013); deploy when none is running.

## Roll back

```sh
ssh claude@192.168.0.10
cd /opt/audioplayer
sudo -u audioplayer git log --oneline -3          # note the previous HEAD
sudo -u audioplayer git checkout <previous-sha>   # detached HEAD is fine
sudo systemctl restart audioplayer
```

Then repeat the checklist below. To return to `main` later: `git checkout main && git pull --ff-only`. Data is not rolled back by a code rollback: library history is in the data repos, restore from a bundle in `/var/backups/audioplayer-<ts>/` only if a deploy damaged the data clone.

Credits migration (DATA-125): the first start of the structured-credits build rewrites every `library.json` (the legacy `artist`, `remixer`, `remix_year` and `year` keys become `artists`, `featured`, `released`, `version`; the original strings stay in `raw`) after copying the old file to `<data repo>/backups-credits/`. An older build does not read the new keys: songs would show no artist or year, and saving from it writes legacy keys over the structure. Do not roll the code back across this deploy without restoring each `library.json` from `backups-credits/` (losing later edits); prefer a forward fix.

## Data model v2 migration

Built on branch `worktree-agent-a9ef527b632364730`, not deployed (DATA-144 to DATA-155, [plan](data-model-v2-plan.md), ADR-0025, task-0043). The server migrates every `library.json` once at startup (`app.migrate_model2`, before the genre-tag migration); the steps below make that safe. The code and the migrated files cannot be rolled back separately.

1. Backup by hand, outside the git tree: copy `users/<uid>/library.json` of every user to a dated folder (the startup migration also writes `<data repo>/backups-model2/<uid>/library.json`, never overwriting an older copy).
2. Guest snapshot BEFORE: `curl -s https://electrophone.cc/library > before.json` (guest view of the owner's library).
3. Dry run on a copy of the live file, with the new code, nothing is written except the report:
   `cd server && PYTHONPATH=. python -m app.migrate_model2 --library /path/copy/users/<uid>/library.json --report report.json`.
   Expect `status: dry_run`, `legacy_diffs: 0`, `ok: true`. Read `report.json`: `tags_removed` per prefix (`decade`, `lang`, `country`), `decade_tags_disagreeing_with_release_year`, `raw_kept` (songs that keep the composite `raw` because the artist text would change), `review.multi_artist_countries`, `review.conflicting_countries` (never applied) and `review.leftover_tags` (non-genre tags kept in `tags`), `tag_view_changes` (expected: `lang:` tags gone, countries of multi-artist songs gone). A status `aborted` lists the songs whose `artist`, `remixer`, `year`, `remix_year` or `album` would change: stop and fix, do not deploy.
4. Deploy the build (`scripts/deploy.sh`). On start each library is converted: backup, atomic rewrite, one git commit per user (`audioplayer: <uid> migrate data model 2`), `updated_at` untouched. Log lines: `data model 2 migrated for <uid>` or `data model 2 migration aborted` (the library stays unchanged and is served through the in-memory loader). The review lists are in `<data repo>/backups-model2/review-model2-<uid>.json`.
5. Guest snapshot AFTER: `curl -s https://electrophone.cc/library > after.json`. Compare song by song: `artist`, `remixer`, `year`, `remix_year`, `album`, `title`, `id`, `bpm`, `audio_state` must be identical; `tags` may differ only by the removed `lang:` values and by `country:` values of songs with several main artists; the new fields (`mainArtists`, `featuredArtists`, `releaseYear`, `albums`, `genres`, `version.type`, ...) are the expected additions, and `artists`, `featured`, `released`, `raw`, `version.kind/by/year/of` are the expected removals. `GET /artists` lists the Artist table. Run `scripts/check.sh`-style API checks and one Add, Edit and Play on the web UI.
6. Rollback: deploy the previous revision and restore `users/<uid>/library.json` from `backups-model2/<uid>/library.json` (later edits are lost); then restart. A forward fix is preferred.

## Data model v3 migration (countries back on songs)

Deployed 2026-10-18 (ADR-0031, task-0049, DATA-164 to DATA-166). The server migrates every schema-2 `library.json` once at startup (`app.migrate_model3`, right after `app.migrate_model2`): the countries go back onto the songs as `country:` tags and the Artist table is removed. It needs the model-2 state, so deploy it after the data model v2 migration. The code and the migrated files cannot be rolled back separately: an older build reads the countries of single-artist songs back into its table on the next save and drops those of songs with several main artists.

1. Backup by hand, outside the git tree: copy `users/<uid>/library.json` of every user to a dated folder, and also `<data repo>/backups-model2/<uid>/` (the pre-v2 file; the migration reads it, `library.json` is the original, numbered copies are later repeats). Check that the pre-v2 file is really the old one: its songs have `tags` with `country:` values and no `mainArtists`.
2. Guest snapshot BEFORE: `curl -s https://electrophone.cc/library > before3.json`.
3. Dry run on a COPY of the live file and of the pre-v2 backup, with the new code, nothing is written except the report:
   `cd server && PYTHONPATH=. python -m app.migrate_model3 --library /path/copy/users/<uid>/library.json --legacy-backup /path/copy/backups-model2/<uid>/library.json --report report3.json`.
   Expect `status: dry_run`, `anomalies: []`. Read the numbers: `songs`, `countries_restored_from_backup` (songs whose countries came from the backup, e.g. the artists the model-2 migration left without a country), `countries_taken_from_table`, `countries_already_on_song`, `left_empty`, `artists_table_removed` and `table_and_backup_disagree` (song ids where the table, edited after model 2, and the backup differ: the table wins; look at a few). A status `aborted` lists the anomalies: stop and fix, do not deploy. Never run `--apply` against the live path by hand; the server does it at start.
4. Deploy the build (`scripts/deploy.sh`). On start each library is converted: backup `<data repo>/backups-model3/<uid>/library.json` (numbered, never overwritten), atomic rewrite, one git commit per user (`audioplayer: <uid> migrate data model 3`), `updated_at` untouched. Log lines: `data model 3 migrated for <uid>` or `data model 3 migration aborted` / `skipped` (the library stays unchanged and is served; its Artist table is carried along untouched until the migration succeeds, and countries are not shown meanwhile).
5. Guest snapshot AFTER: `curl -s https://electrophone.cc/library > after3.json`. Compare song by song: every legacy field (`artist`, `remixer`, `year`, `remix_year`, `album`, `title`, `id`, `bpm`, `audio_state`, `mainArtists`, `featuredArtists`, `releaseYear`, `albums`, `genres`, `version`) must be identical; `tags` may differ only by `country:` values; `artists` is the expected removal and `credits_schema` is 3. `GET /artists` answers 404. Check the Kate Bush and Kato songs (one country per song, as in the old library), run `scripts/check.sh`-style API checks and one Add, Edit (add a second country) and Play on the web UI and the iOS app.
6. Rollback: deploy the previous revision and restore `users/<uid>/library.json` from `backups-model3/<uid>/library.json` (the schema-2 file with its table; later edits are lost), then restart. A forward fix is preferred.

## Verify

1. `scripts/deploy.sh` ends with the new short SHA and `web index: 200`.
2. `curl -s https://electrophone.cc/health` gives `{"status":"ok","sync":"ok"}`.
3. `systemctl status audioplayer` is active, `journalctl -u audioplayer -n 50` has no traceback.
4. Open the site signed in: Library lists songs, one song plays, cover loads.
5. The page `<script>` URLs start with `/_v/<version>/` and the version changed (API-051).

## Operations

- <a id="identification-keys"></a>Identification keys (optional, API-070, NFR-070): the keys go only into `/etc/audioplayer/env` (`chmod 600`), never into the repo, a chat or a log. Add `ACOUSTID_API_KEY=<key>` (register an application at https://acoustid.org/new-application; the key is free) and `DISCOGS_TOKEN=<token>` (personal access token from https://www.discogs.com/settings/developers, "Generate new token"); optionally `ACOUSTID_MIN_SCORE` (default `0.9`) and `AUDIO_FPCALC` (default `fpcalc`). The fingerprint source also needs the Chromaprint tool: `sudo apt install libchromaprint-tools` in the LXC (provides `fpcalc`). Then `sudo systemctl restart audioplayer`. Check without printing the keys: `fpcalc -version`, and the song Edit dialog enables "Identify from audio". Either key may be left out; that source stays off.
- <a id="genre-vocabulary"></a>Genre vocabulary (TAG-077 to TAG-084, ADR-0023): the canonical `genre:` list is data in the repo, `server/data/genre_styles.json` (512 Discogs styles under the 15 genres) and `server/data/genre_extras.json` (65 reviewed extras), read once at start (the server refuses to start without them); `server/data/README.md` has the source, terms and refresh steps. After a deploy the first start rewrites stored tags that map (backup in `<data repo>/backups-genre-merge/<uid>/library.json`) and writes the tags it cannot map, kept on the songs, to `<data repo>/backups-genre-merge/review-<uid>.json` (also logged as `genre review: N unmappable genre tags kept`). Read it with `cat`, then add an alias or retag in `server/app/genre_filter.py` or an entry in `genre_extras.json` and redeploy; a clean library gives `"unmappable": []`. Writes outside the list answer 422 `unknown_genre`; the list is `GET /genres/vocabulary`. Refresh from Discogs: list the new names (the Discogs Genres and Styles help article, or single checks with `https://api.discogs.com/database/search?style=<name>`, no token, at most 25 requests a minute and a descriptive User-Agent), diff against `genre_styles.json`, review in git, run `sh scripts/check.sh`.
- Close signup: set `SIGNUP_OPEN=0` in `/etc/audioplayer/env` and `sudo systemctl restart audioplayer`. Existing users and the owner keep working, new sign-ins get 403 `signup_closed` (NFR-051). Set `1` (or remove the line) to reopen.
- Change a limit (`USER_MAX_SONGS`, `USER_MAX_BYTES`, `USER_ADDS_PER_HOUR`, `POOL_MAX_BYTES`, ...): same file, same restart.
- yt-dlp broken: `sudo systemctl start audioplayer-ytdlp-update.service` (upgrades and restarts).
- Pool usage: `du -sh /srv/music/users`; the server refuses new audio at `POOL_MAX_BYTES` (API-044).

## Public guest view

- Anonymous visitors see the owner's library read-only (ADR-0018, API-090..094). Env in `/etc/audioplayer/env`, then `sudo systemctl restart audioplayer`: `PUBLIC_VIEW` (default 1; `0` = off, anonymous gets 401 everywhere), `PUBLIC_AUDIO` (default 1; `0` = guests get metadata only, no audio), `PUBLIC_VIEW_EMAIL` (default the owner), `GUEST_REQ_PER_MIN` (240), `GUEST_AUDIO_MB_PER_HOUR` (1024), `GUEST_MAX_STREAMS` (3), all per client IP.
- The client IP is `CF-Connecting-IP` when the TCP peer is loopback or a private LAN address (cloudflared runs on the same host), else the socket address. Never expose uvicorn directly to the internet, or behind another proxy on a LAN address, or the header can be spoofed.
- Emergency off: `PUBLIC_VIEW=0` (everything) or `PUBLIC_AUDIO=0` (audio only). Cloudflare's terms restrict large media through the proxy; if traffic grows, switch `PUBLIC_AUDIO` off.

## Hostnames

| Variable | Default | Effect |
| --- | --- | --- |
| `PUBLIC_HOSTS` | unset (any host) | Comma list of hosts the app answers on; absolute URLs are only built from these (a Host outside the list falls back to `CANONICAL_HOST` or the first entry) |
| `CANONICAL_HOST` | unset (no redirect) | GET/HEAD on any other host get a 308 to `https://<CANONICAL_HOST><path+query>`; `/health`, `/robots.txt`, `/legal` and writes are exempt |
| `OAUTH_REDIRECT_URIS` | unset | Comma list of Apple web redirect URIs; the one matching the request host is served by `GET /auth/config`, else the first. Beats `APPLE_WEB_REDIRECT_URI` |
| `LEGAL_CONTACT` | unset | Optional email address or `https://` URL shown as the contact for song removal in the copyright note (`GET /legal`). Use a dedicated alias, not a personal address; invalid values are ignored with a startup warning |

`X-Forwarded-Host` is trusted only from a loopback or LAN peer. Sessions are host-only cookies: sign in again on each host. Steps: [domain-migration.md](domain-migration.md).

## Git sync timer

Built, not deployed (ADR-0026, [task-0021](../tasks/task-0021.md), [design](git-sync-design.md)); the timer is NOT yet installed on perkunas. Saves commit locally (no pull, no push in a request); `audioplayer-gitsync.timer` only pushes. Unit files are in `deploy/systemd/` (`audioplayer-gitsync.service`, `audioplayer-gitsync.timer`, `README.md`). The deploy user `claude` cannot write `/etc/systemd`, so root installs them once; `scripts/deploy.sh` does not.

| Env (in `/etc/audioplayer/env`, read by the server and the CLI) | Default | Meaning |
| --- | --- | --- |
| `GIT_SYNC_MODE` | `timer` | `timer`: commit only, the timer pushes. `request`: the old synchronous pull, commit and push in the request (rollback, kept for one release) |
| `GIT_SYNC_INTERVAL_S` | `60` | must match the timer interval |
| `GIT_SYNC_STALE_GRACE_S` | `30` | stale threshold = interval + grace (90 s) |
| `GIT_SYNC_STATE_FILE` | `/var/lib/audioplayer/gitsync-state.json` | heartbeat and failure counters written by the CLI, read by the server |
| `GIT_SYNC_INBOUND` | `1` | `1`: the timer also fast-forwards from GitHub (ADR-0027); `0`: push-only as in ADR-0026 (rollback). Also creates `<GIT_SYNC_STATE_FILE>.write.lock`, the lock file saves and the pull share (same directory, no setup) |
| `GIT_SYNC_REBASE_FOREIGN` | `1` | `1`: unpushed local commits are rebased over GitHub commits that stay outside the owned paths (ADR-0028); `0`: any divergence is an error (ADR-0027). Needs `GIT_SYNC_INBOUND` not `0` |
| `GIT_SYNC_OWNED_PREFIXES` | `audioplayer/` | comma-separated repo paths only the server writes; keep equal to the tree saves stage (`audioplayer/` in both repos) |

Install (root, once):

```sh
install -m 644 deploy/systemd/audioplayer-gitsync.service deploy/systemd/audioplayer-gitsync.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now audioplayer-gitsync.timer
```

Until the timer is installed the app still works: saves commit locally, `/health` `sync` goes `pending`, then `stale` after 90 s, and the Settings sync card says the push timer is not installed or not running (`timer_seen: false`).

Verify:

- `systemctl list-timers audioplayer-gitsync.timer`, `journalctl -u audioplayer-gitsync`.
- `scripts/check-gitsync.sh` (read-only, runs `python -m app.gitsync --status` as the service user): prints `state`, `unpushed`, `oldest_unpushed_age_s`, `last_push_at`, `timer_seen`; exit 0 for `ok` or `pending`, 1 for `stale`, 2 for `error`, 3 when the state cannot be read.
- One save in the web UI: `pending`, then `ok` within about 60 s. Stop the timer: `stale` after 90 s, with the "timer not installed or not running" text; start it: back to `ok`.
- `/health` owner form (with `X-API-Token`) shows the full `sync` object; everyone else sees only `ok` or `degraded` (API-137).

Rules:

- The CLI per repo: `git fetch`, a fast-forward when GitHub is ahead and nothing is unpushed (ADR-0027, below), then `git push` when local is ahead. Never a rebase, merge commit or force. Only the fast-forward takes the write lock (a short flock shared with saves); the fetch and the push run without it. The server also fast-forwards at startup, after sweeping stray `.json-*.tmp` files and committing a dirty tree.
- Single writer for commits: only the `audioplayer` user creates commits on the server clones of `data-storage` and `data-storage-lfs`; commits made elsewhere arrive only as a fast-forward (NFR-114, NFR-118).
- Alerts: ERROR lines in the journal (`audioplayer-gitsync`, and logger `audioplayer.git` in the server), the `error` state and `last_error` in `/health` (owner form), the Settings card mark. No external channel yet.

Rejected-push runbook (only with `GIT_SYNC_INBOUND=0`; otherwise see the next section; `sync` is `error`, `repos[].rejected` true; the CLI skips that repo and never merges):

1. As the service user in the repo (`/var/lib/audioplayer/<data repo>`): `git fetch`, then inspect `git log HEAD..@{u}` (remote only) and `git log @{u}..HEAD` (local only).
2. Combine by hand: `git rebase @{u}` (resolve conflicts), then `git push`.
3. The mark clears on its own once nothing is unpushed and `HEAD` contains `@{u}`; otherwise `python -m app.gitsync --clear-rejected data` (or `covers`).
4. No restart is needed: the server reads the files on every request.

Rollback: set `GIT_SYNC_MODE=request` in `/etc/audioplayer/env`, `systemctl disable --now audioplayer-gitsync.timer`, restart `audioplayer`, then run `python -m app.gitsync` once as the service user to push leftovers.

### Fixing data from GitHub (inbound fast-forward)

Built, not deployed (ADR-0027). To correct data without touching the server: edit the file in `data-storage` on GitHub (for example `audioplayer/users/<uid>/library.json`), or push a commit from a clone that is up to date with `origin/main`. Within 60 s the next timer run fetches it and fast-forwards the server clone; the server reads files on every request, so no restart is needed. Check `journalctl -u audioplayer-gitsync` ("fast-forwarded N commit(s)") or `/health` owner form `sync.inbound.last_pull_at`.

- The change must be a plain fast-forward of what the server last pushed. A browser edit or `git pull --rebase` then `git push` from a clone always is, as long as the server did not save in between.
- Invalid JSON is refused, not applied: `sync.state` `error`, `last_error` "data: inbound change invalid (path)", the file named in the journal. Fix the file on GitHub; the next run applies it and the error clears by itself.
- Diverged (`last_error` "data diverged: GitHub and the server both have new commits; resolve by hand", exit code 2, ERROR line every run, nothing pulled or pushed): a save on the server and a change on GitHub landed in the same minute. As the service user (`sudo -u audioplayer -i`) in the repo (`/var/lib/audioplayer/<data repo>`): `git fetch`; inspect `git log HEAD..@{u}` (GitHub only) and `git log @{u}..HEAD` (server only); `git rebase @{u}` (resolve conflicts in `library.json` by hand, keep both sets of edits); `git push`. The error clears on the next run, no restart or `--clear-rejected` is needed (the server reads the rebased file on its next request). If the server file was rewritten under a request in between, nothing is lost: both sides are in git.
- Another app in the same repo (the `moodtracker` case, ADR-0028): `moodtracker` pushes commits under `moodtracker/users/<id>/...` while the server has unpushed commits. The next timer run logs INFO `rebased N local commits over M foreign commits (paths outside audioplayer/)`, rebases only the server's unpushed commits and pushes; `/health` owner `sync.inbound.last_rebase_at` and `foreign_commits` show it, nothing to do. A push that loses the race to a second foreign push is a one-run retry; only 5 in a row turn the state into `error` "not reaching git". Rollback: `GIT_SYNC_REBASE_FOREIGN=0`.
- A real overlap (GitHub-only commits touch `audioplayer/`, someone edited our files, or a conflict/invalid file aborted the rebase; the repo is left exactly as it was): use the diverged runbook above (`git fetch`, inspect `git log --name-only HEAD..@{u}`, `git rebase @{u}`, resolve, `git push`). Only rebase commits that were never pushed.
- A pull that finds the write lock busy (a save is running) skips and retries next minute; a save waits at most the length of a fast-forward (well under a second).
- Rollback: `GIT_SYNC_INBOUND=0` in `/etc/audioplayer/env`; the timer then only pushes, and a moved GitHub is the old sticky `rejected` error. No unit file change is needed for this feature (same units, same `/etc/audioplayer/env`); the lock file is created next to the state file by the service user.
