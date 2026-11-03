/* End-to-end test of OffTube comments and subtitles, run against the preview
 * server in Chromium with a stand-in for whisper.cpp (tests/fixtures):
 *   node tests/e2e-comments-subtitles.mjs <dir with clip.webm and old.avi> [screenshot dir] */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setup, check } from "./browser-helpers.mjs";

let mediaDir = process.argv[2];
let shots = process.argv[3];
let here = path.dirname(fileURLToPath(import.meta.url));
let work = fs.mkdtempSync(path.join(os.tmpdir(), "offox-subs-"));
let model = path.join(work, "ggml-base.bin");
fs.writeFileSync(model, "fake model");
process.env.OFFOX_WHISPER = path.join(here, "fixtures", "fake-whisper-cli.mjs");
process.env.OFFOX_WHISPER_MODEL = model;

// Files as yt-dlp saves them next to a YouTube video.
let stem = "Test clip [abc123]";
fs.copyFileSync(path.join(mediaDir, "clip.webm"), path.join(work, `${stem}.webm`));
fs.writeFileSync(path.join(work, `${stem}.en.srt`), "1\n00:00:00,500 --> 00:00:02,000\nHello <font color=red>world</font>\n\n2\n00:00:02,000 --> 00:00:03,500\nSecond line\n");
fs.writeFileSync(path.join(work, `${stem}.info.json`), JSON.stringify({
  id: "abc123", title: "Imported from YouTube", description: "Downloaded with yt-dlp", upload_date: "20240131",
  channel: "Test Channel", view_count: 1234, like_count: 56, webpage_url: "https://www.youtube.com/watch?v=abc123",
  subtitles: { en: [] }, automatic_captions: {},
  comments: [
    { id: "c1", text: "Great video! Best part at 0:02", author: "@alice", timestamp: 1706700000, like_count: 10, parent: "root", is_pinned: true },
    { id: "c2", text: "Thanks!", author: "@uploader", timestamp: 1706700100, like_count: 2, parent: "c1", author_is_uploader: true },
    { id: "c3", text: "Second comment", author: "@bob", timestamp: 1706800000, like_count: 0, parent: "root" },
  ],
}));

