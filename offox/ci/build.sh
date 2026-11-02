#!/usr/bin/env bash
# One build step of the release workflow (.github/workflows/release.yml).
#
#   offox/ci/build.sh linux|windows <minutes>
#
# Compiles with sccache (its cache is saved between jobs), stops after
# <minutes> so the job can save the cache before GitHub's 6 hour limit, and
# prints done=true|false to $GITHUB_OUTPUT. A later job continues the build
# from the cache. When the build is complete it packages Offox:
#   linux:   dist/Offox-<version>-x86_64.AppImage and the .tar.xz
#   windows: dist/Offox-<version>-Setup.exe and the .zip
set -euo pipefail
PLATFORM="$1"
MINUTES="$2"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO/dist"
cd "$REPO"
case "$PLATFORM" in
  linux) export MOZCONFIG="$REPO/offox/fork/mozconfig.linux" ;;
  windows) export MOZCONFIG="$REPO/offox/fork/mozconfig.windows-cross" ;;
  *) echo "usage: $0 linux|windows <minutes>"; exit 2 ;;
esac
export OFFOX_OBJDIR="${OFFOX_OBJDIR:-$REPO/obj-$PLATFORM}"
export MOZ_NOSPAM=1 MACH_NO_TERMINAL_FOOTER=1 MACH_NO_WRITE_TIMES=1
output() { echo "$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }

echo "::group::Bootstrap"
./mach --no-interactive bootstrap --application-choice browser
if [ "$PLATFORM" = windows ]; then
  "$HOME/.cargo/bin/rustup" target add x86_64-pc-windows-msvc
fi
echo "::endgroup::"

started=$(date +%s)
status=0
timeout --signal=INT --kill-after=5m "${MINUTES}m" ./mach build || status=$?
echo "Build took $(( ($(date +%s) - started) / 60 )) minutes (exit $status)."
"${OFFOX_SCCACHE:-sccache}" --show-stats || true
if [ "$status" = 124 ] || [ "$status" = 130 ] || [ "$status" = 137 ]; then
  echo "::notice::Build stopped after $MINUTES minutes; the next job continues from the compiler cache."
  output "done=false"
  exit 0
fi
[ "$status" = 0 ] || exit "$status"

echo "::group::Package"
./mach package
mkdir -p "$OUT"
if [ "$PLATFORM" = linux ]; then
  TARBALL="$(ls -t "$OFFOX_OBJDIR"/dist/offox-*.linux-x86_64.tar.* | head -1)"
  cp "$TARBALL" "$OUT/"
  "$REPO/offox/installer/linux/make-appimage.sh" "$TARBALL" "$OUT"
else
  "$REPO/offox/installer/windows/make-installer.sh" "$OFFOX_OBJDIR" "$OUT"
fi
echo "::endgroup::"
ls -la "$OUT"
output "done=true"
