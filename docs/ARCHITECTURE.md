# How Offox works

## One router, two hosts

```
            ┌──────────────────────── Offox (Firefox ESR) ────────────────────────┐
 any http(s)│ nsHttpChannel ──"http-on-before-connect"──► OffoxService._respond   │
 request ──►│      ▲ suspended                                 │                   │
            │      └──── setResponseOverride(response) ◄── OffoxRouter.handle()   │
            └───────────────────────────────────────────────────┬─────────────────┘
                                                                │ fs / assets / media adapters
                                    SiteRegistry · FireLine · MediaConverter
                                                                │
                                         storage folders on disk / USB drive
```

- `OffoxRouter`, `SiteRegistry`, `FireLine`, `MediaConverter` (in
  `src/offox/modules/`) are plain JavaScript modules. They never touch Gecko
  directly; they get `fs`, `assets` and `media` adapters:
  - In the browser: `OffoxGecko.sys.mjs` (IOUtils, `resource://offox/`, Subprocess).
  - In Node: `dev/node-adapters.mjs`, used by the preview server and the tests.
- `OffoxService.sys.mjs` is the browser glue. For every http(s) channel it:
  1. suspends the channel in `http-on-before-connect`, before any connection
     is made;
  2. builds a request object (method, URL, headers, body from
     `nsIUploadChannel`, and whether it is a page load) and asks the router;
  3. turns the answer into an `nsIReplacedHttpResponse` (status, headers, body)
     and calls `nsIHttpChannelInternal.setResponseOverride`. `nsHttpChannel::Connect()`
     then answers from it instead of the network;
  4. resumes the channel.
- Media is served in 8 MB `206` chunks; the media element asks for the next
  range by itself. Downloads over 64 MB without a `Range` header are copied
  to the Downloads folder with the Downloads API (`file://` source).
- Because overridden responses skip CORS preflights, the router itself refuses
  cross-site calls to `/__offox/api/` (it checks `Sec-Fetch-Site` and `Origin`).

## Startup

- In an Offox build, `BrowserComponents.manifest` gets
  `category browser-before-ui-startup resource://offox/modules/OffoxService.sys.mjs OffoxService.init`.
  The files are packaged by a generated `jar.mn` as `resource://offox/` (modules,
  assets, templates) and `chrome://offox/content/` (settings page).
  `about:offox` is an entry in `AboutRedirector.cpp`.
- In developer mode, autoconfig (`dev/devmode/offox.cfg`) registers the same
  `resource://offox/` and `chrome://offox/` URLs, then calls
  `OffoxService.initDevMode()`. The settings page opens at
  `chrome://offox/content/settings.html`.

On the first window, the service sets the new tab page to FireLine and adds the
"Offox sites" toolbar button. If there is no storage folder yet, it opens the
settings page.

## Settings

- `offox.storage.roots` is a JSON array of folder paths. On a portable
  install, folders inside the Offox folder are stored as `app:Sites`.
- `offox.ffmpeg.path` is an optional path to FFmpeg.

Every site domain is added to `browser.fixup.domainsuffixwhitelist.*` on the
default branch, so that typing `docs.offox` opens the site instead of searching.

## The fork

`fork/apply.py <firefox-esr>`:

| Step | Files |
|---|---|
| patches | `0001-portable-mode` (nsXREDirProvider: `offox-portable` marker → `Data/`), `0002-about-offox`, `0003-offox-component` (startup category, `DIRS`), `0004-offline-prefs` (`#include offox-prefs.js` in firefox.js) |
| component | `src/offox` → `browser/components/offox` + generated `moz.build`/`jar.mn` |
| prefs | `fork/prefs/offox-prefs.js`: proxy to a dead SOCKS port, TRR mode 5 (no DNS), and telemetry, updates, Safe Browsing, Normandy, remote settings, WebRTC, push, captive portal and prefetch all off, every one locked |
| branding | `browser/branding/offox` (copy of `unofficial` + `fork/branding/offox` images from `tools/make-branding.py`) |
| search | `search-config-v2.json` dump contains only FireLine; icons dump emptied |
| mozconfig | `--with-app-name=offox --with-app-basename=Offox`, no updater, crash reporter, maintenance service or default-browser agent |

## Templates

A template is a folder in `src/offox/templates/<id>/` with a `template.json`:

```json
{
  "id": "blog", "name": "Blog / journal", "icon": "✍️",
  "description": "…", "defaultTitle": "My Journal", "defaultDomain": "journal.blog",
  "shared": ["util.js", "md.js", "ui.css"],   // copied from _shared/ into assets/
  "directories": ["posts", "images"],         // empty folders to create
  "searchRules": [ … ]                         // see SITE-API.md
}
```

Text files may contain `{{SITE_TITLE}}`, `{{SITE_DOMAIN}}`,
`{{SITE_DESCRIPTION}}` and `{{CREATED}}`; they are escaped for HTML or JSON as
appropriate. After adding or changing a template, run
`node tools/build-template-index.mjs` to update `templates/index.json`. The
file list in the index is what gets copied.

## Tests

- `tests/e2e-*.mjs` drive Chromium through the preview server. It runs the same
  router, so the websites, FireLine, uploads, conversion and the settings page
  are tested exactly as Offox serves them.
- `tests/gecko-shim.test.mjs` runs `OffoxService` and the Gecko adapters in Node
  with stand-ins for IOUtils, Services and the channel APIs. It checks the
  glue: interception, bodies, ranges, Content-Length, pref changes and fixup.
