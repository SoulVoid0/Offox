/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The browser side of Offox. It
//  * answers every http(s) request of the browser from the storage folders
//    (nothing is ever sent to the network: the channel is suspended in
//    "http-on-before-connect" and given a ready-made response with
//    nsIHttpChannelInternal.setResponseOverride),
//  * keeps the list of storage folders (pref offox.storage.roots),
//  * makes site addresses work in the address bar, sets FireLine as the
//    home and new tab page and adds the "Offox sites" toolbar button,
//  * offers the API used by the about:offox settings page.
//
// Started from BrowserComponents.manifest (category browser-before-ui-startup)
// in an Offox build, or from autoconfig in developer mode (dev/run-dev.*).

import { FireLine } from "resource://offox/modules/OffoxFireLine.sys.mjs";
import {
  GeckoAssets,
  GeckoFS,
  appDir,
  findFFmpeg,
  geckoMedia,
} from "resource://offox/modules/OffoxGecko.sys.mjs";
import { OffoxRouter, statusText } from "resource://offox/modules/OffoxRouter.sys.mjs";
import { SiteRegistry } from "resource://offox/modules/OffoxSites.sys.mjs";
import {
  FIRELINE_HOST,
  bytesToBinaryString,
} from "resource://offox/modules/OffoxUtil.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  DownloadPaths: "resource://gre/modules/DownloadPaths.sys.mjs",
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
});

const ROOTS_PREF = "offox.storage.roots";
// The address bar's top sites (shown when it is empty) are your websites.
const TOP_SITES_PREF = "browser.newtabpage.activity-stream.default.sites";
const SETTINGS_URL = "about:offox";
const HOME_URL = `https://${FIRELINE_HOST}/`;
// Largest Range response handed to the channel in one go; media elements
// ask again for the rest.
const MAX_CHUNK = 8 * 1024 * 1024;
// Larger files requested without a Range header (downloads) are copied to
// the Downloads folder instead of being held in memory.
const MAX_INLINE = 64 * 1024 * 1024;
const APP_PREFIX = "app:";

function log(msg) {
  console.log(`[Offox] ${msg}`);
}

