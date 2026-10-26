#!/bin/sh
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
dry=0
wrangler_version=4.153.0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    *) echo "usage: $0 [--dry-run]"; exit 2 ;;
  esac
done
node "$repo/scripts/build-studio.mjs"
if [ "$dry" = 1 ]; then
  echo "dry run: built studio/dist, nothing uploaded"
  exit 0
fi
[ -f "$HOME/.config/cloudflare/token.env" ] || { echo "deploy stopped: $HOME/.config/cloudflare/token.env is missing"; exit 1; }
(
  set -a
  . "$HOME/.config/cloudflare/token.env"
  set +a
  cd "$repo"
  wrangler_dir="${XDG_CACHE_HOME:-$HOME/.cache}/electrophone-wrangler-$wrangler_version"
  if [ ! -f "$wrangler_dir/node_modules/wrangler/bin/wrangler.js" ]; then
    mkdir -p "$wrangler_dir"
    echo '{"private":true}' > "$wrangler_dir/package.json"
    npm install --prefix "$wrangler_dir" --ignore-scripts --no-audit --no-fund --loglevel=error "wrangler@$wrangler_version"
  fi
  node "$wrangler_dir/node_modules/wrangler/bin/wrangler.js" pages deploy studio/dist --project-name electrophone-studio --branch main --commit-dirty=true
)
