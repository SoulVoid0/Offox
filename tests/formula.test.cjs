/* Unit tests for the spreadsheet formula engine: node tests/formula.test.cjs */
const F = require("../src/offox/templates/sheets/assets/formula.js");
let cells = { A1: 1, A2: 2, A3: 3, B1: "apple", B2: "banana", B3: "cherry", C1: 10, C2: 20, C3: 30 };
let ctx = { get: r => cells[r] ?? null, range: (a, b) => { let p = F.parseRef(a), q = F.parseRef(b); let out = []; for (let r = p.row; r <= q.row; r++) { let row = []; for (let c = p.col; c <= q.col; c++) row.push(cells[F.numToCol(c) + r] ?? null); out.push(row); } return out; } };
let tests = [["SUM(A1:A3)", 6], ["AVERAGE(A1:A3)*2", 4], ["IF(A1>0,\"yes\",\"no\")", "yes"], ["VLOOKUP(\"banana\",B1:C3,2,FALSE)", 20], ["1/0", "#DIV/0!"], ["IFERROR(1/0,\"x\")", "x"],
  ["SUMIF(A1:A3,\">1\",C1:C3)", 50], ["COUNTIF(B1:B3,\"*an*\")", 1], ["CONCAT(B1,\"-\",A2)", "apple-2"], ["2^3+-1", 7], ["50%*2", 1], ["ROUND(3.14159,2)", 3.14], ["LEN(\"hello\")&\"!\"", "5!"], ["A1+B1", "#VALUE!"], ["FOO(1)", "#NAME?"], ["MAX(A1:C3)", 30], ["INDEX(A1:C3,2,3)", 20], ["MATCH(\"cherry\",B1:B3)", 3], ["AND(TRUE,A1=1)", true], ["\"a\"=\"A\"", true]];
let fail = 0;
for (let [f, want] of tests) { let got = F.evaluate(f, ctx); if (got instanceof F.FError) got = got.code; if (got !== want) { fail++; console.log("FAIL", f, got, want); } }
console.log(F.shift("A1+$B$2+C3*SUM(D4:E5)", 1, 2));
if (fail) { console.log(fail + " failures"); process.exit(1); } else console.log("all formula tests pass");