export const OffoxService = {
  _initialized: false,
  _devMode: false,
  registry: null,
  fireline: null,
  router: null,
  media: null,
  ready: null,
  lastError: null,

  /** Called once at startup, before the first window opens. */
  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    this.media = geckoMedia();
    this.registry = new SiteRegistry({ fs: GeckoFS, assets: GeckoAssets, log });
    this.fireline = new FireLine({ fs: GeckoFS, registry: this.registry, log });
    this.router = new OffoxRouter({
      fs: GeckoFS,
      assets: GeckoAssets,
      registry: this.registry,
      fireline: this.fireline,
      media: this.media,
      maxChunk: MAX_CHUNK,
      log,
    });

    // Intercept before anything else can load.
    Services.obs.addObserver(this, "http-on-before-connect");
    Services.obs.addObserver(this, "browser-delayed-startup-finished");
    Services.obs.addObserver(this, "quit-application");
    Services.prefs.addObserver(ROOTS_PREF, this);

    this.ready = this.reload().catch(e => {
      this.lastError = String(e);
      log(`Could not load storage folders: ${e}`);
    });
  },

  /** Developer mode: Offox loaded by autoconfig into a stock Firefox. */
  initDevMode() {
    this._devMode = true;
    this.init();
    // A stock Firefox does not know about:offox; open the page directly.
    this.settingsURL = "chrome://offox/content/settings.html";
  },

  settingsURL: SETTINGS_URL,

  // ------------------------------------------------------------ observers

  observe(subject, topic, data) {
    switch (topic) {
      case "http-on-before-connect":
        this._intercept(subject.QueryInterface(Ci.nsIHttpChannel));
        break;
      case "browser-delayed-startup-finished":
        this._onWindowReady(subject);
        break;
      case "nsPref:changed":
        if (data == ROOTS_PREF && !this._savingRoots) {
          this.ready = this.reload();
        }
        break;
      case "quit-application":
        Services.obs.removeObserver(this, "http-on-before-connect");
        break;
    }
  },

  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),

  // --------------------------------------------------------- interception

  _intercept(channel) {
    try {
      channel.suspend();
    } catch (e) {
      // Already cancelled.
      return;
    }
    this._respond(channel)
      .catch(e => {
        log(`Failed to answer ${channel.URI.spec}: ${e}\n${e.stack || ""}`);
        try {
          channel.cancel(Cr.NS_ERROR_FAILURE);
        } catch (_) {}
      })
      .finally(() => {
        try {
          channel.resume();
        } catch (_) {}
      });
  },

  async _respond(channel) {
    await this.ready;
    let headers = {};
    channel.visitRequestHeaders({
      visitHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
    });
    let type = channel.loadInfo?.externalContentPolicyType;
    let isDocument =
      type == Ci.nsIContentPolicy.TYPE_DOCUMENT ||
      type == Ci.nsIContentPolicy.TYPE_SUBDOCUMENT;
    let req = {
      method: channel.requestMethod,
      url: channel.URI.spec,
      headers,
      isDocument,
      readBody: () => readUploadBody(channel),
    };
    let res = await this.router.handle(req);
    let body = res.body || new Uint8Array(0);

    if (res.file && !res.head) {
      let { path, start, end, size } = res.file;
      let length = size ? end - start + 1 : 0;
      if (length > MAX_INLINE && res.status == 200) {
        if (isDocument || res.headers["Content-Disposition"]) {
          let name =
            decodeDispositionName(res.headers["Content-Disposition"]) ||
            PathUtils.filename(path);
          this._downloadLargeFile(path, name).catch(e =>
            log(`Download of ${path} failed: ${e}`)
          );
          res = { status: 204, headers: { "Cache-Control": "no-store" } };
        } else {
          res = {
            status: 413,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          };
          body = new TextEncoder().encode(
            "This file is too large to load without a Range request."
          );
        }
      } else {
        body = await GeckoFS.read(path, { offset: start, length });
      }
    }

    let replaced = Cc[
      "@mozilla.org/network/replaced-http-response;1"
    ].createInstance(Ci.nsIReplacedHttpResponse);
    replaced.responseStatus = res.status;
    replaced.responseStatusText = statusText(res.status);
    for (let [name, value] of Object.entries(res.headers || {})) {
      if (name.toLowerCase() == "content-length" && !res.head) {
        continue;
      }
      replaced.setResponseHeader(name, String(value), false);
    }
    if (!res.head) {
      replaced.setResponseHeader("Content-Length", String(body.length), false);
      replaced.responseBody = bytesToBinaryString(body);
    }
    channel
      .QueryInterface(Ci.nsIHttpChannelInternal)
      .setResponseOverride(replaced);
  },

  async _downloadLargeFile(path, name) {
    let dir = await lazy.Downloads.getPreferredDownloadsDirectory();
    let target = lazy.DownloadPaths.createNiceUniqueFile(
      new lazy.FileUtils.File(PathUtils.join(dir, name))
    );
    let download = await lazy.Downloads.createDownload({
      source: { url: PathUtils.toFileURI(path) },
      target: target.path,
    });
    let list = await lazy.Downloads.getList(lazy.Downloads.PUBLIC);
    await list.add(download);
    await download.start();
  },

  // -------------------------------------------------------- storage roots

  /** Paths as stored in the pref ("app:" = relative to the Offox folder). */
  _storedRoots() {
    try {
      let value = JSON.parse(Services.prefs.getStringPref(ROOTS_PREF, "[]"));
      return Array.isArray(value) ? value.filter(v => typeof v == "string") : [];
    } catch (e) {
      return [];
    }
  },

  _resolveRoot(stored) {
    if (stored.startsWith(APP_PREFIX)) {
      let rel = stored.slice(APP_PREFIX.length).split(/[\\/]/).filter(Boolean);
      return PathUtils.join(appDir(), ...rel);
    }
    return stored;
  },

  _storeRoot(path) {
    // On a portable install, folders inside the Offox folder are remembered
    // relative to it, so they keep working when the drive letter or mount
    // point changes.
    if (this.isPortable) {
      let base = appDir();
      let sep = Services.appinfo.OS == "WINNT" ? "\\" : "/";
      if (path == base || path.startsWith(base + sep)) {
        return APP_PREFIX + path.slice(base.length + 1).split(sep).join("/");
      }
    }
    return path;
  },

  get roots() {
    return this._storedRoots().map(r => this._resolveRoot(r));
  },

  _saveRoots(stored) {
    this._savingRoots = true;
    try {
      Services.prefs.setStringPref(ROOTS_PREF, JSON.stringify(stored));
    } finally {
      this._savingRoots = false;
    }
  },

  get isPortable() {
    try {
      let marker = Services.dirsvc.get("GreBinD", Ci.nsIFile);
      marker.append("offox-portable");
      return marker.exists();
    } catch (e) {
      return false;
    }
  },

  /** The folder suggested the first time Offox runs. */
  defaultRoot() {
    if (this.isPortable) {
      return PathUtils.join(appDir(), "Sites");
    }
    let docs;
    try {
      docs = Services.dirsvc.get("Docs", Ci.nsIFile).path;
    } catch (e) {
      docs = Services.dirsvc.get("Home", Ci.nsIFile).path;
    }
    return PathUtils.join(docs, "Offox Sites");
  },

  async reload() {
    await this.registry.load(this.roots);
    this.fireline.invalidate();
    this._updateFixup();
    this._updateTopSites();
    return this.registry;
  },

  /**
   * Adds a storage folder. The first time a folder is used, the default
   * websites (OffTube, Offpedia, Offddit, Software Store, Docs, Sheets,
   * Slides) are
   * created in it.
   */
  async addRoot(path) {
    await this.ready;
    let stored = this._storedRoots();
    let entry = this._storeRoot(path);
    if (!stored.includes(entry) && !this.roots.includes(path)) {
      stored.push(entry);
    }
    let created = await this.registry.initRoot(path);
    this._saveRoots(stored);
    await this.reload();
    return created.map(siteInfo);
  },

  async removeRoot(path) {
    await this.ready;
    let stored = this._storedRoots().filter(r => this._resolveRoot(r) != path);
    this._saveRoots(stored);
    await this.reload();
  },

  async moveRoot(path, delta) {
    let stored = this._storedRoots();
    let i = stored.findIndex(r => this._resolveRoot(r) == path);
    let j = i + delta;
    if (i < 0 || j < 0 || j >= stored.length) {
      return;
    }
    [stored[i], stored[j]] = [stored[j], stored[i]];
    this._saveRoots(stored);
    await this.reload();
  },

  // ---------------------------------------------------------------- sites

  async status() {
    await this.ready;
    // Re-scan so drives that were plugged in or removed show up.
    this.ready = this.reload();
    await this.ready;
    let ffmpeg = await findFFmpeg();
    return {
      portable: this.isPortable,
      devMode: this._devMode,
      appDir: appDir(),
      defaultRoot: this.defaultRoot(),
      roots: this.roots.map(path => ({
        path,
        ...(this.registry.rootStatus.get(path) || { available: false, siteCount: 0 }),
      })),
      sites: this.registry.list().map(siteInfo),
      conflicts: this.registry.conflicts,
      ffmpeg,
      ffmpegChosen: Services.prefs.getStringPref("offox.ffmpeg.path", ""),
      speech: await this.media.speechInfo(),
      whisperChosen: Services.prefs.getStringPref("offox.whisper.path", ""),
      whisperModelChosen: Services.prefs.getStringPref("offox.whisper.model", ""),
      network: networkStatus(),
      error: this.lastError,
    };
  },

  async templates() {
    return (await this.registry.templates()).map(t => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      description: t.description,
      defaultTitle: t.defaultTitle,
      defaultDomain: t.defaultDomain,
    }));
  },

  async createSite(options) {
    await this.ready;
    let site = await this.registry.createSite(options);
    this.fireline.invalidate();
    this._updateFixup();
    this._updateTopSites();
    return siteInfo(site);
  },

  async updateSite(domain, changes) {
    await this.ready;
    let site = await this.registry.updateSite(domain, changes);
    this.fireline.invalidate();
    this._updateFixup();
    this._updateTopSites();
    return siteInfo(site);
  },

  async deleteSite(domain) {
    await this.ready;
    await this.registry.deleteSite(domain);
    this.fireline.invalidate();
    this._updateTopSites();
  },

  setFFmpegPath(path) {
    Services.prefs.setStringPref("offox.ffmpeg.path", path || "");
  },

  setWhisperPath(path) {
    Services.prefs.setStringPref("offox.whisper.path", path || "");
  },

  setWhisperModel(path) {
    Services.prefs.setStringPref("offox.whisper.model", path || "");
  },

  /** Shows a folder in the system file manager. */
  reveal(path) {
    let file = new lazy.FileUtils.File(path);
    try {
      file.reveal();
    } catch (e) {
      file.launch();
    }
  },

  // ------------------------------------------------------- address bar etc.

  /**
   * Teaches the address bar that the site addresses are real domains, so
   * typing "docs.offox" or "my.site" opens the site instead of searching.
   */
  _updateFixup() {
    let suffixes = Services.prefs.getDefaultBranch("browser.fixup.domainsuffixwhitelist.");
    let words = Services.prefs.getDefaultBranch("browser.fixup.domainwhitelist.");
    let hosts = [FIRELINE_HOST];
    for (let site of this.registry.list()) {
      hosts.push(site.domain, ...site.aliases);
    }
    for (let host of hosts) {
      try {
        if (host.includes(".")) {
          suffixes.setBoolPref(host, true);
        } else {
          words.setBoolPref(host, true);
        }
      } catch (e) {
        // Locked or invalid name; the site still works when typed with https://
      }
    }
  },

  _updateTopSites() {
    let urls = [HOME_URL, ...this.registry.list().map(s => `https://${s.domain}/`)];
    let value = urls.join(",");
    try {
      if (Services.prefs.getStringPref(TOP_SITES_PREF, "") != value) {
        Services.prefs.setStringPref(TOP_SITES_PREF, value);
      }
    } catch (e) {
      log(`Could not update the top sites: ${e}`);
    }
  },

  _onWindowReady(win) {
    if (!this._newTabSet) {
      this._newTabSet = true;
      try {
        lazy.AboutNewTab.newTabURL = HOME_URL;
      } catch (e) {
        log(`Could not set the new tab page: ${e}`);
      }
    }
    this._addToolbarButton();
    // First run: no storage folder yet, so open the settings page.
    if (!this._storedRoots().length && !this._welcomed) {
      this._welcomed = true;
      win.openTrustedLinkIn(this.settingsURL + "#welcome", "tab", {
        inBackground: false,
      });
    }
  },

  _addToolbarButton() {
    if (this._buttonAdded) {
      return;
    }
    this._buttonAdded = true;
    let CustomizableUI;
    try {
      ({ CustomizableUI } = ChromeUtils.importESModule(
        "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
      ));
    } catch (e) {
      ({ CustomizableUI } = ChromeUtils.importESModule(
        "resource:///modules/CustomizableUI.sys.mjs"
      ));
    }
    let service = this;
    CustomizableUI.createWidget({
      id: "offox-sites-button",
      label: "Offox Sites",
      tooltiptext: "Storage folders and websites",
      defaultArea: CustomizableUI.AREA_NAVBAR,
      onCreated(node) {
        node.style.listStyleImage = "url(chrome://offox/content/offox.svg)";
      },
      onCommand(event) {
        event.target.ownerGlobal.switchToTabHavingURI(service.settingsURL, true, {
          ignoreFragment: "whenComparing",
        });
      },
    });
  },
};

