/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// about:offox: storage folders, websites, creating websites from templates,
// FFmpeg and offline status. In Offox the page runs with chrome privileges
// and talks to OffoxService directly; under the developer preview server
// (dev/preview-server.mjs) the same calls go over HTTP to a Node backend.

const backend = await createBackend();

async function createBackend() {
  if (typeof ChromeUtils != "undefined") {
    let { OffoxService } = ChromeUtils.importESModule(
      "resource://offox/modules/OffoxService.sys.mjs"
    );
    return {
      call: (method, ...args) => OffoxService[method](...args),
      async pickFolder(title) {
        return pickWithFilePicker(title, Ci.nsIFilePicker.modeGetFolder);
      },
      async pickFile(title) {
        return pickWithFilePicker(title, Ci.nsIFilePicker.modeOpen);
      },
      open(url) {
        window.browsingContext.topChromeWindow.openTrustedLinkIn(url, "tab");
      },
    };
  }
  return {
    async call(method, ...args) {
      let response = await fetch("/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, args }),
      });
      let data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || response.statusText);
      }
      return data.result;
    },
    // The preview has no native dialogs: the path is typed into the field.
    pickFolder: async () => null,
    pickFile: async () => null,
    open: url => window.open(url, "_blank"),
  };
}

function pickWithFilePicker(title, mode) {
  let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  picker.init(window.browsingContext, title, mode);
  return new Promise(resolve => {
    picker.open(result => {
      resolve(result == Ci.nsIFilePicker.returnOK ? picker.file.path : null);
    });
  });
}

// ------------------------------------------------------------------ helpers

const $ = id => document.getElementById(id);

function h(tag, props = {}, ...children) {
  let el = document.createElement(tag);
  for (let [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) {
      el.addEventListener(key.slice(2), value);
    } else if (key == "class") {
      el.className = value;
    } else if (value !== false && value != null) {
      el.setAttribute(key, value === true ? "" : value);
    }
  }
  for (let child of children.flat()) {
    if (child != null && child !== false) {
      el.append(child instanceof Node ? child : String(child));
    }
  }
  return el;
}

