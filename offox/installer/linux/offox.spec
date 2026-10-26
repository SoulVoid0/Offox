# RPM for Fedora: a normal, system-wide Offox install (dnf install ./offox-*.rpm).
# For a portable install use the .run installer instead.
#
# Built by installer/build-fedora.sh from the "./mach package" tarball:
#   rpmbuild -bb installer/linux/offox.spec \
#     --define "_sourcedir <folder with the tarball>" --define "offox_version 153.0.1"

%global debug_package %{nil}

Name:           offox
Version:        %{?offox_version}%{!?offox_version:153.0}
Release:        1%{?dist}
Summary:        Offline web browser based on Firefox
License:        MPL-2.0 AND MIT
URL:            https://github.com/SoulVoid0/Offox
Source0:        offox-%{version}esr.en-US.linux-x86_64.tar.xz
ExclusiveArch:  x86_64
# Offox bundles its own libraries (like the Mozilla Firefox tarball).
AutoReqProv:    no

Requires:       gtk3
Requires:       dbus-glib
Requires:       libXt
Requires:       hicolor-icon-theme
Recommends:     ffmpeg-free

%description
Offox is a Firefox-based browser that never goes on the internet. Its
"websites" are folders on your computer or on an external drive, opened at
addresses you choose (for example https://youtube.com). It comes with a
video site, an encyclopedia, a software store, documents, spreadsheets and
presentations, templates for more, and FireLine, a search engine for your
own websites. FFmpeg (ffmpeg-free) is used to convert old video formats.

%prep
%setup -q -n offox

%build

%install
mkdir -p %{buildroot}%{_libdir}/offox %{buildroot}%{_bindir}
cp -a . %{buildroot}%{_libdir}/offox/
rm -f %{buildroot}%{_libdir}/offox/offox-portable
ln -s %{_libdir}/offox/offox %{buildroot}%{_bindir}/offox
for size in 16 32 48 64 128; do
  install -Dm644 browser/chrome/icons/default/default$size.png \
    %{buildroot}%{_datadir}/icons/hicolor/${size}x${size}/apps/offox.png
done
install -Dm644 /dev/stdin %{buildroot}%{_datadir}/applications/offox.desktop <<'DESKTOP'
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
Actions=new-window;settings;

[Desktop Action new-window]
Name=New Window
Exec=offox --new-window

[Desktop Action settings]
Name=Storage folders and websites
Exec=offox about:offox
DESKTOP

%files
%{_libdir}/offox/
%{_bindir}/offox
%{_datadir}/applications/offox.desktop
%{_datadir}/icons/hicolor/*/apps/offox.png

%changelog
* Mon Oct 26 2026 Offox <offox@localhost> - 153.0-1
- First release
