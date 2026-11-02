/* Slides – presentations/<id>/deck.json {theme, slides: [{bg, notes, elements: [{type: "text"|"image"|"shape",
 *   x, y, w, h, html, size, color, align, bold, italic, font, fill, shape, src}]}]}
 * Pictures live in presentations/<id>/images/. meta.json {title, created, updated, text} feeds FireLine. */
"use strict";
const SITE_TITLE = "{{SITE_TITLE}}";
const THEMES = { light: "Light", dark: "Dark", ocean: "Ocean", sunset: "Sunset", forest: "Forest", paper: "Paper" };

const LAYOUTS = {
  title: () => [
    { type: "text", x: 80, y: 170, w: 800, h: 110, html: "", placeholder: "Click to add title", size: 54, bold: true, align: "center" },
    { type: "text", x: 160, y: 300, w: 640, h: 60, html: "", placeholder: "Click to add subtitle", size: 26, align: "center" }],
  content: () => [
    { type: "text", x: 60, y: 40, w: 840, h: 80, html: "", placeholder: "Click to add title", size: 40, bold: true },
    { type: "text", x: 60, y: 140, w: 840, h: 350, html: "", placeholder: "• Click to add text", size: 26 }],
  section: () => [{ type: "text", x: 80, y: 220, w: 800, h: 100, html: "", placeholder: "Section title", size: 48, bold: true }],
  two: () => [
    { type: "text", x: 60, y: 40, w: 840, h: 80, html: "", placeholder: "Click to add title", size: 40, bold: true },
    { type: "text", x: 60, y: 140, w: 400, h: 350, html: "", placeholder: "Left column", size: 24 },
    { type: "text", x: 500, y: 140, w: 400, h: 350, html: "", placeholder: "Right column", size: 24 }],
  blank: () => [],
};

const Slides = {
  newSlide(layout = "content") { return { bg: "", notes: "", elements: LAYOUTS[layout]() }; },

  /** Builds the DOM for one slide (960×540). */
  render(slide, deck, { dir, editable = false } = {}) {
    let root = h("div", { class: `slide theme-${deck.theme || "light"}` }, h("div", { class: "accentbar" }));
    if (slide.bg) root.style.background = slide.bg;
    slide.elements.forEach((el, i) => {
      let node = h("div", { class: `el ${el.type}${el.shape ? " " + el.shape : ""}`, "data-i": i,
        style: { left: el.x + "px", top: el.y + "px", width: el.w + "px", height: el.h + "px" } });
      if (el.type === "text") {
        node.innerHTML = el.html || "";
        Object.assign(node.style, { fontSize: (el.size || 24) + "px", color: el.color || "", textAlign: el.align || "left",
          fontWeight: el.bold ? "700" : "400", fontStyle: el.italic ? "italic" : "normal", fontFamily: el.font || "" });
        if (el.placeholder && editable) { node.classList.add("placeholder"); node.dataset.placeholder = el.placeholder; }
      } else if (el.type === "image") {
        node.append(h("img", { src: `/${dir}/images/${encodeURIComponent(el.src)}`, alt: "" }));
      } else if (el.type === "shape") {
        node.style.background = el.fill || "#4285f4";
      }
      root.append(node);
    });
    return root;
  },

  /** Wraps a slide in a box scaled to `width` pixels. */
  scaled(slide, deck, width, opts) {
    let s = Slides.render(slide, deck, opts);
    let scale = width / 960;
    s.style.transform = `scale(${scale})`;
    let box = h("div", { class: "scaler", style: { width: width + "px", height: 540 * scale + "px" } }, s);
    return box;
  },

  text(deck) {
    return deck.slides.flatMap(s => s.elements.filter(e => e.type === "text").map(e => (e.html || "").replace(/<[^>]+>/g, " "))).join(" ").replace(/\s+/g, " ").slice(0, 4000);
  },
};
