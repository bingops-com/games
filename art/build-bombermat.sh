#!/usr/bin/env bash
# Format-only asset preparation. Preserve generated sources and their alpha.
set -euo pipefail
art_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
asset_root="$art_root/../web/public/games/bombermat"
command -v convert >/dev/null || { printf '%s\n' 'GraphicsMagick ou ImageMagick (convert) requis.' >&2; exit 1; }
mkdir -p "$asset_root"
for arena in classic crossroads bastions rings; do
  convert "$art_root/bombermat/src/$arena-background.png" -quality 88 "$asset_root/$arena-background.webp"
  convert "$art_root/bombermat/src/$arena-sprites.png" -quality 94 "$asset_root/$arena-sprites.webp"
done
