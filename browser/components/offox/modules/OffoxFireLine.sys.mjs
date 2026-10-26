/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// FireLine: the built-in (and only) search engine of Offox. It indexes every
// website in every storage folder: the site itself (address, title,
// description), its HTML pages, and template content described by the
// site's "searchRules" (videos, wiki articles, apps, ...). Portable.

import { utf8Decode } from "./OffoxUtil.sys.mjs";

const MAX_HTML_FILES_PER_SITE = 400;
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_DEPTH = 4;
const MAX_RULE_ITEMS = 5000;
const INDEX_TTL_MS = 15000;
const SKIP_DIRS = new Set(["assets", "node_modules", ".git", "history", "__offox"]);

export class FireLine {
  constructor({ fs, registry, log }) {
    this.fs = fs;
    this.registry = registry;
    this.log = log || (() => {});
    this._cache = new Map(); // site.dir -> { built, generation, docs }
  }

  invalidate(site) {
    if (site) {
      this._cache.delete(site.dir);
    } else {
      this._cache.clear();
    }
  }

  async _siteDocs(site) {
    let cached = this._cache.get(site.dir);
    let now = Date.now();
    if (
      cached &&
      cached.generation === this.registry.generation &&
      now - cached.built < INDEX_TTL_MS
    ) {
      return cached.docs;
    }
    let docs = [];
    let origin = `https://${site.domain}`;
    docs.push({
      site: site.domain,
      siteTitle: site.title,
      kind: "site",
      url: `${origin}/`,
      title: site.title,
      text: `${site.description} ${site.domain} ${site.template}`,
    });
    let ruleDirs = new Set();
    for (let rule of site.searchRules) {
      try {
        if (rule.dir) {
          ruleDirs.add(rule.dir.split("/")[0]);
        }
        docs.push(...(await this._applyRule(site, rule)));
      } catch (e) {
        this.log(`FireLine rule failed for ${site.domain}: ${e}`);
      }
    }
    try {
      await this._crawlHtml(site, site.dir, [], docs, ruleDirs, { count: 0 });
    } catch (e) {
      this.log(`FireLine crawl failed for ${site.domain}: ${e}`);
    }
    for (let doc of docs) {
      doc.siteTitle = site.title;
      doc._title = doc.title.toLowerCase();
      doc._text = doc.text.toLowerCase();
      doc._url = doc.url.toLowerCase();
    }
    this._cache.set(site.dir, {
      built: now,
      generation: this.registry.generation,
      docs,
    });
    return docs;
  }

  async _readText(path) {
    let stat = await this.fs.stat(path);
    if (!stat || stat.type !== "file" || stat.size > MAX_TEXT_BYTES) {
      return "";
    }
    return utf8Decode(await this.fs.read(path));
  }

