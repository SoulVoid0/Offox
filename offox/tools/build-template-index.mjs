#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Writes browser/components/offox/templates/index.json: every template's template.json plus
// the list of its files. The browser needs this list because bundled files
// inside omni.ja can not be listed at run time.
//
//   node tools/build-template-index.mjs [--check]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../browser/components/offox/templates");

function walk(dir, prefix = "") {
  let out = [];
  for (let entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    let rel = prefix + entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(path.join(dir, entry.name), rel + "/"));
    } else if (entry.name !== "template.json" && !entry.name.startsWith(".")) {
      out.push(rel);
    }
  }
  return out;
}

const ORDER = ["blank", "video", "wiki", "software", "docs", "sheets", "slides", "blog", "board", "photos", "music", "library", "drive"];
let templates = [];
for (let name of fs.readdirSync(root)) {
  let dir = path.join(root, name);
  if (name.startsWith("_") || !fs.statSync(dir).isDirectory()) continue;
  let meta = JSON.parse(fs.readFileSync(path.join(dir, "template.json"), "utf8"));
  if (meta.id !== name) throw new Error(`${name}/template.json has id ${meta.id}`);
  for (let s of meta.shared || []) {
    if (!fs.existsSync(path.join(root, "_shared", s))) throw new Error(`${name}: missing shared file ${s}`);
  }
  templates.push({ ...meta, files: walk(dir) });
}
templates.sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
let json = JSON.stringify({ generated: "tools/build-template-index.mjs", templates }, null, 2) + "\n";
let target = path.join(root, "index.json");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== json) {
    console.error("templates/index.json is out of date; run node tools/build-template-index.mjs");
    process.exit(1);
  }
} else {
  fs.writeFileSync(target, json);
  console.log(`Wrote ${templates.length} templates to ${path.relative(process.cwd(), target)}`);
}
