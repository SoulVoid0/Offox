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

// ---------------------------------------------------------------- subtitles

// Subtitle codecs FFmpeg can turn into WebVTT (bitmap subtitles such as
// PGS or DVD subtitles can't become text without OCR).
const TEXT_SUBTITLES = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text", "microdvd", "subviewer", "jacosub", "sami", "realtext", "mpl2", "vplayer", "stl", "pjs"]);

// ISO 639-2 (what containers store) to the two letter codes used for
// <track srclang>. Anything not listed is kept as it is.
const ISO639_2 = {
  ara: "ar", bul: "bg", cat: "ca", ces: "cs", cze: "cs", chi: "zh", zho: "zh",
  dan: "da", deu: "de", ger: "de", ell: "el", gre: "el", eng: "en", spa: "es",
  est: "et", fas: "fa", per: "fa", fin: "fi", fra: "fr", fre: "fr", heb: "he",
  hin: "hi", hrv: "hr", hun: "hu", ind: "id", ita: "it", jpn: "ja", kor: "ko",
  lit: "lt", lav: "lv", msa: "ms", may: "ms", nld: "nl", dut: "nl", nor: "no",
  nob: "nb", nno: "nn", pol: "pl", por: "pt", ron: "ro", rum: "ro", rus: "ru",
  slk: "sk", slo: "sk", slv: "sl", srp: "sr", swe: "sv", tha: "th", tur: "tr",
  ukr: "uk", urd: "ur", vie: "vi", ben: "bn", tam: "ta", tel: "te", fil: "fil",
  tgl: "tl", isl: "is", ice: "is", gle: "ga", cym: "cy", wel: "cy", eus: "eu",
  baq: "eu", glg: "gl", afr: "af", swa: "sw", mal: "ml", mar: "mr", kan: "kn",
  guj: "gu", pan: "pa", nep: "ne", sin: "si", khm: "km", lao: "lo", mya: "my",
  bur: "my", kat: "ka", geo: "ka", hye: "hy", arm: "hy", aze: "az", kaz: "kk",
  uzb: "uz", mon: "mn", alb: "sq", sqi: "sq", mac: "mk", mkd: "mk", bos: "bs",
  bel: "be", lat: "la", epo: "eo",
};

export function normalizeLanguage(code) {
  code = String(code || "").trim().toLowerCase().replace(/_/g, "-");
  if (!code || code === "und" || code === "unknown") {
    return "und";
  }
  return ISO639_2[code] || code;
}

