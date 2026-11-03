/* Unit tests for the subtitle helpers in OffoxMedia and for upgrading sites
 * made from an older template version:  node tests/subtitles-upgrade.test.mjs */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  autoSubtitleName, normalizeLanguage, parseSubtitleStreams, parseWhisperLanguage,
  parseWhisperProgress, sortModels, wavDuration, whisperArgs,
} from "../../browser/components/offox/modules/OffoxMedia.sys.mjs";
import { SiteRegistry } from "../../browser/components/offox/modules/OffoxSites.sys.mjs";
import { NodeFS, nodeAssets } from "../dev/node-adapters.mjs";

function check(cond, message) {
  if (!cond) throw new Error("Check failed: " + message);
  console.log("  ✓ " + message);
}

console.log("subtitle helpers");
let probe = `Input #0, matroska,webm, from 'a.mkv':
  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080
  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo (default)
  Stream #0:2(eng): Subtitle: subrip (default)
  Stream #0:3(ger): Subtitle: ass
  Stream #0:4[0x1201](fre): Subtitle: hdmv_pgs_subtitle (forced)
  Stream #0:5: Subtitle: mov_text`;
let streams = parseSubtitleStreams(probe);
check(streams.length === 4, "four subtitle streams found");
check(streams[0].stream === 2 && streams[0].language === "en" && streams[0].text && streams[0].default, "eng subrip → en, text, default");
check(streams[1].language === "de" && streams[1].codec === "ass", "ger → de");
check(!streams[2].text && streams[2].forced && streams[2].language === "fr", "PGS bitmap subtitles are not text");
check(streams[3].language === "und", "a stream without a language is und");
check(normalizeLanguage("pt-BR") === "pt-br" && normalizeLanguage("") === "und", "language codes are normalised");
check(parseWhisperLanguage("whisper_full_with_state: auto-detected language: ja (p = 0.98)") === "ja", "detected language parsed");
check(parseWhisperProgress("whisper_print_progress_callback: progress =  45%", 0) === 0.45, "progress percentage parsed");
check(Math.abs(parseWhisperProgress("[00:00:30.000 --> 00:00:45.000]  Hello", 90) - 0.5) < 1e-9, "progress from segment times");
check(autoSubtitleName("en", false) === "en.auto.vtt" && autoSubtitleName("en", true) === "en.translated.auto.vtt", "automatic subtitle names");
let args = whisperArgs({ model: "m.bin", audio: "a.wav", outputBase: "out", language: "fr", translate: true, threads: 6 });
check(args.join(" ") === "-m m.bin -f a.wav -l fr -t 6 -ovtt -of out -pp -ml 60 -sow -tr", "whisper.cpp command line: " + args.join(" "));
check(sortModels(["/m/ggml-tiny.bin", "/m/ggml-base.en.bin", "/m/ggml-small.bin", "/m/ggml-base-q5_1.bin"]).map(p => path.basename(p)).join() ===
  "ggml-small.bin,ggml-base-q5_1.bin,ggml-base.en.bin,ggml-tiny.bin", "models sorted: small, base (multilingual first), tiny");
let header = new Uint8Array(44);
new DataView(header.buffer).setUint32(28, 32000, true);
check(wavDuration(header, 44 + 32000 * 3) === 3, "WAV duration from its header");

console.log("site upgrade");
let root = fs.mkdtempSync(path.join(os.tmpdir(), "offox-upgrade-"));
try {
  let registry = new SiteRegistry({ fs: NodeFS, assets: nodeAssets() });
  await registry.load([root]);
  await registry.initRoot(root);
  let site = registry.lookup("youtube.com");
  check(site && site.templateVersion === 2, "new OffTube sites are made from template version 2");
  // Make it look like a site from Offox 153.5.1: version 1, no comments.js,
  // and a page the user changed by hand.
  let manifestPath = path.join(site.dir, "offox-site.json");
  let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  delete manifest.templateVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.rmSync(path.join(site.dir, "assets", "comments.js"));
  fs.writeFileSync(path.join(site.dir, "watch.html"), "<p>my own page</p>");
  fs.mkdirSync(path.join(site.dir, "videos", "abc"), { recursive: true });
  fs.writeFileSync(path.join(site.dir, "videos", "abc", "title.txt"), "Keep me");
  let wikiPage = path.join(registry.lookup("wikipedia.org").dir, "index.html");
  fs.writeFileSync(wikiPage, "<p>custom wiki</p>");

  await registry.load([root]);
  site = registry.lookup("youtube.com");
  check(site.templateVersion === 2, "the site was upgraded to version 2");
  check(fs.existsSync(path.join(site.dir, "assets", "comments.js")), "new template files were added");
  let watch = fs.readFileSync(path.join(site.dir, "watch.html"), "utf8");
  check(watch.includes("OffTubeComments") && watch.includes("<title>OffTube</title>"), "pages were replaced, with the site title filled in");
  let backups = fs.readdirSync(path.join(site.dir, ".offox-backup"));
  check(backups.length === 1 && fs.readFileSync(path.join(site.dir, ".offox-backup", backups[0], "watch.html"), "utf8") === "<p>my own page</p>", "the hand-edited page was backed up");
  check(!fs.existsSync(path.join(site.dir, ".offox-backup", backups[0], "index.html")), "unchanged pages are not backed up");
  check(fs.readFileSync(path.join(site.dir, "videos", "abc", "title.txt"), "utf8") === "Keep me", "videos are untouched");
  check(fs.readFileSync(wikiPage, "utf8") === "<p>custom wiki</p>", "sites whose template did not change are untouched");
  let mtime = fs.statSync(path.join(site.dir, "watch.html")).mtimeMs;
  await registry.load([root]);
  check(fs.statSync(path.join(site.dir, "watch.html")).mtimeMs === mtime, "an upgraded site is not upgraded again");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("All subtitle and upgrade checks passed.");
