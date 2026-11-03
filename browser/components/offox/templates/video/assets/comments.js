/* OffTube comments. Stored next to the video in videos/<id>/comments.json:
 *   { "version": 1, "comments": [
 *       { "id", "author", "text", "created" (ISO 8601), "likes", "liked",
 *         "parent" (null or the id of the comment it answers),
 *         "pinned", "hearted", "edited", "byUploader", "imported" } ] }
 * A comments list saved by yt-dlp (--write-comments, the "comments" array of
 * <video>.info.json) is read as well, so comments downloaded together with a
 * YouTube video show up too.
 */
"use strict";

const OffTubeComments = {
  PAGE: 40,

  file: videoId => `videos/${videoId}/comments.json`,

  /** Turns our own format or a yt-dlp comment list into comment records. */
  normalize(data) {
    let list = Array.isArray(data) ? data : Array.isArray(data?.comments) ? data.comments : [];
    let out = [];
    let seen = new Set();
    for (let c of list) {
      if (!c || typeof c !== "object") continue;
      let id = String(c.id || Offox.id(10));
      if (seen.has(id)) continue;
      seen.add(id);
      let created = c.created;
      if (!created && c.timestamp) created = new Date(c.timestamp * 1000).toISOString();
      let parent = c.parent && c.parent !== "root" ? String(c.parent) : null;
      out.push({
        id,
        author: String(c.author || c.author_id || "Anonymous").replace(/^@/, ""),
        text: String(c.text ?? ""),
        created: created || null,
        likes: Number(c.likes ?? c.like_count ?? 0) || 0,
        liked: !!c.liked,
        parent,
        pinned: !!(c.pinned ?? c.is_pinned),
        hearted: !!(c.hearted ?? c.is_favorited),
        edited: !!c.edited,
        byUploader: !!(c.byUploader ?? c.author_is_uploader),
        imported: !!(c.imported || c.like_count !== undefined || c._time_text !== undefined),
        timeText: c.timeText || c._time_text || null,
      });
    }
    // A reply whose parent is missing becomes a normal comment.
    let ids = new Set(out.map(c => c.id));
    for (let c of out) if (c.parent && !ids.has(c.parent)) c.parent = null;
    return out;
  },

  async load(videoId) {
    let data = await Offox.readJSON(OffTubeComments.file(videoId), null).catch(() => null);
    return OffTubeComments.normalize(data);
  },

  save(videoId, comments) {
    return Offox.writeJSON(OffTubeComments.file(videoId), {
      version: 1,
      updated: new Date().toISOString(),
      comments,
    });
  },

  /** Adds imported comments (e.g. from a yt-dlp .info.json) to a video. */
  async importInto(videoId, data) {
    let current = await OffTubeComments.load(videoId);
    let incoming = OffTubeComments.normalize(data).map(c => ({ ...c, imported: true }));
    let ids = new Set(current.map(c => c.id));
    let merged = current.concat(incoming.filter(c => !ids.has(c.id)));
    await OffTubeComments.save(videoId, merged);
    return merged.length - current.length;
  },

  myName() {
    try { return localStorage.getItem("offtube.name") || "You"; } catch (e) { return "You"; }
  },
  setMyName(name) {
    try { localStorage.setItem("offtube.name", name); } catch (e) {}
  },

  /** Comment text with links and clickable timestamps (1:23, 01:02:03). */
  richText(text, seek) {
    let frag = document.createDocumentFragment();
    let lines = String(text || "").split("\n");
    lines.forEach((line, i) => {
      let last = 0;
      for (let m of line.matchAll(/https?:\/\/[^\s<>"]+|\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g)) {
        frag.append(line.slice(last, m.index));
        if (m[0].startsWith("http")) {
          frag.append(h("a", { href: m[0] }, m[0]));
        } else {
          let sec = (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
          frag.append(seek ? h("a", { href: "#t=" + sec, class: "timestamp", onclick: e => { e.preventDefault(); seek(sec); } }, m[0]) : m[0]);
        }
        last = m.index + m[0].length;
      }
      frag.append(line.slice(last));
      if (i < lines.length - 1) frag.append(h("br"));
    });
    return frag;
  },

  avatar(name) {
    let hash = 0;
    for (let ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) | 0;
    let hue = Math.abs(hash) % 360;
    return h("div", { class: "avatar", style: { background: `hsl(${hue} 55% 45%)` }, "aria-hidden": "true" },
      ([...String(name).trim()][0] || "?").toUpperCase());
  },

  /**
   * Builds the comment section for a video into `container`.
   * @param {object} options  { videoId, seek(seconds) }
   */
  async mount(container, { videoId, seek }) {
    let comments = await OffTubeComments.load(videoId);
    let sort = "top";
    let shown = OffTubeComments.PAGE;
    let openReplies = new Set();
    let saving = Promise.resolve();

    let persist = () => {
      saving = saving.then(() => OffTubeComments.save(videoId, comments)).catch(e => toast("Could not save: " + e.message));
      return saving;
    };
    let byId = id => comments.find(c => c.id === id);
    let repliesOf = id => comments.filter(c => c.parent === id).sort((a, b) => new Date(a.created || 0) - new Date(b.created || 0));

    let heading = h("h2", { class: "comments-count" });
    let sortSelect = h("select", { class: "comments-sort", "aria-label": "Sort comments", onchange: e => { sort = e.target.value; render(); } },
      h("option", { value: "top" }, "Top comments"),
      h("option", { value: "new" }, "Newest first"));
    let list = h("div", { class: "comment-list" });
    let more = h("button", { class: "btn more-comments", onclick: () => { shown += OffTubeComments.PAGE; render(); } }, "Show more comments");

    function composer({ parent = null, initial = "", submitLabel = "Comment", onDone, autofocus = false } = {}) {
      let name = OffTubeComments.myName();
      let input = h("textarea", { rows: 1, placeholder: parent ? "Add a reply…" : "Add a comment…", "aria-label": parent ? "Reply" : "Comment" }, initial);
      let send = h("button", { class: "btn primary", type: "submit", disabled: !initial.trim() }, submitLabel);
      let who = h("button", { type: "button", class: "who", title: "Change the name your comments are posted with", onclick: async () => {
        let data = await dialogForm("Your name", [{ name: "name", label: "Comments are posted as", value: OffTubeComments.myName(), required: true }]);
        if (data && data.name.trim()) {
          OffTubeComments.setMyName(data.name.trim());
          for (let el of container.querySelectorAll(".composer")) {
            el.querySelector(".avatar").replaceWith(OffTubeComments.avatar(data.name.trim()));
            el.querySelector(".who").textContent = `as ${data.name.trim()}`;
          }
        }
      } }, `as ${name}`);
      let actions = h("div", { class: "composer-actions", hidden: !autofocus && !initial },
        who,
        h("span", { class: "spacer" }),
        h("button", { type: "button", class: "btn", onclick: () => { input.value = ""; actions.hidden = true; send.disabled = true; onDone?.(null); } }, "Cancel"),
        send);
      let form = h("form", { class: "composer" + (parent ? " reply" : "") },
        OffTubeComments.avatar(name),
        h("div", { class: "composer-body" }, input, actions));
      input.addEventListener("focus", () => { actions.hidden = false; });
      input.addEventListener("input", () => {
        send.disabled = !input.value.trim();
        input.style.height = "auto";
        input.style.height = input.scrollHeight + "px";
      });
      input.addEventListener("keydown", e => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && input.value.trim()) form.requestSubmit();
      });
      form.addEventListener("submit", e => {
        e.preventDefault();
        let text = input.value.trim();
        if (!text) return;
        onDone?.(text);
        input.value = "";
        send.disabled = true;
        if (!parent) actions.hidden = true;
      });
      if (autofocus) queueMicrotask(() => input.focus());
      return form;
    }

    function commentNode(c, isReply) {
      let body = h("div", { class: "comment-body" });
      let node = h("div", { class: "comment" + (isReply ? " reply" : ""), id: "comment-" + c.id }, OffTubeComments.avatar(c.author), body);
      let when = c.created ? timeAgo(c.created) : c.timeText || "";
      let like = h("button", { class: "icon-btn" + (c.liked ? " on" : ""), title: c.liked ? "Unlike" : "Like", "aria-pressed": String(c.liked), onclick: () => {
        c.liked = !c.liked;
        c.likes = Math.max(0, c.likes + (c.liked ? 1 : -1));
        persist();
        render();
      } }, "👍", c.likes ? " " + formatCount(c.likes) : "");
      let replyBox = h("div", { class: "reply-box" });
      let actions = h("div", { class: "comment-actions" },
        like,
        h("button", { class: "icon-btn", onclick: () => {
          if (replyBox.firstChild) { replyBox.replaceChildren(); return; }
          let parentId = c.parent || c.id;
          replyBox.append(composer({ parent: parentId, submitLabel: "Reply", autofocus: true, initial: isReply ? "@" + c.author + " " : "", onDone: text => {
            replyBox.replaceChildren();
            if (text === null) return;
            comments.push({ id: Offox.id(10), author: OffTubeComments.myName(), text, created: new Date().toISOString(), likes: 0, liked: false, parent: parentId, pinned: false, hearted: false, edited: false, byUploader: false, imported: false });
            openReplies.add(parentId);
            persist();
            render();
          } }));
        } }, "Reply"),
        h("button", { class: "icon-btn" + (c.hearted ? " on" : ""), title: c.hearted ? "Remove heart" : "Heart", onclick: () => { c.hearted = !c.hearted; persist(); render(); } }, c.hearted ? "❤️" : "♡"),
        h("details", { class: "comment-menu" },
          h("summary", { title: "More actions", "aria-label": "More actions" }, "⋮"),
          h("div", { class: "menu" },
            !isReply ? h("button", { onclick: () => { c.pinned = !c.pinned; persist(); render(); } }, c.pinned ? "Unpin" : "📌 Pin") : null,
            h("button", { onclick: () => {
              body.replaceChildren(composer({ initial: c.text, submitLabel: "Save", autofocus: true, onDone: text => {
                if (text !== null && text !== c.text) { c.text = text; c.edited = true; persist(); }
                render();
              } }));
            } }, "✎ Edit"),
            h("button", { class: "danger", onclick: () => {
              let n = repliesOf(c.id).length;
              if (!confirm(n ? `Delete this comment and its ${plural(n, "reply")}?` : "Delete this comment?")) return;
              let gone = new Set([c.id, ...repliesOf(c.id).map(r => r.id)]);
              comments = comments.filter(x => !gone.has(x.id));
              persist();
              render();
            } }, "🗑 Delete"))));
      body.append(...[
        c.pinned ? h("div", { class: "pinned" }, "📌 Pinned") : null,
        h("div", { class: "comment-head" },
          h("span", { class: "author" + (c.byUploader ? " uploader" : "") }, "@" + c.author),
          h("span", { class: "when" }, when + (c.edited ? " (edited)" : ""))),
        h("div", { class: "comment-text" }, OffTubeComments.richText(c.text, seek)),
        actions,
        replyBox].filter(Boolean));
      if (!isReply) {
        let replies = repliesOf(c.id);
        if (replies.length) {
          let open = openReplies.has(c.id);
          body.append(h("button", { class: "replies-toggle", "aria-expanded": String(open), onclick: () => {
            open ? openReplies.delete(c.id) : openReplies.add(c.id);
            render();
          } }, `${open ? "▴" : "▾"} ${plural(replies.length, "reply")}`));
          if (open) body.append(h("div", { class: "replies" }, replies.map(r => commentNode(r, true))));
        }
      }
      return node;
    }

    function render() {
      let top = comments.filter(c => !c.parent);
      let score = c => c.likes + repliesOf(c.id).length * 2;
      top.sort((a, b) =>
        (b.pinned - a.pinned) ||
        (sort === "top" ? score(b) - score(a) : 0) ||
        (new Date(b.created || 0) - new Date(a.created || 0)));
      heading.textContent = plural(comments.length, "Comment");
      list.replaceChildren(...top.slice(0, shown).map(c => commentNode(c, false)));
      more.hidden = top.length <= shown;
      if (!comments.length) list.append(h("p", { class: "no-comments" }, "No comments yet. Be the first to say something!"));
    }

    let mainComposer = () => composer({ onDone: text => {
      if (text === null) return;
      comments.push({ id: Offox.id(10), author: OffTubeComments.myName(), text, created: new Date().toISOString(), likes: 0, liked: false, parent: null, pinned: false, hearted: false, edited: false, byUploader: false, imported: false });
      sort = "new";
      sortSelect.value = "new";
      persist();
      render();
    } });
    let newComment = mainComposer();

    container.replaceChildren(
      h("div", { class: "comments-header" }, heading, sortSelect),
      newComment,
      list,
      more);
    render();
    return { count: () => comments.length };
  },
};

function formatCount(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
  return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
}
