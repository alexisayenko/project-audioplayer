# Deploy runbook

Status: Accepted · 2026-10-14. Live at https://play.isayenko.net since 2026-10-13 (ADR-0004). Design background: [architecture.md](architecture.md); env vars and limits: [architecture.md](architecture.md#limits-and-environment-adr-0012).

## Where things live

| What | Where |
| --- | --- |
| Host | `perkunas` (Proxmox), LXC 106 `tools` (Debian 13, `192.168.0.10`), shared with Immich |
| Service | systemd `audioplayer.service`, user `audioplayer`, code in `/opt/audioplayer` (git clone of this repo, branch `main`) |
| Public URL | Cloudflare Tunnel ingress `play.isayenko.net` -> the service on `192.168.0.10:8000` (uvicorn `--host 0.0.0.0 --port 8000`). `cloudflared` does not run on LXC 106; its host, config path and ingress line are not verified. Tailscale is not used |
| Venv | `/opt/audioplayer/venv` (`ExecStart=/opt/audioplayer/venv/bin/uvicorn app.main:app`, working dir `/opt/audioplayer/server`) |
| Env file | `/etc/audioplayer/env`, loaded by the unit (secrets; never in a repo, never printed). Keys present: `AUDIO_API_TOKEN`, `AUDIO_DATA_REPO`, `AUDIO_COVERS_REPO`, `AUDIO_HOSTS`, `AUDIO_DATA_DIR`, `ALLOWED_EMAIL`, `GOOGLE_WEB_CLIENT_ID`, `APPLE_WEB_CLIENT_ID`, `APPLE_AUDIENCE`, `GOOGLE_CLIENT_ID`, `AUDIO_SESSION_SECRET`; optional host keys `PUBLIC_HOSTS`, `CANONICAL_HOST`, `OAUTH_REDIRECT_URIS` (ADR-0019, see [Hostnames](#hostnames)); no limit keys are set, so the defaults apply |
| Audio | ZFS dataset `pool-3/music` (single disk, no redundancy), mounted in the LXC at `/srv/music` (`AUDIO_DATA_DIR`); files under `/srv/music/users/<uid>/` |
| Metadata | the server's own clones, in `/var/lib/audioplayer/`, of `data-storage` (`audioplayer/users/<uid>/{profile,library}.json`) and `data-storage-lfs` (covers), pushed on every write (ADR-0005, ADR-0012) |
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

## Verify

1. `scripts/deploy.sh` ends with the new short SHA and `web index: 200`.
2. `curl -s https://play.isayenko.net/health` gives `{"status":"ok","sync":"ok"}`.
3. `systemctl status audioplayer` is active, `journalctl -u audioplayer -n 50` has no traceback.
4. Open the site signed in: Library lists songs, one song plays, cover loads.
5. The page `<script>` URLs start with `/_v/<version>/` and the version changed (API-051).

## Operations

- <a id="identification-keys"></a>Identification keys (optional, API-070, NFR-070): the keys go only into `/etc/audioplayer/env` (`chmod 600`), never into the repo, a chat or a log. Add `ACOUSTID_API_KEY=<key>` (register an application at https://acoustid.org/new-application; the key is free) and `DISCOGS_TOKEN=<token>` (personal access token from https://www.discogs.com/settings/developers, "Generate new token"); optionally `ACOUSTID_MIN_SCORE` (default `0.9`) and `AUDIO_FPCALC` (default `fpcalc`). The fingerprint source also needs the Chromaprint tool: `sudo apt install libchromaprint-tools` in the LXC (provides `fpcalc`). Then `sudo systemctl restart audioplayer`. Check without printing the keys: `fpcalc -version`, and the song Edit dialog enables "Identify from audio". Either key may be left out; that source stays off.
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
