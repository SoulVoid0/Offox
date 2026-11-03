#!/usr/bin/env bash
# Makes dist/Offox-<version>-Setup.exe with makensis (Linux or Windows) from
# the "mach package" zip of a Windows build.
#
#   offox/installer/windows/make-installer.sh <objdir> [output folder]
# Set OFFOX_WHISPER_DIR to a folder made by whisper/build-whisper.sh to
# include automatic subtitles.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OBJDIR="$1"
OUT="$(mkdir -p "${2:-.}" && cd "${2:-.}" && pwd)"
ZIP="$(ls -t "$OBJDIR"/dist/offox-*.win64.zip | head -1)"
VERSION="$(basename "$ZIP" | sed -E 's/^offox-([0-9.]+)(esr)?\..*/\1/')"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
unzip -q "$ZIP" -d "$STAGE"
# Speech recognition for automatic subtitles (offox/installer/whisper/build-whisper.sh).
if [ -n "${OFFOX_WHISPER_DIR:-}" ]; then
  cp -r "$OFFOX_WHISPER_DIR" "$STAGE/offox/whisper"
fi
cp "$ZIP" "$OUT/"
makensis -V2 "-DSTAGE=$STAGE/offox" "-DVERSION=$VERSION" \
  "-DOUTFILE=$OUT/Offox-$VERSION-Setup.exe" "$HERE/offox.nsi"
echo "$OUT/Offox-$VERSION-Setup.exe"
