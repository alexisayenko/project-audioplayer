# Git sync timer units

Install runbook for root, once. Design: [git-sync-design](../../docs/tech/git-sync-design.md), ADR-0026. Full operations text: [deploy.md](../../docs/tech/deploy.md#git-sync-timer).

Files: `audioplayer-gitsync.service` (oneshot, `python -m app.gitsync`), `audioplayer-gitsync.timer` (every 60 s). The deploy user `claude` cannot write `/etc/systemd`, so these are not installed by `scripts/deploy.sh`.

## Install

```sh
install -m 644 audioplayer-gitsync.service audioplayer-gitsync.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now audioplayer-gitsync.timer
```

Paths in the service assume `/opt/audioplayer/server`, `/opt/audioplayer/venv` and `/etc/audioplayer/env`; edit the files before copying if the layout differs. `GIT_SYNC_INTERVAL_S` in the env file must match the timer interval (default 60).

## Verify

```sh
systemctl list-timers audioplayer-gitsync.timer
journalctl -u audioplayer-gitsync -n 20
scripts/check-gitsync.sh
```

`scripts/check-gitsync.sh` exits 0 for `ok` or `pending`, 1 for `stale`, 2 for `error`, 3 when the state cannot be read.

## Update

Copy the changed unit, `systemctl daemon-reload`, `systemctl restart audioplayer-gitsync.timer`.

## Remove (rollback)

```sh
systemctl disable --now audioplayer-gitsync.timer
```

Then set `GIT_SYNC_MODE=request` in `/etc/audioplayer/env`, restart `audioplayer`, and run `python -m app.gitsync` once as the service user to push leftovers.

Until the timer is installed the app still works: saves commit locally, `/health` goes `pending`, then `stale` after 90 s, and the Settings sync card says the push timer is not installed or not running.
