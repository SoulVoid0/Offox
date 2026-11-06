/* Software Store – shared code.
 * apps/<id>/app.json      {id, name, version, publisher, category, platforms[], license,
 *                          homepage, description (Markdown), created, updated, icon,
 *                          files: [{name, platform, note}], screenshots: [names]}
 * apps/<id>/files/...     installers, archives, portable programs
 * apps/<id>/icon.*        app icon, apps/<id>/screenshots/... screenshots */
"use strict";

const SITE_TITLE = "{{SITE_TITLE}}";
const CATEGORIES = ["Productivity", "Internet", "Multimedia", "Graphics", "Development", "Games", "Education", "Utilities", "System", "Drivers", "Security", "Other"];
const PLATFORMS = ["Windows", "Linux", "macOS", "Android", "Any"];
const CATEGORY_ICON = { Productivity: "📝", Internet: "🌐", Multimedia: "🎬", Graphics: "🎨", Development: "🛠", Games: "🎮", Education: "🎓", Utilities: "🧰", System: "⚙️", Drivers: "🔌", Security: "🔒", Other: "📦" };
const PLATFORM_SHORT = { Windows: "WIN", Linux: "LINUX", macOS: "MAC", Android: "ANDROID", Any: "ANY OS" };
// Background tints for apps without screenshots, picked from the app id so
// every app keeps the same colour.
const CAPSULE_TINTS = [["#2a475e", "#1b2838"], ["#3d4f2a", "#1c2a14"], ["#4b2f57", "#22152a"], ["#5a3a20", "#2a1a0e"], ["#1f4d57", "#0f262b"], ["#552626", "#2a1212"]];

const Store = {
  async apps() {
    let items = await Offox.collect("apps", ["app.json"]);
    let apps = [];
    for (let item of items) {
      let app;
      try { app = JSON.parse(item.files["app.json"] || "null"); } catch (e) {}
      if (!app) continue;
      app.id = item.name;
      app.files = app.files || [];
      app.platforms = app.platforms || [];
      app.screenshots = app.screenshots || [];
      apps.push(app);
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name));
  },
  iconUrl(app) {
    return app.icon ? Offox.url(`apps/${app.id}/${app.icon}`) : null;
  },
  shotUrl(app, name) {
    return Offox.url(`apps/${app.id}/screenshots/${name}`);
  },
  iconNode(app) {
    return h("div", { class: "icon" }, app.icon ? h("img", { src: Store.iconUrl(app), alt: "" }) : CATEGORY_ICON[app.category] || "📦");
  },
  tint(app) {
    let n = 0;
    for (let c of app.id || "") n = (n * 31 + c.charCodeAt(0)) >>> 0;
    let [a, b] = CAPSULE_TINTS[n % CAPSULE_TINTS.length];
    return `linear-gradient(135deg, ${a}, ${b})`;
  },
  /** Wide header image: first screenshot, or the icon on a tinted background. */
  capsule(app, { shot = app.screenshots[0], cls = "capsule" } = {}) {
    if (shot) return h("div", { class: cls }, h("img", { src: Store.shotUrl(app, shot), alt: "" }));
    return h("div", { class: cls + " generated", style: { background: Store.tint(app) } },
      Store.iconNode(app),
      h("span", { class: "capsule-name" }, app.name));
  },
  platformIcons(app) {
    let list = app.platforms.length ? app.platforms : [];
    return h("span", { class: "platforms" }, list.map(p => h("span", { class: "plat", title: p }, PLATFORM_SHORT[p] || p)));
  },
  /** Steam-like price block: version in the green "discount" box, licence as the price. */
  priceBlock(app) {
    return h("div", { class: "price-block" },
      app.version ? h("div", { class: "ver" }, "v" + app.version) : null,
      h("div", { class: "price" }, app.license || "Download"));
  },
  tags(app, limit = 4) {
    let tags = [app.category, ...app.platforms.filter(p => p !== "Any")].filter(Boolean).slice(0, limit);
    return h("div", { class: "tags" }, tags.map(t => h("span", { class: "tag" }, t)));
  },
  card(app) {
    return h("a", { class: "app-card", href: `app.html?id=${encodeURIComponent(app.id)}` },
      Store.capsule(app),
      h("div", { class: "card-body" },
        h("h3", {}, app.name),
        h("div", { class: "meta" }, [app.publisher, app.updated && "Updated " + formatDate(app.updated)].filter(Boolean).join(" · ")),
        Store.tags(app),
        h("div", { class: "card-foot" }, Store.platformIcons(app), Store.priceBlock(app))));
  },
  /** Global header plus the blue store navigation bar. */
  layout(active = "store") {
    let main = document.getElementById("main");
    let link = (key, href, text) => h("a", { href, class: active === key ? "active" : null }, text);
    let categories = h("div", { class: "menu" },
      h("button", { type: "button", class: "menu-title", "aria-haspopup": "true" }, "Categories"),
      h("div", { class: "menu-pop" },
        h("div", { class: "menu-head" }, "Browse by category"),
        h("div", { class: "menu-cols" }, CATEGORIES.map(c => h("a", { href: `./?category=${encodeURIComponent(c)}#browse` }, `${CATEGORY_ICON[c]} ${c}`))),
        h("div", { class: "menu-head" }, "Browse by platform"),
        h("div", { class: "menu-cols" }, PLATFORMS.filter(p => p !== "Any").map(p => h("a", { href: `./?platform=${encodeURIComponent(p)}#browse` }, p)))));
    document.body.prepend(
      h("header", { class: "global" }, h("div", { class: "inner" },
        h("a", { class: "brand", href: "./" }, h("span", { class: "logo" }, "⬇"), SITE_TITLE),
        h("nav", { class: "global-nav" },
          link("store", "./", "Store"),
          link("new", "./?tab=new#browse", "New"),
          link("add", "edit.html", "Add software"),
          h("a", { href: "https://fireline.offox/" }, "FireLine")))),
      h("div", { class: "store-nav-wrap" }, h("div", { class: "store-nav" },
        h("a", { class: "tab", href: "./" }, "Your Store"),
        categories,
        h("a", { class: "tab", href: "./?tab=new#browse" }, "New & Noteworthy"),
        h("a", { class: "tab", href: "./?tab=updated#browse" }, "Recently Updated"),
        h("a", { class: "tab", href: "edit.html" }, "＋ Add software"),
        h("form", { class: "search", action: "./" },
          h("input", { name: "q", placeholder: "search", value: param("q") || "", "aria-label": "Search" }),
          h("button", { type: "submit", "aria-label": "Search" }, "🔍")))));
    main.classList.add("wrap");
  },
};
