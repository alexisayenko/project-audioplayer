#!/bin/sh
set -e
cd "$(dirname "$0")/.."

# node and python live in WSL on Windows; re-run this script there when not available natively
if ! command -v node >/dev/null 2>&1 && command -v wsl >/dev/null 2>&1; then
  exec wsl sh -c "cd \"\$(wslpath '$(pwd -W 2>/dev/null || pwd)')\" && sh scripts/check.sh"
fi

for f in web/js/*.test.mjs; do
  node "$f" >/dev/null 2>&1 || { echo "FAIL: $f"; node "$f" 2>&1 | grep -E '^not ok|Error' | head -10 || true; exit 1; }
done
echo "web tests ok"

dups=$(cat docs/specs/*.md | grep -o -E '^- [A-Z]{2,5}-[0-9]+' | sort | uniq -d)
if [ -n "$dups" ]; then
  echo "FAIL: duplicate rule IDs:"
  echo "$dups"
  exit 1
fi
echo "rule IDs ok"

py=python3
for c in "$HOME/ap2venv/bin/python" "$HOME/ap2venv/bin/python3"; do [ -x "$c" ] && py="$c" && break; done
if out=$(cd server && PYTHONPATH=. "$py" -m pytest -q --no-header -p no:cacheprovider 2>&1); then
  echo "$out" | tail -n 1
else
  echo "$out" | tail -n 15
  echo "FAIL: server tests"
  exit 1
fi

echo "check ok"
