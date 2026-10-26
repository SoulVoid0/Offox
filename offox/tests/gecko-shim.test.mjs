/* Runs the browser-side modules (OffoxService, OffoxGecko) in Node with
 * stand-ins for the Gecko APIs they use (IOUtils, PathUtils, Services,
 * nsIHttpChannel, nsIReplacedHttpResponse...). It cannot prove that Gecko
 * behaves like the stand-ins, but it catches mistakes in the glue code:
 *   node tests/gecko-shim.test.mjs */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../browser/components/offox");

register(
  "data:text/javascript," +
    encodeURIComponent(`
      const SRC = ${JSON.stringify(pathToFileURL(SRC).href)};
      export async function resolve(specifier, context, next) {
        if (specifier.startsWith("resource://offox/")) {
          return { url: SRC + "/" + specifier.slice("resource://offox/".length), shortCircuit: true };
        }
        if (specifier === "resource://gre/modules/AppConstants.sys.mjs") {
          return { url: "data:text/javascript,export const AppConstants = { platform: 'linux' };", shortCircuit: true };
        }
        return next(specifier, context);
      }`)
);

function check(cond, message) {
  if (!cond) {
    throw new Error("Check failed: " + message);
  }
  console.log("  ✓ " + message);
}

// ------------------------------------------------------------ stand-ins
let tmp = fs.mkdtempSync(path.join(os.tmpdir(), "offox-gecko-"));
let appDir = path.join(tmp, "app");
fs.mkdirSync(appDir);

const prefs = new Map();
const defaults = new Map();
const prefObservers = [];
const obsObservers = new Map();
function branch(prefix, store) {
  return {
    setBoolPref: (n, v) => store.set(prefix + n, v),
  };
}
globalThis.Services = {
  prefs: {
    getStringPref: (n, d) => prefs.get(n) ?? defaults.get(n) ?? d,
    setStringPref(n, v) {
      prefs.set(n, v);
      for (let [p, o] of prefObservers) {
        if (n.startsWith(p)) {
          o.observe(null, "nsPref:changed", n);
        }
      }
    },
    getIntPref: (n, d) => prefs.get(n) ?? d,
    getBoolPref: (n, d) => prefs.get(n) ?? defaults.get(n) ?? d,
    prefIsLocked: () => false,
    getDefaultBranch: prefix => branch(prefix, defaults),
    addObserver: (p, o) => prefObservers.push([p, o]),
  },
  obs: {
    addObserver: (o, topic) => obsObservers.set(topic, o),
    removeObserver: () => {},
  },
  dirsvc: {
    get(key) {
      let p = { GreBinD: appDir, Docs: path.join(tmp, "Documents"), Home: tmp }[key];
      return { path: p, append() {}, exists: () => false };
    },
  },
  appinfo: { OS: "Linux" },
};
globalThis.Ci = {
  nsIHttpChannel: "nsIHttpChannel",
  nsIHttpChannelInternal: "nsIHttpChannelInternal",
  nsIUploadChannel: "nsIUploadChannel",
  nsIReplacedHttpResponse: "nsIReplacedHttpResponse",
  nsIFile: "nsIFile",
  nsISeekableStream: function () {},
  nsIContentPolicy: { TYPE_DOCUMENT: 6, TYPE_SUBDOCUMENT: 7, TYPE_MEDIA: 15, TYPE_FETCH: 20 },
};
globalThis.Cr = { NS_ERROR_FAILURE: 0x80004005 };
globalThis.Components = { isSuccessCode: s => s === 0 };
globalThis.Cc = {
  "@mozilla.org/network/replaced-http-response;1": {
    createInstance: () => ({
      responseStatus: 0,
      responseStatusText: "",
      responseBody: "",
      headers: {},
      setResponseHeader(n, v) {
        this.headers[n.toLowerCase()] = v;
      },
    }),
  },
};
globalThis.PathUtils = {
  join: (...p) => path.join(...p),
  filename: p => path.basename(p),
  toFileURI: p => pathToFileURL(p).href,
};
globalThis.IOUtils = {
  async stat(p) {
    let s = await fsp.stat(p);
    return { type: s.isDirectory() ? "directory" : s.isFile() ? "regular" : "other", size: s.size, lastModified: s.mtimeMs };
  },
  getChildren: async p => (await fsp.readdir(p)).map(n => path.join(p, n)),
  async read(p, { offset = 0, maxBytes } = {}) {
    let buf = await fsp.readFile(p);
    return new Uint8Array(buf.subarray(offset, maxBytes == null ? undefined : offset + maxBytes));
  },
  readUTF8: p => fsp.readFile(p, "utf8"),
  async write(p, bytes, { mode }) {
    if (mode === "append") {
      await fsp.access(p); // Gecko refuses to create the file in this mode
    }
    if (!["overwrite", "append", "appendOrCreate"].includes(mode)) {
      throw new Error("bad mode " + mode);
    }
    await (mode === "overwrite" ? fsp.writeFile(p, bytes) : fsp.appendFile(p, bytes));
  },
  makeDirectory: p => fsp.mkdir(p, { recursive: true }),
  remove: (p, o) => fsp.rm(p, { recursive: o.recursive, force: true }),
  move: (a, b) => fsp.rename(a, b),
  exists: async p => fs.existsSync(p),
};
const NetUtil = {
  asyncFetch(source, callback) {
    let bytes;
    if (source.uri) {
      let rel = source.uri.slice("resource://offox/".length);
      let file = path.join(SRC, rel);
      if (!fs.existsSync(file)) {
        callback(null, 1);
        return;
      }
      bytes = fs.readFileSync(file);
    } else {
      bytes = source.bytes;
    }
    let stream = { available: () => bytes.length, close() {}, bytes };
    setTimeout(() => callback(stream, 0));
  },
  readInputStream: (s, n) => s.bytes.buffer.slice(s.bytes.byteOffset, s.bytes.byteOffset + n),
};
const lazyModules = {
  "resource://gre/modules/NetUtil.sys.mjs": { NetUtil },
  "resource://gre/modules/Subprocess.sys.mjs": { Subprocess: { pathSearch: async () => { throw new Error("none"); } } },
  "resource:///modules/AboutNewTab.sys.mjs": { AboutNewTab: {} },
  "resource://gre/modules/FileUtils.sys.mjs": { FileUtils: { File: class { constructor(p) { this.path = p; } } } },
  "resource://gre/modules/Downloads.sys.mjs": { Downloads: {} },
  "resource://gre/modules/DownloadPaths.sys.mjs": { DownloadPaths: {} },
};
globalThis.ChromeUtils = {
  defineESModuleGetters(obj, map) {
    for (let [name, url] of Object.entries(map)) {
      Object.defineProperty(obj, name, { get: () => lazyModules[url][name] });
    }
  },
  generateQI: () => function () { return this; },
  importESModule: url => lazyModules[url],
};

