/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Makes videos that Firefox can not play (AVI, WMV, FLV, MPEG-TS, old DivX,
// MPEG-2 ...) playable by remuxing or transcoding them with an *external*
// FFmpeg executable. Offox never links FFmpeg's encoders into the browser;
// it starts the user's (or a bundled LGPL) ffmpeg as a separate process.
//
// Portable: the caller supplies two process helpers:
//   run(args)                 -> Promise<{ code, stdout, stderr }>
//   stream(args, onStderr)    -> Promise<code>

// Codecs Firefox decodes on Linux and Windows (via its bundled FFmpeg/ffvpx,
// system FFmpeg or Windows Media Foundation).
const PLAYABLE_VIDEO = new Set(["h264", "hevc", "av1", "vp8", "vp9", "theora"]);
const MP4_VIDEO = new Set(["h264", "hevc", "av1"]);
const WEBM_VIDEO = new Set(["vp8", "vp9", "av1"]);
const MP4_AUDIO = new Set(["aac", "mp3", "opus", "flac"]);
const WEBM_AUDIO = new Set(["opus", "vorbis"]);

// Preferred encoders, all available in LGPL builds of FFmpeg except libx264.
const VIDEO_ENCODERS = [
  { name: "libvpx-vp9", container: "webm", args: ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1"] },
  { name: "libsvtav1", container: "webm", args: ["-c:v", "libsvtav1", "-crf", "35", "-preset", "10"] },
  { name: "libaom-av1", container: "webm", args: ["-c:v", "libaom-av1", "-crf", "35", "-cpu-used", "8", "-row-mt", "1"] },
  { name: "libopenh264", container: "mp4", args: ["-c:v", "libopenh264", "-b:v", "4M"] },
  { name: "libx264", container: "mp4", args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"] },
  { name: "libvpx", container: "webm", args: ["-c:v", "libvpx", "-b:v", "3M", "-deadline", "realtime", "-cpu-used", "8"] },
];

export function parseProbe(stderr) {
  let duration = parseDuration((/Duration:\s*([\d:.]+)/.exec(stderr) || [])[1]);
  let video = (/Stream #[^\n]*?Video:\s*([a-z0-9_]+)/i.exec(stderr) || [])[1] || null;
  let audio = (/Stream #[^\n]*?Audio:\s*([a-z0-9_]+)/i.exec(stderr) || [])[1] || null;
  return {
    duration,
    video: video && video.toLowerCase(),
    audio: audio && audio.toLowerCase(),
  };
}

export function parseEncoders(stdout) {
  let set = new Set();
  for (let line of stdout.split("\n")) {
    let m = /^\s*[VAS][F.][S.][X.][B.][D.]\s+(\S+)/.exec(line);
    if (m) {
      set.add(m[1]);
    }
  }
  return set;
}

function parseDuration(text) {
  if (!text) {
    return 0;
  }
  let [h, m, s] = text.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

export function parseProgress(chunk, duration) {
  let d = /Duration:\s*([\d:.]+)/.exec(chunk);
  if (d) {
    duration = parseDuration(d[1]);
  }
  let times = [...chunk.matchAll(/time=\s*([\d:.]+)/g)];
  let progress = null;
  if (times.length && duration > 0) {
    progress = Math.min(0.99, parseDuration(times.at(-1)[1]) / duration);
  }
  return { duration, progress };
}

/**
 * Decides how to make a file playable.
 * @returns {{action, container, args, output}} or throws if impossible
 */
export function planConversion(input, probe, encoders, { output, separator = "/" } = {}) {
  let v = probe.video;
  let a = probe.audio;
  let videoArgs;
  let audioArgs;
  let container;
  let action = "remux";

  if (!v) {
    // Audio only
    container = a && MP4_AUDIO.has(a) ? "m4a" : "ogg";
    videoArgs = ["-vn"];
    audioArgs = a && MP4_AUDIO.has(a) ? ["-c:a", "copy"] : ["-c:a", "libopus", "-b:a", "128k"];
    if (container === "ogg" && !encoders.has("libopus")) {
      container = "ogg";
      audioArgs = ["-c:a", "libvorbis", "-q:a", "5"];
    }
  } else if (MP4_VIDEO.has(v) && (!a || MP4_AUDIO.has(a) || encoders.has("aac"))) {
    container = "mp4";
    videoArgs = ["-c:v", "copy"];
    audioArgs = !a ? ["-an"] : MP4_AUDIO.has(a) ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k"];
    if (a && !MP4_AUDIO.has(a)) {
      action = "transcode-audio";
    }
  } else if (WEBM_VIDEO.has(v)) {
    container = "webm";
    videoArgs = ["-c:v", "copy"];
    audioArgs = !a ? ["-an"] : WEBM_AUDIO.has(a) ? ["-c:a", "copy"] : ["-c:a", "libopus", "-b:a", "128k"];
    if (a && !WEBM_AUDIO.has(a)) {
      action = "transcode-audio";
    }
  } else {
    let encoder = VIDEO_ENCODERS.find(e => encoders.has(e.name));
    if (!encoder) {
      throw new Error(
        "Your ffmpeg has no usable video encoder (libvpx-vp9, libsvtav1, libaom-av1, libopenh264 or libx264)."
      );
    }
    action = "transcode";
    container = encoder.container;
    videoArgs = [...encoder.args, "-pix_fmt", "yuv420p"];
    if (!a) {
      audioArgs = ["-an"];
    } else if (container === "webm") {
      audioArgs = WEBM_AUDIO.has(a) ? ["-c:a", "copy"] : ["-c:a", "libopus", "-b:a", "128k"];
    } else {
      audioArgs = MP4_AUDIO.has(a) ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k"];
    }
  }

  if (!output) {
    let slash = Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\"));
    let dir = input.slice(0, slash);
    let base = input.slice(slash + 1).replace(/\.[^.]+$/, "");
    output = `${dir}${separator}${base}.offox.${container}`;
  } else {
    output = output.replace(/\.[^.\\/]+$/, "") + "." + container;
  }
  let args = [
    "-hide_banner", "-nostdin", "-y",
    "-i", input,
    "-map", "0:v:0?", "-map", "0:a:0?",
    ...videoArgs,
    ...audioArgs,
  ];
  if (container === "mp4" || container === "m4a") {
    args.push("-movflags", "+faststart");
  }
  args.push(output);
  return { action, container, args, output };
}

export function isPlayable(probe) {
  return (
    (!probe.video || PLAYABLE_VIDEO.has(probe.video)) &&
    (!probe.audio || MP4_AUDIO.has(probe.audio) || WEBM_AUDIO.has(probe.audio))
  );
}

export class MediaConverter {
  /**
   * @param {object} options
   * @param {Function} options.findFFmpeg  async () => path or null
   * @param {Function} options.run         async (exe, args) => {code, stdout, stderr}
   * @param {Function} options.stream      async (exe, args, onStderr) => code
   * @param {string}   [options.separator] path separator
   */
  constructor({ findFFmpeg, run, stream, separator = "/" }) {
    this.findFFmpeg = findFFmpeg;
    this.run = run;
    this.stream = stream;
    this.separator = separator;
    this.jobs = new Map();
    this._encoders = null;
    this._encodersFor = null;
  }

  async info() {
    let exe = await this.findFFmpeg();
    return { ffmpeg: !!exe, path: exe || null };
  }

  async _encoderSet(exe) {
    if (this._encodersFor !== exe) {
      let r = await this.run(exe, ["-hide_banner", "-encoders"]);
      this._encoders = parseEncoders(r.stdout || "");
      this._encodersFor = exe;
    }
    return this._encoders;
  }

  async probe(input) {
    let exe = await this.findFFmpeg();
    if (!exe) {
      throw new Error("ffmpeg was not found");
    }
    let r = await this.run(exe, ["-hide_banner", "-i", input]);
    return parseProbe(r.stderr || "");
  }

  async job(id) {
    let job = this.jobs.get(id);
    return job ? { ...job } : { id, state: "unknown" };
  }

  /** Starts a conversion; returns immediately with a job id. */
  async convert(input, { output } = {}) {
    let exe = await this.findFFmpeg();
    if (!exe) {
      return {
        state: "failed",
        error: "FFmpeg was not found. Install it or choose it in Offox settings to convert this video.",
      };
    }
    let id = Math.random().toString(36).slice(2, 10);
    let job = { id, state: "probing", progress: 0, input };
    this.jobs.set(id, job);
    (async () => {
      try {
        let probe = await this.probe(input);
        let plan = planConversion(input, probe, await this._encoderSet(exe), {
          output,
          separator: this.separator,
        });
        Object.assign(job, {
          state: "running",
          action: plan.action,
          probe,
          output: plan.output,
          outputName: plan.output.split(/[\\/]/).pop(),
        });
        let duration = probe.duration;
        let code = await this.stream(exe, plan.args, chunk => {
          let r = parseProgress(chunk, duration);
          duration = r.duration || duration;
          if (r.progress !== null) {
            job.progress = r.progress;
          }
        });
        if (code !== 0) {
          throw new Error(`ffmpeg exited with code ${code}`);
        }
        job.state = "done";
        job.progress = 1;
      } catch (e) {
        job.state = "failed";
        job.error = String(e.message || e);
      }
    })();
    return { id, state: job.state };
  }
}
