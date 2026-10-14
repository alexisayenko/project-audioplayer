#!/bin/sh
set -e
cd "$(dirname "$0")/.."

# node and python live in WSL on Windows; re-run this script there when not available natively
if ! command -v node >/dev/null 2>&1 && command -v wsl >/dev/null 2>&1; then
  exec wsl sh -c "cd \"\$(wslpath '$(pwd -W 2>/dev/null || pwd)')\" && sh scripts/check.sh"
fi

total=0
failed=0
empty=0
for f in ${WEB_TEST_FILES:-web/js/*.test.mjs}; do
  total=$((total + 1))
  grep -q -E "(^|[^A-Za-z])(test|it|assert)[.(]" "$f" || { echo "NO TESTS: $f"; empty=$((empty + 1)); }
  if out=$(node --test "$f" 2>&1) && ! echo "$out" | grep -q -E '^[[:space:]]*not ok'; then :; else
    failed=$((failed + 1))
    echo "FAIL: $f"
    echo "$out" | grep -E '^[[:space:]]*not ok|Error' | head -10
  fi
done
echo "web: $total files, $failed failed"
[ "$failed" -eq 0 ] && [ "$empty" -eq 0 ] || exit 1

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
