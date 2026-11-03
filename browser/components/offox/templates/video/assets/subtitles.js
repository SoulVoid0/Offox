/* OffTube subtitles. Every video can have any number of WebVTT files in
 * videos/<id>/subtitles/, named <language>[.flags].vtt:
 *   en.vtt                 subtitles you added
 *   en.auto.vtt            made automatically from the speech (whisper.cpp)
 *   en.translated.auto.vtt speech in another language, translated to English
 *   de.embedded.vtt        copied out of the video file (MKV/MP4 tracks)
 * The player shows them as normal <track>s (CC menu of the video controls),
 * so the language can be picked there or in the Subtitles dialog.
 */
"use strict";

const OffTubeSubs = {
  // Languages whisper.cpp recognises.
  LANGUAGES: ["en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su", "yue"],

  dir: videoId => `videos/${videoId}/subtitles`,

  langName(code) {
    if (!code || code === "und") return "Unknown language";
    try {
      let name = new Intl.DisplayNames([navigator.language || "en", "en"], { type: "language" }).of(code);
      if (name && name !== code) return name.charAt(0).toUpperCase() + name.slice(1);
    } catch (e) {}
    return code;
  },

  /** Splits a subtitle file name into language and flags. */
  parseName(name) {
    let m = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)((?:\.[a-z0-9-]+)*)\.(vtt|srt)$/i.exec(name);
    if (!m) return null;
    let flags = m[2].toLowerCase().split(".").filter(Boolean);
    let lang = m[1].toLowerCase();
    let auto = flags.includes("auto") || flags.includes("auto-generated");
    let translated = flags.includes("translated");
    let embedded = flags.includes("embedded");
    let number = flags.find(f => /^\d+$/.test(f));
    let label = OffTubeSubs.langName(lang);
    if (translated) label += " (auto-translated)";
    else if (auto) label += " (auto-generated)";
    else if (embedded) label += number ? ` (from the video, ${number})` : " (from the video)";
    else if (flags.length) label += ` (${flags.join(", ")})`;
    return { name, lang, auto, translated, embedded, label, format: m[3].toLowerCase() };
  },

  /** The video's subtitle tracks, sorted: yours, from the video, automatic. */
  async list(videoId) {
    let entries = await Offox.list(OffTubeSubs.dir(videoId)).catch(() => []);
    let tracks = entries
      .filter(e => e.type === "file" && !e.name.startsWith("."))
      .map(e => OffTubeSubs.parseName(e.name))
      .filter(t => t && t.format === "vtt");
    let rank = t => (t.auto ? 2 : t.embedded ? 1 : 0);
    tracks.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
    for (let t of tracks) t.url = Offox.url(`${OffTubeSubs.dir(videoId)}/${t.name}`);
    return tracks;
  },

  /** Converts SubRip (.srt) text to WebVTT. */
  srtToVtt(text) {
    let body = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim()
      .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
      .replace(/^\d+\n(?=\d{1,2}:\d{2}:\d{2}\.\d{3}\s*-->)/gm, "")
      .replace(/<\/?font[^>]*>/gi, "")
      .replace(/\{\\[^}]*\}/g, "");
    return "WEBVTT\n\n" + body + "\n";
  },

  toVtt(text, name) {
    text = String(text).replace(/^﻿/, "");
    if (/^WEBVTT/.test(text.trimStart())) return text;
    if (/\.srt$/i.test(name) || /\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text)) return OffTubeSubs.srtToVtt(text);
    throw new Error(`${name} is not a .vtt or .srt subtitle file`);
  },

  /** Saves a subtitle file the user picked (.vtt or .srt) for a language. */
  async add(videoId, file, lang) {
    let vtt = OffTubeSubs.toVtt(await file.text(), file.name);
    lang = (lang || "und").toLowerCase();
    let name = `${lang}.vtt`;
    let existing = new Set((await OffTubeSubs.list(videoId)).map(t => t.name));
    for (let i = 2; existing.has(name); i++) name = `${lang}.${i}.vtt`;
    await Offox.writeText(`${OffTubeSubs.dir(videoId)}/${name}`, vtt);
    return name;
  },

  /** Guesses the language of a subtitle file from its name (video.en.srt). */
  guessLang(fileName) {
    let parts = fileName.replace(/\.(vtt|srt)$/i, "").split(".");
    for (let i = parts.length - 1; i > 0; i--) {
      let p = parts[i].replace(/-orig$/i, "");
      if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/i.test(p)) return p.toLowerCase();
    }
    return null;
  },

  /** Parses WebVTT into cues: [{start, end, text}]. */
  parseVtt(text) {
    let cues = [];
    let time = t => {
      let p = t.trim().split(":").map(Number);
      return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    };
    for (let block of String(text).replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
      let lines = block.split("\n");
      let i = lines.findIndex(l => l.includes("-->"));
      if (i < 0) continue;
      let [a, b] = lines[i].split("-->");
      let words = lines.slice(i + 1).join(" ").replace(/<[^>]+>/g, "").trim();
      if (!words) continue;
      cues.push({ start: time(a), end: time(b.trim().split(/\s+/)[0]), text: words });
    }
    return cues;
  },

  speechInfo: () => Offox.media.speech().catch(() => ({ available: false, ffmpeg: false, models: [] })),

  /**
   * Decodes a video's sound in the page and saves it as 16 kHz mono WAV,
   * for when FFmpeg is not installed. Returns the WAV's path.
   */
  async extractAudioInPage(video, onProgress) {
    onProgress?.(0, "Reading the sound of the video…");
    let res = await fetch(OffTube.videoUrl(video));
    if (!res.ok) throw new Error("Could not read the video file");
    let data = await res.arrayBuffer();
    onProgress?.(0.03, "Decoding the sound…");
    let ctx = new OfflineAudioContext(1, 1, 16000);
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(data);
    } catch (e) {
      throw new Error("Offox can't read the sound of this video without FFmpeg. Convert the video or install FFmpeg.");
    }
    data = null;
    let n = buffer.length;
    let channels = [...Array(buffer.numberOfChannels).keys()].map(c => buffer.getChannelData(c));
    let wav = new DataView(new ArrayBuffer(44 + n * 2));
    let str = (o, s) => [...s].forEach((ch, i) => wav.setUint8(o + i, ch.charCodeAt(0)));
    str(0, "RIFF"); wav.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
    str(12, "fmt "); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, 16000, true); wav.setUint32(28, 32000, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
    str(36, "data"); wav.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let ch of channels) v += ch[i];
      v = Math.max(-1, Math.min(1, v / channels.length));
      wav.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    let path = `${OffTubeSubs.dir(video.id)}/.offox-audio-page.wav`;
    await Offox.upload(path, new Blob([wav.buffer], { type: "audio/wav" }), {
      onProgress: p => onProgress?.(0.03 + p * 0.07, "Preparing the sound…"),
    });
    return path;
  },

  /**
   * Makes automatic subtitles for a video. Resolves with the new track's
   * file name. onProgress(fraction, text).
   */
  async generate(video, { language = "auto", translate = false, onProgress } = {}) {
    let dir = OffTubeSubs.dir(video.id);
    let source = `videos/${video.id}/${video.original}`;
    let report = (p, job) => {
      let what = job.state === "extracting" ? "Getting the sound" : "Listening and writing subtitles";
      onProgress?.(p, `${what}… ${Math.round(p * 100)}%`);
    };
    let remember = id => { try { localStorage.setItem("offtube.subjob." + video.id, id); } catch (e) {} };
    let start = async opts => {
      let job = await Offox.media.subtitles(source, dir, {
        language, translate, ...opts,
        onProgress: (p, j) => { remember(j.id); report(p, j); },
      });
      return job;
    };
    let job;
    try {
      job = await start({});
    } catch (e) {
      if (e.code !== "needs-audio") throw e;
      let audio = await OffTubeSubs.extractAudioInPage(video, onProgress);
      job = await start({ audio, removeAudio: true });
    } finally {
      try { localStorage.removeItem("offtube.subjob." + video.id); } catch (e) {}
    }
    return job;
  },

  /** A subtitle job that was still running when the page was left. */
  async resume(videoId, onProgress) {
    let id;
    try { id = localStorage.getItem("offtube.subjob." + videoId); } catch (e) {}
    if (!id) return null;
    let job = await Offox.media.job(id).catch(() => ({ state: "unknown" }));
    if (job.state === "unknown") {
      try { localStorage.removeItem("offtube.subjob." + videoId); } catch (e) {}
      return null;
    }
    try {
      return await Offox.media.wait(job, { onProgress: (p, j) => onProgress?.(p, `Listening and writing subtitles… ${Math.round(p * 100)}%`), interval: 1000 });
    } finally {
      try { localStorage.removeItem("offtube.subjob." + videoId); } catch (e) {}
    }
  },

  /** Copies subtitle tracks stored inside the video file (needs FFmpeg). */
  async extractEmbedded(video, onProgress) {
    let job = await Offox.media.extractSubtitles(`videos/${video.id}/${video.original}`, OffTubeSubs.dir(video.id), { onProgress });
    return job.files || [];
  },

  preferred() {
    try { return localStorage.getItem("offtube.subtitles"); } catch (e) { return null; }
  },
  setPreferred(lang) {
    try { localStorage.setItem("offtube.subtitles", lang); } catch (e) {}
  },

  /** A <select> of languages for automatic subtitles. */
  languageSelect(value = "auto") {
    let langs = OffTubeSubs.LANGUAGES.map(code => ({ code, name: OffTubeSubs.langName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return h("select", { name: "language", "aria-label": "Spoken language" },
      h("option", { value: "auto", selected: value === "auto" }, "Detect automatically"),
      langs.map(l => h("option", { value: l.code, selected: l.code === value }, l.name)));
  },
};
