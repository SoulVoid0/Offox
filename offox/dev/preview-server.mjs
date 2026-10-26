#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Developer tool: serves Offox storage folders with the *same* router the
// browser uses, so templates can be worked on in any browser without
// building Offox.
//
//   node dev/preview-server.mjs [--root ~/OffoxSites] [--root /mnt/usb/Sites] [--port 8443]
//
// It speaks HTTPS with a throw-away self-signed certificate and answers for
// every host name. Point a browser at its built-in proxy (port + 1), e.g.
//   chromium --proxy-server=http://127.0.0.1:8444 --ignore-certificate-errors
// and open https://fireline.offox/

import https from "node:https";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { NodeFS, OFFOX_DIR, nodeAssets, nodeMedia } from "./node-adapters.mjs";
import { SiteRegistry } from "../../browser/components/offox/modules/OffoxSites.sys.mjs";
import { FireLine } from "../../browser/components/offox/modules/OffoxFireLine.sys.mjs";
import { OffoxRouter, statusText } from "../../browser/components/offox/modules/OffoxRouter.sys.mjs";

export async function createOffox(roots, { init = true } = {}) {
  let assets = nodeAssets();
  let log = msg => console.error("[offox]", msg);
  let registry = new SiteRegistry({ fs: NodeFS, assets, log });
  await registry.load(roots);
  if (init) {
    for (let root of roots) {
      await registry.initRoot(root);
    }
    await registry.load(roots);
  }
  let fireline = new FireLine({ fs: NodeFS, registry, log });
  let router = new OffoxRouter({
    fs: NodeFS,
    assets,
    registry,
    fireline,
    media: nodeMedia(),
    maxChunk: 8 * 1024 * 1024,
    log,
  });
  return { registry, fireline, router, settings: settingsBackend(registry, fireline) };
}

// The about:offox settings page, served at https://settings.offox/ by the
// preview server. Same method names as OffoxService in the browser.
export const SETTINGS_HOST = "settings.offox";

function settingsBackend(registry, fireline) {
  let ffmpegPath = process.env.OFFOX_FFMPEG || "";
  let siteInfo = s => ({
    domain: s.domain,
    aliases: s.aliases,
    url: `https://${s.domain}/`,
    title: s.title,
    description: s.description,
    template: s.template,
    created: s.created,
    root: s.root,
    folder: s.folder,
    dir: s.dir,
  });
  let reload = async roots => {
    await registry.load(roots);
    fireline.invalidate();
  };
  return {
    async status() {
      // Re-scan so drives that were plugged in or removed show up.
      await reload(registry.roots);
      let media = nodeMedia(ffmpegPath || undefined);
      let info = await media.info();
      return {
        portable: false,
        devMode: true,
        appDir: path.dirname(OFFOX_DIR),
        defaultRoot: path.join(os.homedir(), "Offox Sites"),
        roots: registry.roots.map(p => ({
          path: p,
          ...(registry.rootStatus.get(p) || { available: false, siteCount: 0 }),
        })),
        sites: registry.list().map(siteInfo),
        conflicts: registry.conflicts,
        ffmpeg: info.path,
        ffmpegChosen: ffmpegPath,
        network: { proxyLocked: false, proxy: "preview server", trrMode: 5, webrtc: false, updates: false, telemetry: false },
        error: null,
      };
    },
    async templates() {
      return (await registry.templates()).map(({ files, shared, directories, searchRules, ...t }) => t);
    },
    async addRoot(root) {
      root = path.resolve(root);
      let created = await registry.initRoot(root);
      await reload([...registry.roots.filter(r => r != root), root]);
      return created.map(siteInfo);
    },
    async removeRoot(root) {
      await reload(registry.roots.filter(r => r != root));
    },
    async moveRoot(root, delta) {
      let roots = [...registry.roots];
      let i = roots.indexOf(root);
      let j = i + delta;
      if (i >= 0 && j >= 0 && j < roots.length) {
        [roots[i], roots[j]] = [roots[j], roots[i]];
        await reload(roots);
      }
    },
    async createSite(options) {
      let site = await registry.createSite(options);
      fireline.invalidate();
      return siteInfo(site);
    },
    async updateSite(domain, changes) {
      let site = await registry.updateSite(domain, changes);
      fireline.invalidate();
      return siteInfo(site);
    },
    async deleteSite(domain) {
      await registry.deleteSite(domain);
      fireline.invalidate();
    },
    async setFFmpegPath(p) {
      ffmpegPath = p;
    },
    async reveal() {},
  };
}

