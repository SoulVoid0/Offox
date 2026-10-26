/* End-to-end test of the video site template, run against the preview
 * server in Chromium:  node tests/e2e-video.mjs <dir with clip.webm and old.avi> [screenshot dir] */
import fs from "node:fs";
import path from "node:path";
import { setup, check } from "./browser-helpers.mjs";

let mediaDir = process.argv[2];
let shots = process.argv[3];
let t = await setup();
let { page } = t;
try {
  console.log("video site");
  await page.goto("https://youtube.com/");
  await page.waitForSelector(".empty");
  check(await page.title() === "OffTube", "home page has the site title");

  await page.goto("https://youtube.com/upload.html");
  await page.setInputFiles("#files", [path.join(mediaDir, "clip.webm"), path.join(mediaDir, "old.avi")]);
  await page.waitForSelector(".upload-item:nth-child(2) .warn", { timeout: 20000 });
  check((await page.locator(".upload-item").count()) === 2, "two files queued");
  await page.locator(".upload-item").first().locator("textarea").fill("A test pattern.\nSee https://wikipedia.org/ for more.");
  await page.click("#upload-all");
  await page.waitForFunction(() => document.querySelectorAll(".upload-item a[href^='watch.html']").length === 2, null, { timeout: 120000 });
  check(true, "both uploads finished (AVI converted)");

  let videosDir = fs.readdirSync(t.root).map(d => path.join(t.root, d, "videos")).find(p => fs.existsSync(p));
  let ids = fs.readdirSync(videosDir);
  check(ids.length === 2, "two video folders on disk");
  for (let id of ids) {
    let files = fs.readdirSync(path.join(videosDir, id));
    check(["title.txt", "description.txt", "created.txt", "info.json"].every(f => files.includes(f)), `video ${id} has title, description and creation date files: ${files.join(", ")}`);
  }
  let aviId = ids.find(id => fs.readdirSync(path.join(videosDir, id)).includes("video.avi"));
  let aviInfo = JSON.parse(fs.readFileSync(path.join(videosDir, aviId, "info.json"), "utf8"));
  check(aviInfo.converted && fs.existsSync(path.join(videosDir, aviId, aviInfo.converted)), `AVI was converted to ${aviInfo.converted}`);

  await page.goto("https://youtube.com/");
  await page.waitForSelector(".grid .card");
  check((await page.locator(".grid .card").count()) === 2, "home page lists both videos");
  if (shots) await page.screenshot({ path: path.join(shots, "video-home.png") });

  await page.locator(".grid .card").first().click();
  await page.waitForSelector("#player video");
  await page.waitForFunction(() => { let v = document.querySelector("#player video"); return v && v.readyState >= 2; }, null, { timeout: 20000 });
  check(true, "watch page plays the video");
  await page.goto(`https://youtube.com/watch.html?v=${aviId}`);
  await page.waitForFunction(() => { let v = document.querySelector("#player video"); return v && v.readyState >= 2; }, null, { timeout: 20000 });
  check(await page.evaluate(() => /\.offox\./.test(document.querySelector("#player video").src)), "converted AVI plays");
  await page.waitForTimeout(3500);
  if (shots) await page.screenshot({ path: path.join(shots, "video-watch.png") });

  // Range requests are served in chunks with 206.
  let r = await page.evaluate(async id => {
    let res = await fetch(`/videos/${id}/video.avi`, { headers: { Range: "bytes=10-19" } });
    return { status: res.status, range: res.headers.get("content-range"), len: (await res.arrayBuffer()).byteLength };
  }, aviId);
  check(r.status === 206 && r.len === 10 && /^bytes 10-19\//.test(r.range), "range requests return 206");

  // Playlist
  await page.goto("https://youtube.com/playlists.html");
  await page.click("#new");
  await page.fill("dialog input[name=name]", "Favourites");
  await page.click("dialog button.primary");
  await page.waitForURL(/playlist\.html/);
  await page.goto(`https://youtube.com/watch.html?v=${aviId}`);
  await page.click("text=≡+ Save");
  await page.check("dialog .saveto input");
  await page.waitForTimeout(500);
  await page.click("dialog button.primary");
  let plDir = path.join(path.dirname(videosDir), "playlists");
  let pl = JSON.parse(fs.readFileSync(path.join(plDir, fs.readdirSync(plDir)[0]), "utf8"));
  check(pl.name === "Favourites" && pl.videos.includes(aviId), "video saved to playlist file");
  await page.goto(`https://youtube.com/playlist.html?id=${pl.id}`);
  await page.waitForSelector(".list-row");
  if (shots) await page.screenshot({ path: path.join(shots, "video-playlist.png") });

  // Security: another site may not write here
  await page.evaluate(() =>
    fetch("https://software.store/__offox/api/write?path=x.txt", { method: "POST", body: "x", mode: "no-cors" }).catch(() => {}));
  await page.waitForTimeout(300);
  check(!fs.readdirSync(t.root).some(d => fs.existsSync(path.join(t.root, d, "x.txt"))), "cross-site write was refused");

  // FireLine finds the video by its description
  await page.goto("https://fireline.offox/search?q=test+pattern");
  await page.waitForSelector(".result");
  check((await page.locator(".result h3").first().innerText()).length > 0, "FireLine finds the video");
  if (shots) await page.screenshot({ path: path.join(shots, "fireline-results.png") });
  check(t.errors.length === 0, "no page errors " + t.errors.join(" | "));
} catch (e) {
  console.error("Page errors:", t.errors);
  throw e;
} finally {
  await t.close();
}
