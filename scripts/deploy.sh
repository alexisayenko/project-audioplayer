#!/bin/sh
set -e
ssh -o BatchMode=yes claude@192.168.0.10 'sudo -n /usr/local/sbin/audioplayer-deploy'
ssh -o BatchMode=yes claude@192.168.0.10 'cd /opt/audioplayer && g="git -c safe.directory=/opt/audioplayer" && $g log --oneline -1 && { printf "sha=%s\ncommitted_at=%s\ndeployed_at=%s\n" "$($g log -1 --format=%H)" "$($g log -1 --format=%cI)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > BUILD; } 2>/dev/null || echo "BUILD file not written (the server falls back to git and its start time)"'
curl -s -m 10 -o /dev/null -w "web index: %{http_code}\n" https://electrophone.cc/