/** Subtitle streams in ffmpeg -i output. */
export function parseSubtitleStreams(stderr) {
  let streams = [];
  let index = 0;
  for (let m of stderr.matchAll(/Stream #\d+:(\d+)(?:\[[^\]]*\])?(?:\(([a-zA-Z-]+)\))?:\s*Subtitle:\s*([a-z0-9_]+)([^\n]*)/g)) {
    streams.push({
      stream: Number(m[1]),
      index: index++,
      language: normalizeLanguage(m[2]),
      codec: m[3].toLowerCase(),
      text: TEXT_SUBTITLES.has(m[3].toLowerCase()),
      default: /\(default\)/.test(m[4]),
      forced: /\(forced\)/.test(m[4]),
    });
  }
  return streams;
}

/** Language that whisper.cpp detected, from its log output. */
export function parseWhisperLanguage(text) {
  let m = /auto-detected language:\s*([a-z-]+)/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Progress between 0 and 1 from whisper.cpp output, or null. */
export function parseWhisperProgress(text, duration) {
  let pct = [...text.matchAll(/progress\s*=\s*(\d+)%/g)];
  if (pct.length) {
    return Math.min(0.99, Number(pct.at(-1)[1]) / 100);
  }
  let stamps = [...text.matchAll(/-->\s*(\d+):(\d+):([\d.]+)\]/g)];
  if (stamps.length && duration > 0) {
    let [, h, m, s] = stamps.at(-1);
    return Math.min(0.99, (Number(h) * 3600 + Number(m) * 60 + Number(s)) / duration);
  }
  return null;
}

/** Duration in seconds of a 16-bit PCM WAV file from its header, or 0. */
export function wavDuration(header, size) {
  if (header.length < 44) {
    return 0;
  }
  let view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  let byteRate = view.getUint32(28, true);
  return byteRate ? Math.max(0, size - 44) / byteRate : 0;
}

/** Builds the whisper.cpp command line. */
export function whisperArgs({ model, audio, outputBase, language = "auto", translate = false, threads = 4 }) {
  let args = [
    "-m", model,
    "-f", audio,
    "-l", language || "auto",
    "-t", String(Math.max(1, Math.min(16, threads | 0 || 4))),
    "-ovtt",
    "-of", outputBase,
    "-pp",
    // Short lines like YouTube's captions.
    "-ml", "60", "-sow",
  ];
  if (translate) {
    args.push("-tr");
  }
  return args;
}

// Bigger models are more accurate (and slower); when several are installed
// the most accurate one that is still reasonably fast is used first.
const MODEL_ORDER = ["large-v3-turbo", "medium", "small", "base", "large", "tiny"];

export function sortModels(paths) {
  let rank = p => {
    let name = p.split(/[\\/]/).pop().toLowerCase();
    let i = MODEL_ORDER.findIndex(m => name.includes(`-${m}`));
    // Multilingual models before English-only ones (.en).
    return (i < 0 ? MODEL_ORDER.length : i) * 2 + (/\.en[.-]/.test(name) ? 1 : 0);
  };
  return [...new Set(paths)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Name of an auto-generated subtitle file. */
export function autoSubtitleName(language, translate) {
  return `${normalizeLanguage(language)}${translate ? ".translated" : ""}.auto.vtt`;
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
  constructor({ findFFmpeg, findWhisper, fs, threads = 4, run, stream, separator = "/" }) {
    this.findFFmpeg = findFFmpeg;
    // async () => { programs: [paths, best first], model, models: [paths] }
    this.findWhisper = findWhisper || (async () => ({ programs: [], model: null, models: [] }));
    this.fs = fs || null;
    this.threads = threads;
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

  // ------------------------------------------------------------ subtitles

  _newJob(fields) {
    let id = Math.random().toString(36).slice(2, 10);
    let job = { id, progress: 0, ...fields };
    this.jobs.set(id, job);
    return job;
  }

  /** What automatic subtitles need: a whisper.cpp program and a model. */
  async speechInfo() {
    let w = await this.findWhisper();
    let ffmpeg = await this.findFFmpeg();
    return {
      available: !!(w.programs.length && w.model),
      program: w.programs[0] || null,
      model: w.model || null,
      modelName: w.model ? w.model.split(/[\\/]/).pop() : null,
      models: w.models || [],
      ffmpeg: !!ffmpeg,
    };
  }

  /** Subtitle tracks stored inside a video file (MKV, MP4 ...). */
  async subtitleStreams(input) {
    let exe = await this.findFFmpeg();
    if (!exe) {
      return [];
    }
    let r = await this.run(exe, ["-hide_banner", "-i", input]);
    return parseSubtitleStreams(r.stderr || "");
  }

  /**
   * Copies the text subtitle tracks of a video into <dir>/<lang>.embedded[.N].vtt.
   * Starts a job; the finished job lists the files in `files`.
   */
  async extractSubtitles(input, dir) {
    let exe = await this.findFFmpeg();
    if (!exe) {
      return { state: "failed", error: "FFmpeg is needed to read subtitles stored inside a video file." };
    }
    let job = this._newJob({ kind: "extract", state: "probing", input });
    (async () => {
      try {
        let streams = (await this.subtitleStreams(input)).filter(s => s.text);
        if (!streams.length) {
          Object.assign(job, { state: "done", progress: 1, files: [] });
          return;
        }
        await this.fs.mkdir(dir);
        let args = ["-hide_banner", "-nostdin", "-y", "-i", input];
        let used = new Map();
        let files = [];
        for (let s of streams) {
          let n = (used.get(s.language) || 0) + 1;
          used.set(s.language, n);
          let name = `${s.language}.embedded${n > 1 ? "." + n : ""}.vtt`;
          files.push({ name, language: s.language, codec: s.codec });
          args.push("-map", `0:${s.stream}`, "-c:s", "webvtt", "-f", "webvtt", this.fs.join(dir, name));
        }
        job.state = "running";
        let probe = await this.probe(input);
        let duration = probe.duration;
        let code = await this.stream(exe, args, chunk => {
          let r = parseProgress(chunk, duration);
          if (r.progress !== null) {
            job.progress = r.progress;
          }
        });
        if (code !== 0) {
          throw new Error(`ffmpeg exited with code ${code}`);
        }
        Object.assign(job, { state: "done", progress: 1, files });
      } catch (e) {
        job.state = "failed";
        job.error = String(e.message || e);
      }
    })();
    return { id: job.id, state: job.state };
  }

  /**
   * Generates subtitles from the speech in a video with whisper.cpp, fully
   * offline. Writes <dir>/<language>.auto.vtt (or <language>.translated.auto.vtt).
   *
   * @param {string} input     the video (or audio) file
   * @param {object} options
   * @param {string} options.dir         folder for the .vtt file
   * @param {string} [options.language]  "auto" or a language code
   * @param {boolean} [options.translate] translate the speech into English
   * @param {string} [options.audio]     a 16 kHz WAV made by the page, used
   *                                     when FFmpeg is not installed
   * @param {boolean} [options.removeAudio] delete `audio` afterwards
   */
  async transcribe(input, { dir, language = "auto", translate = false, audio = null, removeAudio = false } = {}) {
    let w = await this.findWhisper();
    if (!w.programs.length || !w.model) {
      return {
        state: "failed",
        code: "no-whisper",
        error: !w.programs.length
          ? "The speech recognition program (whisper.cpp) was not found. Choose it in about:offox → Automatic subtitles."
          : "No speech recognition model was found. Choose a ggml model file in about:offox → Automatic subtitles.",
      };
    }
    let ffmpeg = await this.findFFmpeg();
    if (!audio && !ffmpeg && !/\.wav$/i.test(input)) {
      return { state: "failed", code: "needs-audio", error: "FFmpeg is not installed, so the page has to extract the audio." };
    }
    language = !language || language === "auto" ? "auto" : normalizeLanguage(language);
    let job = this._newJob({ kind: "subtitles", state: "preparing", input, language });
    let tag = job.id;
    let tempAudio = null;
    let tempBase = this.fs.join(dir, `.offox-subtitles-${tag}`);
    (async () => {
      try {
        await this.fs.mkdir(dir);
        let duration = 0;
        if (audio) {
          tempAudio = removeAudio ? audio : null;
        } else if (/\.wav$/i.test(input) && !ffmpeg) {
          audio = input;
        } else {
          // 16 kHz mono PCM is what whisper.cpp reads.
          audio = tempAudio = this.fs.join(dir, `.offox-audio-${tag}.wav`);
          job.state = "extracting";
          let probe = await this.probe(input);
          duration = probe.duration;
          if (!probe.audio) {
            throw new Error("This video has no sound to make subtitles from.");
          }
          let d = duration;
          let code = await this.stream(ffmpeg, [
            "-hide_banner", "-nostdin", "-y", "-i", input,
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audio,
          ], chunk => {
            let r = parseProgress(chunk, d);
            if (r.progress !== null) {
              job.progress = r.progress * 0.1;
            }
          });
          if (code !== 0) {
            throw new Error(`ffmpeg could not read the sound (exit code ${code})`);
          }
        }
        if (!duration) {
          let s = await this.fs.stat(audio);
          let header = await this.fs.read(audio, { offset: 0, length: 44 });
          duration = s ? wavDuration(header, s.size) : 0;
        }
        job.duration = duration;
        job.state = "running";
        let lastError = null;
        for (let program of w.programs) {
          let log = "";
          let detected = null;
          let start = job.progress;
          // Run inside the subtitle folder with relative file names: on
          // Windows whisper.cpp can't open paths with non-ASCII characters.
          let rel = p => (p.startsWith(dir) && /^[\\/][^\\/]+$/.test(p.slice(dir.length)) ? p.slice(dir.length + 1) : p);
          let code = await this.stream(program, whisperArgs({
            model: w.model, audio: rel(audio), outputBase: rel(tempBase), language, translate, threads: this.threads,
          }), chunk => {
            log = (log + chunk).slice(-8192);
            detected = detected || parseWhisperLanguage(chunk);
            let p = parseWhisperProgress(chunk, duration);
            if (p !== null) {
              job.progress = Math.max(job.progress, start + p * (0.99 - start));
            }
          }, { stdout: true, cwd: dir });
          let out = await this.fs.stat(tempBase + ".vtt");
          if (code === 0 && out) {
            let lang = translate ? "en" : language === "auto" ? detected || "und" : language;
            let name = translate ? autoSubtitleName("en", true) : autoSubtitleName(lang, false);
            let target = this.fs.join(dir, name);
            if (await this.fs.stat(target)) {
              await this.fs.remove(target);
            }
            await this.fs.move(tempBase + ".vtt", target);
            Object.assign(job, { state: "done", progress: 1, output: target, outputName: name, language: lang, program });
            return;
          }
          // An illegal-instruction crash on an old CPU: try the next build.
          lastError = `whisper.cpp exited with code ${code}` + (log.trim() ? `: ${log.trim().split("\n").filter(l => /error|fail/i.test(l)).slice(-2).join(" ")}` : "");
        }
        throw new Error(lastError || "whisper.cpp failed");
      } catch (e) {
        job.state = "failed";
        job.error = String(e.message || e);
      } finally {
        for (let f of [tempAudio, tempBase + ".vtt"]) {
          if (f) {
            try {
              await this.fs.remove(f);
            } catch (e) {}
          }
        }
      }
    })();
    return { id: job.id, state: job.state };
  }
}
