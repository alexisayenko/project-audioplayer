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

- The CLI only runs `git push` per repo with unpushed commits, takes no repo lock and never pulls. The server pulls only at startup (fetch plus fast-forward, never a rebase), after sweeping stray `.json-*.tmp` files and committing a dirty tree.
- Single writer: only the `audioplayer` user commits to `data-storage` and `data-storage-lfs`; nobody edits them by hand or from another host (NFR-114).
- Alerts: ERROR lines in the journal (`audioplayer-gitsync`, and logger `audioplayer.git` in the server), the `error` state and `last_error` in `/health` (owner form), the Settings card mark. No external channel yet.

Rejected-push runbook (`sync` is `error`, `repos[].rejected` true; the CLI skips that repo and never merges):

1. As the service user in the repo (`/var/lib/audioplayer/<data repo>`): `git fetch`, then inspect `git log HEAD..@{u}` (remote only) and `git log @{u}..HEAD` (local only).
2. Combine by hand: `git rebase @{u}` (resolve conflicts), then `git push`.
3. The mark clears on its own once nothing is unpushed and `HEAD` contains `@{u}`; otherwise `python -m app.gitsync --clear-rejected data` (or `covers`).
4. `systemctl restart audioplayer` if the server tree was changed under it (it reloads data at startup only).

Rollback: set `GIT_SYNC_MODE=request` in `/etc/audioplayer/env`, `systemctl disable --now audioplayer-gitsync.timer`, restart `audioplayer`, then run `python -m app.gitsync` once as the service user to push leftovers.
