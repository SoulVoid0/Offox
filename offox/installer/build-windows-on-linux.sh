#!/usr/bin/env bash
# Builds Windows Offox on Linux (cross-compiled, like Mozilla's own Windows
# builds) and makes the installer that asks for a normal or a portable install:
#   dist/Offox-<version>-Setup.exe
#   dist/offox-<version>.en-US.win64.zip     (the program, unpacked = portable)
#
#   offox/installer/build-windows-on-linux.sh
#
# Needs makensis (Fedora: sudo dnf install mingw32-nsis, Ubuntu: sudo apt
# install nsis), ~50 GB of disk and a few hours the first time.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO/dist"
export MOZCONFIG="$REPO/offox/fork/mozconfig.windows-cross"
export OFFOX_OBJDIR="${OFFOX_OBJDIR:-$REPO/obj-offox-win64}"
cd "$REPO"
if [ -z "${OFFOX_SKIP_BOOTSTRAP:-}" ]; then
  ./mach --no-interactive bootstrap --application-choice browser
fi
"${CARGO_HOME:-$HOME/.cargo}/bin/rustup" target add x86_64-pc-windows-msvc
./mach build
./mach package
"$REPO/offox/installer/windows/make-installer.sh" "$OFFOX_OBJDIR" "$OUT"