// --------------------------------------------------------------- tests
const { OffoxService } = await import(pathToFileURL(path.join(SRC, "modules/OffoxService.sys.mjs")).href);

function fakeChannel(url, { method = "GET", headers = {}, type = 6, body = null } = {}) {
  let ch = {
    URI: { spec: url },
    requestMethod: method,
    loadInfo: { externalContentPolicyType: type },
    suspended: 0,
    override: null,
    uploadStream: body ? { bytes: Buffer.from(body) } : null,
    visitRequestHeaders(v) {
      for (let [k, val] of Object.entries(headers)) {
        v.visitHeader(k, val);
      }
    },
    suspend() {
      this.suspended++;
    },
    resume() {
      this.suspended--;
      this.done?.();
    },
    cancel(status) {
      this.cancelled = status;
    },
    QueryInterface() {
      return this;
    },
    setResponseOverride(r) {
      this.override = r;
    },
  };
  ch.finished = new Promise(r => (ch.done = r));
  return ch;
}

async function request(url, options) {
  let ch = fakeChannel(url, options);
  obsObservers.get("http-on-before-connect").observe(ch, "http-on-before-connect");
  check(ch.suspended === 1, `${options?.method || "GET"} ${url} is held while Offox answers`);
  await ch.finished;
  if (ch.cancelled) {
    throw new Error("channel cancelled");
  }
  return ch.override;
}