let toastTimer;
function toast(message) {
  let el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

async function run(action, errorTarget) {
  try {
    if (errorTarget) {
      errorTarget.hidden = true;
    }
    return await action();
  } catch (e) {
    let message = e.message || String(e);
    if (errorTarget) {
      errorTarget.textContent = message;
      errorTarget.hidden = false;
    } else {
      toast(message);
    }
    return undefined;
  }
}

function plural(n, word) {
  return `${n} ${word}${n == 1 ? "" : "s"}`;
}

// -------------------------------------------------------------------- state

let state = null;
let templates = [];
let selectedTemplate = null;

async function refresh() {
  state = await backend.call("status");
  renderWelcome();
  renderRoots();
  renderSites();
  renderCreateRoots();
  renderVideo();
  renderSubtitles();
  renderOffline();
}

// ------------------------------------------------------------------ welcome

function renderWelcome() {
  let first = state.roots.length == 0;
  $("welcome").hidden = !first;
  $("welcome-default-path").textContent = state.defaultRoot;
}

async function addRoot(path) {
  path = (path || "").trim();
  if (!path) {
    toast("Choose or type a folder first.");
    return;
  }
  let created = await run(() => backend.call("addRoot", path));
  if (created === undefined) {
    return;
  }
  $("add-root-path").value = "";
  await refresh();
  toast(
    created.length
      ? `Folder added. Created ${created.map(s => s.title).join(", ")}.`
      : "Folder added."
  );
}

$("welcome-default").addEventListener("click", () => addRoot(state.defaultRoot));
$("welcome-choose").addEventListener("click", async () => {
  let path = await backend.pickFolder("Choose a storage folder for your websites");
  if (path) {
    addRoot(path);
  } else {
    $("add-root-path").focus();
    location.hash = "#storage";
  }
});

// ------------------------------------------------------------ storage roots

function renderRoots() {
  let list = $("root-list");
  list.replaceChildren();
  if (!state.roots.length) {
    list.append(h("li", { class: "empty" }, "No storage folders yet."));
  }
  state.roots.forEach((root, i) => {
    list.append(
      h(
        "li",
        {},
        h("span", { class: root.available ? "dot" : "dot bad", title: root.available ? "Available" : "Not found" }),
        h(
          "div",
          { class: "grow" },
          h("div", { class: "path" }, root.path),
          h(
            "div",
            { class: "meta" },
            root.available
              ? plural(root.siteCount, "website")
              : `Not available: ${root.error || "is the drive connected?"}`
          )
        ),
        h("button", { class: "small", title: "Move up", disabled: i == 0, onclick: () => moveRoot(root.path, -1) }, "↑"),
        h("button", { class: "small", title: "Move down", disabled: i == state.roots.length - 1, onclick: () => moveRoot(root.path, 1) }, "↓"),
        h("button", { class: "small", disabled: !root.available, onclick: () => backend.call("reveal", root.path) }, "Open folder"),
        h("button", { class: "small", onclick: () => removeRoot(root.path) }, "Remove")
      )
    );
  });
}

async function moveRoot(path, delta) {
  await run(() => backend.call("moveRoot", path, delta));
  await refresh();
}

async function removeRoot(path) {
  await run(() => backend.call("removeRoot", path));
  await refresh();
  toast("Folder removed from Offox. Its files were not deleted.");
}

$("add-root-form").addEventListener("submit", event => {
  event.preventDefault();
  addRoot($("add-root-path").value);
});
$("add-root-choose").addEventListener("click", async () => {
  let path = await backend.pickFolder("Choose a storage folder");
  if (path) {
    addRoot(path);
  } else {
    $("add-root-path").focus();
  }
});

// -------------------------------------------------------------------- sites

function templateIcon(id) {
  return templates.find(t => t.id == id)?.icon || "🌐";
}

function renderSites() {
  let list = $("site-list");
  list.replaceChildren();
  if (!state.sites.length) {
    list.append(h("p", { class: "hint" }, "No websites yet. Add a storage folder or create one below."));
  }
  for (let site of state.sites) {
    list.append(
      h(
        "div",
        { class: "card" },
        h("div", { class: "title" }, h("span", {}, templateIcon(site.template)), site.title),
        h("a", { class: "url", href: site.url, target: "_blank" }, site.url),
        h("div", { class: "desc" }, site.description || ""),
        h("div", { class: "folder" }, site.dir),
        h(
          "div",
          { class: "row" },
          h("button", { class: "small primary", onclick: () => backend.open(site.url) }, "Open"),
          h("button", { class: "small", onclick: () => editSite(site) }, "Edit"),
          h("button", { class: "small", onclick: () => backend.call("reveal", site.dir) }, "Show folder"),
          h("button", { class: "small", onclick: () => deleteSite(site) }, "Delete")
        )
      )
    );
  }
  for (let conflict of state.conflicts || []) {
    list.append(
      h(
        "p",
        { class: "bad" },
        `Two websites use https://${conflict.host}: ${conflict.ignored} is ignored because ${conflict.kept} comes first.`
      )
    );
  }
}

function editSite(site) {
  let dialog = $("edit-dialog");
  $("edit-domain").value = site.domain;
  $("edit-aliases").value = (site.aliases || []).join(", ");
  $("edit-title").value = site.title;
  $("edit-description").value = site.description || "";
  $("edit-error").hidden = true;
  let form = $("edit-form");
  form.onsubmit = async event => {
    if (event.submitter?.value != "save") {
      return;
    }
    event.preventDefault();
    let ok = await run(
      () =>
        backend.call("updateSite", site.domain, {
          domain: $("edit-domain").value,
          title: $("edit-title").value,
          description: $("edit-description").value,
          aliases: $("edit-aliases").value.split(",").map(s => s.trim()).filter(Boolean),
        }),
      $("edit-error")
    );
    if (ok) {
      dialog.close();
      await refresh();
      toast("Website saved.");
    }
  };
  dialog.showModal();
}

function deleteSite(site) {
  let dialog = $("delete-dialog");
  $("delete-folder").textContent = site.dir;
  $("delete-domain").textContent = site.domain;
  let input = $("delete-confirm");
  input.value = "";
  $("delete-button").disabled = true;
  input.oninput = () => {
    $("delete-button").disabled = input.value.trim().toLowerCase() != site.domain;
  };
  dialog.onclose = async () => {
    if (dialog.returnValue == "delete" && input.value.trim().toLowerCase() == site.domain) {
      await run(() => backend.call("deleteSite", site.domain));
      await refresh();
      toast(`${site.title} was deleted.`);
    }
  };
  dialog.returnValue = "";
  dialog.showModal();
}

// ------------------------------------------------------------------- create

function renderTemplates() {
  let list = $("template-list");
  list.replaceChildren();
  for (let tpl of templates) {
    list.append(
      h(
        "button",
        {
          class: tpl.id == selectedTemplate?.id ? "template selected" : "template",
          "data-template": tpl.id,
          onclick: () => chooseTemplate(tpl),
        },
        h("span", { class: "icon" }, tpl.icon),
        h("span", { class: "name" }, tpl.name),
        h("span", { class: "desc" }, tpl.description)
      )
    );
  }
}

function suggestDomain(tpl) {
  let taken = new Set(state.sites.flatMap(s => [s.domain, ...(s.aliases || [])]));
  let base = tpl.defaultDomain || "my-site.home";
  if (!taken.has(base)) {
    return base;
  }
  let [name, ...rest] = base.split(".");
  for (let i = 2; ; i++) {
    let candidate = [`${name}${i}`, ...rest].join(".");
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

function chooseTemplate(tpl) {
  selectedTemplate = tpl;
  renderTemplates();
  let form = $("create-form");
  form.hidden = false;
  $("create-heading").textContent = `${tpl.icon} New ${tpl.name.toLowerCase()} website`;
  $("create-domain").value = suggestDomain(tpl);
  $("create-title").value = tpl.defaultTitle || tpl.name;
  $("create-description").value = "";
  $("create-error").hidden = true;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("create-domain").select();
}

function renderCreateRoots() {
  let select = $("create-root");
  let current = select.value;
  select.replaceChildren(
    ...state.roots
      .filter(r => r.available)
      .map(r => h("option", { value: r.path }, r.path))
  );
  if (current) {
    select.value = current;
  }
}

$("create-cancel").addEventListener("click", () => {
  $("create-form").hidden = true;
  selectedTemplate = null;
  renderTemplates();
});

$("create-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!$("create-root").value) {
    $("create-error").textContent = "Add a storage folder first.";
    $("create-error").hidden = false;
    return;
  }
  let site = await run(
    () =>
      backend.call("createSite", {
        root: $("create-root").value,
        domain: $("create-domain").value,
        title: $("create-title").value,
        description: $("create-description").value,
        template: selectedTemplate.id,
      }),
    $("create-error")
  );
  if (!site) {
    return;
  }
  $("create-form").hidden = true;
  selectedTemplate = null;
  renderTemplates();
  await refresh();
  toast(`${site.title} is ready at ${site.url}`);
  backend.open(site.url);
});

// -------------------------------------------------------------------- video

function renderVideo() {
  let box = $("ffmpeg-status");
  box.replaceChildren(
    state.ffmpeg
      ? h("div", {}, h("span", { class: "ok" }, "✓ FFmpeg found: "), h("code", {}, state.ffmpeg))
      : h(
          "div",
          {},
          h("span", { class: "bad" }, "FFmpeg was not found. "),
          "Videos in AVI, WMV, FLV and other old formats can't be converted until it is installed. ",
          "On Fedora run ",
          h("code", {}, "sudo dnf install ffmpeg-free"),
          " (or ffmpeg from RPM Fusion); on Windows put ffmpeg.exe in the Offox folder or choose it below."
        )
  );
  $("ffmpeg-path").value = state.ffmpegChosen || "";
}

$("ffmpeg-form").addEventListener("submit", async event => {
  event.preventDefault();
  await run(() => backend.call("setFFmpegPath", $("ffmpeg-path").value.trim()));
  await refresh();
  toast("Saved.");
});
$("ffmpeg-choose").addEventListener("click", async () => {
  let path = await backend.pickFile("Choose the ffmpeg program");
  if (path) {
    $("ffmpeg-path").value = path;
  }
});

// ---------------------------------------------------------------- subtitles

function renderSubtitles() {
  let sp = state.speech || { available: false, models: [] };
  let box = $("whisper-status");
  box.replaceChildren(
    h(
      "div",
      {},
      sp.program
        ? [h("span", { class: "ok" }, "✓ Speech recognition program: "), h("code", {}, sp.program)]
        : [h("span", { class: "bad" }, "whisper.cpp was not found. "), "Choose its whisper-cli program below, or reinstall Offox."]
    ),
    h(
      "div",
      {},
      sp.model
        ? [h("span", { class: "ok" }, "✓ Speech model: "), h("code", {}, sp.model)]
        : [h("span", { class: "bad" }, "No speech model was found. "), "Download a ggml model (for example ggml-base.bin or ggml-small.bin from the whisper.cpp project) on another computer and choose it below."]
    ),
    h("div", {}, sp.ffmpeg ? "FFmpeg is used to read the sound of every video format." : "Without FFmpeg, Offox reads the sound of the video in the page (formats Firefox can play).")
  );
  $("whisper-path").value = state.whisperChosen || "";
  $("whisper-model").value = state.whisperModelChosen || "";
  let list = $("whisper-model-list");
  list.replaceChildren(
    h("option", { value: "" }, sp.models.length ? "Installed models…" : "No models installed"),
    ...sp.models.map(m => h("option", { value: m }, m.split(/[\\/]/).pop()))
  );
  list.hidden = !sp.models.length;
}

$("whisper-model-list").addEventListener("change", () => {
  if ($("whisper-model-list").value) {
    $("whisper-model").value = $("whisper-model-list").value;
  }
});
$("whisper-form").addEventListener("submit", async event => {
  event.preventDefault();
  await run(() => backend.call("setWhisperPath", $("whisper-path").value.trim()));
  await refresh();
  toast("Saved.");
});
$("whisper-model-form").addEventListener("submit", async event => {
  event.preventDefault();
  await run(() => backend.call("setWhisperModel", $("whisper-model").value.trim()));
  await refresh();
  toast("Saved.");
});
$("whisper-choose").addEventListener("click", async () => {
  let path = await backend.pickFile("Choose the whisper-cli program");
  if (path) {
    $("whisper-path").value = path;
  }
});
$("whisper-model-choose").addEventListener("click", async () => {
  let path = await backend.pickFile("Choose a whisper.cpp speech model (ggml-*.bin)");
  if (path) {
    $("whisper-model").value = path;
  }
});

// ------------------------------------------------------------------ offline

function renderOffline() {
  let n = state.network || {};
  let facts = [
    ["Internet", n.proxyLocked ? "Blocked (locked by Offox)" : "Blocked by Offox; network prefs are not locked in this build"],
    ["Every web address", "Answered from your storage folders"],
    ["Search engine", "FireLine (searches your websites only)"],
    ["Updates", n.updates ? "On" : "Off"],
    ["Telemetry", n.telemetry ? "On" : "Off"],
    ["WebRTC", n.webrtc ? "On" : "Off"],
    ["Installation", state.portable ? "Portable: settings are stored in the Data folder next to Offox" : state.devMode ? "Developer mode (stock Firefox with Offox loaded)" : "Normal: settings are stored in your user profile"],
    ["Offox folder", state.appDir],
  ];
  if (state.error) {
    facts.push(["Last error", state.error]);
  }
  $("offline-facts").replaceChildren(...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}

// -------------------------------------------------------------- navigation

function highlightNav() {
  let sections = [...document.querySelectorAll("main section:not([hidden])")];
  let current = sections[0]?.id;
  for (let section of sections) {
    if (section.getBoundingClientRect().top < 140) {
      current = section.id;
    }
  }
  for (let link of document.querySelectorAll(".nav nav a")) {
    link.classList.toggle("active", link.dataset.section == current);
  }
}
window.addEventListener("scroll", highlightNav, { passive: true });

// --------------------------------------------------------------------- init

try {
  templates = await backend.call("templates");
  await refresh();
} catch (e) {
  console.error(e);
  toast(`Offox could not load its settings: ${e.message || e}`);
}
renderTemplates();
highlightNav();
document.body.dataset.ready = "true";