let t = await setup();
let { page } = t;
try {
  console.log("comments and subtitles");
  await page.goto("https://youtube.com/upload.html");
  await page.waitForSelector("#auto-subs:not([hidden])");
  check(await page.isChecked("#auto-subs-on"), "automatic subtitles are offered when whisper.cpp and a model are found");
  await page.setInputFiles("#files", [`${stem}.webm`, `${stem}.en.srt`, `${stem}.info.json`].map(f => path.join(work, f)));
  await page.waitForFunction(() => document.querySelectorAll(".upload-item .extra").length === 2);
  check((await page.locator(".upload-item").count()) === 1, "subtitle and info files are attached to their video, not uploaded as videos");
  check(await page.inputValue(".upload-item input[type=text]") === "Imported from YouTube", "title comes from the .info.json");
  await page.setInputFiles("#files", [path.join(mediaDir, "old.avi")]);
  await page.waitForSelector(".upload-item:nth-child(2) .warn", { timeout: 20000 });
  await page.click("#upload-all");
  await page.waitForFunction(() => document.querySelectorAll(".upload-item a[href^='watch.html']").length === 2, null, { timeout: 120000 });
  await page.waitForFunction(() => /Automatic subtitles ready/.test(document.querySelector(".upload-item:nth-child(2) .status").textContent), null, { timeout: 60000 });
  check(true, "uploads finished and automatic subtitles were made for the video without subtitles");
  if (shots) await page.screenshot({ path: path.join(shots, "subs-upload.png") });

  let videosDir = fs.readdirSync(t.root).map(d => path.join(t.root, d, "videos")).find(p => fs.existsSync(p));
  let ids = fs.readdirSync(videosDir);
  let ytId = ids.find(id => fs.existsSync(path.join(videosDir, id, "video.webm")));
  let aviId = ids.find(id => id !== ytId);
  let ytDir = path.join(videosDir, ytId);
  check(fs.readFileSync(path.join(ytDir, "created.txt"), "utf8").startsWith("2024-01-31"), "upload date comes from the .info.json");
  let comments = JSON.parse(fs.readFileSync(path.join(ytDir, "comments.json"), "utf8")).comments;
  check(comments.length === 3 && comments.find(c => c.id === "c2").parent === "c1", "yt-dlp comments were imported with their replies");
  let vtt = fs.readFileSync(path.join(ytDir, "subtitles", "en.vtt"), "utf8");
  check(vtt.startsWith("WEBVTT") && vtt.includes("00:00:00.500 --> 00:00:02.000") && !vtt.includes("<font"), "the .srt was converted to WebVTT");
  let aviSubs = fs.readdirSync(path.join(videosDir, aviId, "subtitles"));
  check(aviSubs.includes("de.auto.vtt"), `automatic subtitles saved under the detected language: ${aviSubs.join(", ")}`);
  check(!aviSubs.some(f => f.endsWith(".wav")), "the temporary sound file was removed");
  let info = JSON.parse(fs.readFileSync(path.join(ytDir, "info.json"), "utf8"));
  check(info.source && info.source.channel === "Test Channel", "YouTube details are kept in info.json");

  // ---------- Watch page: subtitles
  await page.goto(`https://youtube.com/watch.html?v=${ytId}`);
  await page.waitForFunction(() => document.querySelectorAll("#player video track").length === 1);
  check(await page.evaluate(() => document.querySelector("#player video").textTracks[0].language === "en"), "the player has the English track");
  await page.click("text=CC");
  await page.waitForSelector(".subtitles-dialog");
  check(await page.isEnabled(".subtitles-dialog button.btn.primary"), "the Generate button is enabled");
  await page.selectOption(".subtitles-dialog select[name=language]", "fr");
  await page.check(".subtitles-dialog input[name=translate]");
  if (shots) await page.screenshot({ path: path.join(shots, "subs-dialog.png") });
  await page.click(".subtitles-dialog button.btn.primary");
  await page.waitForFunction(() => document.querySelectorAll("#player video track").length === 2, null, { timeout: 60000 });
  check(fs.existsSync(path.join(ytDir, "subtitles", "en.translated.auto.vtt")), "translated automatic subtitles were saved");
  let argsFile = fs.readdirSync(path.join(ytDir, "subtitles")).find(f => f.endsWith(".args.json"));
  let call = JSON.parse(fs.readFileSync(path.join(ytDir, "subtitles", argsFile), "utf8"));
  check(call.args.includes("-tr") && call.args[call.args.indexOf("-l") + 1] === "fr", "whisper.cpp got the chosen language and the translate option");
  check(!path.isAbsolute(call.args[call.args.indexOf("-f") + 1]) && fs.realpathSync(call.cwd) === fs.realpathSync(path.join(ytDir, "subtitles")), "whisper.cpp runs in the subtitle folder with relative file names");
  await page.waitForFunction(() => [...document.querySelector("#player video").textTracks].filter(t => t.mode === "showing").length === 1, null, { timeout: 5000 }).catch(() => {});
  let showing = await page.evaluate(() => [...document.querySelector("#player video").textTracks].filter(t => t.mode === "showing").map(t => t.label));
  check(showing.length === 1 && /auto-translated/.test(showing[0]), "the new subtitles are shown: " + showing.join());

  await page.click("text=☰ Transcript");
  await page.waitForSelector(".transcript .cue");
  check((await page.locator(".transcript .cue").count()) === 2, "the transcript lists the cues");
  await page.locator(".transcript .cue").nth(1).click();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelector("#player video").currentTime >= 1.4), "clicking a transcript line seeks the video");

  // ---------- Comments
  await page.waitForSelector(".comment");
  check((await page.locator(".comments-count").innerText()) === "3 Comments", "comment count shown");
  check((await page.locator(".comment-list > .comment").first().innerText()).includes("Pinned"), "the pinned comment is first");
  await page.fill(".comments > .composer textarea", "My own comment at 0:01");
  await page.click(".comments > .composer button[type=submit]");
  await page.waitForFunction(() => document.querySelector(".comments-count").textContent === "4 Comments");
  await page.locator(".comment-list > .comment", { hasText: "Second comment" }).locator(".comment-actions button", { hasText: "Reply" }).first().click();
  await page.fill(".reply-box textarea", "A reply");
  await page.click(".reply-box button[type=submit]");
  await page.waitForFunction(() => document.querySelector(".comments-count").textContent === "5 Comments");
  await page.locator(".comment-list > .comment", { hasText: "Second comment" }).locator(".comment-actions button[title=Like]").first().click();
  await page.locator(".comment-list > .comment", { hasText: "Great video" }).locator(".replies-toggle").click();
  await page.waitForSelector(".replies .comment");
  if (shots) await page.screenshot({ path: path.join(shots, "comments.png"), fullPage: true });
  await page.waitForTimeout(500);
  comments = JSON.parse(fs.readFileSync(path.join(ytDir, "comments.json"), "utf8")).comments;
  let bob = comments.find(c => c.id === "c3");
  check(comments.length === 5 && comments.some(c => c.text === "A reply" && c.parent === "c3") && bob.likes === 1 && bob.liked, "new comment, reply and like saved to comments.json");
  await page.reload();
  await page.waitForSelector(".comment");
  check((await page.locator(".comments-count").innerText()) === "5 Comments", "comments are still there after reloading");
  await page.locator(".comment-list > .comment", { hasText: "My own comment" }).locator(".timestamp").click();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => Math.abs(document.querySelector("#player video").currentTime - 1) < 0.5), "timestamps in comments seek the video");
  let mine = page.locator(".comment-list > .comment", { hasText: "My own comment" });
  await mine.locator(".comment-menu summary").first().click();
  await mine.locator(".comment-menu .danger").first().click();
  await page.waitForFunction(() => document.querySelector(".comments-count").textContent === "4 Comments");
  check(true, "a comment can be deleted");

  // ---------- Subtitle tracks stored inside an MKV are copied out.
  let mkv = path.join(work, "with-subs.mkv");
  let srt = path.join(work, "track.srt");
  fs.writeFileSync(srt, "1\n00:00:00,000 --> 00:00:01,000\nEmbedded line\n");
  let { spawnSync } = await import("node:child_process");
  let r = spawnSync(process.env.OFFOX_FFMPEG || "ffmpeg", ["-loglevel", "error", "-y", "-i", path.join(mediaDir, "clip.webm"), "-i", srt,
    "-map", "0", "-map", "1", "-c", "copy", "-c:s", "srt", "-metadata:s:s:0", "language=ger", mkv]);
  check(r.status === 0, "made an MKV with a German subtitle track");
  await page.goto("https://youtube.com/upload.html");
  await page.waitForSelector("#auto-subs:not([hidden])");
  await page.setInputFiles("#files", [mkv]);
  await page.waitForSelector(".upload-item .thumb img", { timeout: 20000 });
  await page.click("#upload-all");
  await page.waitForFunction(() => /from the video file/.test(document.querySelector(".upload-item .status").textContent), null, { timeout: 60000 });
  let mkvId = fs.readdirSync(videosDir).find(id => fs.existsSync(path.join(videosDir, id, "video.mkv")));
  let embedded = fs.readFileSync(path.join(videosDir, mkvId, "subtitles", "de.embedded.vtt"), "utf8");
  check(embedded.startsWith("WEBVTT") && embedded.includes("Embedded line"), "the MKV's subtitle track was saved as de.embedded.vtt");
  check(!fs.readdirSync(path.join(videosDir, mkvId, "subtitles")).some(f => f.endsWith(".auto.vtt")), "no automatic subtitles when the video brings its own");
  check(t.errors.length === 0, "no page errors " + t.errors.join(" | "));
} catch (e) {
  console.error("Page errors:", t.errors);
  throw e;
} finally {
  await t.close();
}

