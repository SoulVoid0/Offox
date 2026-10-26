#!/usr/bin/env node
/* Syntax-checks every JavaScript file and inline <script> in src/offox.
 *   node tools/check-syntax.mjs */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/offox");
// Files loaded with <script type="module">.
const MODULE_SCRIPTS = new Set(["content/settings.js"]);
let failures = 0;
function check(code, label, module) {
  try {
    if (module) new vm.SourceTextModule(code, { identifier: label });
    else new vm.Script(code, { filename: label });
  } catch (e) {
    failures++;
    console.error(`${label}: ${e.message}`);
  }
}
function walk(dir) {
  for (let e of fs.readdirSync(dir, { withFileTypes: true })) {
    let p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js)$/.test(e.name)) check(fs.readFileSync(p, "utf8"), p, MODULE_SCRIPTS.has(path.relative(root, p).split(path.sep).join("/")));
    else if (/\.mjs$/.test(e.name)) check(fs.readFileSync(p, "utf8"), p, true);
    else if (/\.html$/.test(e.name)) {
      let html = fs.readFileSync(p, "utf8");
      let i = 0;
      for (let m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) check(m[1], `${p} <script #${++i}>`, false);
    }
  }
}
walk(root);
if (failures) {
  console.error(`${failures} file(s) with syntax errors`);
  process.exit(1);
}
console.log("All scripts parse.");
