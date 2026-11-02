/* Offpedia – shared wiki code.
 * articles/<Page_name>.md       current text of each article (Markdown)
 * history/<Page_name>/<time>.md older revisions, history/<Page_name>/log.json edit log
 * history/recent.json           the last 300 edits of the whole wiki
 * media/<file>                  uploaded images and files */
"use strict";

const SITE_TITLE = "{{SITE_TITLE}}";
const SITE_DESCRIPTION = "{{SITE_DESCRIPTION}}";

const Wiki = {
  _articles: null,

  /** "solar system" -> "Solar_system" */
  slug(name) {
    let s = slugify(String(name).trim());
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  title(slug) { return String(slug).replace(/_/g, " "); },
  href(name, action) {
    return `wiki.html?page=${encodeURIComponent(Wiki.slug(name))}${action ? "&action=" + action : ""}`;
  },

  async articles() {
    if (!Wiki._articles) {
      let entries = await Offox.list("articles");
      Wiki._articles = entries.filter(e => e.type === "file" && e.name.endsWith(".md"))
        .map(e => ({ slug: e.name.slice(0, -3), modified: e.modified, size: e.size }));
    }
    return Wiki._articles;
  },

  async exists(slug) {
    return (await Wiki.articles()).some(a => a.slug === slug);
  },

  read(slug) { return Offox.readText(`articles/${slug}.md`, ""); },

  async save(slug, text, summary) {
    let time = new Date().toISOString();
    let old = await Wiki.read(slug);
    if (old) {
      await Offox.writeText(`history/${slug}/${time.replace(/[:.]/g, "-")}.md`, old);
    }
    await Offox.writeText(`articles/${slug}.md`, text);
    let log = await Offox.readJSON(`history/${slug}/log.json`, []);
    log.unshift({ time, summary: summary || "", size: text.length, previous: old ? time.replace(/[:.]/g, "-") : null });
    await Offox.writeJSON(`history/${slug}/log.json`, log);
    let recent = await Offox.readJSON("history/recent.json", []);
    recent.unshift({ page: slug, time, summary: summary || "", created: !old });
    await Offox.writeJSON("history/recent.json", recent.slice(0, 300));
    Wiki._articles = null;
  },

  async render(markdown) {
    let names = new Set((await Wiki.articles()).map(a => a.slug));
    return Markdown.render(markdown, {
      wikiLink: target => Wiki.href(target.split("#")[0]) + (target.includes("#") ? "#" + Markdown.slug(target.split("#")[1]) : ""),
      exists: target => names.has(Wiki.slug(target.split("#")[0])),
    });
  },

  /** Header, sidebar and tabs around <main id="main">. */
  layout({ slug, tab } = {}) {
    let main = document.getElementById("main");
    let header = h("header", { class: "header" },
      h("a", { class: "brand", href: "./" }, h("img", { src: "assets/logo.svg", alt: "" }),
        h("span", {}, h("b", {}, SITE_TITLE), h("small", {}, SITE_DESCRIPTION || "The offline encyclopedia"))),
      h("form", { action: "special.html" },
        h("input", { type: "hidden", name: "p", value: "search" }),
        h("input", { name: "q", placeholder: `Search ${SITE_TITLE}`, value: param("q") || "", "aria-label": "Search" }),
        h("button", {}, "Search")));
    let side = h("nav", { class: "side" },
      h("a", { href: "./" }, "Main page"),
      h("a", { href: "special.html?p=all" }, "All pages"),
      h("a", { href: "special.html?p=recent" }, "Recent changes"),
      h("a", { href: "special.html?p=random" }, "Random article"),
      h("h3", {}, "Contribute"),
      h("a", { href: "special.html?p=create" }, "Create a page"),
      h("a", { href: "special.html?p=upload" }, "Upload file"),
      h("a", { href: Wiki.href("Editing help") }, "Help"));
    let tabs = null;
    if (slug) {
      let link = (action, label) => h("a", { href: Wiki.href(slug, action), class: tab === (action || "read") ? "active" : "" }, label);
      tabs = h("div", { class: "tabs" },
        h("nav", {}, link("", "Article")),
        h("nav", {}, link("", "Read"), link("edit", "Edit"), link("history", "View history")));
    }
    let content = h("div", { class: "main" }, tabs);
    main.replaceWith(h("div", { class: "page" }, side, content));
    content.append(main);
    document.body.prepend(header);
  },
};
