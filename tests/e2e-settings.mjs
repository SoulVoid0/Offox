/* End-to-end test of the about:offox settings page (served by the preview
 * server at https://settings.offox/ with the same calls OffoxService offers):
 *   node tests/e2e-settings.mjs [screenshot dir] */
import fs from "node:fs";
import path from "node:path";
import { setup, check } from "./browser-helpers.mjs";

let shots = process.argv[2];
let t = await setup({ noRoots: true });
let { page, server, root } = t;
let shot = async name => shots && page.screenshot({ path: path.join(shots, name + ".png"), fullPage: true });
try {
  await page.goto("https://settings.offox/");
  await page.waitForSelector("body[data-ready]");
  check(await page.isVisible("#welcome"), "first run shows the welcome panel");
  await shot("settings-welcome");

  // Add a storage folder by path -> default websites are created
  let storage = path.join(root, "My Sites");
  await page.fill("#add-root-path", storage);
  await page.click("#add-root-form button[type=submit]");
  await page.waitForFunction(() => document.querySelectorAll("#site-list .card").length === 6);
  check(!(await page.isVisible("#welcome")), "welcome panel disappears once a folder is added");
  check(fs.existsSync(path.join(storage, "offox-storage.json")), "storage folder is marked");
  let titles = await page.locator("#site-list .card .title").allInnerTexts();
  check(["OffTube", "Offpedia", "Software Store", "Docs", "Sheets", "Slides"].every(n => titles.some(x => x.includes(n))), "the six default websites are listed");
  check((await page.locator("#root-list li").innerText()).includes("6 websites"), "folder shows its website count");

  // A second folder (missing drive)
  await page.fill("#add-root-path", path.join(root, "Second"));
  await page.click("#add-root-form button[type=submit]");
  await page.waitForFunction(() => document.querySelectorAll("#root-list li").length === 2);
  fs.rmSync(path.join(root, "Second"), { recursive: true });
  await page.reload();
  await page.waitForSelector("body[data-ready]");
  check((await page.locator("#root-list li").nth(1).innerText()).includes("Not available"), "a disconnected folder is shown as not available");

  // Create a website from a template
  await page.click("button[data-template=blog]");
  check((await page.inputValue("#create-domain")) === "journal.blog", "address is suggested from the template");
  await page.fill("#create-domain", "https://travel.diary/");
  await page.fill("#create-title", "Travel diary");
  await page.fill("#create-description", "Notes from my trips");
  await shot("settings-create");
  let popup = page.context().waitForEvent("page");
  await page.click("#create-form button[type=submit]");
  let newPage = await popup;
  await newPage.waitForLoadState();
  check(newPage.url() === "https://travel.diary/", "the new website opens at its address");
  check((await newPage.title()).includes("Travel diary"), "the new website uses the chosen title");
  await newPage.close();
  check((await page.locator("#site-list .card").count()) === 7, "the new website is listed");

  // Address already in use
  await page.click("button[data-template=video]");
  await page.fill("#create-domain", "youtube.com");
  await page.click("#create-form button[type=submit]");
  await page.waitForSelector("#create-error:not([hidden])");
  check((await page.innerText("#create-error")).includes("already uses"), "a taken address is refused");
  await page.click("#create-cancel");

  // Edit
  let card = page.locator(".card", { hasText: "Travel diary" });
  await card.locator("text=Edit").click();
  await page.fill("#edit-title", "Trips");
  await page.fill("#edit-aliases", "www.travel.diary, trips.home");
  await page.click("#edit-form button[value=save]");
  await page.waitForFunction(() => [...document.querySelectorAll(".card .title")].some(e => e.textContent.includes("Trips")));
  check(server.registry.lookup("trips.home")?.title === "Trips", "edits are saved and the extra address works");
  await page.goto("https://trips.home/");
  check((await page.title()).length > 0, "the extra address opens the website");
  await page.goto("https://settings.offox/#sites");
  await page.waitForSelector("body[data-ready]");
  await shot("settings-sites");

  // Delete
  let dir = server.registry.lookup("travel.diary").dir;
  await page.locator(".card", { hasText: "Trips" }).locator("text=Delete").click();
  check(await page.isDisabled("#delete-button"), "delete needs the address typed first");
  await page.fill("#delete-confirm", "travel.diary");
  await page.click("#delete-button");
  await page.waitForFunction(() => document.querySelectorAll("#site-list .card").length === 6);
  check(!fs.existsSync(dir), "deleting removes the website folder");

  // Remove a folder (files stay)
  await page.locator("#root-list li").nth(1).locator("text=Remove").click();
  await page.waitForFunction(() => document.querySelectorAll("#root-list li").length === 1);
  check(true, "a folder can be removed from the list");
  await page.goto("https://settings.offox/#video");
  await page.waitForSelector("body[data-ready]");
  check((await page.innerText("#ffmpeg-status")).includes("FFmpeg"), "video section shows the FFmpeg status");
  check(t.errors.length === 0, "no page errors " + t.errors.join("; "));
} finally {
  await t.close();
}
