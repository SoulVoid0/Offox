/* Library – books/<id>/ holds the document file, book.json {title, author, year, tags[], description, file, created}
 * and an optional cover image. Reading position is remembered in this browser. */
"use strict";
const SITE_TITLE = "{{SITE_TITLE}}";
const READABLE = ["txt", "md", "html", "htm"];
const Library = {
  async books() {
    let items = await Offox.collect("books", ["book.json"]);
    return items.map(item => {
      let b = {};
      try { b = JSON.parse(item.files["book.json"] || "{}"); } catch (e) {}
      let names = item.entries.filter(e => e.type === "file").map(e => e.name);
      let file = b.file && names.includes(b.file) ? b.file : names.find(n => n !== "book.json" && !/^cover\./.test(n));
      if (!file) return null;
      let cover = names.find(n => /^cover\./.test(n));
      return { ...b, id: item.name, file, cover, title: b.title || file.replace(/\.[^.]+$/, ""), author: b.author || "", tags: b.tags || [],
        created: b.created || new Date(item.modified).toISOString(), size: item.entries.find(e => e.name === file)?.size, meta: b };
    }).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
  },
  color(text) {
    let hsh = 0;
    for (let c of text) hsh = (hsh * 31 + c.charCodeAt(0)) | 0;
    return `linear-gradient(160deg, hsl(${Math.abs(hsh) % 360} 45% 38%), hsl(${(Math.abs(hsh) + 40) % 360} 50% 24%))`;
  },
  coverNode(b) {
    return h("div", { class: "cover", style: { background: Library.color(b.title + b.author) } },
      h("b", {}, b.title), h("small", {}, b.author),
      b.cover ? h("img", { src: Offox.url(`books/${b.id}/${b.cover}`), alt: "" }) : null,
      h("span", { class: "kind" }, extOf(b.file).toUpperCase()));
  },
  progress(id) {
    try { return Number(localStorage.getItem("read:" + id)) || 0; } catch (e) { return 0; }
  },
  header() {
    document.body.prepend(h("header", {}, h("a", { class: "brand", href: "./" }, "📖 " + SITE_TITLE),
      h("form", { action: "./", style: { flex: 1, display: "flex" } }, h("input", { name: "q", placeholder: "Search titles, authors, tags", value: param("q") || "" })),
      h("a", { class: "btn primary", href: "edit.html" }, "＋ Add books")));
  },
  openHref(b) {
    return READABLE.includes(extOf(b.file)) ? `read.html?id=${encodeURIComponent(b.id)}` : Offox.url(`books/${b.id}/${b.file}`);
  },
};
