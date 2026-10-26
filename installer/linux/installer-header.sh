#!/bin/sh
# Offox installer for Linux (self-extracting). Run it and pick:
#   1) Normal install   - Offox in your applications menu, settings in ~/.offox
#   2) Portable install - Offox and all its settings in one folder you choose
#                         (e.g. on a USB drive), nothing written anywhere else
#
# Without questions:
#   sh Offox-*.run --normal              # for your user (~/.local), no sudo
#   sudo sh Offox-*.run --normal --system  # for all users (/opt/offox)
#   sh Offox-*.run --portable /run/media/me/USB
#   sh Offox-*.run --uninstall [--system]
set -eu

VERSION="@VERSION@"
ME="$0"
MODE=""
SYSTEM=0
TARGET=""

usage() {
  sed -n '2,13p' "$ME" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --normal) MODE=normal ;;
    --portable) MODE=portable; TARGET="${2:-}"; [ $# -gt 1 ] && shift ;;
    --system) SYSTEM=1 ;;
    --uninstall) MODE=uninstall ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1"; usage 1 ;;
  esac
  shift
done

payload_line() {
  awk '/^__OFFOX_PAYLOAD__$/ { print NR + 1; exit }' "$ME"
}

extract_to() {
  mkdir -p "$1"
  tail -n +"$(payload_line)" "$ME" | tar -xJ -C "$1" --strip-components=1
}

ask() {
  printf '%s' "$1" >&2
  read -r answer
  printf '%s' "$answer"
}

if [ -z "$MODE" ]; then
  echo "Offox $VERSION - the offline browser"
  echo
  echo "  1) Normal install    Offox appears in your applications menu."
  echo "                       Settings are kept in your home folder."
  echo "  2) Portable install  Offox and all of its settings stay in one folder"
  echo "                       (for example on a USB drive). Nothing is written"
  echo "                       anywhere else."
  echo
  case "$(ask 'Choose 1 or 2: ')" in
    1) MODE=normal
       if [ "$(id -u)" = 0 ]; then SYSTEM=1; fi ;;
    2) MODE=portable ;;
    *) echo "Nothing installed."; exit 1 ;;
  esac
fi

if [ "$SYSTEM" = 1 ]; then
  APPDIR=/opt/offox
  BINDIR=/usr/local/bin
  SHARE=/usr/share
else
  APPDIR="${XDG_DATA_HOME:-$HOME/.local/share}/offox-browser"
  BINDIR="$HOME/.local/bin"
  SHARE="${XDG_DATA_HOME:-$HOME/.local/share}"
fi

desktop_entry() {
  cat <<DESKTOP
[Desktop Entry]
Version=1.0
Name=Offox
GenericName=Offline Web Browser
Comment=Browse your own websites stored in folders - no internet needed
Exec=$1 %u
Icon=offox
Terminal=false
Type=Application
MimeType=text/html;application/xhtml+xml;
StartupNotify=true
StartupWMClass=offox
Categories=Network;WebBrowser;
Keywords=offline;web;browser;
Actions=new-window;settings;

[Desktop Action new-window]
Name=New Window
Exec=$1 --new-window

[Desktop Action settings]
Name=Storage folders and websites
Exec=$1 about:offox
DESKTOP
}

case "$MODE" in
  normal)
    echo "Installing Offox to $APPDIR ..."
    rm -rf "$APPDIR"
    extract_to "$APPDIR"
    rm -f "$APPDIR/offox-portable"
    mkdir -p "$BINDIR" "$SHARE/applications"
    ln -sf "$APPDIR/offox" "$BINDIR/offox"
    for size in 16 32 48 64 128 256; do
      if [ -f "$APPDIR/browser/chrome/icons/default/default$size.png" ]; then
        mkdir -p "$SHARE/icons/hicolor/${size}x$size/apps"
        cp "$APPDIR/browser/chrome/icons/default/default$size.png" "$SHARE/icons/hicolor/${size}x$size/apps/offox.png"
      fi
    done
    desktop_entry "$APPDIR/offox" > "$SHARE/applications/offox.desktop"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$SHARE/applications" >/dev/null 2>&1 || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$SHARE/icons/hicolor" >/dev/null 2>&1 || true
    echo "Done. Start Offox from your applications menu or run: offox"
    case ":$PATH:" in *":$BINDIR:"*) ;; *) echo "(Add $BINDIR to your PATH to use the offox command.)" ;; esac
    ;;
  portable)
    if [ -z "$TARGET" ]; then
      TARGET="$(ask "Folder to put Offox in (e.g. /run/media/${USER:-you}/USB): ")"
    fi
    [ -n "$TARGET" ] || { echo "Nothing installed."; exit 1; }
    DEST="$TARGET/Offox"
    echo "Installing portable Offox to $DEST ..."
    extract_to "$DEST"
    # The marker tells Offox to keep its profile in Data/ next to the program.
    : > "$DEST/offox-portable"
    mkdir -p "$DEST/Data" "$DEST/Sites"
    cat > "$DEST/Start Offox.sh" <<'LAUNCH'
#!/bin/sh
cd "$(dirname "$0")" && exec ./offox "$@"
LAUNCH
    chmod +x "$DEST/Start Offox.sh"
    echo "Done. Start Offox with: \"$DEST/Start Offox.sh\""
    echo "Its settings are saved in $DEST/Data; Sites is a good storage folder."
    ;;
  uninstall)
    rm -rf "$APPDIR"
    rm -f "$BINDIR/offox" "$SHARE/applications/offox.desktop"
    rm -f "$SHARE"/icons/hicolor/*/apps/offox.png
    echo "Offox was removed. Your websites and storage folders were not touched."
    ;;
esac
exit 0
__OFFOX_PAYLOAD__
