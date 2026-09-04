// Unit tests for the DEPLOYED artifacts — report.html, takeaways.html, conv-text.json.
// These guard the exact failure mode that shipped a broken live page on 2026-07-10: a git
// merge conflict left `<<<<<<< HEAD / ======= / >>>>>>>` markers in the prose regions, and
// duplicated the singleton data regions (two /*SCORES_START*/, two STATS_JSON) — gen.js does
// targeted in-place replacements so it silently baked around the conflict and deployed it.
// A parse-only check passed then (the first SCORES block still parsed); these tests fail
// instead on ANY conflict marker AND on any duplicated singleton region.  Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RANK_WINDOW_DAYS } from "./ranking-window.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const ARTIFACTS = ["../report.html", "../takeaways.html", "../conv-text.json"];
// git conflict markers as whole lines: "<<<<<<< label", "=======", ">>>>>>> label"
const CONFLICT = /^(<{7} |={7}$|>{7} )/m;

// ---- 1. no unresolved conflict markers in any deployed artifact -----------------
for (const f of ARTIFACTS) {
  test(`${f} has no git conflict markers`, () => {
    assert.ok(!CONFLICT.test(read(f)), `${f} contains unresolved git conflict markers`);
  });
}

// ---- 2. singleton data regions appear EXACTLY once (a conflict duplicates them) --
// This catches a conflict even when the markers themselves were auto-resolved but the
// enclosed region got doubled — a second SCORES block would still parse yet be stale.
test("takeaways.html has exactly one SCORES block", () => {
  const h = read("../takeaways.html");
  assert.equal((h.match(/\/\*SCORES_START\*\//g) || []).length, 1, "expected one /*SCORES_START*/");
  assert.equal((h.match(/\/\*SCORES_END\*\//g) || []).length, 1, "expected one /*SCORES_END*/");
});

test("takeaways.html has exactly one STATS_JSON marker", () => {
  const h = read("../takeaways.html");
  assert.equal((h.match(/STATS_JSON:\{/g) || []).length, 1, "expected one STATS_JSON marker");
});

// String-aware literal grabber: returns every `const NAME = <literal>` parsed. Used for both
// the report's arrays and the takeaways SCORES objects, so one brace/bracket scanner covers
// both surfaces instead of two half-correct regexes.
function grabLiterals(html, name, open, close) {
  const out = [];
  let from = 0, i;
  while ((i = html.indexOf(`const ${name} = ${open}`, from)) >= 0) {
    const s = html.indexOf(open, i);
    let d = 0, j = s, inStr = false, esc = false;
    for (; j < html.length; j++) {
      const c = html[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) d++;
      else if (c === close) { d--; if (d === 0) { j++; break; } }
    }
    out.push(JSON.parse(html.slice(s, j)));
    from = j;
  }
  return out;
}
const grabArrays = (html, name) => grabLiterals(html, name, "[", "]");
const grabObjects = (html, name) => grabLiterals(html, name, "{", "}");

// ---- 3. the SCORES scoreboard parses to a non-empty object ----------------------
// The block holds more than one declaration since the per-window scoreboards landed (D plus
// D_WINDOWS), so each is grabbed by name rather than parsing the whole block as one JSON
// document — which silently broke this test the moment a second const appeared.
test("takeaways.html SCORES object parses and is non-empty", () => {
  const h = read("../takeaways.html");
  const m = h.match(/\/\*SCORES_START\*\/([\s\S]*?)\/\*SCORES_END\*\//);
  assert.ok(m, "SCORES markers missing");
  const found = grabObjects(m[1], "D");
  assert.equal(found.length, 1, "expected exactly one D scoreboard (a conflict duplicates it)");
  const D = found[0];
  assert.ok(Object.keys(D).length > 0, "scoreboard D is empty");
  // Gorgias must be present with both lanes shaped as {a,q,l,...} or null
  assert.ok(D.Gorgias, "Gorgias missing from scoreboard");
});

test("takeaways.html per-window scoreboards parse and cover the ranking window", () => {
  const h = read("../takeaways.html");
  const m = h.match(/\/\*SCORES_START\*\/([\s\S]*?)\/\*SCORES_END\*\//);
  const found = grabObjects(m[1], "D_WINDOWS");
  if (found.length === 0) return;   // optional surface — absent is fine, malformed is not
  assert.equal(found.length, 1, "expected exactly one D_WINDOWS object");
  const W = found[0];
  assert.ok(W[String(RANK_WINDOW_DAYS)], `D_WINDOWS is missing the ${RANK_WINDOW_DAYS}-day ranking window`);
  for (const [days, board] of Object.entries(W)) {
    assert.ok(Object.keys(board).length > 0, `D_WINDOWS[${days}] is empty`);
  }
});

// ---- 4. report.html data arrays appear exactly once and parse (string-aware) -----
for (const name of ["STORES", "SUPPORT"]) {
  test(`report.html ${name} appears once and parses`, () => {
    const arrs = grabArrays(read("../report.html"), name);
    assert.equal(arrs.length, 1, `expected exactly one ${name} array (a conflict duplicates it)`);
    assert.ok(Array.isArray(arrs[0]) && arrs[0].length > 0, `${name} is empty`);
  });
}

// ---- 5. conv-text.json is valid JSON ---------------------------------------------
test("conv-text.json parses as JSON", () => {
  assert.doesNotThrow(() => JSON.parse(read("../conv-text.json")));
});
