/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Turns a request for https://<any host>/<path> into a response built from
// the local storage folders. Nothing in here touches the network; Offox
// routes *every* http(s) request of the browser through this function.
// Portable: the browser glue (OffoxService) and the Node preview server
// (dev/preview-server.mjs) are thin adapters around it.
//
// Request:  { method, url, headers: {lower-case name: value}, readBody(): Promise<Uint8Array> }
// Response: { status, headers: {}, body?: Uint8Array, file?: {path, start, end, size} }

import { mimeTypeFor } from "./OffoxMime.sys.mjs";
import {
  FIRELINE_HOST,
  OffoxError,
  SITE_MANIFEST,
  escapeHtml,
  parseRange,
  pathSegments,
  utf8Decode,
  utf8Encode,
} from "./OffoxUtil.sys.mjs";

const STATUS_TEXT = {
  200: "OK",
  204: "No Content",
  206: "Partial Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Payload Too Large",
  416: "Range Not Satisfiable",
  500: "Internal Server Error",
  501: "Not Implemented",
};

export function statusText(status) {
  return STATUS_TEXT[status] || "Unknown";
}

const MAX_WRITE_BYTES = 64 * 1024 * 1024;
const MAX_COLLECT_FILE_BYTES = 256 * 1024;

export class OffoxRouter {
  /**
   * @param {object} options
   * @param {object} options.fs
   * @param {object} options.assets     read(relPath) -> Uint8Array of a bundled file
   * @param {SiteRegistry} options.registry
   * @param {FireLine} options.fireline
   * @param {object} [options.media]    { info(), convert(path, opts), job(id) }
   * @param {number} [options.maxChunk] largest body returned for one Range request
   */
  constructor({ fs, assets, registry, fireline, media, maxChunk = Infinity, log }) {
    this.fs = fs;
    this.assets = assets;
    this.registry = registry;
    this.fireline = fireline;
    this.media = media || null;
    this.maxChunk = maxChunk;
    this.log = log || (() => {});
  }

  async handle(req) {
    try {
      return await this._handle(req);
    } catch (e) {
      let status = e instanceof OffoxError ? e.status : 500;
      if (status === 500) {
        this.log(`Error handling ${req.method} ${req.url}: ${e}\n${e.stack || ""}`);
      }
      return wantsJSON(req)
        ? json({ error: e.message }, status)
        : this._errorPage(status, e.message);
    }
  }

  async _handle(req) {
    let url = new URL(req.url);
    let host = url.hostname.toLowerCase();

    if (host === FIRELINE_HOST || host === "fireline") {
      if (url.protocol === "http:" || host === "fireline") {
        return redirect(`https://${FIRELINE_HOST}${url.pathname}${url.search}`);
      }
      return this._fireline(req, url);
    }

    let site = this.registry.lookup(host);
    if (!site) {
      return this._unknownSite(req, url);
    }
    let known = host === site.domain || site.aliases.includes(host);
    if (url.protocol === "http:" || !known) {
      // One origin per site, so storage (localStorage, IndexedDB) is shared;
      // www.<site> goes to <site> and the other way round.
      return redirect(`https://${known ? host : site.domain}${url.pathname}${url.search}`);
    }
    if (url.pathname === "/__offox/offox.js") {
      return this._asset("assets/client/offox.js");
    }
    if (url.pathname.startsWith("/__offox/api/")) {
      return this._api(req, url, site);
    }
    return this._static(req, url, site);
  }

  // ---------------------------------------------------------------- static

