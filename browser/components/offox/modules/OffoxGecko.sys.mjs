/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Gecko implementations of the adapters the portable Offox modules use
// (the Node versions live in dev/node-adapters.mjs): disk access through
// IOUtils, bundled files through resource://offox/, and FFmpeg through
// Subprocess.

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";
import { MediaConverter } from "resource://offox/modules/OffoxMedia.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
});

const IS_WINDOWS = AppConstants.platform == "win";

function entryType(info) {
  if (info.type == "directory") {
    return "directory";
  }
  return info.type == "regular" ? "file" : "other";
}

export const GeckoFS = {
  join: (...parts) => PathUtils.join(...parts),

  async stat(path) {
    try {
      let info = await IOUtils.stat(path);
      return {
        type: entryType(info),
        size: info.size,
        lastModified: info.lastModified,
      };
    } catch (e) {
      return null;
    }
  },

  async list(dir) {
    let out = [];
    for (let child of await IOUtils.getChildren(dir)) {
      let info = await GeckoFS.stat(child);
      if (info) {
        out.push({ name: PathUtils.filename(child), ...info });
      }
    }
    return out;
  },

  async read(path, { offset = 0, length } = {}) {
    if (length === 0) {
      return new Uint8Array(0);
    }
    let options = { offset };
    if (length !== undefined) {
      options.maxBytes = length;
    }
    return IOUtils.read(path, options);
  },

  readText: path => IOUtils.readUTF8(path),

  async write(path, bytes, { append = false } = {}) {
    await IOUtils.write(path, bytes, { mode: append ? "appendOrCreate" : "overwrite" });
  },

  async mkdir(path) {
    await IOUtils.makeDirectory(path, {
      createAncestors: true,
      ignoreExisting: true,
    });
  },

  async remove(path, { recursive = false } = {}) {
    await IOUtils.remove(path, { recursive, ignoreAbsent: true });
  },

  move: (from, to) => IOUtils.move(from, to),
};

/** Reads files bundled with the browser under resource://offox/. */
export const GeckoAssets = {
  read(relPath) {
    if (relPath.split("/").includes("..")) {
      return Promise.reject(new Error("bad asset path"));
    }
    return new Promise((resolve, reject) => {
      lazy.NetUtil.asyncFetch(
        {
          uri: `resource://offox/${relPath}`,
          loadUsingSystemPrincipal: true,
        },
        (stream, status) => {
          if (!Components.isSuccessCode(status)) {
            reject(new Error(`Missing asset ${relPath}`));
            return;
          }
          try {
            resolve(
              new Uint8Array(
                lazy.NetUtil.readInputStream(stream, stream.available())
              )
            );
          } catch (e) {
            reject(e);
          } finally {
            stream.close();
          }
        }
      );
    });
  },
};

/** The folder Offox is installed in (where the offox / offox.exe binary is). */
export function appDir() {
  return Services.dirsvc.get("GreBinD", Ci.nsIFile).path;
}

/**
 * Finds an FFmpeg executable: the one chosen in settings, one shipped next
 * to the browser (installers can bundle it), or one on the PATH.
 */
export async function findFFmpeg() {
  let exe = IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg";
  let chosen = Services.prefs.getStringPref("offox.ffmpeg.path", "");
  let candidates = [
    chosen,
    PathUtils.join(appDir(), "ffmpeg", exe),
    PathUtils.join(appDir(), exe),
  ].filter(Boolean);
  for (let path of candidates) {
    if (await IOUtils.exists(path)) {
      return path;
    }
  }
  if (!IS_WINDOWS) {
    for (let dir of ["/usr/bin", "/usr/local/bin", "/var/lib/flatpak/exports/bin"]) {
      let path = PathUtils.join(dir, exe);
      if (await IOUtils.exists(path)) {
        return path;
      }
    }
  }
  try {
    return await lazy.Subprocess.pathSearch(exe);
  } catch (e) {
    return null;
  }
}

async function readAll(pipe) {
  let text = "";
  let chunk;
  while ((chunk = await pipe.readString())) {
    text += chunk;
  }
  return text;
}

export function geckoMedia() {
  return new MediaConverter({
    separator: IS_WINDOWS ? "\\" : "/",
    findFFmpeg,
    async run(command, args) {
      let proc = await lazy.Subprocess.call({
        command,
        arguments: args,
        stderr: "pipe",
      });
      proc.stdin.close();
      let [stdout, stderr] = await Promise.all([
        readAll(proc.stdout),
        readAll(proc.stderr),
      ]);
      let { exitCode } = await proc.wait();
      return { code: exitCode, stdout, stderr };
    },
    async stream(command, args, onStderr) {
      let proc = await lazy.Subprocess.call({
        command,
        arguments: args,
        stderr: "pipe",
      });
      proc.stdin.close();
      let drain = readAll(proc.stdout);
      let chunk;
      while ((chunk = await proc.stderr.readString())) {
        onStderr(chunk);
      }
      await drain;
      let { exitCode } = await proc.wait();
      return exitCode;
    },
  });
}
