/* Blog – posts/<slug>.md with front matter (title, date, tags, summary, draft). */
"use strict";
const SITE_TITLE = "{{SITE_TITLE}}";
const SITE_DESCRIPTION = "{{SITE_DESCRIPTION}}";
const Blog = {
  async posts() {
    let entries = (await Offox.list("posts")).filter(e => e.name.endsWith(".md"));
    let posts = await Promise.all(entries.map(async e => {
      let slug = e.name.slice(0, -3);
      let { data, body } = Markdown.frontMatter(await Offox.readText(`posts/${e.name}`, ""));
      return { slug, title: data.title || slug.replace(/_/g, " "), date: data.date || new Date(e.modified).toISOString(),
        tags: (data.tags || "").split(",").map(t => t.trim()).filter(Boolean), summary: data.summary || body.replace(/[#*_>`\[\]!()]/g, "").slice(0, 220), draft: data.draft === "true", body };
    }));
    return posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  },
  header() {
    document.body.prepend(h("header", { class: "site" },
      h("a", { class: "name", href: "./" }, SITE_TITLE),
      h("nav", {}, h("a", { href: "./" }, "Posts"), h("a", { href: "write.html" }, "✍ New post")),
      SITE_DESCRIPTION ? h("p", {}, SITE_DESCRIPTION) : null));
  },
};
