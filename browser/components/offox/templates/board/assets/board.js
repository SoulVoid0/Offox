/* Notes board – a Reddit-style site.
 *   posts/<id>/post.json      {title, body (Markdown), community, flair, created, edited, score, pinned, media: [file]}
 *   posts/<id>/comments.json  [{id, parent, body, created, edited, score}]
 *   posts/<id>/<media files>  pictures, GIFs and videos attached to the post
 *   communities.json          [{name, description, created}]
 * Votes are a single score per post or comment; this browser remembers which
 * way you voted (localStorage) so a second click takes the vote back. */
"use strict";
const SITE_TITLE = "{{SITE_TITLE}}";
const SITE_DESCRIPTION = "{{SITE_DESCRIPTION}}";
const MEDIA_EXT = [...IMAGE_EXT, ...VIDEO_EXT];

const Board = {
  async posts() {
    let items = await Offox.collect("posts", ["post.json", "comments.json"]);
    return items.map(item => {
      let meta = {};
      let comments = [];
      try { meta = JSON.parse(item.files["post.json"] || "{}"); } catch (e) {}
      try { comments = JSON.parse(item.files["comments.json"] || "[]"); } catch (e) {}
      return Board.normalize(item.name, meta, comments, item.entries);
    }).filter(p => p.title);
  },

  async post(id) {
    let meta = await Offox.readJSON(`posts/${id}/post.json`, null);
    if (!meta) return null;
    let comments = await Offox.readJSON(`posts/${id}/comments.json`, []);
    let entries = await Offox.list(`posts/${id}`);
    return Board.normalize(id, meta, comments, entries);
  },

  normalize(id, meta, comments, entries) {
    let files = new Set(entries.filter(e => e.type === "file").map(e => e.name));
    let media = (meta.media || []).filter(name => files.has(name));
    return {
      id,
      title: String(meta.title || ""),
      body: String(meta.body || ""),
      community: Board.cleanCommunity(meta.community) || "general",
      flair: String(meta.flair || ""),
      created: meta.created || new Date().toISOString(),
      edited: meta.edited || null,
      score: Number(meta.score) || 0,
      pinned: !!meta.pinned,
      media,
      comments: Array.isArray(comments) ? comments : [],
      meta,
    };
  },

  async savePost(id, meta) {
    await Offox.writeJSON(`posts/${id}/post.json`, meta);
  },

  async saveComments(id, comments) {
    await Offox.writeJSON(`posts/${id}/comments.json`, comments);
  },

  async communities(posts) {
    let saved = await Offox.readJSON("communities.json", []);
    let map = new Map();
    for (let c of Array.isArray(saved) ? saved : []) {
      let name = Board.cleanCommunity(c.name);
      if (name) map.set(name, { name, description: c.description || "", count: 0 });
    }
    for (let p of posts || []) {
      if (!map.has(p.community)) map.set(p.community, { name: p.community, description: "", count: 0 });
      map.get(p.community).count++;
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  },

  async addCommunity(name, description) {
    name = Board.cleanCommunity(name);
    if (!name) throw new Error("Community names can use letters, numbers, - and _.");
    let saved = await Offox.readJSON("communities.json", []);
    if (!Array.isArray(saved)) saved = [];
    if (!saved.some(c => Board.cleanCommunity(c.name) === name)) {
      saved.push({ name, description: description || "", created: new Date().toISOString() });
      await Offox.writeJSON("communities.json", saved);
    }
    return name;
  },

  cleanCommunity(name) {
    return String(name || "").trim().replace(/^r\//i, "").replace(/[^\p{L}\p{N}_-]+/gu, "").slice(0, 40).toLowerCase();
  },

  /** Reddit's "hot" ranking: votes count logarithmically, newer posts rank higher. */
  hot(post) {
    let order = Math.log10(Math.max(Math.abs(post.score), 1)) * Math.sign(post.score);
    let seconds = new Date(post.created).getTime() / 1000 - 1700000000;
    return order + seconds / 45000;
  },

  sort(posts, how) {
    let list = [...posts];
    let by = {
      hot: (a, b) => Board.hot(b) - Board.hot(a),
      new: (a, b) => new Date(b.created) - new Date(a.created),
      old: (a, b) => new Date(a.created) - new Date(b.created),
      top: (a, b) => b.score - a.score || new Date(b.created) - new Date(a.created),
      comments: (a, b) => b.comments.length - a.comments.length,
    }[how] || ((a, b) => Board.hot(b) - Board.hot(a));
    list.sort((a, b) => (b.pinned - a.pinned) || by(a, b));
    return list;
  },

  // ------------------------------------------------------------------ votes

  myVote(key) {
    try { return Number(localStorage.getItem("vote:" + key)) || 0; } catch (e) { return 0; }
  },

  setMyVote(key, value) {
    try {
      if (value) localStorage.setItem("vote:" + key, String(value));
      else localStorage.removeItem("vote:" + key);
    } catch (e) {}
  },

  /** Applies an up (1) or down (-1) click; returns the change to the score. */
  vote(key, direction) {
    let current = Board.myVote(key);
    let next = current === direction ? 0 : direction;
    Board.setMyVote(key, next);
    return next - current;
  },

  voteBox(key, score, onChange, { horizontal = false } = {}) {
    let mine = Board.myVote(key);
    let label = h("span", { class: "score" }, Board.formatScore(score));
    let up = h("button", { class: "vote up" + (mine === 1 ? " on" : ""), title: "Upvote", "aria-label": "Upvote" }, "▲");
    let down = h("button", { class: "vote down" + (mine === -1 ? " on" : ""), title: "Downvote", "aria-label": "Downvote" }, "▼");
    let click = direction => async e => {
      e.preventDefault();
      e.stopPropagation();
      let delta = Board.vote(key, direction);
      score += delta;
      let now = Board.myVote(key);
      up.classList.toggle("on", now === 1);
      down.classList.toggle("on", now === -1);
      label.textContent = Board.formatScore(score);
      try { await onChange(delta); } catch (err) { toast(err.message); }
    };
    up.addEventListener("click", click(1));
    down.addEventListener("click", click(-1));
    return h("div", { class: horizontal ? "votes row" : "votes" }, up, label, down);
  },

  formatScore(n) {
    return Math.abs(n) >= 10000 ? (n / 1000).toFixed(0) + "k" : Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  },

  // ------------------------------------------------------------------ media

  mediaUrl(postId, name) {
    return Offox.url(`posts/${postId}/${name}`);
  },

  isVideo(name) {
    return VIDEO_EXT.includes(extOf(name));
  },

  mediaNode(postId, name, { thumb = false } = {}) {
    let src = Board.mediaUrl(postId, name);
    if (Board.isVideo(name)) {
      return thumb
        ? h("video", { src, muted: true, preload: "metadata", class: "media" })
        : h("video", { src, controls: true, preload: "metadata", class: "media" });
    }
    return h("img", { src, alt: name, loading: "lazy", class: "media" });
  },

  /** Copies picked, dropped or pasted files into the post folder. */
  async addMedia(postId, files, onProgress) {
    let added = [];
    for (let file of files) {
      let ext = extOf(file.name) || (file.type.split("/")[1] || "").replace("jpeg", "jpg");
      if (!MEDIA_EXT.includes(ext)) {
        toast(`${file.name || "That file"} is not a picture, GIF or video.`);
        continue;
      }
      let base = slugify((file.name || "pasted").replace(/\.[^.]+$/, "")).slice(0, 60);
      let name = `${Date.now().toString(36)}-${base}.${ext}`;
      await Offox.upload(`posts/${postId}/${name}`, file, {
        onProgress: p => onProgress && onProgress(file, p),
      });
      added.push(name);
    }
    return added;
  },

  // ----------------------------------------------------------------- layout

  header(active) {
    let search = h("form", { class: "search", action: "./", method: "get" },
      h("input", { name: "q", placeholder: `Search ${SITE_TITLE}`, value: param("q") || "", "aria-label": "Search" }));
    document.body.prepend(h("header", { class: "top" },
      h("a", { class: "brand", href: "./" }, h("span", { class: "logo" }, "📌"), SITE_TITLE),
      search,
      h("a", { class: "btn primary", href: "submit.html" + (active ? `?c=${encodeURIComponent(active)}` : "") }, "＋ Create post")));
  },

  postCard(p) {
    let url = `post.html?id=${encodeURIComponent(p.id)}`;
    let first = p.media[0];
    let text = p.body.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[#*_>`~\[\]]/g, "").trim();
    let card = h("article", { class: "card" + (p.pinned ? " pinned" : "") },
      Board.voteBox("p:" + p.id, p.score, delta => Board.bump(p, delta)),
      h("div", { class: "content" },
        h("div", { class: "meta" },
          h("a", { class: "community", href: `./?c=${encodeURIComponent(p.community)}` }, "r/" + p.community),
          " · ", h("span", { title: new Date(p.created).toLocaleString() }, timeAgo(p.created)),
          p.pinned ? h("span", { class: "pin" }, " · 📌 pinned") : null),
        h("h2", {}, h("a", { href: url }, p.title), p.flair ? h("span", { class: "flair" }, p.flair) : null),
        first ? h("a", { class: "preview", href: url },
          Board.mediaNode(p.id, first, { thumb: true }),
          p.media.length > 1 ? h("span", { class: "count" }, `1 / ${p.media.length}`) : null) : null,
        !first && text ? h("p", { class: "snippet" }, text.slice(0, 300) + (text.length > 300 ? "…" : "")) : null,
        h("div", { class: "actions" },
          h("a", { href: url + "#comments" }, "💬 ", plural(p.comments.length, "comment")),
          h("a", { href: `submit.html?id=${encodeURIComponent(p.id)}` }, "✏ Edit"))));
    return card;
  },

  async bump(post, delta) {
    let meta = await Offox.readJSON(`posts/${post.id}/post.json`, post.meta);
    meta.score = (Number(meta.score) || 0) + delta;
    post.score = meta.score;
    await Board.savePost(post.id, meta);
  },

  sidebar(communities, active, info) {
    let current = communities.find(c => c.name === active);
    return h("aside", { class: "side" },
      h("section", { class: "box" },
        h("h3", {}, current ? "r/" + current.name : SITE_TITLE),
        h("p", {}, current ? (current.description || "A community on " + SITE_TITLE + ".") : (SITE_DESCRIPTION || "Your notes, pictures and GIFs.")),
        info ? h("p", { class: "muted" }, info) : null,
        h("a", { class: "btn primary block", href: "submit.html" + (active ? `?c=${encodeURIComponent(active)}` : "") }, "Create post")),
      h("section", { class: "box" },
        h("h3", {}, "Communities"),
        h("ul", { class: "communities" },
          h("li", {}, h("a", { href: "./", class: active ? "" : "active" }, "🏠 Home")),
          communities.map(c => h("li", {}, h("a", { href: `./?c=${encodeURIComponent(c.name)}`, class: c.name === active ? "active" : "" }, "r/" + c.name), h("span", { class: "muted" }, c.count)))),
        h("button", { class: "btn block", onclick: async () => {
          let data = await dialogForm("New community", [
            { name: "name", label: "Name (letters, numbers, - and _)", required: true },
            { name: "description", label: "Description", type: "textarea", rows: 3 },
          ], { submit: "Create" });
          if (!data) return;
          try {
            let name = await Board.addCommunity(data.name, data.description);
            location.href = `./?c=${encodeURIComponent(name)}`;
          } catch (e) { toast(e.message); }
        } }, "＋ New community")));
  },

  renderMarkdown(text, postId) {
    let rendered = Markdown.render(text || "").html;
    let div = h("div", { class: "md", html: rendered });
    // ![](picture.gif) with a bare file name refers to a file of this post.
    for (let img of div.querySelectorAll("img")) {
      let src = img.getAttribute("src") || "";
      if (postId && src && !/^[a-z]+:|^\//i.test(src)) img.src = Board.mediaUrl(postId, decodeURIComponent(src));
    }
    return div;
  },
};
