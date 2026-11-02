/* Photos – albums/<id>/album.json {name, description, created, cover, captions: {file: text}} + image files. */
"use strict";
const SITE_TITLE = "{{SITE_TITLE}}";
const Photos = {
  async albums() {
    let items = await Offox.collect("albums", ["album.json"]);
    return items.map(item => {
      let meta = {};
      try { meta = JSON.parse(item.files["album.json"] || "{}"); } catch (e) {}
      let images = item.entries.filter(e => e.type === "file" && IMAGE_EXT.includes(extOf(e.name))).sort((a, b) => a.name.localeCompare(b.name));
      return { id: item.name, name: meta.name || item.name, description: meta.description || "", created: meta.created || new Date(item.modified).toISOString(),
        cover: meta.cover && images.some(i => i.name === meta.cover) ? meta.cover : images[0]?.name, captions: meta.captions || {}, images, meta };
    }).sort((a, b) => new Date(b.created) - new Date(a.created));
  },
  header(extra) {
    document.body.prepend(h("header", {}, h("a", { class: "brand", href: "./" }, "🖼", SITE_TITLE), h("div", { class: "spacer" }), extra));
  },
  /** Full-screen viewer with keyboard navigation and slideshow. */
  view(list, index, captionOf) {
    let img = h("img", { alt: "" });
    let caption = h("div", { class: "caption" });
    let timer = null;
    let show = i => {
      index = (i + list.length) % list.length;
      img.src = list[index].url;
      caption.textContent = `${index + 1} / ${list.length}  ${captionOf ? captionOf(list[index]) || "" : ""}`;
    };
    let close = () => { clearInterval(timer); document.removeEventListener("keydown", onKey); viewer.remove(); };
    let onKey = e => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") show(index + 1);
      if (e.key === "ArrowLeft") show(index - 1);
    };
    let play = h("button", { onclick: () => {
      if (timer) { clearInterval(timer); timer = null; play.textContent = "▶ Slideshow"; }
      else { timer = setInterval(() => show(index + 1), 3500); play.textContent = "⏸ Pause"; }
    } }, "▶ Slideshow");
    let viewer = h("div", { class: "viewer" },
      h("div", { class: "stage", onclick: e => { if (e.target === e.currentTarget) close(); } }, img),
      h("button", { class: "nav prev", onclick: () => show(index - 1) }, "‹"),
      h("button", { class: "nav next", onclick: () => show(index + 1) }, "›"),
      h("div", { class: "bar" }, caption, play,
        h("a", { onclick: e => (e.currentTarget.href = list[index].url + "?download"), href: "#" }, h("button", {}, "⬇")),
        h("button", { onclick: close }, "✕")));
    document.addEventListener("keydown", onKey);
    document.body.append(viewer);
    show(index);
  },
};
