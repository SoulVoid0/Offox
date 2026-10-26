/* Offox site helpers (copied into every new website as assets/util.js).
 * Plain browser JavaScript, no build step. Requires /__offox/offox.js. */
"use strict";

/** document.createElement with attributes, event handlers and children. */
function h(tag, attrs, ...children) {
  let node = document.createElement(tag);
  for (let [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "html") node.innerHTML = v;
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (let c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function param(name) {
  return new URLSearchParams(location.search).get(name);
}

function formatSize(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  let units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + " " + units[i];
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function formatDate(date) {
  let d = new Date(date);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function timeAgo(date) {
  let d = new Date(date);
  if (isNaN(d)) return "";
  let s = (Date.now() - d.getTime()) / 1000;
  let steps = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.345, "week"], [12, "month"], [Infinity, "year"]];
  for (let [n, unit] of steps) {
    if (Math.abs(s) < n) {
      let v = Math.max(1, Math.floor(s));
      return v + " " + unit + (v === 1 ? "" : "s") + " ago";
    }
    s /= n;
  }
  return formatDate(d);
}

function formatDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return "";
  sec = Math.round(sec);
  let hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  let pad = n => String(n).padStart(2, "0");
  return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

function extOf(name) {
  let m = /\.([^.]+)$/.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

const VIDEO_EXT = ["mp4", "m4v", "mov", "webm", "mkv", "ogv", "avi", "wmv", "flv", "ts", "m2ts", "mts", "mpg", "mpeg", "vob", "3gp"];
const AUDIO_EXT = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "flac", "wav", "weba", "wma"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "ico", "jxl"];

function slugify(text) {
  return String(text).trim().replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, "").replace(/\s+/g, "_").slice(0, 120) || "Untitled";
}

/** Small toast message at the bottom of the page. */
function toast(message, ms = 3000) {
  let t = h("div", { class: "offox-toast", role: "status" }, message);
  Object.assign(t.style, {
    position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)",
    background: "#222", color: "#fff", padding: "10px 18px", borderRadius: "8px",
    zIndex: 9999, boxShadow: "0 4px 18px #0005", font: "14px system-ui, sans-serif",
  });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Turns plain text into nodes with clickable links and line breaks. */
function linkify(text) {
  let frag = document.createDocumentFragment();
  let lines = String(text || "").split("\n");
  lines.forEach((line, i) => {
    let last = 0;
    for (let m of line.matchAll(/https?:\/\/[^\s<>"]+/g)) {
      frag.append(line.slice(last, m.index), h("a", { href: m[0] }, m[0]));
      last = m.index + m[0].length;
    }
    frag.append(line.slice(last));
    if (i < lines.length - 1) frag.append(h("br"));
  });
  return frag;
}

/** Grabs a JPEG thumbnail from a video URL. Resolves to a Blob or null. */
function captureThumbnail(src, { at = 0.1, width = 640 } = {}) {
  return new Promise(resolve => {
    let v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = src;
    let done = result => { v.removeAttribute("src"); v.load(); resolve(result); };
    let timer = setTimeout(() => done(null), 15000);
    v.addEventListener("error", () => { clearTimeout(timer); done(null); });
    v.addEventListener("loadedmetadata", () => {
      v.currentTime = Math.min(Math.max(1, v.duration * at), Math.max(0, v.duration - 0.1)) || 0;
    });
    v.addEventListener("seeked", () => {
      clearTimeout(timer);
      let scale = Math.min(1, width / (v.videoWidth || width));
      let c = document.createElement("canvas");
      c.width = Math.round((v.videoWidth || 640) * scale);
      c.height = Math.round((v.videoHeight || 360) * scale);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      c.toBlob(b => done(b ? { blob: b, duration: v.duration } : null), "image/jpeg", 0.82);
    }, { once: true });
  });
}

/** Resolves true if this browser can decode the media file (File/Blob or URL). */
function canPlayMedia(source, kind = "video") {
  return new Promise(resolve => {
    let m = document.createElement(kind);
    m.muted = true;
    m.preload = "metadata";
    let url = typeof source === "string" ? source : URL.createObjectURL(source);
    let finish = ok => {
      clearTimeout(timer);
      m.removeAttribute("src");
      m.load();
      if (typeof source !== "string") URL.revokeObjectURL(url);
      resolve(ok);
    };
    let timer = setTimeout(() => finish(false), 10000);
    m.addEventListener("loadedmetadata", () => finish(kind === "audio" || m.videoWidth > 0 || m.duration > 0), { once: true });
    m.addEventListener("error", () => finish(false), { once: true });
    m.src = url;
  });
}

/** A simple modal dialog built on <dialog>. Resolves with the form data or null. */
function dialogForm(title, fields, { submit = "Save" } = {}) {
  return new Promise(resolve => {
    let form = h("form", { method: "dialog", class: "offox-dialog-form" },
      h("h2", {}, title),
      fields.map(f => h("label", {}, f.label,
        f.type === "textarea"
          ? h("textarea", { name: f.name, rows: f.rows || 6 }, f.value || "")
          : f.type === "select"
            ? h("select", { name: f.name }, f.options.map(o => h("option", { value: o.value, selected: o.value === f.value }, o.label)))
            : h("input", { name: f.name, type: f.type || "text", value: f.value || "", required: f.required }))),
      h("div", { class: "offox-dialog-buttons" },
        h("button", { type: "button", value: "cancel", onclick: () => { dlg.close(); } }, "Cancel"),
        h("button", { type: "submit", value: "ok", class: "primary" }, submit)));
    let dlg = h("dialog", { class: "offox-dialog" }, form);
    form.addEventListener("submit", e => {
      e.preventDefault();
      let data = Object.fromEntries(new FormData(form));
      dlg.close();
      resolve(data);
    });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
