/* Offox Markdown renderer (copied into websites as assets/md.js).
 * Supports headings, paragraphs, **bold**, *italic*, ~~strike~~, `code`,
 * fenced code blocks, > quotes, lists, tables, images, links, --- rules and
 * [[Wiki links]] / [[Wiki links|with text]]. Raw HTML is escaped. */
"use strict";

const Markdown = (() => {
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function safeUrl(url) {
    url = String(url).trim();
    return /^(javascript|data|vbscript):/i.test(url) && !/^data:image\//i.test(url) ? "#" : url;
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  }

  function inline(text, opts) {
    let codes = [];
    text = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    text = esc(text);
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
      (_, alt, src, title) => `<img src="${esc(safeUrl(src))}" alt="${alt}"${title ? ` title="${title}"` : ""} loading="lazy">`);
    text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
      target = target.trim();
      let href = opts.wikiLink ? opts.wikiLink(target) : "#";
      let missing = opts.exists && !opts.exists(target);
      return `<a href="${esc(href)}" class="wikilink${missing ? " new" : ""}"${missing ? ` title="${esc(target)} (page does not exist)"` : ""}>${label || target}</a>`;
    });
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${esc(safeUrl(href))}">${label}</a>`);
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => `${pre}<a href="${url}">${url}</a>`);
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/(^|[\s(])_([^_\s][^_]*)_/g, "$1<em>$2</em>");
    text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
    return text;
  }

  function render(src, opts = {}) {
    let lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    let out = [];
    let headings = [];
    let i = 0;
    let para = [];
    let flush = () => {
      if (para.length) {
        out.push(`<p>${inline(para.join(" "), opts)}</p>`);
        para = [];
      }
    };
    while (i < lines.length) {
      let line = lines[i];
      let fence = /^```\s*([\w-]*)/.exec(line);
      if (fence) {
        flush();
        let code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push(`<pre><code${fence[1] ? ` class="language-${esc(fence[1])}"` : ""}>${esc(code.join("\n"))}</code></pre>`);
        continue;
      }
      let hd = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
      if (hd) {
        flush();
        let level = hd[1].length;
        let html = inline(hd[2], opts);
        let id = slug(hd[2]);
        headings.push({ level, id, text: hd[2] });
        out.push(`<h${level} id="${id}">${html}</h${level}>`);
        i++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush();
        out.push("<hr>");
        i++;
        continue;
      }
      if (/^>\s?/.test(line)) {
        flush();
        let quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
        out.push(`<blockquote>${render(quote.join("\n"), opts).html}</blockquote>`);
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        flush();
        let cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        let head = cells(line);
        let align = cells(lines[i + 1]).map(c => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : ""));
        i += 2;
        let rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        let td = (tag, c, j) => `<${tag}${align[j] ? ` style="text-align:${align[j]}"` : ""}>${inline(c, opts)}</${tag}>`;
        out.push(`<table><thead><tr>${head.map((c, j) => td("th", c, j)).join("")}</tr></thead><tbody>${rows
          .map(r => `<tr>${r.map((c, j) => td("td", c, j)).join("")}</tr>`).join("")}</tbody></table>`);
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        let items = [];
        while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          let m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
          else items[items.length - 1].text += " " + lines[i].trim();
          i++;
        }
        out.push(renderList(items, 0, opts).html);
        continue;
      }
      if (!line.trim()) {
        flush();
        i++;
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flush();
    return { html: out.join("\n"), headings };
  }

  function renderList(items, start, opts) {
    let indent = items[start].indent;
    let tag = items[start].ordered ? "ol" : "ul";
    let html = `<${tag}>`;
    let i = start;
    while (i < items.length && items[i].indent >= indent) {
      if (items[i].indent > indent) {
        let nested = renderList(items, i, opts);
        html = html.replace(/<\/li>$/, nested.html + "</li>");
        i = nested.next;
        continue;
      }
      let text = items[i].text;
      let task = /^\[( |x)\]\s+/i.exec(text);
      if (task) {
        text = text.slice(task[0].length);
      }
      html += `<li>${task ? `<input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}> ` : ""}${inline(text, opts)}</li>`;
      i++;
    }
    return { html: html + `</${tag}>`, next: i };
  }

  /** Splits "---\nkey: value\n---\nbody" front matter. */
  function frontMatter(src) {
    let m = /^---\n([\s\S]*?)\n---\n?/.exec(String(src || "").replace(/\r\n?/g, "\n"));
    if (!m) return { data: {}, body: String(src || "") };
    let data = {};
    for (let line of m[1].split("\n")) {
      let kv = /^([\w-]+):\s*(.*)$/.exec(line);
      if (kv) data[kv[1]] = kv[2].trim();
    }
    return { data, body: String(src).replace(/\r\n?/g, "\n").slice(m[0].length) };
  }

  function stringifyFrontMatter(data, body) {
    let head = Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${String(v).replace(/\n/g, " ")}`)
      .join("\n");
    return `---\n${head}\n---\n${body}`;
  }

  return { render, esc, slug, frontMatter, stringifyFrontMatter };
})();
