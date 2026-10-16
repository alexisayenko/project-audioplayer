#!/bin/sh
# Read-only: prints the git sync state. Exit 0 ok|pending, 1 stale, 2 error, 3 unreadable.
APP_DIR=${APP_DIR:-/opt/audioplayer/server}
PY=${PY:-/opt/audioplayer/venv/bin/python}
ENV_FILE=${ENV_FILE:-/etc/audioplayer/env}
SERVICE_USER=${SERVICE_USER:-audioplayer}

if command -v systemctl >/dev/null 2>&1; then
  printf 'timer_enabled: %s\n' "$(systemctl is-enabled audioplayer-gitsync.timer 2>&1 | head -n 1)"
  printf 'timer_active: %s\n' "$(systemctl is-active audioplayer-gitsync.timer 2>&1 | head -n 1)"
fi

inner="set -a; [ -r '$ENV_FILE' ] && . '$ENV_FILE'; set +a; cd '$APP_DIR' && '$PY' -m app.gitsync --status"
if [ "$(id -un)" = "$SERVICE_USER" ]; then
  out=$(sh -c "$inner" 2>&1)
elif [ "$(id -u)" = "0" ] && command -v runuser >/dev/null 2>&1; then
  out=$(runuser -u "$SERVICE_USER" -- sh -c "$inner" 2>&1)
else
  out=$(sudo -n -u "$SERVICE_USER" sh -c "$inner" 2>&1)
fi
rc=$?
if [ $rc -ne 0 ]; then
  echo "cannot read sync status: $out" | head -n 5
  exit 3
fi

printf '%s' "$out" | "$PY" -c '
import json, sys
try:
    d = json.load(sys.stdin)
except ValueError:
    print("cannot parse sync status")
    sys.exit(3)
s = d.get("sync", d)
for k in ("state", "unpushed", "oldest_unpushed_age_s", "last_push_at", "timer_seen"):
    print("%s: %s" % (k, s.get(k)))
sys.exit({"ok": 0, "pending": 0, "stale": 1, "error": 2}.get(s.get("state"), 3))
'
exit $?
