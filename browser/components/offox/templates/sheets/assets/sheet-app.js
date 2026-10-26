/* Sheets editor. Workbook file: spreadsheets/<id>/workbook.json
 *   { sheets: [{ name, rows, cols, cells: { A1: { v: "typed text or =formula", f: format, b, i, u, a: align, c: color, bg } },
 *                widths: { A: 120 }, charts: [{ type, range, title, x, y, w, h }] }] }
 * spreadsheets/<id>/meta.json { title, created, updated, text } (text is used by FireLine search). */
"use strict";

(async () => {
  const id = param("id");
  const dir = `spreadsheets/${id}`;
  let meta = await Offox.readJSON(`${dir}/meta.json`, null);
  if (!meta) { document.body.textContent = "Spreadsheet not found."; return; }
  let book = await Offox.readJSON(`${dir}/workbook.json`, { sheets: [newSheet("Sheet1")] });
  let active = 0;
  let sheet = () => book.sheets[active];
  let sel = { r: 1, c: 1, r2: 1, c2: 1 };
  let editing = null;
  let undoStack = [], redoStack = [];
  let values = new Map();

  function newSheet(name) { return { name, rows: 100, cols: 26, cells: {}, widths: {}, charts: [] }; }
  const ref = (r, c) => Formula.numToCol(c) + r;
  const rng = () => ({ r1: Math.min(sel.r, sel.r2), r2: Math.max(sel.r, sel.r2), c1: Math.min(sel.c, sel.c2), c2: Math.max(sel.c, sel.c2) });

  // ---------------------------------------------------------- calculation
  function computeAll() {
    values = new Map();
    for (let s of book.sheets) for (let key of Object.keys(s.cells)) valueOf(s, key, []);
  }
  function rawValue(cell) {
    let v = Formula.parseInput(cell.v);
    return v && typeof v === "object" && "date" in v ? v.date : v;
  }
  function valueOf(s, key, stack) {
    let k = s.name + "!" + key;
    if (values.has(k)) return values.get(k);
    let cell = s.cells[key];
    if (!cell || cell.v === undefined || cell.v === "") { values.set(k, null); return null; }
    if (typeof cell.v !== "string" || !cell.v.startsWith("=")) { let v = rawValue(cell); values.set(k, v); return v; }
    if (stack.includes(k)) return new Formula.FError("#CIRC!");
    let next = [...stack, k];
    let target = name => (name ? book.sheets.find(x => x.name.toLowerCase() === name.toLowerCase()) : s);
    let v = Formula.evaluate(cell.v.slice(1), {
      get(r, name) {
        let t = target(name);
        if (!t) throw new Formula.FError("#REF!");
        let x = valueOf(t, r, next);
        if (x instanceof Formula.FError) throw x;
        return x;
      },
      range(a, b, name) {
        let t = target(name);
        if (!t) throw new Formula.FError("#REF!");
        let p = Formula.parseRef(a) || { col: Formula.colToNum(a), row: 1 };
        let q = Formula.parseRef(b) || { col: Formula.colToNum(b), row: t.rows };
        let out = [];
        for (let r = Math.min(p.row, q.row); r <= Math.max(p.row, q.row); r++) {
          let row = [];
          for (let c = Math.min(p.col, q.col); c <= Math.max(p.col, q.col); c++) row.push(valueOf(t, ref(r, c), next));
          out.push(row);
        }
        return out;
      },
    });
    values.set(k, v);
    return v;
  }
  const display = (s, key) => {
    let v = values.get(s.name + "!" + key);
    if (v instanceof Formula.FError) return v.code;
    let cell = s.cells[key];
    let fmt = cell?.f || (cell && typeof cell.v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cell.v.trim()) ? "date" : "");
    return Formula.formatValue(v, fmt);
  };

  // ---------------------------------------------------------- rendering
  const wrap = $("#gridwrap");
  let table;
  function render() {
    computeAll();
    let s = sheet();
    let colgroup = h("colgroup", {}, h("col", { style: { width: "46px" } }),
      Array.from({ length: s.cols }, (_, i) => h("col", { style: { width: (s.widths[Formula.numToCol(i + 1)] || 100) + "px" } })));
    let head = h("tr", {}, h("th", { class: "corner", onclick: () => { sel = { r: 1, c: 1, r2: s.rows, c2: s.cols }; paintSelection(); } }),
      Array.from({ length: s.cols }, (_, i) => {
        let col = Formula.numToCol(i + 1);
        return h("th", { "data-c": i + 1, onmousedown: e => { if (e.target.classList.contains("resize")) return; sel = { r: 1, c: i + 1, r2: s.rows, c2: i + 1 }; paintSelection(); },
          oncontextmenu: e => { e.preventDefault(); colMenu(e, i + 1); } }, col, h("span", { class: "resize", onmousedown: e => startResize(e, col) }));
      }));
    let body = h("tbody", {});
    for (let r = 1; r <= s.rows; r++) {
      let tr = h("tr", {}, h("th", { "data-r": r, onmousedown: () => { sel = { r, c: 1, r2: r, c2: s.cols }; paintSelection(); }, oncontextmenu: e => { e.preventDefault(); rowMenu(e, r); } }, r));
      for (let c = 1; c <= s.cols; c++) tr.append(cellNode(s, r, c));
      body.append(tr);
    }
    table = h("table", { class: "grid" }, colgroup, h("thead", {}, head), body);
    wrap.replaceChildren(table);
    renderCharts();
    renderTabs();
    paintSelection();
  }
  function cellNode(s, r, c) {
    let key = ref(r, c);
    let cell = s.cells[key];
    let td = h("td", { "data-r": r, "data-c": c });
    fillCell(td, s, key, cell);
    return td;
  }
  function fillCell(td, s, key, cell) {
    let text = display(s, key);
    td.textContent = text;
    let v = values.get(s.name + "!" + key);
    td.className = v instanceof Formula.FError ? "err" : typeof v === "number" ? "num" : "";
    td.style.cssText = "";
    if (cell) {
      if (cell.b) td.style.fontWeight = "700";
      if (cell.i) td.style.fontStyle = "italic";
      if (cell.u) td.style.textDecoration = "underline";
      if (cell.a) td.style.textAlign = cell.a;
      if (cell.c) td.style.color = cell.c;
      if (cell.bg) td.style.background = cell.bg;
    }
  }
  function refreshValues() {
    computeAll();
    let s = sheet();
    for (let td of table.querySelectorAll("td")) {
      let key = ref(+td.dataset.r, +td.dataset.c);
      fillCell(td, s, key, s.cells[key]);
    }
    paintSelection();
    renderCharts();
  }
  function tdAt(r, c) { return table.rows[r]?.cells[c]; }
  function paintSelection() {
    table.querySelectorAll(".sel, .cur, .hl").forEach(n => n.classList.remove("sel", "cur", "hl"));
    let { r1, r2, c1, c2 } = rng();
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) tdAt(r, c)?.classList.add("sel");
    tdAt(sel.r, sel.c)?.classList.add("cur");
    for (let c = c1; c <= c2; c++) table.rows[0].cells[c]?.classList.add("hl");
    for (let r = r1; r <= r2; r++) table.rows[r]?.cells[0]?.classList.add("hl");
    let key = ref(sel.r, sel.c);
    $("#cellname").textContent = r1 === r2 && c1 === c2 ? key : `${ref(r1, c1)}:${ref(r2, c2)}`;
    if (!editing) $("#formula").value = sheet().cells[key]?.v ?? "";
    let nums = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { let v = values.get(sheet().name + "!" + ref(r, c)); if (typeof v === "number") nums.push(v); }
    $("#sum").textContent = nums.length > 1 ? `Sum: ${Formula.formatValue(nums.reduce((a, b) => a + b, 0))} · Average: ${Formula.formatValue(nums.reduce((a, b) => a + b, 0) / nums.length)} · Count: ${nums.length}` : "";
    let cell = sheet().cells[key] || {};
    $$("#toolbar [data-flag]").forEach(b => b.classList.toggle("on", !!cell[b.dataset.flag]));
    $("#fmt").value = cell.f || "";
  }
  function scrollIntoView() {
    let td = tdAt(sel.r, sel.c);
    if (!td) return;
    let w = wrap.getBoundingClientRect(), b = td.getBoundingClientRect();
    if (b.right > w.right) wrap.scrollLeft += b.right - w.right + 20;
    if (b.left < w.left + 46) wrap.scrollLeft -= w.left + 46 - b.left + 20;
    if (b.bottom > w.bottom) wrap.scrollTop += b.bottom - w.bottom + 10;
    if (b.top < w.top + 24) wrap.scrollTop -= w.top + 24 - b.top + 10;
  }

  // ---------------------------------------------------------- editing
  function snapshot() {
    undoStack.push(JSON.stringify(book));
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }
  function setCell(s, key, patch) {
    let cell = { ...(s.cells[key] || {}), ...patch };
    for (let k of Object.keys(cell)) if (cell[k] === "" || cell[k] === false || cell[k] === null || cell[k] === undefined) delete cell[k];
    if (Object.keys(cell).length) s.cells[key] = cell;
    else delete s.cells[key];
  }
  function startEdit(initial) {
    let td = tdAt(sel.r, sel.c);
    let b = td.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    let input = h("input", { class: "editor-input", value: initial ?? sheet().cells[ref(sel.r, sel.c)]?.v ?? "" });
    Object.assign(input.style, { left: b.left - w.left + wrap.scrollLeft + "px", top: b.top - w.top + wrap.scrollTop + "px", minWidth: b.width + "px", height: b.height + "px" });
    wrap.append(input);
    editing = input;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener("input", () => ($("#formula").value = input.value));
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); commit(); move(e.shiftKey ? -1 : 1, 0); }
      else if (e.key === "Tab") { e.preventDefault(); commit(); move(0, e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { cancelEdit(); }
      e.stopPropagation();
    });
    input.addEventListener("blur", () => editing === input && commit());
  }
  function commit(value) {
    let text = value ?? editing?.value;
    if (editing) { let e = editing; editing = null; e.remove(); }
    if (text === undefined) return;
    let s = sheet(), key = ref(sel.r, sel.c);
    if ((s.cells[key]?.v ?? "") === text) return;
    snapshot();
    setCell(s, key, { v: text });
    refreshValues();
    changed();
  }
  function cancelEdit() { if (editing) { let e = editing; editing = null; e.remove(); } paintSelection(); }
  function move(dr, dc, extend) {
    let s = sheet();
    if (extend) { sel.r2 = Math.min(s.rows, Math.max(1, sel.r2 + dr)); sel.c2 = Math.min(s.cols, Math.max(1, sel.c2 + dc)); }
    else { sel.r = Math.min(s.rows, Math.max(1, sel.r + dr)); sel.c = Math.min(s.cols, Math.max(1, sel.c + dc)); sel.r2 = sel.r; sel.c2 = sel.c; }
    paintSelection();
    scrollIntoView();
  }
  function eachSelected(fn) {
    let { r1, r2, c1, c2 } = rng();
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(ref(r, c), r, c);
  }
  function applyStyle(patch) {
    snapshot();
    eachSelected(key => setCell(sheet(), key, patch));
    refreshValues();
    changed();
  }
  function toggleFlag(flag) {
    let on = !sheet().cells[ref(sel.r, sel.c)]?.[flag];
    applyStyle({ [flag]: on });
  }
  function clearSelection() {
    snapshot();
    eachSelected(key => setCell(sheet(), key, { v: "" }));
    refreshValues();
    changed();
  }

  // mouse selection
  let dragging = false;
  wrap.addEventListener("mousedown", e => {
    let td = e.target.closest("td");
    if (!td || e.button !== 0) return;
    if (editing) {
      let text = editing.value;
      if (text.startsWith("=") && /[(,+\-*/^&=<>:]$/.test(text)) { // click inserts a reference while typing a formula
        e.preventDefault();
        editing.value += ref(+td.dataset.r, +td.dataset.c);
        editing.focus();
        $("#formula").value = editing.value;
        return;
      }
      commit();
    }
    let r = +td.dataset.r, c = +td.dataset.c;
    if (e.shiftKey) { sel.r2 = r; sel.c2 = c; } else sel = { r, c, r2: r, c2: c };
    dragging = true;
    paintSelection();
  });
  wrap.addEventListener("mouseover", e => {
    if (!dragging) return;
    let td = e.target.closest("td");
    if (td) { sel.r2 = +td.dataset.r; sel.c2 = +td.dataset.c; paintSelection(); }
  });
  addEventListener("mouseup", () => (dragging = false));
  wrap.addEventListener("dblclick", e => { if (e.target.closest("td")) startEdit(); });
  wrap.addEventListener("contextmenu", e => { if (e.target.closest("td")) { e.preventDefault(); cellMenu(e); } });

  document.addEventListener("keydown", e => {
    if (editing || e.target.closest("input, select, textarea, dialog")) return;
    let mod = e.ctrlKey || e.metaKey;
    let k = e.key;
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === "b") { e.preventDefault(); toggleFlag("b"); return; }
    if (mod && k.toLowerCase() === "i") { e.preventDefault(); toggleFlag("i"); return; }
    if (mod && k.toLowerCase() === "u") { e.preventDefault(); toggleFlag("u"); return; }
    if (mod && k.toLowerCase() === "a") { e.preventDefault(); sel = { r: 1, c: 1, r2: sheet().rows, c2: sheet().cols }; paintSelection(); return; }
    if (mod) return;
    let moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, 1] };
    if (moves[k]) { e.preventDefault(); let [dr, dc] = moves[k]; if (e.shiftKey && (k === "Enter" || k === "Tab")) { dr = -dr; dc = -dc; } move(dr, dc, e.shiftKey && k.startsWith("Arrow")); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); clearSelection(); return; }
    if (k === "F2") { e.preventDefault(); startEdit(); return; }
    if (k.length === 1) { e.preventDefault(); startEdit(k); }
  });

  // clipboard (tab separated, formulas move when pasted)
  let internalClip = null;
  function copySelection(e) {
    let { r1, r2, c1, c2 } = rng();
    let rows = [], raw = [];
    for (let r = r1; r <= r2; r++) {
      let row = [], rawRow = [];
      for (let c = c1; c <= c2; c++) { row.push(display(sheet(), ref(r, c))); rawRow.push(sheet().cells[ref(r, c)] || null); }
      rows.push(row.join("\t"));
      raw.push(rawRow);
    }
    let text = rows.join("\n");
    internalClip = { text, raw, r1, c1 };
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  }
  document.addEventListener("copy", e => {
    if (editing || e.target.closest?.("input, textarea")) return;
    copySelection(e);
  });
  document.addEventListener("cut", e => {
    if (editing || e.target.closest?.("input, textarea")) return;
    copySelection(e);
    clearSelection();
  });
  document.addEventListener("paste", e => {
    if (editing || e.target.closest?.("input, textarea")) return;
    e.preventDefault();
    let text = e.clipboardData.getData("text/plain");
    snapshot();
    let s = sheet();
    if (internalClip && internalClip.text === text) {
      internalClip.raw.forEach((row, i) => row.forEach((cell, j) => {
        let key = ref(sel.r + i, sel.c + j);
        if (!cell) { delete s.cells[key]; return; }
        let copy = { ...cell };
        if (typeof copy.v === "string" && copy.v.startsWith("=")) copy.v = "=" + Formula.shift(copy.v.slice(1), sel.c - internalClip.c1, sel.r - internalClip.r1);
        s.cells[key] = copy;
      }));
    } else {
      text.replace(/\r/g, "").replace(/\n$/, "").split("\n").forEach((line, i) =>
        line.split("\t").forEach((v, j) => setCell(s, ref(sel.r + i, sel.c + j), { v })));
    }
    ensureSize(sel.r + text.split("\n").length, sel.c + Math.max(...text.split("\n").map(l => l.split("\t").length)));
    render();
    changed();
  });
  function ensureSize(rows, cols) {
    let s = sheet();
    s.rows = Math.max(s.rows, rows);
    s.cols = Math.min(702, Math.max(s.cols, cols));
  }

  // formula bar
  $("#formula").addEventListener("focus", () => { if (!editing) $("#formula").dataset.editing = "1"; });
  $("#formula").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); commit($("#formula").value); $("#formula").blur(); move(1, 0); }
    if (e.key === "Escape") { $("#formula").blur(); paintSelection(); }
  });
  $("#formula").addEventListener("input", () => { if (editing) editing.value = $("#formula").value; });

  // column resize
  function startResize(e, col) {
    e.preventDefault();
    e.stopPropagation();
    let startX = e.clientX, start = sheet().widths[col] || 100;
    let onMove = ev => {
      sheet().widths[col] = Math.max(30, start + ev.clientX - startX);
      table.querySelector("colgroup").children[Formula.colToNum(col)].style.width = sheet().widths[col] + "px";
    };
    let onUp = () => { removeEventListener("mousemove", onMove); removeEventListener("mouseup", onUp); changed(); };
    addEventListener("mousemove", onMove);
    addEventListener("mouseup", onUp);
  }

  // insert / delete rows and columns (formula references are adjusted)
  function adjustRefs(kind, at, delta) {
    for (let s of book.sheets) for (let cell of Object.values(s.cells)) {
      if (typeof cell.v !== "string" || !cell.v.startsWith("=")) continue;
      cell.v = cell.v.replace(/(^|[^A-Za-z0-9_$"])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g, (m, pre, ac, col, ar, row) => {
        let c = Formula.colToNum(col), r = +row;
        if (kind === "row" && r >= at) r = Math.max(1, r + delta);
        if (kind === "col" && c >= at) c = Math.max(1, c + delta);
        return `${pre}${ac}${Formula.numToCol(c)}${ar}${r}`;
      });
    }
  }
  function shiftCells(kind, at, delta) {
    snapshot();
    let s = sheet();
    let next = {};
    for (let [key, cell] of Object.entries(s.cells)) {
      let p = Formula.parseRef(key);
      let r = p.row, c = p.col;
      if (kind === "row") { if (delta < 0 && r === at) continue; if (r >= at) r += delta; }
      else { if (delta < 0 && c === at) continue; if (c >= at) c += delta; }
      if (r >= 1 && c >= 1) next[ref(r, c)] = cell;
    }
    s.cells = next;
    adjustRefs(kind, delta > 0 ? at : at + 1, delta);
    if (kind === "row") s.rows = Math.max(1, s.rows + delta); else s.cols = Math.max(1, Math.min(702, s.cols + delta));
    render();
    changed();
  }
  function sortColumn(c, desc) {
    snapshot();
    let s = sheet();
    let { r1, r2 } = rng();
    if (r1 === r2) { r1 = 1; r2 = s.rows; }
    let rows = [];
    for (let r = r1; r <= r2; r++) {
      let row = [];
      for (let cc = 1; cc <= s.cols; cc++) row.push(s.cells[ref(r, cc)]);
      if (row.some(Boolean)) rows.push({ row, v: values.get(s.name + "!" + ref(r, c)) });
    }
    rows.sort((a, b) => {
      let x = a.v, y = b.v;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      let cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return desc ? -cmp : cmp;
    });
    for (let r = r1; r <= r2; r++) for (let cc = 1; cc <= s.cols; cc++) delete s.cells[ref(r, cc)];
    rows.forEach((item, i) => item.row.forEach((cell, j) => { if (cell) s.cells[ref(r1 + i, j + 1)] = cell; }));
    render();
    changed();
  }

  function popup(e, items) {
    $$(".menu").forEach(m => m.remove());
    let m = h("div", { class: "menu", style: { left: e.clientX + "px", top: e.clientY + "px" } },
      items.map(([label, fn]) => h("button", { onclick: () => { m.remove(); fn(); } }, label)));
    document.body.append(m);
    setTimeout(() => addEventListener("click", () => m.remove(), { once: true }));
  }
  const cellMenu = e => popup(e, [
    ["Cut", () => document.execCommand("cut")], ["Copy", () => document.execCommand("copy")],
    ["Insert row above", () => shiftCells("row", sel.r, 1)], ["Insert column left", () => shiftCells("col", sel.c, 1)],
    ["Delete row", () => shiftCells("row", sel.r, -1)], ["Delete column", () => shiftCells("col", sel.c, -1)],
    ["Sort A → Z by this column", () => sortColumn(sel.c, false)], ["Sort Z → A by this column", () => sortColumn(sel.c, true)],
    ["Clear", clearSelection]]);
  const rowMenu = (e, r) => { sel = { r, c: 1, r2: r, c2: sheet().cols }; paintSelection(); popup(e, [["Insert row above", () => shiftCells("row", r, 1)], ["Insert row below", () => shiftCells("row", r + 1, 1)], ["Delete row", () => shiftCells("row", r, -1)]]); };
  const colMenu = (e, c) => { sel = { r: 1, c, r2: sheet().rows, c2: c }; paintSelection(); popup(e, [["Insert column left", () => shiftCells("col", c, 1)], ["Insert column right", () => shiftCells("col", c + 1, 1)], ["Delete column", () => shiftCells("col", c, -1)], ["Sort sheet A → Z", () => sortColumn(c, false)], ["Sort sheet Z → A", () => sortColumn(c, true)]]); };

  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(book)); book = JSON.parse(undoStack.pop()); active = Math.min(active, book.sheets.length - 1); render(); changed(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(book)); book = JSON.parse(redoStack.pop()); render(); changed(); }

  // ---------------------------------------------------------- sheets tabs
  function renderTabs() {
    let tabs = $("#tabs");
    let sum = $("#sum");
    tabs.replaceChildren(h("button", { title: "Add sheet", onclick: () => {
      snapshot();
      let n = book.sheets.length + 1;
      while (book.sheets.some(s => s.name === "Sheet" + n)) n++;
      book.sheets.push(newSheet("Sheet" + n));
      active = book.sheets.length - 1;
      render();
      changed();
    } }, "＋"), ...book.sheets.map((s, i) => h("button", { class: i === active ? "active" : "", onclick: () => { active = i; sel = { r: 1, c: 1, r2: 1, c2: 1 }; render(); },
      ondblclick: async () => {
        let data = await dialogForm("Rename sheet", [{ name: "name", label: "Name", value: s.name, required: true }]);
        if (data && data.name.trim() && !book.sheets.some(x => x !== s && x.name === data.name.trim())) { snapshot(); s.name = data.name.trim(); render(); changed(); }
      },
      oncontextmenu: e => { e.preventDefault(); popup(e, [["Delete sheet", () => { if (book.sheets.length < 2 || !confirm(`Delete ${s.name}?`)) return; snapshot(); book.sheets.splice(i, 1); active = 0; render(); changed(); }]]); } }, s.name)), sum);
  }

  // ---------------------------------------------------------- charts
  const PALETTE = ["#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6", "#7baaf7", "#f07b72"];
  function renderCharts() {
    $$(".chart").forEach(n => n.remove());
    for (let chart of sheet().charts || []) {
      let canvas = h("canvas");
      let box = h("div", { class: "chart", style: { left: chart.x + "px", top: chart.y + "px", width: chart.w + "px", height: chart.h + "px" } },
        h("div", { class: "head" }, h("span", {}, chart.title || chart.range),
          h("select", { onchange: e => { chart.type = e.target.value; renderCharts(); changed(); } }, ["bar", "line", "pie"].map(t => h("option", { value: t, selected: t === chart.type }, t))),
          h("button", { title: "Remove chart", onclick: () => { snapshot(); sheet().charts = sheet().charts.filter(x => x !== chart); renderCharts(); changed(); } }, "✕")), canvas);
      wrap.append(box);
      new ResizeObserver(() => { chart.w = box.offsetWidth; chart.h = box.offsetHeight; draw(canvas, chart); }).observe(box);
      box.querySelector(".head").addEventListener("mousedown", e => {
        if (e.target.closest("button, select")) return;
        let sx = e.clientX - chart.x, sy = e.clientY - chart.y;
        let mv = ev => { chart.x = ev.clientX - sx; chart.y = ev.clientY - sy; box.style.left = chart.x + "px"; box.style.top = chart.y + "px"; };
        let up = () => { removeEventListener("mousemove", mv); removeEventListener("mouseup", up); changed(); };
        addEventListener("mousemove", mv);
        addEventListener("mouseup", up);
      });
    }
  }
  function chartData(chart) {
    let [a, b] = chart.range.split(":");
    let p = Formula.parseRef(a), q = Formula.parseRef(b || a);
    let s = sheet();
    let get = (r, c) => values.get(s.name + "!" + ref(r, c));
    let firstRowIsHeader = typeof get(p.row, p.col + 1) === "string";
    let labels = [], series = [];
    let startRow = firstRowIsHeader ? p.row + 1 : p.row;
    for (let c = p.col + 1; c <= q.col; c++) series.push({ name: firstRowIsHeader ? String(get(p.row, c) ?? "") : Formula.numToCol(c), data: [] });
    if (!series.length) series.push({ name: "", data: [] });
    for (let r = startRow; r <= q.row; r++) {
      labels.push(q.col > p.col ? String(get(r, p.col) ?? "") : String(r));
      series.forEach((sr, i) => { let v = get(r, q.col > p.col ? p.col + 1 + i : p.col); sr.data.push(typeof v === "number" ? v : 0); });
    }
    return { labels, series };
  }
  function draw(canvas, chart) {
    let dpr = devicePixelRatio || 1;
    let W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    let g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    let fg = getComputedStyle(document.body).color;
    g.font = "11px system-ui"; g.fillStyle = fg; g.strokeStyle = fg;
    let { labels, series } = chartData(chart);
    if (chart.type === "pie") {
      let data = series[0].data, total = data.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      let cx = W / 2 - 50, cy = H / 2, rad = Math.min(cx, cy) - 14, ang = -Math.PI / 2;
      data.forEach((v, i) => {
        let a2 = ang + (Math.max(0, v) / total) * Math.PI * 2;
        g.fillStyle = PALETTE[i % PALETTE.length]; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rad, ang, a2); g.fill(); ang = a2;
        g.fillRect(W - 110, 14 + i * 16, 10, 10); g.fillStyle = fg; g.fillText(`${labels[i]} (${Math.round((v / total) * 100)}%)`.slice(0, 18), W - 96, 23 + i * 16);
      });
      return;
    }
    let all = series.flatMap(s => s.data), max = Math.max(0, ...all), min = Math.min(0, ...all);
    if (max === min) max = min + 1;
    let L = 44, R = 12, T = 12 + (series.length > 1 ? 16 : 0), B = 26;
    let y = v => T + (H - T - B) * (1 - (v - min) / (max - min));
    g.globalAlpha = 0.25;
    for (let i = 0; i <= 4; i++) { let v = min + ((max - min) * i) / 4; g.beginPath(); g.moveTo(L, y(v)); g.lineTo(W - R, y(v)); g.stroke(); }
    g.globalAlpha = 1;
    for (let i = 0; i <= 4; i++) { let v = min + ((max - min) * i) / 4; g.fillText(Formula.formatValue(Number(v.toPrecision(3))), 4, y(v) + 4); }
    let n = labels.length || 1, slot = (W - L - R) / n;
    labels.forEach((l, i) => g.fillText(l.slice(0, Math.max(3, Math.floor(slot / 7))), L + i * slot + 2, H - 8));
    series.forEach((s, si) => {
      g.fillStyle = g.strokeStyle = PALETTE[si % PALETTE.length];
      if (series.length > 1) { g.fillRect(L + si * 90, 2, 10, 10); g.fillText(s.name.slice(0, 12), L + si * 90 + 14, 11); }
      if (chart.type === "line") {
        g.lineWidth = 2; g.beginPath();
        s.data.forEach((v, i) => { let x = L + i * slot + slot / 2; i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v)); });
        g.stroke(); g.lineWidth = 1;
      } else {
        let bw = (slot * 0.8) / series.length;
        s.data.forEach((v, i) => { let x = L + i * slot + slot * 0.1 + si * bw; g.fillRect(x, Math.min(y(v), y(0)), bw - 1, Math.abs(y(v) - y(0))); });
      }
    });
  }
  function addChart() {
    let { r1, r2, c1, c2 } = rng();
    if (r1 === r2 && c1 === c2) return toast("Select the data for the chart first (labels in the first column).");
    snapshot();
    sheet().charts = sheet().charts || [];
    sheet().charts.push({ type: "bar", range: `${ref(r1, c1)}:${ref(r2, c2)}`, title: "", x: 80 + wrap.scrollLeft + Math.min(600, c2 * 100), y: 30 + wrap.scrollTop, w: 420, h: 280 });
    renderCharts();
    changed();
  }

  // ---------------------------------------------------------- toolbar
  let tb = $("#toolbar");
  let btn = (label, title, fn, flag) => h("button", { title, onmousedown: e => e.preventDefault(), onclick: fn, "data-flag": flag }, label);
  let sep = () => h("span", { class: "sep" });
  let fnSelect = h("select", { title: "Insert function", onchange: e => { if (!e.target.value) return; let f = e.target.value; e.target.value = ""; startEdit(`=${f}(`); } },
    h("option", { value: "" }, "Σ Functions"), Formula.functions.map(f => h("option", { value: f }, f)));
  tb.append(
    btn("↶", "Undo (Ctrl+Z)", undo), btn("↷", "Redo (Ctrl+Y)", redo), btn("🖨", "Print", () => print()), sep(),
    h("select", { id: "fmt", title: "Number format", onchange: e => applyStyle({ f: e.target.value }) },
      [["", "Automatic"], ["number", "Number 1,000.00"], ["integer", "Whole number"], ["currency", "Currency"], ["percent", "Percent %"], ["date", "Date"], ["datetime", "Date and time"]].map(([v, l]) => h("option", { value: v }, l))), sep(),
    btn(h("b", {}, "B"), "Bold (Ctrl+B)", () => toggleFlag("b"), "b"), btn(h("i", {}, "I"), "Italic (Ctrl+I)", () => toggleFlag("i"), "i"), btn(h("u", {}, "U"), "Underline (Ctrl+U)", () => toggleFlag("u"), "u"),
    h("label", { title: "Text colour" }, "A", h("input", { type: "color", value: "#000000", onchange: e => applyStyle({ c: e.target.value }) })),
    h("label", { title: "Fill colour" }, "🪣", h("input", { type: "color", value: "#ffff00", onchange: e => applyStyle({ bg: e.target.value }) })),
    btn("⌫", "Clear formatting", () => applyStyle({ b: false, i: false, u: false, a: "", c: "", bg: "", f: "" })), sep(),
    btn("⯇", "Align left", () => applyStyle({ a: "left" })), btn("≡", "Center", () => applyStyle({ a: "center" })), btn("⯈", "Align right", () => applyStyle({ a: "right" })), sep(),
    btn("A→Z", "Sort ascending by current column", () => sortColumn(sel.c, false)), btn("Z→A", "Sort descending by current column", () => sortColumn(sel.c, true)), sep(),
    btn("📊 Chart", "Insert a chart from the selection", addChart), fnSelect, sep(),
    btn("＋ 100 rows", "Add 100 rows", () => { sheet().rows += 100; render(); changed(); }));

  // ---------------------------------------------------------- saving
  let timer = null, chain = Promise.resolve();
  function changed() { $("#status").textContent = "Editing…"; clearTimeout(timer); timer = setTimeout(save, 700); }
  function save() {
    clearTimeout(timer);
    timer = null;
    chain = chain.then(async () => {
      $("#status").textContent = "Saving…";
      await Offox.writeJSON(`${dir}/workbook.json`, book);
      meta.title = $("#title").value.trim() || "Untitled spreadsheet";
      meta.updated = new Date().toISOString();
      meta.text = book.sheets.flatMap(s => Object.values(s.cells).map(c => c.v).filter(v => typeof v === "string" && !v.startsWith("="))).join(" ").slice(0, 4000);
      await Offox.writeJSON(`${dir}/meta.json`, meta);
      document.title = `${meta.title} – {{SITE_TITLE}}`;
      $("#status").textContent = "All changes saved to disk";
    }).catch(e => ($("#status").textContent = "Could not save: " + e.message));
  }
  addEventListener("beforeunload", e => { if (timer) { save(); e.preventDefault(); } });
  $("#title").value = meta.title;
  document.title = `${meta.title} – {{SITE_TITLE}}`;
  $("#title").addEventListener("input", changed);

  // CSV import / export
  function toCSV(s) {
    let maxR = 0, maxC = 0;
    for (let key of Object.keys(s.cells)) { let p = Formula.parseRef(key); maxR = Math.max(maxR, p.row); maxC = Math.max(maxC, p.col); }
    let lines = [];
    for (let r = 1; r <= maxR; r++) {
      let row = [];
      for (let c = 1; c <= maxC; c++) { let v = display(s, ref(r, c)); row.push(/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v); }
      lines.push(row.join(","));
    }
    return lines.join("\n");
  }
  function parseCSV(text) {
    let rows = [], row = [], cur = "", q = false;
    let sepChar = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : text.includes("\t") && !text.includes(",") ? "\t" : ",";
    for (let i = 0; i < text.length; i++) {
      let ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sepChar) { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  $("#export").onclick = () => {
    let a = h("a", { href: URL.createObjectURL(new Blob([toCSV(sheet())], { type: "text/csv" })), download: `${meta.title} - ${sheet().name}.csv` });
    a.click();
  };
  $("#import").onchange = async e => {
    let f = e.target.files[0];
    if (!f) return;
    snapshot();
    let rows = parseCSV(await f.text());
    let s = newSheet(f.name.replace(/\.[^.]+$/, "").slice(0, 30));
    rows.forEach((row, r) => row.forEach((v, c) => { if (v !== "") s.cells[ref(r + 1, c + 1)] = { v }; }));
    s.rows = Math.max(100, rows.length + 20);
    s.cols = Math.min(702, Math.max(26, ...rows.map(r => r.length)));
    book.sheets.push(s);
    active = book.sheets.length - 1;
    render();
    changed();
    e.target.value = "";
  };

  render();
})();