// ---------- Without FFmpeg the page extracts the sound itself.
process.env.OFFOX_FFMPEG = path.join(work, "no-ffmpeg");
t = await setup();
page = t.page;
try {
  console.log("automatic subtitles without FFmpeg");
  await page.goto("https://youtube.com/upload.html");
  await page.waitForSelector("#auto-subs:not([hidden])");
  await page.selectOption("#auto-subs-lang select", "es");
  await page.setInputFiles("#files", [path.join(mediaDir, "clip.webm")]);
  await page.waitForSelector(".upload-item .thumb img", { timeout: 20000 });
  await page.click("#upload-all");
  await page.waitForFunction(() => /Automatic subtitles (ready|failed)/.test(document.querySelector(".upload-item .status").textContent), null, { timeout: 60000 });
  let status = await page.locator(".upload-item .status").innerText();
  check(/ready/.test(status), "subtitles made from sound decoded in the page: " + status.replace(/\n/g, " "));
  let videosDir = fs.readdirSync(t.root).map(d => path.join(t.root, d, "videos")).find(p => fs.existsSync(p));
  let id = fs.readdirSync(videosDir)[0];
  let files = fs.readdirSync(path.join(videosDir, id, "subtitles"));
  check(files.includes("es.auto.vtt") && !files.some(f => f.endsWith(".wav")), "es.auto.vtt saved and the page's WAV removed: " + files.join(", "));
  check(t.errors.length === 0, "no page errors " + t.errors.join(" | "));
} finally {
  await t.close();
  fs.rmSync(work, { recursive: true, force: true });
}