  async _applyRule(site, rule) {
    let dir = this.fs.join(site.dir, ...rule.dir.split("/"));
    let stat = await this.fs.stat(dir);
    if (!stat || stat.type !== "directory") {
      return [];
    }
    let entries = (await this.fs.list(dir)).slice(0, MAX_RULE_ITEMS);
    let docs = [];
    let origin = `https://${site.domain}`;
    for (let entry of entries) {
      let name = entry.name;
      let stem = name.replace(/\.[^.]+$/, "");
      let fill = s =>
        s
          .replace("{name}", encodeURIComponent(name))
          .replace("{stem}", encodeURIComponent(stem));
      if (rule.type === "folders" && entry.type === "directory") {
        let itemDir = this.fs.join(dir, name);
        let title = "";
        let text = "";
        if (rule.json) {
          let data = {};
          try {
            data = JSON.parse(await this._readText(this.fs.join(itemDir, rule.json)) || "{}");
          } catch (e) {}
          title = String(data[rule.titleKey || "title"] || "");
          text = (rule.textKeys || [])
            .map(k => (Array.isArray(data[k]) ? data[k].join(" ") : data[k] || ""))
            .join(" ");
        }
        if (rule.title) {
          title = (await this._readText(this.fs.join(itemDir, rule.title))).trim() || title;
        }
        for (let file of rule.text || []) {
          let content = await this._readText(this.fs.join(itemDir, file));
          if (/\.html?$/i.test(file)) {
            content = content.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
          }
          text += " " + content;
        }
        docs.push({
          site: site.domain,
          kind: rule.kind || "page",
          url: origin + fill(rule.url),
          title: title || name,
          text: text.trim(),
        });
      } else if (
        rule.type === "files" &&
        entry.type === "file" &&
        (!rule.ext || name.toLowerCase().endsWith(rule.ext))
      ) {
        let content = await this._readText(this.fs.join(dir, name));
        let front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
        let frontTitle = front && /^title:\s*(.+)$/m.exec(front[1]);
        if (front) {
          content = content.slice(front[0].length);
        }
        let heading = frontTitle || /^#\s+(.+)$/m.exec(content);
        docs.push({
          site: site.domain,
          kind: rule.kind || "page",
          url: origin + fill(rule.url),
          title: heading ? heading[1].trim() : stem.replace(/_/g, " "),
          text: content.replace(/[#*_`>\[\]()|-]+/g, " "),
        });
      }
    }
    return docs;
  }

  async _crawlHtml(site, dir, segments, docs, ruleDirs, state) {
    if (segments.length > MAX_DEPTH) {
      return;
    }
    for (let entry of await this.fs.list(dir)) {
      if (state.count >= MAX_HTML_FILES_PER_SITE) {
        return;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.type === "directory") {
        if (SKIP_DIRS.has(entry.name) || (segments.length === 0 && ruleDirs.has(entry.name))) {
          continue;
        }
        await this._crawlHtml(
          site,
          this.fs.join(dir, entry.name),
          [...segments, entry.name],
          docs,
          ruleDirs,
          state
        );
      } else if (/\.html?$/i.test(entry.name)) {
        state.count++;
        let html = await this._readText(this.fs.join(dir, entry.name));
        if (/<meta\s+name=["']fireline["']\s+content=["']noindex["']/i.test(html)) {
          continue;
        }
        let path = [...segments, entry.name].map(encodeURIComponent).join("/");
        if (/^index\.html?$/i.test(entry.name)) {
          path = path.replace(/index\.html?$/i, "");
        }
        let title = (/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1] || entry.name;
        let description =
          (/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html) || [])[1] || "";
        let body = html
          .replace(/<(script|style|template)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+/g, " ");
        docs.push({
          site: site.domain,
          kind: "page",
          url: `https://${site.domain}/${path}`,
          title: decodeEntities(title.trim()),
          text: `${description} ${body}`.slice(0, 20000),
        });
      }
    }
  }

  /** Lists every website (used by the FireLine home page). */
  sites() {
    return this.registry.list().map(s => ({
      domain: s.domain,
      url: `https://${s.domain}/`,
      title: s.title,
      description: s.description,
      template: s.template,
      folder: s.dir,
    }));
  }

  /**
   * Searches all websites. Every query word has to match somewhere in a
   * result (title, address or text); if that finds nothing, results that
   * match any word are returned instead.
   */
  async search(query, { limit = 50 } = {}) {
    let words = tokenize(query);
    if (!words.length) {
      return { query, total: 0, results: [] };
    }
    let all = [];
    for (let site of this.registry.list()) {
      all.push(...(await this._siteDocs(site)));
    }
    let scored = score(all, words, true);
    if (!scored.length) {
      scored = score(all, words, false);
    }
    scored.sort((a, b) => b.score - a.score);
    return {
      query,
      total: scored.length,
      results: scored.slice(0, limit).map(({ doc, score: s }) => ({
        url: doc.url,
        title: doc.title,
        site: doc.site,
        siteTitle: doc.siteTitle,
        kind: doc.kind,
        snippet: snippet(doc.text, words),
        score: Math.round(s * 10) / 10,
      })),
    };
  }

  /** Short completions for the address bar / search box. */
  async suggest(query, limit = 8) {
    let { results } = await this.search(query, { limit });
    return [...new Set(results.map(r => r.title))];
  }
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length > 0)
    .slice(0, 12);
}

function score(docs, words, requireAll) {
  let out = [];
  for (let doc of docs) {
    let total = 0;
    let matched = 0;
    for (let w of words) {
      let s = 0;
      if (doc.site.includes(w)) {
        s += doc.kind === "site" ? 14 : 4;
      }
      if (doc._url.includes(w)) {
        s += 1;
      }
      let t = doc._title.indexOf(w);
      if (t !== -1) {
        s += 6 + (t === 0 || /[^\p{L}\p{N}]/u.test(doc._title[t - 1]) ? 3 : 0);
        if (doc._title === w) {
          s += 6;
        }
      }
      let count = countOf(doc._text, w, 6);
      if (count) {
        s += 1 + count * 0.5;
      }
      if (s > 0) {
        matched++;
      }
      total += s;
    }
    if (requireAll ? matched === words.length : matched > 0) {
      if (doc.kind === "site") {
        total *= 1.2;
      }
      out.push({ doc, score: total });
    }
  }
  return out;
}

function countOf(haystack, needle, max) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1 && n < max) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

function snippet(text, words) {
  let flat = String(text).replace(/\s+/g, " ").trim();
  let lower = flat.toLowerCase();
  let at = -1;
  for (let w of words) {
    at = lower.indexOf(w);
    if (at !== -1) {
      break;
    }
  }
  if (at === -1) {
    return flat.slice(0, 180);
  }
  let start = Math.max(0, at - 60);
  return (start > 0 ? "…" : "") + flat.slice(start, start + 180) + (flat.length > start + 180 ? "…" : "");
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