async function handleSettings(offox, req, url) {
  if (url.pathname == "/rpc" && req.method == "POST") {
    let chunks = [];
    for await (let c of req) {
      chunks.push(c);
    }
    let { method, args } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Object.hasOwn(offox.settings, method)) {
      return { status: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "no such method" }) };
    }
    try {
      let result = await offox.settings[method](...(args || []));
      return { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: result ?? null }) };
    } catch (e) {
      return { status: e.status || 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message }) };
    }
  }
  let name = url.pathname == "/" ? "settings.html" : url.pathname.slice(1);
  let file = path.join(OFFOX_DIR, "content", name);
  if (!file.startsWith(path.join(OFFOX_DIR, "content")) || !fs.existsSync(file)) {
    return { status: 404, headers: { "Content-Type": "text/plain" }, body: "Not found" };
  }
  let types = { html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", svg: "image/svg+xml" };
  return {
    status: 200,
    headers: { "Content-Type": types[name.split(".").pop()] || "application/octet-stream" },
    body: fs.readFileSync(file),
  };
}

function selfSignedCert() {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "offox-cert-"));
  let key = path.join(dir, "key.pem");
  let cert = path.join(dir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
    "-subj", "/CN=offox-preview", "-keyout", key, "-out", cert,
  ], { stdio: "ignore" });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

export async function startServer({ roots, port = 8443, proxyPort = 0 }) {
  let offox = await createOffox(roots);
  let server = https.createServer(selfSignedCert(), async (req, res) => {
    let host = (req.headers.host || "localhost").replace(/:\d+$/, "");
    if (host == SETTINGS_HOST) {
      let r = await handleSettings(offox, req, new URL(req.url, `https://${host}`));
      res.writeHead(r.status, r.headers);
      res.end(r.body);
      return;
    }
    let response = await offox.router.handle({
      method: req.method,
      url: `https://${host}${req.url}`,
      headers: req.headers,
      readBody: () =>
        new Promise((resolve, reject) => {
          let chunks = [];
          req.on("data", c => chunks.push(c));
          req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
          req.on("error", reject);
        }),
    });
    if (process.env.OFFOX_DEBUG) {
      console.error(req.method, host, req.url, JSON.stringify(req.headers), "->", response.status, JSON.stringify(response.headers));
    }
    res.writeHead(response.status, statusText(response.status), response.headers);
    if (response.file && !response.head) {
      if (response.file.size === 0) {
        res.end();
      } else {
        fs.createReadStream(response.file.path, {
          start: response.file.start,
          end: response.file.end,
        }).pipe(res);
      }
    } else {
      res.end(response.head ? undefined : Buffer.from(response.body || []));
    }
  });
  await new Promise(r => server.listen(port, "127.0.0.1", r));

  // A tiny HTTP proxy in front of it, so any browser can be pointed at Offox
  // with its normal proxy setting: every CONNECT goes to the server above.
  let proxy = http.createServer((req, res) => {
    // Plain http:// requests through the proxy: let the router redirect them.
    let url = new URL(req.url, "http://localhost");
    res.writeHead(301, { Location: `https://${url.host}${url.pathname}${url.search}` });
    res.end();
  });
  proxy.on("connect", (req, socket, head) => {
    let upstream = net.connect(port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  await new Promise(r => proxy.listen(proxyPort || port + 1, "127.0.0.1", r));
  server.on("close", () => proxy.close());
  return { server, proxy, proxyPort: proxyPort || port + 1, ...offox };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let roots = [];
  let port = 8443;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--root") {
      roots.push(path.resolve(process.argv[++i].replace(/^~/, os.homedir())));
    } else if (process.argv[i] === "--port") {
      port = Number(process.argv[++i]);
    }
  }
  if (!roots.length) {
    console.log("No --root given: add a storage folder on the settings page.");
  }
  let { registry, proxyPort } = await startServer({ roots, port });
  console.log(`Offox preview on https://127.0.0.1:${port} (proxy on 127.0.0.1:${proxyPort})`);
  console.log(`  Settings page: https://${SETTINGS_HOST}/`);
  for (let site of registry.list()) {
    console.log(`  https://${site.domain}/  ->  ${site.dir}`);
  }
  console.log(
    `Start a browser with: chromium --proxy-server=http://127.0.0.1:${proxyPort} --ignore-certificate-errors https://fireline.offox/`
  );
}
