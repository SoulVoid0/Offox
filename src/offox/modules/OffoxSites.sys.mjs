/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The site registry: which storage folders exist, which "websites" live in
// them, and which host name each website answers to. Portable (Gecko + Node);
// all disk access goes through the `fs` adapter and all bundled files through
// the `assets` adapter.
//
// On-disk layout:
//   <storage root>/offox-storage.json        marks a folder as Offox storage
//   <storage root>/<site folder>/offox-site.json
//   <storage root>/<site folder>/index.html ...

import {
  OffoxError,
  RESERVED_HOSTS,
  ROOT_MANIFEST,
  SITE_MANIFEST,
  normalizeDomain,
  safeFolderName,
  utf8Decode,
  utf8Encode,
} from "./OffoxUtil.sys.mjs";

// Websites created the first time a storage folder is added.
export const DEFAULT_SITES = [
  {
    template: "video",
    domain: "youtube.com",
    title: "OffTube",
    description: "Watch, upload and organise your offline videos.",
  },
  {
    template: "wiki",
    domain: "wikipedia.org",
    title: "Offpedia",
    description: "Your own offline encyclopedia.",
  },
  {
    template: "software",
    domain: "software.store",
    title: "Software Store",
    description: "Keep installers and portable apps in one place.",
  },
  {
    template: "docs",
    domain: "docs.offox",
    title: "Docs",
    description: "Write and format documents.",
  },
  {
    template: "sheets",
    domain: "sheets.offox",
    title: "Sheets",
    description: "Spreadsheets with formulas and charts.",
  },
  {
    template: "slides",
    domain: "slides.offox",
    title: "Slides",
    description: "Presentations with themes and a full-screen presenter.",
  },
];

const TEXT_TEMPLATE_FILE = /\.(html?|css|js|mjs|json|md|txt|svg|webmanifest)$/i;

export class SiteRegistry {
  /**
   * @param {object} options
   * @param {object} options.fs      file system adapter (see docs/ARCHITECTURE.md)
   * @param {object} options.assets  bundled asset reader: read(relPath) -> Uint8Array
   * @param {Function} [options.log]
   */
  constructor({ fs, assets, log }) {
    this.fs = fs;
    this.assets = assets;
    this.log = log || (() => {});
    this.roots = [];
    this.rootStatus = new Map();
    this.sites = new Map();
    this.conflicts = [];
    this.generation = 0;
    this._templates = null;
  }

  /** Re-reads every storage root from disk. */
  async load(roots) {
    this.roots = [...new Set(roots.filter(Boolean))];
    let sites = new Map();
    let conflicts = [];
    this.rootStatus = new Map();
    for (let root of this.roots) {
      let found = [];
      try {
        found = await this._scanRoot(root);
        this.rootStatus.set(root, { available: true, siteCount: found.length });
      } catch (e) {
        this.rootStatus.set(root, {
          available: false,
          siteCount: 0,
          error: String(e.message || e),
        });
        continue;
      }
      for (let site of found) {
        for (let host of [site.domain, ...site.aliases]) {
          let existing = sites.get(host);
          if (existing) {
            conflicts.push({ host, kept: existing.dir, ignored: site.dir });
            continue;
          }
          sites.set(host, site);
        }
      }
    }
    this.sites = sites;
    this.conflicts = conflicts;
    this.generation++;
    return this;
  }

  async _scanRoot(root) {
    let stat = await this.fs.stat(root);
    if (!stat || stat.type !== "directory") {
      throw new Error("Folder not found (is the drive connected?)");
    }
    let result = [];
    for (let entry of await this.fs.list(root)) {
      if (entry.type !== "directory") {
        continue;
      }
      let dir = this.fs.join(root, entry.name);
      let manifest = await this._readJSON(this.fs.join(dir, SITE_MANIFEST));
      if (!manifest) {
        continue;
      }
      let domain = normalizeDomain(manifest.domain);
      if (!domain || RESERVED_HOSTS.includes(domain)) {
        this.log(`Ignoring site in ${dir}: invalid domain`);
        continue;
      }
      result.push({
        domain,
        aliases: (manifest.aliases || []).map(normalizeDomain).filter(Boolean),
        title: String(manifest.title || domain),
        description: String(manifest.description || ""),
        template: String(manifest.template || "custom"),
        created: manifest.created || null,
        searchRules: Array.isArray(manifest.searchRules) ? manifest.searchRules : [],
        root,
        folder: entry.name,
        dir,
      });
    }
    return result;
  }

  async _readJSON(path) {
    try {
      let stat = await this.fs.stat(path);
      if (!stat || stat.type !== "file") {
        return null;
      }
      return JSON.parse(await this.fs.readText(path));
    } catch (e) {
      this.log(`Could not read ${path}: ${e}`);
      return null;
    }
  }

  /** Finds the site that answers for a host ("www." is optional). */
  lookup(host) {
    host = String(host || "").toLowerCase();
    return (
      this.sites.get(host) ||
      (host.startsWith("www.") ? this.sites.get(host.slice(4)) : null) ||
      null
    );
  }

  /** Every site once (aliases collapsed), sorted by title. */
  list() {
    let unique = new Map();
    for (let site of this.sites.values()) {
      unique.set(site.dir, site);
    }
    return [...unique.values()].sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }

  async templates() {
    if (!this._templates) {
      let index = JSON.parse(
        utf8Decode(await this.assets.read("templates/index.json"))
      );
      this._templates = index.templates;
    }
    return this._templates;
  }

