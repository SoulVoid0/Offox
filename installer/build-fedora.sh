#!/usr/bin/env bash
# Builds Offox on Fedora and makes both installers:
#   dist/offox-<version>-1.fc*.x86_64.rpm        normal install (sudo dnf install ./offox-*.rpm)
#   dist/Offox-<version>-linux-x86_64.run         asks: normal or portable install
#
#   installer/build-fedora.sh [firefox source folder]
#
# Needs ~40 GB of disk and a few hours the first time (much less afterwards).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
FF="${1:-$REPO/../firefox-esr}"
BRANCH="$(cut -d' ' -f1 "$REPO/fork/FIREFOX_VERSION")"
OUT="$REPO/dist"

echo "== Installing build tools"
sudo dnf install -y git python3 python3-pip rpm-build xz curl

if [[ ! -d "$FF/.git" ]]; then
  echo "== Downloading Firefox $BRANCH source to $FF"
  git clone --branch "$BRANCH" --depth 1 https://github.com/mozilla-firefox/firefox.git "$FF"
fi

echo "== Applying Offox"
python3 "$REPO/fork/apply.py" "$FF" --platform linux

cd "$FF"
echo "== Bootstrapping (compilers, Rust, Node...)"
./mach --no-interactive bootstrap --application-choice browser
echo "== Building"
./mach build
echo "== Packaging"
./mach package

TARBALL="$(ls -t obj-offox/dist/offox-*.linux-x86_64.tar.* | head -1)"
mkdir -p "$OUT"
cp "$TARBALL" "$OUT/"
"$REPO/installer/linux/make-run.sh" "$TARBALL" "$OUT"

VERSION="$(basename "$TARBALL" | sed -E 's/^offox-([0-9.]+)(esr)?\..*/\1/')"
RPMTOP="$(mktemp -d)"
mkdir -p "$RPMTOP/SOURCES"
case "$TARBALL" in
  *.tar.xz) cp "$TARBALL" "$RPMTOP/SOURCES/offox-${VERSION}esr.en-US.linux-x86_64.tar.xz" ;;
  *) bzip2 -dc "$TARBALL" | xz -T0 > "$RPMTOP/SOURCES/offox-${VERSION}esr.en-US.linux-x86_64.tar.xz" ;;
esac
rpmbuild -bb "$REPO/installer/linux/offox.spec" --define "_topdir $RPMTOP" --define "offox_version $VERSION"
cp "$RPMTOP"/RPMS/x86_64/*.rpm "$OUT/"
rm -rf "$RPMTOP"

echo
echo "Done. Installers are in $OUT:"
ls -1 "$OUT"