function siteInfo(site) {
  return {
    domain: site.domain,
    aliases: site.aliases,
    url: `https://${site.domain}/`,
    title: site.title,
    description: site.description,
    template: site.template,
    created: site.created,
    root: site.root,
    folder: site.folder,
    dir: site.dir,
  };
}

function decodeDispositionName(value) {
  let m = /filename\*=UTF-8''([^;]+)/i.exec(value || "");
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {}
  }
  return null;
}

function networkStatus() {
  let prefs = Services.prefs;
  let socks = `${prefs.getStringPref("network.proxy.socks", "")}:${prefs.getIntPref("network.proxy.socks_port", 0)}`;
  return {
    proxyLocked: prefs.prefIsLocked("network.proxy.type"),
    proxy: prefs.getIntPref("network.proxy.type", 0) == 1 ? `SOCKS ${socks}` : "none",
    trrMode: prefs.getIntPref("network.trr.mode", 0),
    webrtc: prefs.getBoolPref("media.peerconnection.enabled", true),
    updates: prefs.getBoolPref("app.update.auto", true),
    telemetry: prefs.getBoolPref("datareporting.healthreport.uploadEnabled", true),
  };
}

/** Reads the request body (fetch/XHR/form uploads) of a channel. */
function readUploadBody(channel) {
  let stream = null;
  try {
    stream = channel.QueryInterface(Ci.nsIUploadChannel).uploadStream;
  } catch (e) {}
  if (!stream) {
    return Promise.resolve(new Uint8Array(0));
  }
  if (stream instanceof Ci.nsISeekableStream) {
    try {
      stream.seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);
    } catch (e) {}
  }
  return new Promise((resolve, reject) => {
    lazy.NetUtil.asyncFetch(stream, (input, status) => {
      if (!Components.isSuccessCode(status)) {
        reject(new Error(`Could not read the request body (${status})`));
        return;
      }
      try {
        let available = input.available();
        resolve(
          available
            ? new Uint8Array(lazy.NetUtil.readInputStream(input, available))
            : new Uint8Array(0)
        );
      } catch (e) {
        reject(e);
      } finally {
        input.close();
      }
    });
  });
}
