/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Node.js implementations of the adapters the portable Offox modules use.
// The browser uses IOUtils-based versions (browser/components/offox/modules/OffoxGecko.sys.mjs).

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MediaConverter, sortModels } from "../../browser/components/offox/modules/OffoxMedia.sys.mjs";

export const OFFOX_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../browser/components/offox"
);

function toEntryType(stat) {
  return stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
}

export const NodeFS = {
  join: (...parts) => path.join(...parts),
  async stat(p) {
    try {
      let s = await fsp.stat(p);
      return { type: toEntryType(s), size: s.size, lastModified: s.mtimeMs };
    } catch (e) {
      return null;
    }
  },
  async list(dir) {
    let out = [];
    for (let name of await fsp.readdir(dir)) {
      let s = await NodeFS.stat(path.join(dir, name));
      if (s) {
        out.push({ name, ...s });
      }
    }
    return out;
  },
  async read(p, { offset = 0, length } = {}) {
    let handle = await fsp.open(p, "r");
    try {
      let size = (await handle.stat()).size;
      let n = Math.max(0, Math.min(length ?? size - offset, size - offset));
      let buf = Buffer.alloc(n);
      await handle.read(buf, 0, n, offset);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    } finally {
      await handle.close();
    }
  },
  async readText(p) {
    return fsp.readFile(p, "utf8");
  },
  async write(p, bytes, { append = false } = {}) {
    await (append ? fsp.appendFile(p, bytes) : fsp.writeFile(p, bytes));
  },
  async mkdir(p) {
    await fsp.mkdir(p, { recursive: true });
  },
  async remove(p, { recursive = false } = {}) {
    await fsp.rm(p, { recursive, force: true });
  },
  async move(from, to) {
    await fsp.rename(from, to);
  },
};

export function nodeAssets(baseDir = OFFOX_DIR) {
  return {
    async read(rel) {
      let full = path.join(baseDir, ...rel.split("/"));
      if (!full.startsWith(baseDir)) {
        throw new Error("bad asset path");
      }
      return new Uint8Array(await fsp.readFile(full));
    },
  };
}

function onPath(name) {
  for (let dir of (process.env.PATH || "").split(path.delimiter)) {
    for (let ext of process.platform === "win32" ? [".exe", ""] : [""]) {
      let p = path.join(dir, name + ext);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        if (fs.statSync(p).isFile()) {
          return p;
        }
      } catch (e) {}
    }
  }
  return null;
}

/**
 * whisper.cpp for automatic subtitles: OFFOX_WHISPER / OFFOX_WHISPER_MODEL,
 * or whisper-cli on the PATH and ggml-*.bin models in OFFOX_WHISPER_MODELS
 * or ~/.local/share/whisper.cpp/models.
 */
export function nodeWhisperFinder(options = {}) {
  return async () => {
    let program = options.program || process.env.OFFOX_WHISPER || onPath("whisper-cli");
    let programs = program && fs.existsSync(program) ? [program] : [];
    let dirs = [
      process.env.OFFOX_WHISPER_MODELS,
      path.join(os.homedir(), ".local", "share", "whisper.cpp", "models"),
    ].filter(Boolean);
    let models = [];
    for (let dir of dirs) {
      try {
        for (let name of fs.readdirSync(dir)) {
          if (/^ggml-.*\.bin$/i.test(name)) {
            models.push(path.join(dir, name));
          }
        }
      } catch (e) {}
    }
    models = sortModels(models);
    let chosen = options.model || process.env.OFFOX_WHISPER_MODEL;
    let model = chosen && fs.existsSync(chosen) ? chosen : models[0] || null;
    if (model && !models.includes(model)) {
      models.unshift(model);
    }
    return { programs, model, models };
  };
}

/** Video conversion through an ffmpeg executable, if one is installed. */
export function nodeMedia(ffmpegPath = process.env.OFFOX_FFMPEG || "ffmpeg", whisper = {}) {
  let available = spawnSync(ffmpegPath, ["-version"]).status === 0;
  return new MediaConverter({
    separator: path.sep,
    fs: NodeFS,
    threads: Math.max(1, Math.min(8, os.cpus().length - 1)),
    findFFmpeg: async () => (available ? ffmpegPath : null),
    findWhisper: nodeWhisperFinder(whisper),
    run: (exe, args) =>
      new Promise(resolve => {
        let r = spawnSync(exe, args, { encoding: "utf8", maxBuffer: 64 << 20 });
        resolve({ code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" });
      }),
    stream: (exe, args, onStderr, { stdout = false, cwd } = {}) =>
      new Promise(resolve => {
        let child = spawn(exe, args, cwd ? { cwd } : {});
        child.stderr.on("data", chunk => onStderr(String(chunk)));
        if (stdout) {
          child.stdout.on("data", chunk => onStderr(String(chunk)));
        } else {
          child.stdout.resume();
        }
        child.on("error", () => resolve(-1));
        child.on("close", code => resolve(code));
      }),
  });
}