try {
  OffoxService.init();
  await OffoxService.ready;
  let status = await OffoxService.status();
  check(status.roots.length === 0 && status.defaultRoot.endsWith("Offox Sites"), "starts with no storage folders");

  let root = path.join(tmp, "Sites");
  let created = await OffoxService.addRoot(root);
  check(created.length === 7, "adding a folder creates the seven default websites");
  check(created.some(site => site.domain === "reddit.com"), "the notes board is one of the default websites");
  check(JSON.parse(prefs.get("offox.storage.roots"))[0] === root, "the folder is saved in offox.storage.roots");
  check(defaults.get("browser.fixup.domainsuffixwhitelist.docs.offox") === true, "site addresses are taught to the address bar");

  let home = await request("https://fireline.offox/");
  check(home.responseStatus === 200 && home.responseBody.includes("FireLine"), "FireLine home page is served");
  let yt = await request("https://youtube.com/");
  check(yt.responseStatus === 200 && yt.headers["content-type"].startsWith("text/html"), "youtube.com is answered from the folder");
  check(Number(yt.headers["content-length"]) === yt.responseBody.length, "Content-Length matches the body");
  let missing = await request("https://example.com/");
  check(missing.responseStatus === 404, "unknown sites get the offline page");
  let redirect = await request("http://youtube.com/watch.html?v=1");
  check(redirect.responseStatus === 301 && redirect.headers.location === "https://youtube.com/watch.html?v=1", "http:// is redirected to https://");
  let www = await request("https://www.youtube.com/watch.html?v=1");
  check(www.responseStatus === 301 && www.headers.location === "https://youtube.com/watch.html?v=1", "www.youtube.com goes to youtube.com");
  let topSites = prefs.get("browser.newtabpage.activity-stream.default.sites").split(",");
  check(topSites[0] === "https://fireline.offox/" && topSites.includes("https://youtube.com/") && topSites.includes("https://reddit.com/"), "the address bar's top sites are FireLine and your websites");

  // Writes through the site API with a request body
  let write = await request("https://youtube.com/__offox/api/write?path=videos/abc/title.txt", {
    method: "POST",
    type: 20,
    headers: { Origin: "https://youtube.com", "Sec-Fetch-Site": "same-origin" },
    body: "Héllo",
  });
  check(write.responseStatus === 200, "site API write succeeds");
  let site = OffoxService.registry.lookup("youtube.com");
  check(fs.readFileSync(path.join(site.dir, "videos/abc/title.txt"), "utf8") === "Héllo", "the request body is written to the site folder");
  let append = await request("https://youtube.com/__offox/api/write?path=videos/abc/new.bin&offset=0", {
    method: "PUT", type: 20, headers: { Origin: "https://youtube.com", "Sec-Fetch-Site": "same-origin" }, body: "abc",
  });
  check(append.responseStatus === 200, "chunked upload can start a new file");
  let cross = await request("https://youtube.com/__offox/api/write?path=x.txt", {
    method: "POST", type: 20, headers: { Origin: "https://evil.site", "Sec-Fetch-Site": "cross-site" }, body: "x",
  });
  check(cross.responseStatus === 403, "other sites cannot write");

  // Ranges and binary bodies
  let big = Buffer.alloc(9 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) {
    big[i] = i % 251;
  }
  fs.writeFileSync(path.join(site.dir, "videos/abc/video.mp4"), big);
  let range = await request("https://youtube.com/videos/abc/video.mp4", { type: 15, headers: { Range: "bytes=100-" } });
  check(range.responseStatus === 206 && range.responseBody.length === 8 * 1024 * 1024, "range answers are capped at 8 MB");
  check(range.responseBody.charCodeAt(0) === 100 % 251 && range.headers["content-range"] === `bytes 100-${100 + 8 * 1024 * 1024 - 1}/${big.length}`, "range body and Content-Range are right");

  // Creating, editing and deleting sites
  let blog = await OffoxService.createSite({ root, domain: "my.blog", template: "blog", title: "Mine" });
  check(blog.url === "https://my.blog/", "createSite returns the new site");
  let page = await request("https://my.blog/");
  check(page.responseStatus === 200 && page.responseBody.includes("Mine"), "the new site is served right away");
  await OffoxService.updateSite("my.blog", { domain: "our.blog" });
  check((await request("https://our.blog/")).responseStatus === 200, "a renamed site answers at its new address");
  await OffoxService.deleteSite("our.blog");
  check((await request("https://our.blog/")).responseStatus === 404, "a deleted site is gone");

  // The pref changing elsewhere (e.g. another window) reloads the folders
  Services.prefs.setStringPref("offox.storage.roots", "[]");
  await OffoxService.ready;
  check((await request("https://youtube.com/")).responseStatus === 404, "removing the folder from the pref unloads its sites");
  // about:offox is a chrome:// page shown at about:offox, where relative URLs
  // do not resolve: every file it loads must be named by its full URL.
  let settingsHtml = fs.readFileSync(path.join(SRC, "content", "settings.html"), "utf8");
  let refs = [...settingsHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !u.startsWith("#"));
  check(refs.length && refs.every(u => /^(chrome|https):\/\//.test(u)), "about:offox loads its files by chrome:// URL");
  console.log("All Gecko glue checks passed.");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
