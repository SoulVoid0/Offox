# Offox

Offox is a web browser built on Firefox ESR that **never goes on the internet**.
Its "websites" are ordinary folders of HTML, CSS and JavaScript on your computer
or on an external drive, and each one opens at an address you choose, for example
`https://youtube.com`. Every request the browser makes is answered from those
folders, and nothing is ever sent to the network.

Offox runs on **Fedora Linux** and **Windows**. Both have installers that ask
whether you want a **normal** or a **portable** install.

## What you get

- **Storage folders.** In `about:offox` (the fox button on the toolbar) you pick
  one or more folders, on your disk or on a USB drive, where your websites live.
  The first time a folder is added, Offox creates these default websites in it:

  | Address | Website |
  |---|---|
  | `https://youtube.com` | **OffTube**, a video site. You can upload videos with a title and description, browse every video on the home page, make playlists (with autoplay) and convert old formats. Each video is stored in `videos/<id>/`, which holds the video file, `description.txt`, `created.txt` (the creation date), `title.txt`, a thumbnail and `info.json`. |
  | `https://wikipedia.org` | **Offpedia**, a wiki. Articles are Markdown files with `[[links]]`, an edit history, recent changes, image uploads and search. |
  | `https://software.store` | **Software Store**, for installers and portable apps. It shows versions, platforms, categories and screenshots, with download buttons. |
  | `https://docs.offox` | **Docs**, a word processor (fonts, styles, lists, tables, images). It autosaves and can export or print to PDF. |
  | `https://sheets.offox` | **Sheets**, spreadsheets with about 60 formula functions (SUM, IF, VLOOKUP and more), formatting, several sheets per file, charts and CSV import/export. |
  | `https://slides.offox` | **Slides**, presentations with themes, layouts, text, images, shapes, speaker notes, a full-screen presenter and PDF export. |

- **Create websites from templates.** In `about:offox → Create a website` you pick
  a template, type an address and a title, and Offox makes the folder. The
  templates are: the six sites above, a **blog**, a **photo gallery**, a **music
  library**, a **document library** (e-books, PDFs, manuals), a **file drive**
  and a **blank** site. Every site is plain HTML, CSS and JS, so you can change
  anything with any editor.
- **FireLine**, at `https://fireline.offox/`, is the only search engine. It is the
  home page, the new tab page and the address-bar search. It searches all of your
  websites: their addresses, titles, pages, videos, wiki articles, apps,
  documents, posts, songs and books. If you forget a site's address, type a word
  from it and FireLine finds it. Unknown addresses show an "offline" page with
  suggestions.
- **Video formats.** Offox plays MP4 (H.264, HEVC, AV1), WebM, MKV, Ogg, MP3,
  AAC, FLAC, Opus and WAV directly. AVI, WMV, FLV, MPEG, old MOV, 3GP and
  DivX/Xvid are converted with FFmpeg when you upload them. The conversion copies
  the streams without loss when it can and re-encodes otherwise. See
  [docs/VIDEO-FORMATS.md](docs/VIDEO-FORMATS.md).
- **No internet, enforced.** All proxies, DNS, telemetry, updates, Safe
  Browsing, studies, WebRTC, push, captive-portal checks and prefetching
  are turned off with *locked* prefs ([fork/prefs/offox-prefs.js](fork/prefs/offox-prefs.js)).
  Anything that is not an http(s) request goes to a SOCKS proxy that never
  answers.

## Try it now without compiling (developer mode)

Developer mode runs Offox inside a stock Firefox ESR (140 or newer). The first
run downloads Firefox ESR; after that, everything works offline.

```sh
# Fedora
dev/run-dev.sh
```
```powershell
# Windows
powershell -ExecutionPolicy Bypass -File dev\run-dev.ps1
```

On the first start, the settings page opens and asks for a storage folder.

You can also work on websites and templates in any browser with the preview
server. It runs the same request router as the browser:

```sh
node dev/preview-server.mjs --root ~/OffoxSites
chromium --proxy-server=http://127.0.0.1:8444 --ignore-certificate-errors https://fireline.offox/
# settings page: https://settings.offox/
```

## Build Offox and the installers

Offox is a set of patches and files applied to the Firefox ESR source. The
version is in [fork/FIREFOX_VERSION](fork/FIREFOX_VERSION). The first build
needs about 40 GB of disk space and takes a few hours.

### Fedora

```sh
git clone https://github.com/SoulVoid0/Offox && cd Offox
installer/build-fedora.sh            # clones Firefox ESR next to the repo, applies Offox, builds
```

The installers are written to `dist/`:

