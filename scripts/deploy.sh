#!/bin/sh
set -e
ssh -o BatchMode=yes claude@192.168.0.10 'sudo -n /usr/local/sbin/audioplayer-deploy'
ssh -o BatchMode=yes claude@192.168.0.10 'cd /opt/audioplayer && git -c safe.directory=/opt/audioplayer log --oneline -1'
curl -s -m 10 -o /dev/null -w "web index: %{http_code}\n" https://play.isayenko.net/
