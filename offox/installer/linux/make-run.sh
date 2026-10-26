#!/usr/bin/env bash
# Builds the self-extracting Linux installer from the output of
# "./mach package" (offox-<version>.en-US.linux-x86_64.tar.xz).
#
#   installer/linux/make-run.sh <offox tarball> [output folder]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARBALL="$1"
OUT="${2:-.}"
NAME="$(basename "$TARBALL")"
VERSION="$(echo "$NAME" | sed -E 's/^offox-([^.]+(\.[0-9a-z]+)*)\.en-US.*/\1/')"
mkdir -p "$OUT"
RUN="$OUT/Offox-$VERSION-linux-x86_64.run"
sed "s/@VERSION@/$VERSION/" "$HERE/installer-header.sh" > "$RUN"
case "$TARBALL" in
  *.tar.xz) cat "$TARBALL" >> "$RUN" ;;
  *.tar.bz2) bzip2 -dc "$TARBALL" | xz -T0 >> "$RUN" ;;
  *) echo "Expected a .tar.xz or .tar.bz2 from mach package"; exit 1 ;;
esac
chmod +x "$RUN"
echo "$RUN"
