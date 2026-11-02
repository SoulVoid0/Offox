/* End-to-end test of the notes board (Reddit-style) template:
 *   node tests/e2e-board.mjs <media dir> [screenshot dir]
 * The media dir must contain photo.png, anim.gif and clip.webm. */
import fs from "node:fs";
import path from "node:path";
import { setup, check } from "./browser-helpers.mjs";

let mediaDir = process.argv[2];
let shots = process.argv[3];
let t = await setup();
let { page, server } = t;
let shot = async name => shots && page.screenshot({ path: path.join(shots, name + ".png"), fullPage: true });
try {
  let site = server.registry.lookup("reddit.com");
  check(site?.template === "board", "the notes board is a default website at reddit.com");
  check(server.registry.lookup("www.reddit.com") === site, "www.reddit.com is the same website");

  await page.goto("https://reddit.com/");
  await page.waitForSelector(".empty");
  check((await page.innerText(".empty h2")).includes("No posts yet"), "an empty board says so");

  // New post with a picture, a GIF and a video
  await page.click("text=Create the first post");
  await page.waitForSelector("#form");
  await page.fill("#community", "Ideas");
  await page.fill("#flair", "Plan");
  await page.fill("#title", "Garden plans for spring");
  await page.fill("#body", "Plant **tomatoes** and basil.\n\n- buy seeds\n- fix the fence");
  await page.setInputFiles("#files", [path.join(mediaDir, "photo.png"), path.join(mediaDir, "anim.gif"), path.join(mediaDir, "clip.webm")]);
  await page.waitForFunction(() => document.querySelectorAll("#thumbs figure").length === 3);
  check(true, "picture, GIF and video are added to the post");
  await page.click(".tab[data-tab=preview]");
  check((await page.innerHTML("#preview")).includes("<strong>tomatoes</strong>"), "the preview renders Markdown");
  await page.click(".tab[data-tab=write]");
  await shot("board-submit");
  await page.click("#publish");
  await page.waitForURL(/post\.html\?id=/);
  let id = new URL(page.url()).searchParams.get("id");
  let postDir = path.join(site.dir, "posts", id);
  let meta = JSON.parse(fs.readFileSync(path.join(postDir, "post.json"), "utf8"));
  check(meta.title === "Garden plans for spring" && meta.community === "ideas" && meta.media.length === 3, "post.json is saved with its community and media");
  check(meta.media.every(name => fs.existsSync(path.join(postDir, name))), "the media files are stored in the post folder");
  check(meta.media.some(name => name.endsWith(".gif")), "the GIF keeps its format");
  await page.waitForSelector(".gallery img");
  check((await page.innerText(".gallery .count")) === "1 / 3", "the post shows a gallery");
  await page.click(".gallery .next");
  await page.click(".gallery .next");
  await page.waitForSelector(".gallery video");
  check(true, "the gallery plays the video");
  check((await page.innerHTML(".card.full .md")).includes("<li>buy seeds</li>"), "the post text is rendered");

  // Votes
  await page.click(".card.full .vote.up");
  await page.waitForFunction(() => document.querySelector(".card.full .score").textContent === "0");
  await page.waitForTimeout(200);
  check(JSON.parse(fs.readFileSync(path.join(postDir, "post.json"), "utf8")).score === 0, "clicking your own upvote again takes it back");
  await page.click(".card.full .vote.up");
  await page.waitForFunction(() => document.querySelector(".card.full .score").textContent === "1");

  // Comments and replies
  await page.fill("#comments > form textarea", "Do not forget the *peppers*.");
  await page.click("#comments > form button.primary");
  await page.waitForSelector(".comment");
  await page.click(".comment button:has-text('Reply')");
  await page.fill(".comment .reply-slot textarea", "Good idea!");
  await page.click(".comment .reply-slot button.primary");
  await page.waitForSelector(".comment .children .comment");
  let comments = JSON.parse(fs.readFileSync(path.join(postDir, "comments.json"), "utf8"));
  check(comments.length === 2 && comments[1].parent === comments[0].id, "comments and replies are saved in comments.json");
  check((await page.innerText("#comment-count")) === "2 comments", "the comment count is shown");
  await shot("board-post");

  // A second post as text only, in another community
  await page.goto("https://reddit.com/submit.html?c=journal");
  await page.waitForSelector("#form");
  check((await page.inputValue("#community")) === "journal", "the community comes from the page you were on");
  await page.fill("#title", "Shopping list");
  await page.fill("#body", "Milk, eggs, bread");
  await page.click("#publish");
  await page.waitForURL(/post\.html\?id=/);

  // Front page, communities, sorting and search
  await page.goto("https://reddit.com/");
  await page.waitForSelector(".card");
  check((await page.locator(".card").count()) === 2, "the front page lists every post");
  check((await page.locator(".card .preview img").count()) === 1, "the post with pictures shows a preview");
  check((await page.innerText(".communities")).includes("r/ideas") && (await page.innerText(".communities")).includes("r/journal"), "the sidebar lists the communities");
  await shot("board-home");
  await page.click(".communities a:has-text('r/journal')");
  await page.waitForSelector("h1:has-text('r/journal')");
  check((await page.locator(".card").count()) === 1, "a community shows only its posts");
  await page.goto("https://reddit.com/?q=tomatoes");
  await page.waitForSelector(".card");
  check((await page.locator(".card").count()) === 1 && (await page.innerText(".card h2")).includes("Garden"), "board search finds posts by their text");
  await page.goto("https://reddit.com/?sort=new");
  await page.waitForSelector(".card");
  check((await page.locator(".card h2").first().innerText()).includes("Shopping"), "sorting by new puts the newest post first");

  // FireLine indexes the posts
  server.fireline.invalidate();
  let results = await server.fireline.search("tomatoes");
  check(results.results.some(r => r.url === `https://reddit.com/post.html?id=${id}`), "FireLine finds the post");

  // Edit and delete
  await page.goto(`https://reddit.com/submit.html?id=${id}`);
  await page.waitForSelector("#form");
  check((await page.inputValue("#title")) === "Garden plans for spring", "editing loads the post");
  await page.fill("#title", "Garden plans");
  await page.click("#thumbs figure:nth-child(3) button[title=Remove]");
  await page.waitForFunction(() => document.querySelectorAll("#thumbs figure").length === 2);
  await page.click("#publish");
  await page.waitForURL(/post\.html\?id=/);
  meta = JSON.parse(fs.readFileSync(path.join(postDir, "post.json"), "utf8"));
  check(meta.title === "Garden plans" && meta.media.length === 2 && meta.edited, "edits are saved");
  await page.click(".card.full button:has-text('Delete')");
  await page.waitForURL(/\?c=ideas/);
  check(!fs.existsSync(postDir), "deleting a post removes its folder");

  check(t.errors.length === 0, "no page errors " + t.errors.join("; "));
  console.log("Board tests passed.");
} finally {
  await t.close();
}
