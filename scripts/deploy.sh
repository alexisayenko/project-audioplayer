#!/bin/sh
set -e
if command -v node >/dev/null 2>&1; then
  node "$(dirname "$0")/build-web.mjs" --check || [ "${SKIP_WEB_DIST_CHECK:-0}" = 1 ] || { echo "deploy stopped: rebuild web/dist, commit and push it, then deploy again (SKIP_WEB_DIST_CHECK=1 deploys anyway; the server then serves the unbundled files)"; exit 1; }
else
  echo "node not found: web/dist freshness not checked"
fi
ssh -o BatchMode=yes claude@192.168.0.10 'sudo -n /usr/local/sbin/audioplayer-deploy'
ssh -o BatchMode=yes claude@192.168.0.10 'cd /opt/audioplayer && g="git -c safe.directory=/opt/audioplayer" && $g log --oneline -1 && { printf "sha=%s\ncommitted_at=%s\ndeployed_at=%s\n" "$($g log -1 --format=%H)" "$($g log -1 --format=%cI)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > BUILD; } 2>/dev/null || echo "BUILD file not written (the server falls back to git and its start time)"'
curl -s -m 10 -o /dev/null -w "web index: %{http_code}\n" https://electrophone.cc/
ssh -o BatchMode=yes claude@192.168.0.10 'sh -s' <<'REMOTE'
i=0; last=""; b=""
while [ "$i" -lt 60 ]; do
  b=$(curl -s -m 3 http://127.0.0.1:8000/health) || b=""
  case "$b" in
    *'"ready":false'*) now="starting" ;;
    *'"ready":true'*|*'"status":"ok"'*) echo "health: ready after ${i}s"; exit 0 ;;
    *) now="waiting" ;;
  esac
  [ "$now" = "$last" ] || { echo "health: $now"; last="$now"; }
  i=$((i + 1)); sleep 1
done
echo "health: not ready after 60 s (last answer: ${b:-none})"; exit 1
REMOTE
