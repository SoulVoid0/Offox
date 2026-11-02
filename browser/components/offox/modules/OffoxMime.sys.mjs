/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// MIME types used when serving files out of an Offox site folder.
// Portable: imported by the browser (Gecko) and by the Node preview server.

const TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  xhtml: "application/xhtml+xml; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  jxl: "image/jxl",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  pdf: "application/pdf",
  epub: "application/epub+zip",
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  xz: "application/x-xz",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  tar: "application/x-tar",
  exe: "application/vnd.microsoft.portable-executable",
  msi: "application/x-msi",
  rpm: "application/x-rpm",
  deb: "application/vnd.debian.binary-package",
  appimage: "application/vnd.appimage",
  flatpak: "application/vnd.flatpak",
  iso: "application/x-iso9660-image",
  apk: "application/vnd.android.package-archive",
  dmg: "application/x-apple-diskimage",
  // Video (Firefox plays mp4/m4v/mov(h264,hevc,av1), webm, mkv, ogv natively)
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  ts: "video/mp2t",
  m2ts: "video/mp2t",
  mts: "video/mp2t",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  vob: "video/mpeg",
  "3gp": "video/3gpp",
  // Audio
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  wav: "audio/wav",
  weba: "audio/webm",
  wma: "audio/x-ms-wma",
};

export const VIDEO_EXTENSIONS = [
  "mp4", "m4v", "mov", "webm", "mkv", "ogv", "avi", "wmv", "flv",
  "ts", "m2ts", "mts", "mpg", "mpeg", "vob", "3gp",
];

export const AUDIO_EXTENSIONS = [
  "mp3", "m4a", "aac", "ogg", "oga", "opus", "flac", "wav", "weba", "wma",
];

// Containers that Firefox can demux itself. Anything else needs converting.
export const NATIVE_MEDIA_EXTENSIONS = [
  "mp4", "m4v", "mov", "webm", "mkv", "ogv", "3gp",
  "mp3", "m4a", "aac", "ogg", "oga", "opus", "flac", "wav", "weba",
];

export function extensionOf(name) {
  let base = String(name).split("/").pop();
  let dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function mimeTypeFor(name) {
  return TYPES[extensionOf(name)] || "application/octet-stream";
}

export function isMediaFile(name) {
  let ext = extensionOf(name);
  return VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext);
}

export function isTextFile(name) {
  return /^(text\/|application\/(json|xml|xhtml|javascript|manifest))/.test(
    mimeTypeFor(name)
  );
}
