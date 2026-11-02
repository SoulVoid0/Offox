# Offox

Offox is a web browser built on Firefox ESR that **never goes on the internet**.
Its "websites" are ordinary folders of HTML, CSS and JavaScript on your computer
or on an external drive, and each one opens at an address you choose, for example
`https://youtube.com`. Every request the browser makes is answered from those
folders, and nothing is ever sent to the network.

Offox runs on **Windows** and **any 64-bit Linux** (Fedora, Ubuntu, Debian,
Arch, openSUSE...).

## Download

Ready-made builds are on the [Releases page](https://github.com/SoulVoid0/Offox/releases/latest):

- **Windows 10/11 (64-bit):** `Offox-<version>-Setup.exe`. The installer asks
  whether you want a **normal install** (Start menu, uninstaller, settings in
  your user profile) or a **portable install** (everything in one folder, for
  example on a USB drive). The installer is not signed, so Windows SmartScreen
  may warn: click *More info*, then *Run anyway*.
- **Linux:** `Offox-<version>-x86_64.AppImage`, one file that runs on any
  distribution:

  ```sh
  chmod +x Offox-*-x86_64.AppImage
  ./Offox-*-x86_64.AppImage              # run Offox
  ./Offox-*-x86_64.AppImage --install    # add it to the applications menu (~/.local, no sudo)
  ./Offox-*-x86_64.AppImage --uninstall  # remove it from the menu again
  ./Offox-*-x86_64.AppImage --portable   # keep the settings next to the AppImage (USB drive)
  ```

  AppImages need FUSE. If it is missing, install it (Fedora: `sudo dnf install
  fuse`, Ubuntu/Debian: `sudo apt install libfuse2`) or run the file with
  `--appimage-extract-and-run`.

The builds are made by the [release workflow](.github/workflows/release.yml),
which also starts the built browser on Ubuntu, Fedora, Debian, Arch, openSUSE
and Windows and checks that it works before publishing. To build Offox
yourself, see [Build Offox and the installers](#build-offox-and-the-installers).

## What you get

- **Offox Sites settings (`about:offox`).** Open it with the **Offox Sites**
  button on the toolbar, **Offox Sites** in the ☰ menu or the Tools menu, the
  **Offox Sites** link at the bottom of Settings, or by typing `about:offox`
  (it is the first suggestion when you type `about:`).
- **Storage folders.** In `about:offox` you pick
  one or more folders, on your disk or on a USB drive, where your websites live.
  The first time a folder is added, Offox creates these default websites in it:

  | Address | Website |
  |---|---|
  | `https://youtube.com` | **OffTube**, a video site. You can upload videos with a title and description, browse every video on the home page, make playlists (with autoplay) and convert old formats. Each video is stored in `videos/<id>/`, which holds the video file, `description.txt`, `created.txt` (the creation date), `title.txt`, a thumbnail and `info.json`. |
  | `https://wikipedia.org` | **Offpedia**, a wiki. Articles are Markdown files with `[[links]]`, an edit history, recent changes, image uploads and search. |
  | `https://reddit.com` | **Offddit**, a Reddit-style board for notes. Posts have a title, Markdown text and any number of pictures, GIFs and videos (drop, paste or pick them), and live in communities. It has votes, comments with replies, pinned posts, sorting (hot, new, top, most comments) and search. Each post is stored in `posts/<id>/`, which holds `post.json`, `comments.json` and the media files. |
  | `https://software.store` | **Software Store**, for installers and portable apps. It shows versions, platforms, categories and screenshots, with download buttons. |
  | `https://docs.offox` | **Docs**, a word processor (fonts, styles, lists, tables, images). It autosaves and can export or print to PDF. |
  | `https://sheets.offox` | **Sheets**, spreadsheets with about 60 formula functions (SUM, IF, VLOOKUP and more), formatting, several sheets per file, charts and CSV import/export. |
  | `https://slides.offox` | **Slides**, presentations with themes, layouts, text, images, shapes, speaker notes, a full-screen presenter and PDF export. |

- **Create websites from templates.** In `about:offox → Create a website` you pick
  a template, type an address and a title, and Offox makes the folder. The
  templates are: the seven sites above, a **blog**, a **photo gallery**, a **music
  library**, a **document library** (e-books, PDFs, manuals), a **file drive**
  and a **blank** site. Every site is plain HTML, CSS and JS, so you can change
  anything with any editor.
- **Addresses work with or without `www.`**: `www.youtube.com` opens the same
  site as `youtube.com`.
- **FireLine**, at `https://fireline.offox/`, is the only search engine. It is the
  home page, the new tab page and the address-bar search. It searches all of your
  websites: their addresses, titles, pages, videos, wiki articles, apps,
  documents, posts, songs and books. If you forget a site's address, type a word
  from it and FireLine finds it. Unknown addresses show an "offline" page with
  suggestions.
- **Nothing online in the browser itself.** The address bar suggests only your
  websites, history, bookmarks, open tabs and FireLine (no Firefox Suggest,
  sponsored or default top sites). Settings leave out everything that needs the
  internet: accounts and sync, AI controls, importing from other browsers,
  Firefox Suggest, search shortcuts, updates, DNS over HTTPS, proxy, Safe
  Browsing, data collection, translations, Firefox Labs and "More from Mozilla".
- **Video formats.** Offox plays MP4 (H.264, HEVC, AV1), WebM, MKV, Ogg, MP3,
  AAC, FLAC, Opus and WAV directly. AVI, WMV, FLV, MPEG, old MOV, 3GP and
  DivX/Xvid are converted with FFmpeg when you upload them. The conversion copies
  the streams without loss when it can and re-encodes otherwise. See
  [offox/docs/VIDEO-FORMATS.md](offox/docs/VIDEO-FORMATS.md).
- **No internet, enforced.** All proxies, DNS, telemetry, updates, Safe
  Browsing, studies, WebRTC, push, captive-portal checks and prefetching
  are turned off with *locked* prefs ([browser/app/profile/offox-prefs.js](browser/app/profile/offox-prefs.js)).
  Anything that is not an http(s) request goes to a SOCKS proxy that never
  answers.

## Scripts at a glance

All commands are run from the repository folder.

| Script | System | What it does |
|---|---|---|
| `offox/installer/build-fedora.sh` | Fedora | Builds Offox and writes the RPM and the `.run` installer to `dist/` |
| `offox\installer\build-windows.ps1` | Windows (PowerShell) | Builds Offox and writes `dist\Offox-<version>-Setup.exe` |
| `offox/installer/build-windows.sh` | Windows (MozillaBuild shell) | Same as `build-windows.ps1` |
| `offox/installer/build-windows-on-linux.sh` | Linux | Cross-compiles Windows Offox and writes `dist/Offox-<version>-Setup.exe` (needs `makensis`) |
| `offox/installer/linux/make-appimage.sh` | Linux | Turns the `mach package` tarball into `Offox-<version>-x86_64.AppImage` |
| `.github/workflows/release.yml` | GitHub Actions | Builds both, tests them and publishes them on the Releases page. Start it with *Actions → Build and release Offox → Run workflow*, by pushing to the `release-build` branch, or by pushing a `v*` tag |
| `offox/dev/run-dev.sh` | Fedora | Developer mode: runs Offox inside a stock Firefox ESR, without compiling |
| `offox\dev\run-dev.ps1` | Windows (PowerShell) | Developer mode, as above |
| `offox/dev/preview-server.mjs` | Any (Node.js) | Serves your storage folders to any browser, for working on websites and templates |
| `offox/fork/apply.py` | Any (Python 3) | Moves Offox to a newer Firefox ESR source tree |
| `offox/tools/make-branding.py` | Any (Python 3 + Pillow) | Redraws the Offox logo and icons |

## Build Offox and the installers

This repository is the complete Firefox 153.5.1 ESR source with the Offox
changes applied (see [Project layout](#project-layout)), so it builds in place.
The first build needs about 40 GB of free disk space and takes a few hours.
Later builds are much faster.

### Fedora

```sh
git clone https://github.com/SoulVoid0/Offox
cd Offox
offox/installer/build-fedora.sh
```

The script installs the build tools with `dnf` (it asks for your password). It
then runs `./mach bootstrap`, `./mach build` and `./mach package`, and writes
the installers to `dist/`:

| File | Install |
|---|---|
| `dist/offox-<version>-1.fc*.x86_64.rpm` | **Normal**, for all users: `sudo dnf install ./dist/offox-*.rpm`. Remove it with `sudo dnf remove offox`. |
| `dist/Offox-<version>-linux-x86_64.run` | Asks whether you want a **normal** or a **portable** install (see below). |
| `dist/offox-<version>esr.en-US.linux-x86_64.tar.xz` | The plain build, unpacked anywhere. Run `offox/offox` inside it. |

Using the `.run` installer:

```sh
sh dist/Offox-*.run                              # menu: 1) normal  2) portable
sh dist/Offox-*.run --normal                     # normal, for your user only (no sudo)
sudo sh dist/Offox-*.run --normal --system       # normal, for all users
sh dist/Offox-*.run --portable /run/media/$USER/USB
sh dist/Offox-*.run --uninstall                  # add --system for the all-users install
```

- **Normal, your user only** puts the program in `~/.local/share/offox-browser`,
  the `offox` command in `~/.local/bin`, and a menu entry with icons in
  `~/.local/share`.
- **Normal, all users** puts the program in `/opt/offox`, the command in
  `/usr/local/bin` and the menu entry in `/usr/share`.
- **Portable** creates an `Offox` folder in the place you give, with the program,
  an `offox-portable` marker file, a `Data` folder for settings and a `Sites`
  folder for websites. Start it with `Offox/Start Offox.sh`.

For video conversion, install FFmpeg with `sudo dnf install ffmpeg-free`, or
install `ffmpeg` from RPM Fusion for more codecs.

### Windows

1. Install [Git for Windows](https://git-scm.com/download/win). Then clone the
   repository with Unix line endings and long paths turned on. Git's default
   CRLF conversion breaks the build, and the script stops if it finds CRLF.
   ```powershell
   git clone -c core.autocrlf=false -c core.longpaths=true https://github.com/SoulVoid0/Offox
   cd Offox
   ```
2. Optional: put an LGPL build of FFmpeg (`ffmpeg.exe` and its DLLs) in
   `offox\installer\windows\ffmpeg\`, so that video conversion works out of
   the box. See `offox\installer\windows\ffmpeg\README.txt`.
3. In PowerShell, run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File offox\installer\build-windows.ps1
   ```
   The script:
   - installs [MozillaBuild](https://wiki.mozilla.org/MozillaBuild) to
     `C:\mozilla-build` if it is missing (it asks for administrator rights once);
   - runs `./mach bootstrap`, which downloads the compilers and the Windows SDK;
   - runs `./mach build` and `./mach package`;
   - makes the installer with NSIS, installing NSIS with `winget` if needed.

   Options:

   | Option | Effect |
   |---|---|
   | `-SkipBootstrap` | Skip `mach bootstrap` (for builds after the first) |
   | `-NoInstaller` | Only build Offox and copy `offox-<version>.en-US.win64.zip` to `dist\` |
   | `-ObjDir D:\offox-obj` | Put the build output on another disk (default: `obj-offox` in the repository) |

   If you prefer the MozillaBuild shell (`C:\mozilla-build\start-shell.bat`), run
   `offox/installer/build-windows.sh` there instead.

The result is `dist\Offox-<version>-Setup.exe`. Its second page asks for the
installation type:

- **Normal install** goes to `%LOCALAPPDATA%\Programs\Offox` and needs no
  administrator rights. It adds a Start menu shortcut, an optional desktop
  shortcut and an entry in "Installed apps". Settings are kept in
  `%APPDATA%\Mozilla\Offox`. Uninstall it from "Installed apps"; your settings
  and websites are kept.
- **Portable install** puts everything in one folder you pick (for example
  `E:\Offox`). This includes the `offox-portable` marker, a `Data` folder for
  settings and a `Sites` folder for websites. Nothing is written to the
  registry. To remove it, delete the folder.

Silent installs: `Offox-<version>-Setup.exe /S` (normal), or
`Offox-<version>-Setup.exe /S /PORTABLE /D=E:\Offox` (portable; `/D=` must come last).

### Building by hand

On Fedora, in a terminal:

```sh
export MOZCONFIG=$PWD/offox/fork/mozconfig.linux
./mach bootstrap
./mach build
./mach run          # start the Offox you just built
./mach package      # obj-offox/dist/offox-<version>esr.en-US.linux-x86_64.tar.xz
```

On Windows, run the same commands in the MozillaBuild shell with
`export MOZCONFIG=$PWD/offox/fork/mozconfig.windows`. The package is then
`obj-offox/dist/offox-<version>esr.en-US.win64.zip`.

After you change files in `browser/components/offox/`, `./mach build faster`
is enough to rebuild. If you added or removed files there, run
`python3 offox/fork/apply.py .` first. It regenerates `jar.mn`, the list of
files packaged into the browser.

To move Offox to a newer Firefox ESR, run
`python3 offox/fork/apply.py <new firefox source folder> --mozconfig linux`.
It applies the patches in `offox/fork/patches/`, then copies in the Offox
component, the prefs, the branding and the FireLine search config.

## Try Offox without compiling (developer mode)

Developer mode runs Offox inside a stock Firefox ESR (version 140 or newer).
The first run downloads Firefox ESR into `offox/dev/.firefox`; after that,
everything works offline. The profile is kept in `offox/dev/.profile`.

```sh
offox/dev/run-dev.sh            # Fedora; add --fresh to start with a new profile
```
```powershell
powershell -ExecutionPolicy Bypass -File offox\dev\run-dev.ps1     # Windows; add -Fresh for a new profile
```

On the first start, the settings page opens and asks for a storage folder. The
settings page is at `chrome://offox/content/settings.html` in developer mode,
and at `about:offox` in a real Offox build. Developer mode cannot include the
portable-mode patch, and Firefox's own branding stays.

To work on websites and templates in any browser, use the preview server. It
runs the same request handling as Offox (Node.js 20 or newer):

```sh
node offox/dev/preview-server.mjs --root ~/OffoxSites      # add more --root folders if you like
chromium-browser --proxy-server=http://127.0.0.1:8444 --ignore-certificate-errors https://fireline.offox/
```

The settings page is then at `https://settings.offox/`. The server listens on
port 8443 and its proxy on 8444; use `--port` to change them.

## How portable mode works

A portable install has an empty file called `offox-portable` next to the `offox`
/ `offox.exe` program. When Offox finds it at startup, it keeps its whole
profile (bookmarks, history, settings, the list of storage folders) in a `Data`
folder beside the program instead of in your home folder. The Linux AppImage
uses the AppImage way instead: `--portable` creates a folder named
`<AppImage file>.home` next to it, and Offox keeps its settings there. This is done in a
small patch, [toolkit/xre/nsXREDirProvider.cpp](toolkit/xre/nsXREDirProvider.cpp) (also kept as [offox/fork/patches/0001-portable-mode.patch](offox/fork/patches/0001-portable-mode.patch)).
On a portable install, storage folders inside the Offox folder (such as
`Offox\Sites`) are saved relative to it. They keep working when the USB drive
gets a different letter or mount point.

## Where things are stored

```
<storage folder>/
  offox-storage.json              marks the folder as Offox storage
  OffTube/                        one folder per website
    offox-site.json               address, title, template, search rules
    index.html, watch.html, ...   the website itself
    videos/<id>/                  video file, title.txt, description.txt,
                                  created.txt, thumbnail.jpg, info.json
    playlists/<id>.json
  Offddit/
    communities.json              community names and descriptions
    posts/<id>/                   post.json, comments.json, pictures, GIFs, videos
  Offpedia/ ...
```

A site's pages can read and write files in their own folder through
`/__offox/offox.js`. See [offox/docs/SITE-API.md](offox/docs/SITE-API.md). Pages cannot
reach other sites' folders, and cross-site writes are refused.

## Project layout

| Path | What |
|---|---|
| everything else | The Firefox 153.5.1 ESR source. Offox changes it in a few places: `toolkit/xre/nsXREDirProvider.cpp` (portable mode), `browser/components/about/` (`about:offox`), `browser/components/BrowserComponents.manifest` and `moz.build` (startup), `browser/app/profile/firefox.js` + `offox-prefs.js` (offline prefs), `browser/branding/offox/`, the search and top sites config in `services/settings/dumps/main/`, the Offox Sites menu items (`browser/base/content/`), the online-only Settings sections (`browser/components/preferences/`) and the `about:` suggestions (`browser/components/urlbar/UrlbarProviderAboutPages.sys.mjs`). |
| `browser/components/offox/modules/` | The browser code. `OffoxService` intercepts requests in the browser. The router, site registry, FireLine and media conversion are plain JS modules shared with the Node preview server. |
| `browser/components/offox/content/` | The `about:offox` settings page. |
| `browser/components/offox/assets/` | FireLine, the offline and error pages, and the site API script. |
| `browser/components/offox/templates/` | Website templates (`template.json` plus the site's files). |
| `browser/components/offox/jar.mn`, `moz.build` | Package the component into the browser (`jar.mn` is generated by `offox/fork/apply.py`). |
| `browser/branding/offox/` | Offox name, logo and icons. |
| `offox/fork/` | `mozconfig.linux` and `mozconfig.windows` (build settings), `patches/` (the Firefox changes as separate files), `branding-images/` (icons drawn by `offox/tools/make-branding.py`), `apply.py`, and `FIREFOX_VERSION` (the Firefox release tag this is based on). |
| `offox/installer/` | `build-fedora.sh`, `build-windows.ps1`, `build-windows.sh` and `build-windows-on-linux.sh`. `linux/` has the AppImage (`make-appimage.sh`, `AppRun`), the `.run` installer (`installer-header.sh`, `make-run.sh`) and the RPM spec (`offox.spec`). `windows/` has the NSIS installer script (`offox.nsi`), `make-installer.sh` and the optional `ffmpeg/` folder. |
| `offox/ci/build.sh`, `.github/workflows/` | The release workflow. `build-part.yml` builds one platform; a build that would pass GitHub's 6 hour limit stops, saves its compiler cache and the next part continues. |
| `offox/dev/` | `run-dev.sh` and `run-dev.ps1` (developer mode, with its files in `devmode/`), and `preview-server.mjs` with `node-adapters.mjs`. |
| `offox/tests/` | Tests: end-to-end in Chromium through the preview server, plus a test of the browser glue with simulated Gecko APIs. |
| `offox/tools/` | `check-syntax.mjs`, `build-template-index.mjs` (regenerates `templates/index.json`) and `make-branding.py`. |
| `offox/docs/` | `ARCHITECTURE.md`, `SITE-API.md` and `VIDEO-FORMATS.md`. |

More detail: [offox/docs/ARCHITECTURE.md](offox/docs/ARCHITECTURE.md).

## Tests

The tests need Node.js 20 or newer. The end-to-end tests also need Playwright
with Chromium.

```sh
cd offox
npm install playwright && npx playwright install chromium   # once
node --experimental-vm-modules tools/check-syntax.mjs     # every script parses
node tools/build-template-index.mjs --check               # templates/index.json is up to date
node tests/formula.test.cjs                                # spreadsheet formulas
node tests/gecko-shim.test.mjs                             # browser glue with simulated Gecko APIs
node tests/e2e-settings.mjs                                # settings page
node tests/e2e-video.mjs <media folder>                    # needs clip.webm and old.avi
node tests/e2e-sites.mjs <media folder>                    # needs "Test Artist - Test Song.mp3", photo.png, story.txt, setup.exe
node tests/e2e-board.mjs <media folder>                    # needs photo.png, anim.gif and clip.webm
```

`tests/smoke-browser.py` checks a *built* Offox (it needs `pip install selenium`
and [geckodriver](https://github.com/mozilla/geckodriver/releases)); the release
workflow runs it on Linux and Windows:

```sh
python3 offox/tests/smoke-browser.py <path to offox or offox.exe> <screenshot folder>
```

`e2e-video.mjs` also needs `ffmpeg` on the PATH, for the AVI conversion.

## Licences

Offox is a modified Firefox, so the repository is under the
[Mozilla Public License 2.0](LICENSE), like Firefox. Offox's own browser files
carry MPL 2.0 headers. The helper scripts in `offox/` that have no header are
also available under the [MIT licence](offox/LICENSE-MIT).

**Why FFmpeg and not VLC.** VLC's code (libVLC) is GPL/LGPL, and copying parts of
it into a Firefox fork would make the browser's licensing much harder. Offox
does not copy any VLC code. Instead, it calls an **FFmpeg** program, which is
the same decoding library VLC uses for most formats, as a separate process. That
keeps Offox under the MPL. Firefox already uses FFmpeg's decoders internally
for H.264, HEVC, AAC and others. The trade-off is that a few formats are
converted once when you upload them, rather than played directly. If you bundle
FFmpeg with the Windows installer, use an LGPL build.