  /**
   * Prepares a newly added storage folder. The first time a folder is used
   * it is marked with offox-storage.json and the default websites are
   * created in it (skipping any domain that already exists elsewhere).
   * Returns the list of sites that were created.
   */
  async initRoot(root) {
    await this.fs.mkdir(root);
    let markerPath = this.fs.join(root, ROOT_MANIFEST);
    let marker = await this._readJSON(markerPath);
    if (marker) {
      return [];
    }
    // Make sure we know about sites in every other root before checking for
    // domain clashes.
    await this.load([...this.roots, root]);
    let created = [];
    for (let def of DEFAULT_SITES) {
      if (this.lookup(def.domain)) {
        continue;
      }
      try {
        created.push(await this.createSite({ root, ...def }));
      } catch (e) {
        this.log(`Could not create default site ${def.domain}: ${e.message}`);
      }
    }
    await this.fs.write(
      markerPath,
      utf8Encode(
        JSON.stringify(
          { offox: 1, created: new Date().toISOString(), defaultsCreated: true },
          null,
          2
        )
      )
    );
    return created;
  }

  /**
   * Creates a website from a template.
   * @returns the new site record
   */
  async createSite({ root, domain, title, description, template, folder }) {
    let host = normalizeDomain(domain);
    if (!host) {
      throw new OffoxError(400, "Please enter a valid address, e.g. https://my-site.com");
    }
    if (RESERVED_HOSTS.includes(host)) {
      throw new OffoxError(400, `${host} is reserved by Offox`);
    }
    if (this.lookup(host)) {
      throw new OffoxError(409, `A website already uses https://${host}`);
    }
    if (!this.roots.includes(root)) {
      throw new OffoxError(400, "Choose one of your storage folders");
    }
    let templates = await this.templates();
    let tpl = templates.find(t => t.id === (template || "blank"));
    if (!tpl) {
      throw new OffoxError(400, `Unknown template "${template}"`);
    }
    title = String(title || tpl.defaultTitle || host).trim();
    description = String(description || "").trim();

    let base = safeFolderName(folder || title);
    let name = base;
    for (let i = 2; await this.fs.stat(this.fs.join(root, name)); i++) {
      name = `${base} (${i})`;
    }
    let dir = this.fs.join(root, name);
    await this.fs.mkdir(dir);

    let replacements = {
      "{{SITE_TITLE}}": title,
      "{{SITE_DOMAIN}}": host,
      "{{SITE_DESCRIPTION}}": description,
      "{{CREATED}}": new Date().toISOString(),
    };
    let copy = async (from, to) => {
      let bytes = await this.assets.read(from);
      if (TEXT_TEMPLATE_FILE.test(to)) {
        let text = utf8Decode(bytes);
        for (let [key, value] of Object.entries(replacements)) {
          text = text.split(key).join(htmlSafe(to, value));
        }
        bytes = utf8Encode(text);
      }
      let parts = to.split("/");
      if (parts.length > 1) {
        await this.fs.mkdir(this.fs.join(dir, ...parts.slice(0, -1)));
      }
      await this.fs.write(this.fs.join(dir, ...parts), bytes);
    };
    for (let file of tpl.files) {
      await copy(`templates/${tpl.id}/${file}`, file);
    }
    for (let file of tpl.shared || []) {
      await copy(`templates/_shared/${file}`, `assets/${file}`);
    }
    for (let emptyDir of tpl.directories || []) {
      await this.fs.mkdir(this.fs.join(dir, ...emptyDir.split("/")));
    }

    let manifest = {
      offox: 1,
      domain: host,
      aliases: [],
      title,
      description,
      template: tpl.id,
      created: new Date().toISOString(),
      searchRules: tpl.searchRules || [],
    };
    await this.fs.write(
      this.fs.join(dir, SITE_MANIFEST),
      utf8Encode(JSON.stringify(manifest, null, 2))
    );
    await this.load(this.roots);
    return this.lookup(host);
  }

  /** Changes a site's address, title or description. */
  async updateSite(domain, changes) {
    let site = this.lookup(domain);
    if (!site) {
      throw new OffoxError(404, "No such website");
    }
    let path = this.fs.join(site.dir, SITE_MANIFEST);
    let manifest = (await this._readJSON(path)) || {};
    if (changes.domain !== undefined) {
      let host = normalizeDomain(changes.domain);
      if (!host || RESERVED_HOSTS.includes(host)) {
        throw new OffoxError(400, "Please enter a valid address");
      }
      let other = this.lookup(host);
      if (other && other.dir !== site.dir) {
        throw new OffoxError(409, `A website already uses https://${host}`);
      }
      manifest.domain = host;
    }
    for (let key of ["title", "description"]) {
      if (changes[key] !== undefined) {
        manifest[key] = String(changes[key]);
      }
    }
    if (changes.aliases !== undefined) {
      manifest.aliases = changes.aliases.map(normalizeDomain).filter(Boolean);
    }
    await this.fs.write(path, utf8Encode(JSON.stringify(manifest, null, 2)));
    await this.load(this.roots);
    return this.lookup(manifest.domain);
  }

  /** Deletes a website's folder from disk. */
  async deleteSite(domain) {
    let site = this.lookup(domain);
    if (!site) {
      throw new OffoxError(404, "No such website");
    }
    await this.fs.remove(site.dir, { recursive: true });
    await this.load(this.roots);
  }
}

function htmlSafe(fileName, value) {
  if (/\.(html?|svg)$/i.test(fileName)) {
    return String(value).replace(
      /[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }
  if (/\.(json|js|mjs|webmanifest)$/i.test(fileName)) {
    // Placeholders sit inside JSON/JS string literals.
    return JSON.stringify(String(value)).slice(1, -1);
  }
  return String(value);
}
