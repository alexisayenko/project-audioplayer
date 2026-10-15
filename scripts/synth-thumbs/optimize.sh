#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "$0")/../../web/img/synth-presets" && pwd)"
colors="${1:-128}"
for f in "$dir"/*.png; do
  tmp="$f.tmp.png"
  ffmpeg -v error -y -i "$f" -vf "split[a][b];[a]palettegen=max_colors=$colors:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" "$tmp"
  mv "$tmp" "$f"
  echo "$(basename "$f") $(stat -c %s "$f")"
done