  async _static(req, url, site) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return text("Offox websites are files on your disk; use the Offox site API to change them.", 405);
    }
    let segments = pathSegments(url.pathname);
    if (segments[0] === SITE_MANIFEST) {
      throw new OffoxError(404, "Not found");
    }
    let path = this.fs.join(site.dir, ...segments);
    let stat = await this.fs.stat(path);

    if (stat && stat.type === "directory") {
      if (!url.pathname.endsWith("/")) {
        return redirect(`${url.pathname}/${url.search}`);
      }
      for (let index of ["index.html", "index.htm"]) {
        let candidate = this.fs.join(path, index);
        let s = await this.fs.stat(candidate);
        if (s && s.type === "file") {
          return this._file(req, url, candidate, s);
        }
      }
      return this._directoryListing(site, segments, path);
    }
    if (!stat && segments.length && !/\.[^/]+$/.test(segments.at(-1))) {
      // Clean URLs: /about -> /about.html
      let candidate = this.fs.join(site.dir, ...segments.slice(0, -1), segments.at(-1) + ".html");
      let s = await this.fs.stat(candidate);
      if (s && s.type === "file") {
        return this._file(req, url, candidate, s);
      }
    }
    if (!stat || stat.type !== "file") {
      let custom = this.fs.join(site.dir, "404.html");
      let s = await this.fs.stat(custom);
      if (s && s.type === "file") {
        let res = await this._file(req, url, custom, s);
        res.status = 404;
        return res;
      }
      throw new OffoxError(404, `${url.pathname} does not exist on ${site.domain}`);
    }
    return this._file(req, url, path, stat);
  }

  async _file(req, url, path, stat) {
    let name = path.split(/[\\/]/).pop();
    let headers = {
      "Content-Type": mimeTypeFor(name),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      "Last-Modified": new Date(stat.lastModified || Date.now()).toUTCString(),
      "X-Content-Type-Options": "nosniff",
    };
    if (url.searchParams.has("download")) {
      let filename = url.searchParams.get("download") || name;
      headers["Content-Disposition"] =
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
    }
    let size = stat.size;
    let range = req.headers.range ? parseRange(req.headers.range, size) : null;
    if (range && range.unsatisfiable) {
      headers["Content-Range"] = `bytes */${size}`;
      return { status: 416, headers, body: new Uint8Array(0) };
    }
    if (range) {
      let end = Math.min(range.end, range.start + this.maxChunk - 1);
      headers["Content-Range"] = `bytes ${range.start}-${end}/${size}`;
      headers["Content-Length"] = String(end - range.start + 1);
      return {
        status: 206,
        headers,
        file: { path, start: range.start, end, size },
        head: req.method === "HEAD",
      };
    }
    headers["Content-Length"] = String(size);
    return {
      status: 200,
      headers,
      file: { path, start: 0, end: size - 1, size },
      head: req.method === "HEAD",
    };
  }

  async _directoryListing(site, segments, path) {
    let entries = await this.fs.list(path);
    entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1
    );
    let title = `/${segments.join("/")}`;
    let rows = entries
      .filter(e => e.name !== SITE_MANIFEST)
      .map(e => {
        let href = encodeURIComponent(e.name) + (e.type === "directory" ? "/" : "");
        let size = e.type === "directory" ? "" : formatSize(e.size);
        return `<tr><td><a href="${href}">${e.type === "directory" ? "📁" : "📄"} ${escapeHtml(e.name)}</a></td><td>${size}</td><td>${new Date(e.lastModified).toLocaleString()}</td></tr>`;
      })
      .join("");
    let up = segments.length ? `<p><a href="../">⬑ Parent folder</a></p>` : "";
    return html(
      `<!doctype html><meta charset="utf-8"><title>Index of ${escapeHtml(title)} – ${escapeHtml(site.title)}</title>
<meta name="fireline" content="noindex">
<style>body{font:15px system-ui,sans-serif;margin:2rem auto;max-width:900px;padding:0 1rem;color:#222;background:#fff}
@media(prefers-color-scheme:dark){body{background:#1c1b22;color:#eee}a{color:#8cf}}
table{width:100%;border-collapse:collapse}td{padding:.4rem;border-bottom:1px solid #8883}td:nth-child(n+2){white-space:nowrap;opacity:.7}</style>
<h1>Index of ${escapeHtml(site.domain)}${escapeHtml(title)}</h1>${up}
<table>${rows || "<tr><td>This folder is empty.</td></tr>"}</table>`
    );
  }

  // ------------------------------------------------------------- site API

  _resolve(site, relPath, { allowRoot = false } = {}) {
    let segments = pathSegments(relPath || "");
    if (!segments.length && !allowRoot) {
      throw new OffoxError(400, "A path is required");
    }
    if (segments[0] === SITE_MANIFEST) {
      throw new OffoxError(403, "offox-site.json can only be changed in Offox settings");
    }
    return { segments, path: this.fs.join(site.dir, ...segments) };
  }

  _checkSameOrigin(req, site, mutating) {
    let fetchSite = req.headers["sec-fetch-site"];
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      throw new OffoxError(403, "Only pages of this website may use its storage API");
    }
    if (mutating) {
      let origin = req.headers.origin;
      if (origin && origin !== `https://${site.domain}` && !site.aliases.some(a => origin === `https://${a}`)) {
        throw new OffoxError(403, "Only pages of this website may change its files");
      }
      if (!origin && !fetchSite) {
        throw new OffoxError(403, "Missing Origin header");
      }
    }
  }

  async _api(req, url, site) {
    let route = url.pathname.slice("/__offox/api/".length);
    let q = url.searchParams;
    let mutating = !["GET", "HEAD"].includes(req.method);
    this._checkSameOrigin(req, site, mutating);

    let read = {
      info: async () =>
        json({
          domain: site.domain,
          origin: `https://${site.domain}`,
          title: site.title,
          description: site.description,
          template: site.template,
          created: site.created,
        }),
      stat: async () => {
        let { path } = this._resolve(site, q.get("path"), { allowRoot: true });
        let s = await this.fs.stat(path);
        return json(s ? { exists: true, ...s } : { exists: false });
      },
      list: async () => {
        let { path } = this._resolve(site, q.get("path"), { allowRoot: true });
        let s = await this.fs.stat(path);
        if (!s || s.type !== "directory") {
          return json([]);
        }
        let entries = await this.fs.list(path);
        return json(
          entries
            .filter(e => !(e.name === SITE_MANIFEST && !q.get("path")))
            .map(e => ({ name: e.name, type: e.type, size: e.size, modified: e.lastModified }))
        );
      },
      collect: async () => this._collect(site, q),
      sites: async () => json(this.fireline.sites()),
      search: async () => json(await this.fireline.search(q.get("q") || "")),
      "media/info": async () =>
        json(this.media ? await this.media.info() : { ffmpeg: false }),
      "media/speech": async () =>
        json(this.media && this.media.speechInfo ? await this.media.speechInfo() : { available: false, ffmpeg: false, models: [] }),
      "media/subtitle-streams": async () => {
        if (!this.media) {
          return json([]);
        }
        let { path } = this._resolve(site, q.get("path"));
        return json(await this.media.subtitleStreams(path));
      },
      "media/job": async () => {
        if (!this.media) {
          throw new OffoxError(501, "Video conversion is not available");
        }
        return json(await this.media.job(q.get("id")));
      },
    };
    let write = {
      write: async () => {
        let { path, segments } = this._resolve(site, q.get("path"));
        let body = await req.readBody();
        if (body.length > MAX_WRITE_BYTES) {
          throw new OffoxError(413, "Upload in chunks of at most 64 MB");
        }
        if (segments.length > 1) {
          await this.fs.mkdir(this.fs.join(site.dir, ...segments.slice(0, -1)));
        }
        let offset = Number(q.get("offset") || 0);
        if (offset > 0 || q.has("append")) {
          let s = await this.fs.stat(path);
          let current = s ? s.size : 0;
          if (q.has("offset") && current !== offset) {
            throw new OffoxError(409, `File is ${current} bytes, expected ${offset}`);
          }
          await this.fs.write(path, body, { append: true });
        } else {
          await this.fs.write(path, body);
        }
        this.fireline.invalidate(site);
        let s = await this.fs.stat(path);
        return json({ ok: true, size: s ? s.size : body.length });
      },
      mkdir: async () => {
        let { path } = this._resolve(site, q.get("path"));
        await this.fs.mkdir(path);
        return json({ ok: true });
      },
      delete: async () => {
        let { path } = this._resolve(site, q.get("path"));
        if (await this.fs.stat(path)) {
          await this.fs.remove(path, { recursive: true });
        }
        this.fireline.invalidate(site);
        return json({ ok: true });
      },
      move: async () => {
        let from = this._resolve(site, q.get("from"));
        let to = this._resolve(site, q.get("to"));
        if (to.segments.length > 1) {
          await this.fs.mkdir(this.fs.join(site.dir, ...to.segments.slice(0, -1)));
        }
        await this.fs.move(from.path, to.path);
        this.fireline.invalidate(site);
        return json({ ok: true });
      },
      "media/convert": async () => {
        if (!this.media) {
          throw new OffoxError(501, "Video conversion is not available");
        }
        let { path } = this._resolve(site, q.get("path"));
        let out = q.get("output") ? this._resolve(site, q.get("output")).path : null;
        return json(await this.media.convert(path, { output: out, mode: q.get("mode") || "auto" }));
      },
      "media/subtitles": async () => {
        if (!this.media) {
          throw new OffoxError(501, "Automatic subtitles are not available");
        }
        let { path } = this._resolve(site, q.get("path"));
        let dir = this._resolve(site, q.get("dir")).path;
        let audio = q.get("audio") ? this._resolve(site, q.get("audio")).path : null;
        let job = await this.media.transcribe(path, {
          dir,
          language: q.get("language") || "auto",
          translate: q.get("translate") === "1",
          audio,
          removeAudio: !!audio && q.get("removeAudio") === "1",
        });
        if (job.state !== "failed") {
          this.fireline.invalidate(site);
        }
        return json(job);
      },
      "media/extract-subtitles": async () => {
        if (!this.media) {
          throw new OffoxError(501, "Video tools are not available");
        }
        let { path } = this._resolve(site, q.get("path"));
        let dir = this._resolve(site, q.get("dir")).path;
        return json(await this.media.extractSubtitles(path, dir));
      },
    };

    let handler = (mutating ? write : read)[route];
    if (!handler) {
      if ((mutating ? read : write)[route]) {
        throw new OffoxError(405, `Use ${mutating ? "GET" : "POST"} for ${route}`);
      }
      throw new OffoxError(404, `Unknown Offox API "${route}"`);
    }
    return handler();
  }

  /**
   * Reads many small files from every sub folder of a folder in one go,
   * e.g. collect?path=videos&files=title.txt,created.txt
   */
  async _collect(site, q) {
    let { path } = this._resolve(site, q.get("path"));
    let s = await this.fs.stat(path);
    if (!s || s.type !== "directory") {
      return json([]);
    }
    let wanted = (q.get("files") || "").split(",").filter(Boolean);
    for (let f of wanted) {
      pathSegments(f);
    }
    let out = [];
    for (let entry of await this.fs.list(path)) {
      if (entry.type !== "directory") {
        continue;
      }
      let dir = this.fs.join(path, entry.name);
      let children = await this.fs.list(dir);
      let files = {};
      for (let f of wanted) {
        let child = children.find(c => c.name === f && c.type === "file");
        files[f] =
          child && child.size <= MAX_COLLECT_FILE_BYTES
            ? utf8Decode(await this.fs.read(this.fs.join(dir, f)))
            : null;
      }
      out.push({
        name: entry.name,
        modified: entry.lastModified,
        files,
        entries: children.map(c => ({
          name: c.name,
          type: c.type,
          size: c.size,
          modified: c.lastModified,
        })),
      });
    }
    return json(out);
  }

  // -------------------------------------------------------------- FireLine

  async _fireline(req, url) {
    let q = url.searchParams;
    let cors = { "Access-Control-Allow-Origin": "*" };
    switch (url.pathname) {
      case "/":
      case "/index.html":
        return this._asset("assets/fireline/index.html");
      case "/search":
        return this._asset("assets/fireline/search.html");
      case "/api/search":
        return json(await this.fireline.search(q.get("q") || "", { limit: Number(q.get("limit")) || 50 }), 200, cors);
      case "/api/suggest": {
        let query = q.get("q") || "";
        return json([query, await this.fireline.suggest(query)], 200, {
          ...cors,
          "Content-Type": "application/x-suggestions+json",
        });
      }
      case "/api/sites":
        return json(this.fireline.sites(), 200, cors);
      case "/opensearch.xml":
        return this._asset("assets/fireline/opensearch.xml");
    }
    let segments = pathSegments(url.pathname);
    return this._asset(["assets", "fireline", ...segments].join("/"));
  }

  async _asset(relPath) {
    let body;
    try {
      body = await this.assets.read(relPath);
    } catch (e) {
      throw new OffoxError(404, "Not found");
    }
    return {
      status: 200,
      headers: {
        "Content-Type": mimeTypeFor(relPath),
        "Content-Length": String(body.length),
        "Cache-Control": "no-cache",
      },
      body,
    };
  }

  // ---------------------------------------------------------------- errors

  async _unknownSite(req, url) {
    if (!isDocumentRequest(req)) {
      return text(`Offox is offline: ${url.hostname} is not one of your websites.`, 404);
    }
    let page = utf8Decode(await this.assets.read("assets/pages/notfound.html"));
    page = page.split("{{HOST}}").join(escapeHtml(url.hostname));
    page = page.split("{{QUERY}}").join(
      escapeHtml(url.hostname.replace(/^www\./, "").replace(/\.[a-z]+$/, "").replace(/[.-]/g, " "))
    );
    return html(page, 404);
  }

  async _errorPage(status, message) {
    let page;
    try {
      page = utf8Decode(await this.assets.read("assets/pages/error.html"));
    } catch (e) {
      page = "<!doctype html><meta charset=utf-8><title>{{STATUS}}</title><h1>{{STATUS}}</h1><p>{{MESSAGE}}</p>";
    }
    page = page
      .split("{{STATUS}}")
      .join(`${status} ${statusText(status)}`)
      .split("{{MESSAGE}}")
      .join(escapeHtml(message || ""));
    return html(page, status);
  }
}

function isDocumentRequest(req) {
  let dest = req.headers["sec-fetch-dest"];
  if (dest) {
    return dest === "document" || dest === "iframe" || dest === "frame";
  }
  return req.isDocument || /text\/html/.test(req.headers.accept || "");
}

function wantsJSON(req) {
  return /\/__offox\/api\/|\/api\//.test(new URL(req.url).pathname);
}

export function json(value, status = 200, extraHeaders = {}) {
  let body = utf8Encode(JSON.stringify(value));
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body,
  };
}

function html(markup, status = 200) {
  let body = utf8Encode(markup);
  return {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    },
    body,
  };
}

function text(message, status = 200) {
  let body = utf8Encode(message);
  return {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    },
    body,
  };
}

function redirect(location, status = 301) {
  return {
    status,
    headers: { Location: location, "Content-Length": "0", "Cache-Control": "no-store" },
    body: new Uint8Array(0),
  };
}

function formatSize(n) {
  if (n < 1024) {
    return `${n} B`;
  }
  let units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

