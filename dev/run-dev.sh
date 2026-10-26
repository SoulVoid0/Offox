#!/usr/bin/env bash
# Offox developer mode for Linux (Fedora): runs Offox inside a stock Firefox
# ESR without compiling anything. The first run downloads Firefox ESR (the
# only time anything touches the internet); after that it works offline.
#
#   dev/run-dev.sh            # start Offox (dev profile in dev/.profile)
#   dev/run-dev.sh --fresh    # start with a new, empty profile
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
FF="$HERE/.firefox"
PROFILE="$HERE/.profile"

if [[ "${1:-}" == "--fresh" ]]; then
  rm -rf "$PROFILE"
  shift
fi

if [[ ! -x "$FF/firefox/firefox" ]]; then
  echo "Downloading Firefox ESR (one time)..."
  mkdir -p "$FF"
  curl -fL "https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=linux64&lang=en-US" -o "$FF/firefox.tar.xz"
  tar -xf "$FF/firefox.tar.xz" -C "$FF"
  rm "$FF/firefox.tar.xz"
fi

APP="$FF/firefox"
mkdir -p "$APP/defaults/pref" "$APP/distribution" "$PROFILE"
cp "$HERE/devmode/autoconfig.js" "$APP/defaults/pref/autoconfig.js"
cp "$REPO/fork/prefs/offox-prefs.js" "$APP/defaults/pref/offox-prefs.js"
cp "$HERE/devmode/offox.cfg" "$APP/offox.cfg"
cp "$HERE/devmode/policies.json" "$APP/distribution/policies.json"
# Link the sources so edits show up after a restart.
ln -sfn "$REPO/src/offox" "$APP/offox"

exec "$APP/firefox" --no-remote --profile "$PROFILE" "$@"
