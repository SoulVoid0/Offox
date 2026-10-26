/* Offox spreadsheet formula engine. Plain JavaScript, no dependencies.
 *   Formula.evaluate("=SUM(A1:A3)*2", getCell) where getCell("A1") returns the cell's computed value.
 * Supports + - * / ^ & = <> < > <= >=, percentages, strings, booleans, cell refs (A1, $A$1),
 * ranges (A1:B3, A:A), Sheet refs ('Sheet 2'!A1) and the functions in FUNCTIONS below. */
"use strict";

const Formula = (() => {
  class FError extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  const ERR = code => new FError(code);

  function colToNum(col) {
    let n = 0;
    for (let ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }
  function numToCol(n) {
    let s = "";
    while (n > 0) { let m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function parseRef(ref) {
    let m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
    return m ? { col: colToNum(m[1]), row: Number(m[2]) } : null;
  }

  // ------------------------------------------------------------ tokenizer
  function tokenize(src) {
    let tokens = [];
    let i = 0;
    while (i < src.length) {
      let c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') {
        let j = i + 1, s = "";
        while (j < src.length) {
          if (src[j] === '"' && src[j + 1] === '"') { s += '"'; j += 2; continue; }
          if (src[j] === '"') break;
          s += src[j++];
        }
        tokens.push({ t: "str", v: s });
        i = j + 1;
        continue;
      }
      let sheet = /^(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!/.exec(src.slice(i));
      let rest = sheet ? src.slice(i + sheet[0].length) : src.slice(i);
      let range = /^(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?/.exec(rest) || /^(\$?[A-Za-z]{1,3}):(\$?[A-Za-z]{1,3})(?![\w(])/.exec(rest);
      if (range && !/^[A-Za-z_]+\(/.test(rest) && !(/^(TRUE|FALSE)\b/i.test(rest) && !range[2])) {
        tokens.push({ t: "ref", a: range[1].replace(/\$/g, "").toUpperCase(), b: range[2] && range[2].replace(/\$/g, "").toUpperCase(),
          sheet: sheet ? (sheet[1] ? sheet[1].replace(/''/g, "'") : sheet[2]) : null });
        i += (sheet ? sheet[0].length : 0) + range[0].length;
        continue;
      }
      let num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (num) { tokens.push({ t: "num", v: parseFloat(num[0]) }); i += num[0].length; continue; }
      let id = /^[A-Za-z_][\w.]*/.exec(src.slice(i));
      if (id) {
        let name = id[0].toUpperCase();
        if (name === "TRUE" || name === "FALSE") tokens.push({ t: "bool", v: name === "TRUE" });
        else tokens.push({ t: "id", v: name });
        i += id[0].length;
        continue;
      }
      let op = /^(<>|<=|>=|[-+*/^&=<>(),;:%])/.exec(src.slice(i));
      if (op) { tokens.push({ t: "op", v: op[0] === ";" ? "," : op[0] }); i += op[0].length; continue; }
      throw ERR("#ERROR!");
    }
    return tokens;
  }

  // --------------------------------------------------------------- parser
  function parse(src) {
    let tokens = tokenize(src);
    let pos = 0;
    let peek = () => tokens[pos];
    let next = () => tokens[pos++];
    let expect = v => { let t = next(); if (!t || t.v !== v) throw ERR("#ERROR!"); };
    let isOp = (...ops) => peek() && peek().t === "op" && ops.includes(peek().v);

    function comparison() {
      let left = concat();
      while (isOp("=", "<>", "<", ">", "<=", ">=")) left = { op: next().v, left, right: concat() };
      return left;
    }
    function concat() {
      let left = additive();
      while (isOp("&")) { next(); left = { op: "&", left, right: additive() }; }
      return left;
    }
    function additive() {
      let left = term();
      while (isOp("+", "-")) left = { op: next().v, left, right: term() };
      return left;
    }
    function term() {
      let left = power();
      while (isOp("*", "/")) left = { op: next().v, left, right: power() };
      return left;
    }
    function power() {
      let left = unary();
      while (isOp("^")) { next(); left = { op: "^", left, right: unary() }; }
      return left;
    }
    function unary() {
      if (isOp("-")) { next(); return { op: "neg", arg: unary() }; }
      if (isOp("+")) { next(); return unary(); }
      let node = primary();
      while (isOp("%")) { next(); node = { op: "%", arg: node }; }
      return node;
    }
    function primary() {
      let t = next();
      if (!t) throw ERR("#ERROR!");
      if (t.t === "num" || t.t === "str" || t.t === "bool") return { lit: t.v };
      if (t.t === "ref") return { ref: t };
      if (t.t === "op" && t.v === "(") { let e = comparison(); expect(")"); return e; }
      if (t.t === "id") {
        if (!isOp("(")) throw ERR("#NAME?");
        next();
        let args = [];
        if (!isOp(")")) {
          do {
            if (isOp(",")) { args.push({ lit: null }); continue; }
            args.push(comparison());
          } while (isOp(",") && next());
        }
        expect(")");
        return { fn: t.v, args };
      }
      throw ERR("#ERROR!");
    }
    let tree = comparison();
    if (pos < tokens.length) throw ERR("#ERROR!");
    return tree;
  }

  // ------------------------------------------------------------ evaluator
  const num = v => {
    if (v instanceof FError) throw v;
    if (Array.isArray(v)) v = v[0]?.[0];
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return v;
    let n = Number(String(v).replace(/,/g, ""));
    if (isNaN(n)) throw ERR("#VALUE!");
    return n;
  };
  const str = v => {
    if (v instanceof FError) throw v;
    if (Array.isArray(v)) v = v[0]?.[0];
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return String(v);
  };
  const bool = v => (typeof v === "string" ? (v.toUpperCase() === "TRUE" ? true : v.toUpperCase() === "FALSE" ? false : num(v) !== 0) : !!num(v));
  const flat = args => args.flat(Infinity);
  const nums = args => flat(args).filter(v => typeof v === "number");
  const scalar = v => (Array.isArray(v) ? v[0]?.[0] ?? null : v);

  function criteria(c) {
    let m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(str(c));
    let op = m[1] || "=", target = m[2];
    let tn = Number(target);
    let isNum = target !== "" && !isNaN(tn);
    let re = !isNum && /[*?]/.test(target) ? new RegExp("^" + target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i") : null;
    return v => {
      if (isNum && typeof v === "number") {
        return { "=": v === tn, "<>": v !== tn, "<": v < tn, ">": v > tn, "<=": v <= tn, ">=": v >= tn }[op];
      }
      let s = str(v).toLowerCase(), t = target.toLowerCase();
      if (re) return op === "<>" ? !re.test(s) : re.test(s);
      return { "=": s === t, "<>": s !== t, "<": s < t, ">": s > t, "<=": s <= t, ">=": s >= t }[op];
    };
  }

  const DAY = 86400000;
  const EPOCH = Date.UTC(1899, 11, 30);
  const toSerial = d => (d.getTime() - d.getTimezoneOffset() * 60000 - EPOCH) / DAY;
  const fromSerial = n => new Date(EPOCH + num(n) * DAY);

  const FUNCTIONS = {
    SUM: a => nums(a).reduce((s, v) => s + v, 0),
    AVERAGE: a => { let n = nums(a); if (!n.length) throw ERR("#DIV/0!"); return n.reduce((s, v) => s + v, 0) / n.length; },
    MIN: a => { let n = nums(a); return n.length ? Math.min(...n) : 0; },
    MAX: a => { let n = nums(a); return n.length ? Math.max(...n) : 0; },
    COUNT: a => nums(a).length,
    COUNTA: a => flat(a).filter(v => v !== null && v !== "").length,
    COUNTBLANK: a => flat(a).filter(v => v === null || v === "").length,
    PRODUCT: a => nums(a).reduce((s, v) => s * v, 1),
    MEDIAN: a => { let n = nums(a).sort((x, y) => x - y); if (!n.length) throw ERR("#NUM!"); let m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
    STDEV: a => { let n = nums(a); if (n.length < 2) throw ERR("#DIV/0!"); let avg = n.reduce((s, v) => s + v, 0) / n.length; return Math.sqrt(n.reduce((s, v) => s + (v - avg) ** 2, 0) / (n.length - 1)); },
    ROUND: ([v, d]) => { let f = 10 ** num(d ?? 0); return Math.round(num(v) * f) / f; },
    ROUNDUP: ([v, d]) => { let f = 10 ** num(d ?? 0); return Math.sign(num(v)) * Math.ceil(Math.abs(num(v)) * f) / f; },
    ROUNDDOWN: ([v, d]) => { let f = 10 ** num(d ?? 0); return Math.sign(num(v)) * Math.floor(Math.abs(num(v)) * f) / f; },
    INT: ([v]) => Math.floor(num(v)),
    ABS: ([v]) => Math.abs(num(v)),
    SQRT: ([v]) => { if (num(v) < 0) throw ERR("#NUM!"); return Math.sqrt(num(v)); },
    POWER: ([a, b]) => num(a) ** num(b),
    MOD: ([a, b]) => { if (num(b) === 0) throw ERR("#DIV/0!"); let r = num(a) % num(b); return r && Math.sign(r) !== Math.sign(num(b)) ? r + num(b) : r; },
    PI: () => Math.PI,
    RAND: () => Math.random(),
    RANDBETWEEN: ([a, b]) => Math.floor(num(a) + Math.random() * (num(b) - num(a) + 1)),
    IF: ([c, a, b]) => (bool(scalar(c)) ? (a === undefined ? true : a) : (b === undefined ? false : b)),
    IFERROR: () => { throw new Error("lazy"); },
    AND: a => flat(a).every(v => bool(v)),
    OR: a => flat(a).some(v => bool(v)),
    NOT: ([v]) => !bool(scalar(v)),
    CONCAT: a => flat(a).map(str).join(""),
    CONCATENATE: a => flat(a).map(str).join(""),
    TEXTJOIN: ([d, skip, ...rest]) => flat(rest).filter(v => !(bool(skip) && (v === null || v === ""))).map(str).join(str(d)),
    LEN: ([v]) => str(scalar(v)).length,
    UPPER: ([v]) => str(scalar(v)).toUpperCase(),
    LOWER: ([v]) => str(scalar(v)).toLowerCase(),
    PROPER: ([v]) => str(scalar(v)).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
    TRIM: ([v]) => str(scalar(v)).trim().replace(/\s+/g, " "),
    LEFT: ([v, n]) => str(scalar(v)).slice(0, n === undefined ? 1 : num(n)),
    RIGHT: ([v, n]) => { let s = str(scalar(v)); let k = n === undefined ? 1 : num(n); return k ? s.slice(-k) : ""; },
    MID: ([v, s, n]) => str(scalar(v)).substr(num(s) - 1, num(n)),
    FIND: ([f, v, s]) => { let i = str(scalar(v)).indexOf(str(f), (s ? num(s) : 1) - 1); if (i < 0) throw ERR("#VALUE!"); return i + 1; },
    SEARCH: ([f, v, s]) => { let i = str(scalar(v)).toLowerCase().indexOf(str(f).toLowerCase(), (s ? num(s) : 1) - 1); if (i < 0) throw ERR("#VALUE!"); return i + 1; },
    SUBSTITUTE: ([v, a, b]) => str(scalar(v)).split(str(a)).join(str(b)),
    REPT: ([v, n]) => str(scalar(v)).repeat(Math.max(0, num(n))),
    TEXT: ([v, f]) => formatValue(scalar(v), str(f)),
    VALUE: ([v]) => num(scalar(v)),
    ISBLANK: ([v]) => scalar(v) === null || scalar(v) === "",
    ISNUMBER: ([v]) => typeof scalar(v) === "number",
    ISTEXT: ([v]) => typeof scalar(v) === "string",
    TODAY: () => Math.floor(toSerial(new Date())),
    NOW: () => toSerial(new Date()),
    DATE: ([y, m, d]) => toSerial(new Date(num(y), num(m) - 1, num(d))),
    YEAR: ([v]) => fromSerial(scalar(v)).getUTCFullYear(),
    MONTH: ([v]) => fromSerial(scalar(v)).getUTCMonth() + 1,
    DAY: ([v]) => fromSerial(scalar(v)).getUTCDate(),
    WEEKDAY: ([v]) => fromSerial(scalar(v)).getUTCDay() + 1,
    SUMIF: ([range, c, sumRange]) => {
      let test = criteria(scalar(c)), r = flat([range]), s = sumRange ? flat([sumRange]) : r;
      return r.reduce((acc, v, i) => (test(v) && typeof s[i] === "number" ? acc + s[i] : acc), 0);
    },
    COUNTIF: ([range, c]) => { let test = criteria(scalar(c)); return flat([range]).filter(v => test(v)).length; },
    AVERAGEIF: ([range, c, avgRange]) => {
      let test = criteria(scalar(c)), r = flat([range]), s = avgRange ? flat([avgRange]) : r;
      let picked = r.map((v, i) => (test(v) ? s[i] : null)).filter(v => typeof v === "number");
      if (!picked.length) throw ERR("#DIV/0!");
      return picked.reduce((a, b) => a + b, 0) / picked.length;
    },
    VLOOKUP: ([key, table, col, approx]) => {
      key = scalar(key);
      let rows = table, c = num(col) - 1;
      if (!Array.isArray(rows) || c < 0 || c >= (rows[0] || []).length) throw ERR("#REF!");
      let exact = approx !== undefined && !bool(approx);
      let found = -1;
      for (let i = 0; i < rows.length; i++) {
        let v = rows[i][0];
        if (typeof key === "number" && typeof v === "number" ? v === key : str(v).toLowerCase() === str(key).toLowerCase()) { found = i; break; }
        if (!exact && typeof key === "number" && typeof v === "number" && v < key) found = i;
      }
      if (found < 0) throw ERR("#N/A");
      return rows[found][c];
    },
    HLOOKUP: ([key, table, row]) => {
      let r = num(row) - 1;
      let cols = table[0] || [];
      let i = cols.findIndex(v => str(v).toLowerCase() === str(scalar(key)).toLowerCase());
      if (i < 0) throw ERR("#N/A");
      if (!table[r]) throw ERR("#REF!");
      return table[r][i];
    },
    INDEX: ([table, r, c]) => {
      let row = table[num(r) - 1];
      if (!row) throw ERR("#REF!");
      let v = row[(c === undefined ? 1 : num(c)) - 1];
      if (v === undefined) throw ERR("#REF!");
      return v;
    },
    MATCH: ([key, range]) => {
      let list = flat([range]);
      let i = list.findIndex(v => str(v).toLowerCase() === str(scalar(key)).toLowerCase());
      if (i < 0) throw ERR("#N/A");
      return i + 1;
    },
    ROWS: ([r]) => (Array.isArray(r) ? r.length : 1),
    COLUMNS: ([r]) => (Array.isArray(r) ? (r[0] || []).length : 1),
  };

  function evalNode(node, ctx) {
    if ("lit" in node) return node.lit;
    if (node.ref) {
      let { a, b, sheet } = node.ref;
      if (!b) {
        if (!parseRef(a)) throw ERR("#REF!");
        return ctx.get(a, sheet);
      }
      return ctx.range(a, b, sheet);
    }
    if (node.fn) {
      if (node.fn === "IFERROR") {
        try {
          let v = evalNode(node.args[0], ctx);
          if (v instanceof FError) throw v;
          return v;
        } catch (e) {
          if (e instanceof FError) return node.args[1] ? evalNode(node.args[1], ctx) : "";
          throw e;
        }
      }
      if (node.fn === "IF") {
        let cond = bool(scalar(evalNode(node.args[0], ctx)));
        let pick = cond ? node.args[1] : node.args[2];
        return pick ? evalNode(pick, ctx) : cond;
      }
      let f = FUNCTIONS[node.fn];
      if (!f) throw ERR("#NAME?");
      let args = node.args.map(a => {
        let v = evalNode(a, ctx);
        if (v instanceof FError) throw v;
        if (Array.isArray(v)) v.flat().forEach(x => { if (x instanceof FError) throw x; });
        return v;
      });
      let r = f(args);
      return r === undefined ? null : r;
    }
    if (node.op === "neg") return -num(evalNode(node.arg, ctx));
    if (node.op === "%") return num(evalNode(node.arg, ctx)) / 100;
    let l = scalar(evalNode(node.left, ctx));
    let r = scalar(evalNode(node.right, ctx));
    switch (node.op) {
      case "+": return num(l) + num(r);
      case "-": return num(l) - num(r);
      case "*": return num(l) * num(r);
      case "/": if (num(r) === 0) throw ERR("#DIV/0!"); return num(l) / num(r);
      case "^": return num(l) ** num(r);
      case "&": return str(l) + str(r);
      default: {
        let a = l, b = r;
        if (typeof a === "string" || typeof b === "string") { a = str(a).toLowerCase(); b = str(b).toLowerCase(); }
        else { a = num(a); b = num(b); }
        return { "=": a === b, "<>": a !== b, "<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b }[node.op];
      }
    }
  }

  /** Number formats: general, number, integer, currency, percent, date, datetime, or TEXT() patterns like "0.00". */
  function formatValue(v, fmt) {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v !== "number") return String(v);
    switch (fmt) {
      case "number": return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case "integer": return Math.round(v).toLocaleString();
      case "currency": return v.toLocaleString(undefined, { style: "currency", currency: (Intl.NumberFormat().resolvedOptions().locale.endsWith("US") ? "USD" : "EUR") });
      case "percent": return (v * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
      case "date": return fromSerial(v).toLocaleDateString(undefined, { timeZone: "UTC" });
      case "datetime": return fromSerial(v).toLocaleString(undefined, { timeZone: "UTC" });
      case "general": case undefined: case null: case "": {
        if (Number.isInteger(v)) return String(v);
        return String(Number(v.toPrecision(12)));
      }
      default: {
        let m = /^0(?:\.(0+))?(%?)$/.exec(fmt);
        if (m) return (m[2] ? v * 100 : v).toFixed(m[1] ? m[1].length : 0) + m[2];
        return String(v);
      }
    }
  }

  const cache = new Map();
  function compile(src) {
    if (!cache.has(src)) {
      try { cache.set(src, { tree: parse(src) }); } catch (e) { cache.set(src, { error: e instanceof FError ? e : ERR("#ERROR!") }); }
    }
    return cache.get(src);
  }

  /** Evaluates a formula (without the leading "=") with ctx = {get(ref, sheet), range(a, b, sheet)}. */
  function evaluate(src, ctx) {
    let c = compile(src);
    if (c.error) return c.error;
    try {
      let v = evalNode(c.tree, ctx);
      if (Array.isArray(v)) v = v[0]?.[0] ?? null;
      if (typeof v === "number" && !isFinite(v)) return ERR("#NUM!");
      return v;
    } catch (e) {
      return e instanceof FError ? e : ERR("#ERROR!");
    }
  }

  /** Moves the relative references of a formula when it is copied (A1 -> B2 for dx=1, dy=1). */
  function shift(src, dx, dy) {
    return src.replace(/(^|[^A-Za-z0-9_$!'"])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g, (m, pre, ac, col, ar, row) => {
      let c = ac ? col.toUpperCase() : numToCol(Math.max(1, colToNum(col) + dx));
      let r = ar ? row : String(Math.max(1, Number(row) + dy));
      return `${pre}${ac}${c}${ar}${r}`;
    });
  }

  /** Converts typed text into a cell value: numbers, booleans, percentages, dates. */
  function parseInput(text) {
    let t = String(text).trim();
    if (t === "") return null;
    if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?(e[-+]?\d+)?$/i.test(t) && /\d/.test(t)) return Number(t.replace(/,/g, ""));
    if (/^[-+]?\d+(\.\d+)?%$/.test(t)) return Number(t.slice(0, -1)) / 100;
    if (/^(true|false)$/i.test(t)) return t.toUpperCase() === "TRUE";
    let d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (d) return { date: toSerial(new Date(+d[1], +d[2] - 1, +d[3])) };
    return text;
  }

  return { evaluate, formatValue, shift, parseInput, colToNum, numToCol, parseRef, FError, functions: Object.keys(FUNCTIONS).sort() };
})();
if (typeof module !== "undefined") module.exports = Formula;
