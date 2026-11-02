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
      apps.push(app);
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name));
  },
  iconNode(app) {
    return h("div", { class: "icon" }, app.icon ? h("img", { src: Offox.url(`apps/${app.id}/${app.icon}`), alt: "" }) : CATEGORY_ICON[app.category] || "📦");
  },
  card(app) {
    return h("a", { class: "app-card", href: `app.html?id=${encodeURIComponent(app.id)}` },
      Store.iconNode(app),
      h("div", {},
        h("h3", {}, app.name),
        h("div", { class: "meta" }, [app.publisher, app.version && "v" + app.version].filter(Boolean).join(" · ")),
        h("div", {}, app.category ? h("span", { class: "tag" }, app.category) : null, app.platforms.map(p => h("span", { class: "tag" }, p)))));
  },
  layout() {
    let main = document.getElementById("main");
    document.body.prepend(h("header", { class: "top" }, h("div", { class: "inner" },
      h("a", { class: "brand", href: "./" }, h("span", {}, "⬇"), SITE_TITLE),
      h("form", { action: "./" }, h("input", { name: "q", placeholder: "Search apps", value: param("q") || "", "aria-label": "Search" })),
      h("a", { class: "btn primary", href: "edit.html" }, "＋ Add software"))));
    main.classList.add("wrap");
  },
};
