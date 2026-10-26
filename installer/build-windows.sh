#!/usr/bin/env bash
# Builds Offox on Windows and makes the installer (normal or portable choice):
#   dist/Offox-<version>-Setup.exe
#
# Run inside the MozillaBuild shell (C:\mozilla-build\start-shell.bat):
#   installer/build-windows.sh [firefox source folder]
#
# Needs Visual Studio 2022 Build Tools (mach bootstrap explains), ~40 GB of
# disk and a few hours the first time.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
FF="${1:-$REPO/../firefox-esr}"
BRANCH="$(cut -d' ' -f1 "$REPO/fork/FIREFOX_VERSION")"
OUT="$REPO/dist"

if [[ ! -d "$FF/.git" ]]; then
  echo "== Downloading Firefox $BRANCH source to $FF"
  git clone --branch "$BRANCH" --depth 1 https://github.com/mozilla-firefox/firefox.git "$FF"
fi

echo "== Applying Offox"
python3 "$REPO/fork/apply.py" "$FF" --platform windows

cd "$FF"
./mach --no-interactive bootstrap --application-choice browser
./mach build
./mach package

ZIP="$(ls -t obj-offox/dist/offox-*.win64.zip | head -1)"
VERSION="$(basename "$ZIP" | sed -E 's/^offox-([0-9.]+)(esr)?\..*/\1/')"
STAGE="$(mktemp -d)"
unzip -q "$ZIP" -d "$STAGE"
mkdir -p "$OUT"
MAKENSIS="$(command -v makensis || echo /c/mozilla-build/bin/makensis.exe)"
"$MAKENSIS" -V2 \
  "-DSTAGE=$(cygpath -w "$STAGE/offox")" \
  "-DVERSION=$VERSION" \
  "-DOUTFILE=$(cygpath -w "$OUT/Offox-$VERSION-Setup.exe")" \
  "$(cygpath -w "$REPO/installer/windows/offox.nsi")"
rm -rf "$STAGE"
echo "Done: $OUT/Offox-$VERSION-Setup.exe"
