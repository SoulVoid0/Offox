#!/usr/bin/env bash
# Builds Offox on Windows and makes the installer (normal or portable choice):
#   dist/Offox-<version>-Setup.exe
#
# Run inside the MozillaBuild shell (C:\mozilla-build\start-shell.bat):
#   offox/installer/build-windows.sh
# This repository is the Firefox ESR source with Offox already applied, so it
# builds in place.
#
# Needs Visual Studio 2022 Build Tools (mach bootstrap explains), ~40 GB of
# disk and a few hours the first time.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OFFOX="$REPO/offox"
OUT="$REPO/dist"
export MOZCONFIG="$OFFOX/fork/mozconfig.windows"

cd "$REPO"
./mach --no-interactive bootstrap --application-choice browser
./mach build
./mach package

ZIP="$(ls -t "${OFFOX_OBJDIR:-obj-offox}"/dist/offox-*.win64.zip | head -1)"
VERSION="$(basename "$ZIP" | sed -E 's/^offox-([0-9.]+)(esr)?\..*/\1/')"
STAGE="$(mktemp -d)"
unzip -q "$ZIP" -d "$STAGE"
mkdir -p "$OUT"
MAKENSIS="$(command -v makensis || echo /c/mozilla-build/bin/makensis.exe)"
"$MAKENSIS" -V2 \
  "-DSTAGE=$(cygpath -w "$STAGE/offox")" \
  "-DVERSION=$VERSION" \
  "-DOUTFILE=$(cygpath -w "$OUT/Offox-$VERSION-Setup.exe")" \
  "$(cygpath -w "$OFFOX/installer/windows/offox.nsi")"
rm -rf "$STAGE"
echo "Done: $OUT/Offox-$VERSION-Setup.exe"
