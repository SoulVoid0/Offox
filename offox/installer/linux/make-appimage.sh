#!/usr/bin/env bash
# Builds Offox-<version>-x86_64.AppImage from the output of "./mach package"
# (offox-<version>.en-US.linux-x86_64.tar.xz). The AppImage runs on any
# x86_64 Linux with glibc 2.17 or newer and GTK 3 (every current desktop).
#
#   offox/installer/linux/make-appimage.sh <offox tarball> [output folder]
#
# Downloads appimagetool the first time (or set APPIMAGETOOL to its path).
# Set OFFOX_WHISPER_DIR to a folder made by whisper/build-whisper.sh to
# include automatic subtitles.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARBALL="$(readlink -f "$1")"
OUT="$(mkdir -p "${2:-.}" && cd "${2:-.}" && pwd)"
NAME="$(basename "$TARBALL")"
VERSION="$(echo "$NAME" | sed -E 's/^offox-([0-9.]+)(esr)?\..*/\1/')"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

APPDIR="$WORK/Offox.AppDir"
mkdir -p "$APPDIR/usr/lib"
tar -xf "$TARBALL" -C "$APPDIR/usr/lib"
rm -f "$APPDIR/usr/lib/offox/offox-portable"
# Speech recognition for automatic subtitles (offox/installer/whisper/build-whisper.sh).
if [ -n "${OFFOX_WHISPER_DIR:-}" ]; then
  cp -r "$OFFOX_WHISPER_DIR" "$APPDIR/usr/lib/offox/whisper"
  chmod +x "$APPDIR"/usr/lib/offox/whisper/whisper-cli*
fi
install -m755 "$HERE/AppRun" "$APPDIR/AppRun"
install -m644 "$APPDIR/usr/lib/offox/browser/chrome/icons/default/default128.png" "$APPDIR/offox.png"
ln -s offox.png "$APPDIR/.DirIcon"
cat > "$APPDIR/offox.desktop" <<DESKTOP
[Desktop Entry]
Version=1.0
Name=Offox
GenericName=Offline Web Browser
Comment=Browse your own websites stored in folders - no internet needed
Exec=offox %u
Icon=offox
Terminal=false
Type=Application
MimeType=text/html;application/xhtml+xml;
StartupNotify=true
StartupWMClass=offox
Categories=Network;WebBrowser;
Keywords=offline;web;browser;
X-AppImage-Version=$VERSION
DESKTOP

TOOL="${APPIMAGETOOL:-}"
if [ -z "$TOOL" ]; then
  TOOL="$WORK/appimagetool"
  curl -fsSL -o "$TOOL" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
  chmod +x "$TOOL"
fi
TARGET="$OUT/Offox-$VERSION-x86_64.AppImage"
# Extract-and-run: works without FUSE (CI containers).
APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 "$TOOL" --no-appstream "$APPDIR" "$TARGET"
echo "$TARGET"
