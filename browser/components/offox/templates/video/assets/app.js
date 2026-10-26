/* OffTube – shared code for every page of the video site.
 * Data lives in this site's folder:
 *   videos/<id>/video.<ext>     the video file (any name with a video extension works)
 *   videos/<id>/title.txt       title
 *   videos/<id>/description.txt description
 *   videos/<id>/created.txt     creation date (ISO 8601)
 *   videos/<id>/thumbnail.jpg   optional preview image
 *   videos/<id>/info.json       optional: {file, converted, originalName, duration, views}
 *   playlists/<id>.json         {id, name, description, created, videos: [ids]}
 */
"use strict";

const SITE_TITLE = "{{SITE_TITLE}}";

const OffTube = {
  /** Loads every video in videos/, newest first. */
  async videos() {
    let items = await Offox.collect("videos", ["title.txt", "description.txt", "created.txt", "info.json"]);
    let videos = [];
    for (let item of items) {
      let info = {};
      try { info = JSON.parse(item.files["info.json"] || "{}"); } catch (e) {}
      let names = item.entries.filter(e => e.type === "file").map(e => e.name);
      let original = info.file && names.includes(info.file) ? info.file : names.find(n => VIDEO_EXT.includes(extOf(n)) && !/\.offox\./.test(n)) || names.find(n => VIDEO_EXT.includes(extOf(n)));
      if (!original) continue;
      let playable = info.converted && names.includes(info.converted) ? info.converted : original;
      let created = (item.files["created.txt"] || "").trim() || new Date(item.modified).toISOString();
      videos.push({
        id: item.name,
        title: (item.files["title.txt"] || "").trim() || original.replace(/\.[^.]+$/, ""),
        description: item.files["description.txt"] || "",
        created,
        file: playable,
        original,
        converted: playable !== original,
        hasThumb: names.includes("thumbnail.jpg"),
        duration: info.duration || 0,
        views: info.views || 0,
        info,
      });
    }
    videos.sort((a, b) => new Date(b.created) - new Date(a.created));
    return videos;
  },

  videoUrl(v) { return Offox.url(`videos/${v.id}/${v.file}`); },
  thumbUrl(v) { return v.hasThumb ? Offox.url(`videos/${v.id}/thumbnail.jpg`) + "?t=" + (v.info.thumbVersion || 0) : null; },

  async playlists() {
    let entries = await Offox.list("playlists");
    let lists = [];
    for (let e of entries) {
      if (e.type !== "file" || !e.name.endsWith(".json")) continue;
      try { lists.push(await Offox.readJSON(`playlists/${e.name}`)); } catch (err) {}
    }
    lists.sort((a, b) => a.name.localeCompare(b.name));
    return lists;
  },

  savePlaylist(pl) {
    pl.updated = new Date().toISOString();
    return Offox.writeJSON(`playlists/${pl.id}.json`, pl);
  },

  async updateInfo(id, changes) {
    let info = await Offox.readJSON(`videos/${id}/info.json`, {});
    Object.assign(info, changes);
    await Offox.writeJSON(`videos/${id}/info.json`, info);
    return info;
  },

  thumbNode(v) {
    let url = OffTube.thumbUrl(v);
    return h("div", { class: "thumb" },
      url ? h("img", { src: url, alt: "", loading: "lazy" }) : h("span", { class: "placeholder" }, "▶"),
      v.duration ? h("span", { class: "duration" }, formatDuration(v.duration)) : null,
      !["mp4", "m4v", "mov", "webm", "mkv", "ogv", "3gp"].includes(extOf(v.file)) ? h("span", { class: "badge" }, extOf(v.file)) : null);
  },

  card(v, href) {
    return h("a", { class: "card", href: href || `watch.html?v=${encodeURIComponent(v.id)}` },
      OffTube.thumbNode(v),
      h("div", {},
        h("h3", { title: v.title }, v.title),
        h("div", { class: "meta" }, `${v.views ? plural(v.views, "view") + " · " : ""}${timeAgo(v.created)}`)));
  },

  compact(v, href, current) {
    return h("a", { class: "compact" + (current ? " current" : ""), href },
      OffTube.thumbNode(v),
      h("div", {}, h("h3", {}, v.title), h("div", { class: "meta" }, `${v.views ? plural(v.views, "view") + " · " : ""}${timeAgo(v.created)}`)));
  },

  /** Builds the header + sidebar around the page's <main id="main">. */
  async layout(active) {
    let main = document.getElementById("main");
    let q = param("search") || "";
    let header = h("header", { class: "topbar" },
      h("button", { class: "menu", title: "Menu", onclick: () => {
        document.body.classList.toggle(innerWidth > 1000 ? "sidebar-collapsed" : "sidebar-open");
      } }, "☰"),
      h("a", { class: "logo", href: "./" }, h("img", { src: "assets/logo.svg", alt: "" }), SITE_TITLE),
      h("form", { class: "searchbox", action: "./", role: "search" },
        h("input", { name: "search", placeholder: "Search", value: q, "aria-label": "Search videos" }),
        h("button", { title: "Search" }, "🔍")),
      h("div", { class: "actions" }, h("a", { class: "btn", href: "upload.html" }, "＋ Upload")));
    let nav = (href, icon, label, key) => h("a", { href, class: key === active ? "active" : "" }, h("span", {}, icon), label);
    let sidebar = h("nav", { class: "sidebar" },
      nav("./", "🏠", "Home", "home"),
      nav("playlists.html", "📃", "Playlists", "playlists"),
      nav("upload.html", "⬆️", "Upload", "upload"),
      h("hr"),
      h("h4", {}, "Your playlists"),
      h("div", { id: "side-playlists" }));
    let layout = h("div", { class: "layout" }, sidebar, h("div", { class: "content" }));
    main.replaceWith(layout);
    layout.querySelector(".content").append(main);
    document.body.prepend(header);
    OffTube.playlists().then(lists => {
      let box = document.getElementById("side-playlists");
      for (let pl of lists) {
        box.append(h("a", { class: "playlist-link", href: `playlist.html?id=${encodeURIComponent(pl.id)}` }, "▶  " + pl.name));
      }
      if (!lists.length) box.append(h("div", { class: "meta", style: { padding: "0 12px", color: "var(--muted)" } }, "No playlists yet"));
    });
  },

  /** Dialog to add/remove a video from playlists. */
  async saveToPlaylist(videoId) {
    let lists = await OffTube.playlists();
    return new Promise(resolve => {
      let box = h("div", { class: "saveto" },
        lists.map(pl => h("label", {},
          h("input", { type: "checkbox", checked: pl.videos.includes(videoId), onchange: async e => {
            if (e.target.checked) { if (!pl.videos.includes(videoId)) pl.videos.push(videoId); }
            else pl.videos = pl.videos.filter(x => x !== videoId);
            await OffTube.savePlaylist(pl);
            toast(e.target.checked ? `Saved to ${pl.name}` : `Removed from ${pl.name}`);
          } }), pl.name)));
      let nameInput = h("input", { placeholder: "New playlist name" });
      let dlg = h("dialog", { class: "offox-dialog" },
        h("div", { class: "offox-dialog-form" },
          h("h2", {}, "Save to…"),
          lists.length ? box : h("p", {}, "You have no playlists yet."),
          h("label", {}, "Create a new playlist", nameInput),
          h("div", { class: "offox-dialog-buttons" },
            h("button", { onclick: async () => {
              let name = nameInput.value.trim();
              if (name) {
                let pl = { id: Offox.id(8), name, description: "", created: new Date().toISOString(), videos: [videoId] };
                await OffTube.savePlaylist(pl);
                toast(`Saved to ${name}`);
              }
              dlg.close();
            }, class: "primary" }, "Done"))));
      dlg.addEventListener("close", () => { dlg.remove(); resolve(); });
      document.body.append(dlg);
      dlg.showModal();
    });
  },
};
