/* Shared helpers for the browser tests: start the preview server on a fresh
 * storage folder and open Chromium with every host mapped to it. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../dev/preview-server.mjs";

const require = createRequire(import.meta.url);

export async function setup({ port = 8443 + Math.floor(Math.random() * 500), noRoots = false } = {}) {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), "offox-root-"));
  let server = await startServer({ roots: noRoots ? [] : [root], port });
  let { chromium } = require("playwright");
  let browser = await chromium.launch({
    args: [`--proxy-server=http://127.0.0.1:${server.proxyPort}`, "--proxy-bypass-list=<-loopback>", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required"],
  });
  let context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } });
  let page = await context.newPage();
  let errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("dialog", d => d.accept());
  return {
    root, server, browser, page, errors,
    async close() {
      await browser.close();
      server.server.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function check(cond, message) {
  if (!cond) throw new Error("Check failed: " + message);
  console.log("  ✓ " + message);
}
