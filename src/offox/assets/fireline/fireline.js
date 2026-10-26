/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

function el(tag, attrs = {}, ...children) {
  let node = document.createElement(tag);
  for (let [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (let c of children) {
    node.append(c instanceof Node ? c : document.createTextNode(String(c ?? "")));
  }
  return node;
}

function highlight(text, words) {
  let frag = document.createDocumentFragment();
  if (!words.length) {
    frag.append(text);
    return frag;
  }
  let re = new RegExp("(" + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
  let last = 0;
  for (let m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index), el("mark", {}, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

const KIND_LABEL = { site: "Website", video: "Video", article: "Article", app: "Software", post: "Post", album: "Photos", track: "Music", book: "Book", page: "" };

async function renderHome() {
  let list = document.getElementById("sites");
  let sites = await (await fetch("/api/sites")).json();
  if (!sites.length) {
    list.replaceWith(el("p", { class: "empty" },
      "You have no websites yet. Open Offox settings (the Offox Sites button or about:offox), choose a storage folder, and Offox will create a few websites for you."));
    return;
  }
  for (let s of sites) {
    list.append(el("a", { class: "site", href: s.url },
      el("b", {}, s.title), el("small", {}, s.domain), el("p", {}, s.description || "")));
  }
}

async function renderResults() {
  let q = new URLSearchParams(location.search).get("q") || "";
  document.querySelector("input[name=q]").value = q;
  document.title = q ? `${q} – FireLine` : "FireLine";
  let main = document.getElementById("results");
  if (!q.trim()) {
    main.append(el("p", { class: "count" }, "Type something to search all of your websites."));
    return;
  }
  let data = await (await fetch("/api/search?q=" + encodeURIComponent(q))).json();
  let words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  main.append(el("p", { class: "count" },
    data.total ? `${data.total} result${data.total === 1 ? "" : "s"} on your offline websites` : ""));
  if (!data.total) {
    main.append(el("div", { class: "result" },
      el("h3", {}, `No results for “${q}”`),
      el("p", {}, "Check the spelling, try fewer words, or browse all websites on the "),
      el("a", { href: "/" }, "FireLine home page")));
    return;
  }
  for (let r of data.results) {
    let label = KIND_LABEL[r.kind] ?? r.kind;
    let where = el("div", { class: "where" }, `${r.siteTitle} · ${r.url.replace(/^https:\/\//, "")}`);
    if (label) where.append(el("span", { class: "kind" }, label));
    main.append(el("div", { class: "result" },
      where,
      el("h3", {}, el("a", { href: r.url }, highlight(r.title, words))),
      el("p", {}, highlight(r.snippet, words))));
  }
}

if (document.getElementById("sites")) renderHome();
if (document.getElementById("results")) renderResults();
