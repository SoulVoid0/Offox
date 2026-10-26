/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Small helpers shared by every Offox module. Portable (Gecko + Node).

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

export const FIRELINE_HOST = "fireline.offox";
export const RESERVED_HOSTS = [FIRELINE_HOST, "fireline", "offox", "offox.offox"];
export const SITE_MANIFEST = "offox-site.json";
export const ROOT_MANIFEST = "offox-storage.json";

export function utf8Encode(text) {
  return encoder.encode(String(text));
}

export function utf8Decode(bytes) {
  return decoder.decode(bytes);
}

/**
 * Normalises whatever the user typed as a site address into a bare
 * lowercase host name. "https://YouTube.com/watch" -> "youtube.com".
 * Returns null when the input can not be used as a host name.
 */
export function normalizeDomain(input) {
  let text = String(input || "").trim().toLowerCase();
  if (!text) {
    return null;
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  text = text.replace(/[/?#].*$/, "");
  text = text.replace(/:\d+$/, "");
  text = text.replace(/^\.+|\.+$/g, "");
  if (!text || text.length > 253) {
    return null;
  }
  let labels = text.split(".");
  for (let label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
      return null;
    }
  }
  return text;
}

/** Turns a title into a safe folder name: "My Wiki!" -> "My Wiki". */
export function safeFolderName(name) {
  let cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) {
    cleaned = "_" + cleaned;
  }
  return cleaned.slice(0, 80) || "site";
}

/**
 * Splits a URL path ("/videos/abc/video.mp4") into decoded, validated
 * segments. Throws on anything that could escape the site folder.
 */
export function pathSegments(urlPath) {
  let segments = [];
  for (let raw of String(urlPath || "").split("/")) {
    if (raw === "") {
      continue;
    }
    let segment;
    try {
      segment = decodeURIComponent(raw);
    } catch (e) {
      throw new OffoxError(400, "Bad path encoding");
    }
    if (
      segment === "." ||
      segment === ".." ||
      /[\\/:*?"<>|\u0000-\u001f]/.test(segment) ||
      segment.length > 255
    ) {
      throw new OffoxError(400, "Invalid path segment");
    }
    segments.push(segment);
  }
  return segments;
}

export class OffoxError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** YouTube-style 11 character id. */
export function randomId(length = 11) {
  let bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let b of bytes) {
    out += ID_ALPHABET[b & 63];
  }
  return out;
}

export function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/** Uint8Array -> "binary" string (one char per byte) for nsIReplacedHttpResponse. */
export function bytesToBinaryString(bytes) {
  let chunks = [];
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + STEP)));
  }
  return chunks.join("");
}

export function concatBytes(parts) {
  let total = parts.reduce((n, p) => n + p.length, 0);
  let out = new Uint8Array(total);
  let offset = 0;
  for (let p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Parses "bytes=start-end" against a file size. Returns null if absent/invalid. */
export function parseRange(header, size) {
  let m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) {
    return null;
  }
  let start;
  let end;
  if (m[1] === "") {
    let suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return { unsatisfiable: true };
  }
  return { start, end };
}
