/* End-to-end tests for the other site templates (preview server + Chromium):
 *   node tests/e2e-sites.mjs <media dir> [screenshot dir]
 * The media dir must contain "Test Artist - Test Song.mp3", photo.png, story.txt and setup.exe. */
import fs from "node:fs";
import path from "node:path";
import { setup, check } from "./browser-helpers.mjs";

let mediaDir = process.argv[2];
let shots = process.argv[3];
let t = await setup();
let { page, server } = t;
let shot = async name => shots && page.screenshot({ path: path.join(shots, name + ".png") });
let siteDir = domain => server.registry.lookup(domain).dir;
try {
  for (let [template, domain] of [["blog", "journal.blog"], ["photos", "photos.gallery"], ["music", "music.player"], ["library", "library.books"], ["drive", "drive.files"], ["blank", "my-site.home"]]) {
    await server.registry.createSite({ root: t.root, domain, template });
  }
  check(server.registry.list().length === 13, "default sites plus six template sites exist");

  // FireLine home lists sites
  await page.goto("https://fireline.offox/");
  await page.waitForSelector(".site");
  check((await page.locator(".site").count()) === 13, "FireLine home lists every website");
  await shot("fireline-home");

  // Unknown site
  let res = await page.goto("https://not-a-site.example/");
  check(res.status() === 404 && (await page.content()).includes("not one of your websites"), "unknown address shows the offline page");

  // Wiki
  console.log("wiki");
  await page.goto("https://wikipedia.org/");
  await page.waitForSelector(".content h1");
  check((await page.locator("a.wikilink.new").count()) === 0, "main page wiki links point to existing pages");
  await shot("wiki-main");
  await page.goto("https://wikipedia.org/wiki.html?page=Solar_system&action=edit");
  await page.fill("textarea", "# Solar system\n\nThe **Sun** and its planets. See [[Offox]].\n\n## Planets\n\n- Mercury\n- Venus\n\n## Moons\n\nMany.\n\n## History\n\nOld.");
  await page.fill("input[placeholder^=Summary]", "first version");
  await page.click("text=Save changes");
  await page.waitForSelector(".toc");
  check(fs.existsSync(path.join(siteDir("wikipedia.org"), "articles", "Solar_system.md")), "new article saved as Markdown file");
  await page.goto("https://wikipedia.org/special.html?p=search&q=planets&fulltext=1");
  await page.waitForSelector("text=Solar system");
  check(true, "wiki search finds the article");

  // Software store
  console.log("software");
  await page.goto("https://software.store/edit.html");
  await page.fill("input[name=name]", "Test App");
  await page.fill("input[name=version]", "2.1");
  await page.check("input[value=Windows]");
  await page.fill("textarea[name=description]", "A **great** app.");
  await page.setInputFiles("input[name=files]", path.join(mediaDir, "setup.exe"));
  await page.setInputFiles("input[name=icon]", path.join(mediaDir, "photo.png"));
  await page.click("#save");
  await page.waitForURL(/app\.html/);
  await page.waitForSelector(".download");
  let [download] = await Promise.all([page.waitForEvent("download"), page.click(".download a.btn")]);
  check((await download.suggestedFilename()) === "setup.exe", "software download works");
  await shot("software-app");
  await page.goto("https://software.store/");
  await page.waitForSelector(".app-card");
  await shot("software-home");

  // Docs
  console.log("docs");
  await page.goto("https://docs.offox/");
  await page.click(".tpl >> nth=0");
  await page.waitForURL(/doc\.html/);
  await page.click("#page");
  await page.keyboard.type("Hello offline world");
  await page.fill("#title", "My first doc");
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("saved"), null, { timeout: 10000 });
  let docDir = path.join(siteDir("docs.offox"), "documents");
  let docId = fs.readdirSync(docDir)[0];
  check(fs.readFileSync(path.join(docDir, docId, "document.html"), "utf8").includes("Hello offline world"), "document text saved to disk");
  check(JSON.parse(fs.readFileSync(path.join(docDir, docId, "meta.json"), "utf8")).title === "My first doc", "document title saved");
  await page.keyboard.press("Control+a");
  await page.click("button[title^=Bold]");
  await shot("docs-editor");

  // Sheets
  console.log("sheets");
  await page.goto("https://sheets.offox/");
  await page.click(".new-card >> text=Budget");
  await page.waitForURL(/sheet\.html/);
  await page.waitForSelector("table.grid td");
  let cell = (r, c) => page.locator(`table.grid td[data-r="${r}"][data-c="${c}"]`);
  check((await cell(6, 2).innerText()) === "1570", "budget template computes =SUM(B2:B5)");
  await cell(2, 2).click();
  await page.keyboard.type("1000");
  await page.keyboard.press("Enter");
  check((await cell(6, 2).innerText()) === "1670", "editing a cell recalculates dependent formulas");
  await cell(8, 1).click();
  await page.keyboard.type("=AVERAGE(C2:C5)");
  await page.keyboard.press("Enter");
  check((await cell(8, 1).innerText()) === "371.875", "typed formula evaluates");
  await cell(1, 1).click();
  await cell(5, 2).click({ modifiers: ["Shift"] });
  await page.click("text=📊 Chart");
  await page.waitForSelector(".chart canvas");
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("saved"), null, { timeout: 10000 });
  await shot("sheets-editor");

  // Slides
  console.log("slides");
  await page.goto("https://slides.offox/");
  await page.click("#new .deck-card >> nth=2");
  await page.waitForURL(/deck\.html/);
  await page.waitForSelector(".editing .el.text");
  await page.dblclick(".editing .el.text >> nth=0");
  await page.keyboard.type("Offline Presentation");
  await page.click(".stage-wrap", { position: { x: 5, y: 5 } });
  await page.selectOption("select[title='New slide with layout']", "content");
  await page.waitForFunction(() => document.querySelectorAll(".strip .item").length === 2);
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("saved"), null, { timeout: 10000 });
  let deckDir = path.join(siteDir("slides.offox"), "presentations");
  let deck = JSON.parse(fs.readFileSync(path.join(deckDir, fs.readdirSync(deckDir)[0], "deck.json"), "utf8"));
  check(deck.slides.length === 2 && deck.slides[0].elements[0].html.includes("Offline Presentation"), "slides saved with typed title");
  await page.click(".strip .item >> nth=0");
  await shot("slides-editor");

  // Blog
  console.log("blog");
  await page.goto("https://journal.blog/write.html");
  await page.fill("#title", "First day offline");
  await page.fill("#body", "Today I used **Offox**.");
  await page.click("#save");
  await page.waitForURL(/post\.html/);
  await page.waitForSelector("article strong");
  check(true, "blog post published and rendered");

  // Photos
  console.log("photos");
  await page.goto("https://photos.gallery/");
  await page.click("text=＋ New album");
  await page.fill("dialog input[name=name]", "Holiday");
  await page.click("dialog button.primary");
  await page.waitForURL(/album\.html/);
  await page.setInputFiles("label.btn input[type=file]", path.join(mediaDir, "photo.png"));
  await page.waitForSelector(".photo img");
  await page.click(".photo");
  await page.waitForSelector(".viewer img");
  check(true, "photo uploaded and opens in the viewer");
  await page.keyboard.press("Escape");

  // Music
  console.log("music");
  await page.goto("https://music.player/");
  await page.click("text=⬆ Add music");
  await page.setInputFiles(".drop input", path.join(mediaDir, "Test Artist - Test Song.mp3"));
  await page.waitForSelector("text=Songs added", { timeout: 20000 });
  await page.click("nav.side >> text=Songs");
  await page.waitForSelector("tr.track");
  check((await page.locator("tr.track td:nth-child(3)").innerText()) === "Test Artist", "artist parsed from file name");
  await page.click("tr.track button[title=Play]");
  await page.waitForFunction(() => !document.getElementById("audio").paused || document.getElementById("audio").currentTime > 0, null, { timeout: 10000 });
  check(true, "song plays");
  await shot("music");

  // Library
  console.log("library");
  await page.goto("https://library.books/edit.html");
  await page.setInputFiles("input[name=files]", path.join(mediaDir, "story.txt"));
  await page.fill("input[name=author]", "A. Writer");
  await page.click("#save");
  await page.waitForSelector(".book");
  await page.click(".book");
  await page.click("text=📖 Read");
  await page.waitForSelector("text=dark and stormy");
  check(true, "text book opens in the reader");

  // Drive
  console.log("drive");
  await page.goto("https://drive.files/");
  await page.setInputFiles("#up-files", [path.join(mediaDir, "photo.png"), path.join(mediaDir, "story.txt")]);
  await page.waitForFunction(() => document.querySelectorAll("tr.item").length === 2, null, { timeout: 10000 });
  check(fs.existsSync(path.join(siteDir("drive.files"), "files", "photo.png")), "drive upload stored in files/");
  await shot("drive");

  // Blank
  await page.goto("https://my-site.home/");
  await page.waitForFunction(() => /visited 1 time/.test(document.getElementById("count").textContent));
  check(fs.readFileSync(path.join(siteDir("my-site.home"), "visits.txt"), "utf8") === "1", "blank site writes visits.txt via the site API");

  // FireLine finds content across templates
  for (let [q, expect] of [["solar", "Solar system"], ["test app", "Test App"], ["first doc", "My first doc"], ["offline presentation", "Untitled presentation"], ["first day", "First day offline"]]) {
    let data = await page.evaluate(async q => (await fetch("https://fireline.offox/api/search?q=" + encodeURIComponent(q))).json(), q);
    check(data.results.some(r => r.title === expect), `FireLine finds “${expect}” for “${q}”`);
  }
  check(t.errors.length === 0, "no page errors " + t.errors.join(" | "));
} catch (e) {
  console.error("Page errors:", t.errors);
  if (shots) await page.screenshot({ path: path.join(shots, "failure.png") });
  throw e;
} finally {
  await t.close();
}
