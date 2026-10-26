/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Offox site API, served to every Offox website at /__offox/offox.js.
// Lets a site's own pages read and change the files in the site's folder.
// Paths are relative to the site folder, e.g. "videos/abc123/title.txt".
//
//   <script src="/__offox/offox.js"></script>
//   await Offox.writeText("notes/hello.txt", "Hi!");

(function () {
  "use strict";

  const API = "/__offox/api/";

  function encodePath(path) {
    return String(path)
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
  }

  async function call(route, params = {}, init = {}) {
    let query = new URLSearchParams(params).toString();
    let res = await fetch(API + route + (query ? "?" + query : ""), {
      cache: "no-store",
      ...init,
    });
    let data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `${route} failed (${res.status})`);
    }
    return data;
  }

  const Offox = {
    /** URL of a file in this site, safe to put in src/href. */
    url(path) {
      return "/" + encodePath(path);
    },

    info: () => call("info"),
    sites: () => call("sites"),
    search: q => call("search", { q }),
    stat: path => call("stat", { path }),
    list: (path = "") => call("list", { path }),

    /** Reads small files from every sub folder of `path` in one request. */
    collect: (path, files) => call("collect", { path, files: files.join(",") }),

    async exists(path) {
      return (await Offox.stat(path)).exists;
    },

    async readText(path, fallback = null) {
      let res = await fetch(Offox.url(path), { cache: "no-store" });
      if (!res.ok) {
        if (fallback !== null) {
          return fallback;
        }
        throw new Error(`Could not read ${path} (${res.status})`);
      }
      return res.text();
    },

    async readJSON(path, fallback) {
      let text = await Offox.readText(path, "");
      if (!text) {
        if (fallback !== undefined) {
          return fallback;
        }
        throw new Error(`${path} not found`);
      }
      return JSON.parse(text);
    },

    write(path, data, { offset } = {}) {
      let params = { path };
      if (offset !== undefined) {
        params.offset = offset;
      }
      return call("write", params, { method: "PUT", body: data });
    },

    writeText: (path, text) => Offox.write(path, new Blob([text], { type: "text/plain" })),
    writeJSON: (path, value) =>
      Offox.write(path, new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })),

    /**
     * Copies a File/Blob into the site folder in chunks, reporting progress
     * as a number between 0 and 1.
     */
    async upload(path, blob, { onProgress, chunkSize = 8 * 1024 * 1024 } = {}) {
      let offset = 0;
      if (blob.size === 0) {
        await Offox.write(path, blob);
      }
      while (offset < blob.size) {
        let chunk = blob.slice(offset, offset + chunkSize);
        await Offox.write(path, chunk, { offset });
        offset += chunk.size;
        onProgress?.(offset / blob.size);
      }
      return { path, size: blob.size };
    },

    mkdir: path => call("mkdir", { path }, { method: "POST" }),
    remove: path => call("delete", { path }, { method: "POST" }),
    move: (from, to) => call("move", { from, to }, { method: "POST" }),

    /** Random YouTube-style id. */
    id(length = 11) {
      let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      let bytes = crypto.getRandomValues(new Uint8Array(length));
      return Array.from(bytes, b => alphabet[b & 63]).join("");
    },

    media: {
      info: () => call("media/info"),
      convert: (path, { output } = {}) =>
        call("media/convert", output ? { path, output } : { path }, { method: "POST" }),
      job: id => call("media/job", { id }),
      /** Converts and waits; resolves with the finished job. */
      async convertAndWait(path, { output, onProgress } = {}) {
        let job = await Offox.media.convert(path, { output });
        if (job.state === "failed") {
          throw new Error(job.error);
        }
        for (;;) {
          await new Promise(r => setTimeout(r, 700));
          job = await Offox.media.job(job.id);
          onProgress?.(job.progress || 0, job);
          if (job.state === "done") {
            return job;
          }
          if (job.state === "failed" || job.state === "unknown") {
            throw new Error(job.error || "Conversion failed");
          }
        }
      },
    },
  };

  window.Offox = Offox;
})();
