#!/bin/sh
set -e
cd "$(dirname "$0")/.."

node --test web/js >/dev/null 2>&1 || { echo "FAIL: node --test web/js"; node --test web/js 2>&1 | grep -E '^not ok|FAIL' || true; exit 1; }
for f in web/js/*.test.mjs; do
  node "$f" >/dev/null 2>&1 || { echo "FAIL: $f"; exit 1; }
done
echo "web tests ok"

dups=$(cat docs/specs/*.md | grep -o -E '^- (WEB|IOS|ADD|LIB|PLY|TAG|API|DAT|NFR)-[0-9]+' | sort | uniq -d)
if [ -n "$dups" ]; then
  echo "FAIL: duplicate rule IDs:"
  echo "$dups"
  exit 1
fi
echo "rule IDs ok"

py=/private/tmp/claude-501/-Users-aisayenko-alex-project-audioplayer/259bf2a3-4380-4ce7-9ab9-2c718763b66f/scratchpad/venv/bin/python
[ -x "$py" ] || py=python3
if out=$(cd server && "$py" -m pytest -q --no-header -p no:cacheprovider 2>&1); then
  echo "$out" | tail -n 1
else
  echo "$out" | tail -n 15
  echo "FAIL: server tests"
  exit 1
fi

echo "check ok"