- `offox-<version>-1.fc*.x86_64.rpm` is the normal install, for all users:
  `sudo dnf install ./dist/offox-*.rpm`
- `Offox-<version>-linux-x86_64.run` asks which install you want:
  ```sh
  sh Offox-*.run                         # menu: 1) normal  2) portable
  sh Offox-*.run --normal                # for your user, no sudo (~/.local)
  sudo sh Offox-*.run --normal --system  # for all users (/opt/offox)
  sh Offox-*.run --portable /run/media/$USER/USB
  sh Offox-*.run --uninstall
  ```

For video conversion, install FFmpeg: `sudo dnf install ffmpeg-free`, or
`ffmpeg` from RPM Fusion for more codecs.

### Windows

1. Install [MozillaBuild](https://wiki.mozilla.org/MozillaBuild) and the Visual
   Studio 2022 Build Tools. `mach bootstrap` tells you exactly which parts are
   needed.
2. Optional: put an LGPL FFmpeg build in `installer\windows\ffmpeg\` (see the
   README there) so video conversion works out of the box.
3. In the MozillaBuild shell (`C:\mozilla-build\start-shell.bat`):
   ```sh
   git clone https://github.com/SoulVoid0/Offox && cd Offox
   installer/build-windows.sh
   ```

The result is `dist\Offox-<version>-Setup.exe`. Its second page asks for the
installation type:

- **Normal install** goes to `%LOCALAPPDATA%\Programs\Offox` (no administrator
  rights needed). It adds Start menu and desktop shortcuts, an entry in "Apps &
  features" and keeps settings in `%APPDATA%\Offox`.
- **Portable install** puts everything in one folder you pick, for example
  `E:\Offox`. Nothing is written to the registry.

Silent installs: `Offox-Setup.exe /S`, or `Offox-Setup.exe /S /PORTABLE /D=E:\Offox`.

### Manual build (either system)

```sh
git clone --branch esr153 --depth 1 https://github.com/mozilla-firefox/firefox.git firefox-esr
python3 Offox/fork/apply.py firefox-esr          # add --platform windows on Windows
cd firefox-esr && ./mach bootstrap && ./mach build && ./mach run
```

## How portable mode works

A portable install has an empty file called `offox-portable` next to the `offox`
/ `offox.exe` program. When Offox finds it at startup, it keeps its whole
profile (bookmarks, history, settings, the list of storage folders) in a `Data`
folder beside the program instead of in your home folder. This is done in a
small patch, [fork/patches/0001-portable-mode.patch](fork/patches/0001-portable-mode.patch).
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
  Offpedia/ ...
```

A site's pages can read and write files in their own folder through
`/__offox/offox.js`. See [docs/SITE-API.md](docs/SITE-API.md). Pages cannot
reach other sites' folders, and cross-site writes are refused.

## Project layout

| Path | What |
|---|---|
| `src/offox/modules/` | The browser code. `OffoxService` intercepts requests in the browser. The router, site registry, FireLine and media conversion are plain JS modules shared with the Node preview server. |
| `src/offox/content/` | The `about:offox` settings page. |
| `src/offox/assets/` | FireLine, the offline and error pages, and the site API script. |
| `src/offox/templates/` | Website templates (`template.json` plus the site's files). |
| `fork/` | `apply.py`, the patches, the locked prefs, the branding and the mozconfigs. |
| `installer/` | The NSIS script (Windows), the `.run` installer and RPM spec (Linux), and the build scripts. |
| `dev/` | The preview server and the developer-mode runners. |
| `tests/` | End-to-end tests in Chromium through the preview server. |

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tests

```sh
npm install playwright      # once, if not installed
node tools/check-syntax.mjs
node tools/build-template-index.mjs --check
node tests/formula.test.cjs
node tests/e2e-video.mjs <media folder>
node tests/e2e-sites.mjs <media folder>
node tests/e2e-settings.mjs
```

## Licences

The Offox code in this repository is under the [MIT licence](LICENSE). Files
with an MPL 2.0 header, and everything that becomes part of the Firefox build,
are under the Mozilla Public License 2.0, like Firefox itself.

**Why FFmpeg and not VLC.** VLC's code (libVLC) is GPL/LGPL, and copying parts of
it into a Firefox fork would make the browser's licensing much harder. Offox
does not copy any VLC code. Instead, it calls an **FFmpeg** program, which is
the same decoding library VLC uses for most formats, as a separate process. That
keeps Offox under MPL/MIT. Firefox already uses FFmpeg's decoders internally
for H.264, HEVC, AAC and others. The trade-off is that a few formats are
converted once when you upload them, rather than played directly. If you bundle
FFmpeg with the Windows installer, use an LGPL build.
