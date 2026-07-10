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

// ---- 3. the SCORES scoreboard parses to a non-empty object ----------------------
test("takeaways.html SCORES object parses and is non-empty", () => {
  const h = read("../takeaways.html");
  const m = h.match(/\/\*SCORES_START\*\/([\s\S]*?)\/\*SCORES_END\*\//);
  assert.ok(m, "SCORES markers missing");
  const D = JSON.parse(m[1].replace(/^\s*const D =\s*/, "").replace(/;\s*$/, ""));
  assert.ok(Object.keys(D).length > 0, "scoreboard D is empty");
  // Gorgias must be present with both lanes shaped as {a,q,l,...} or null
  assert.ok(D.Gorgias, "Gorgias missing from scoreboard");
});

// ---- 4. report.html data arrays appear exactly once and parse (string-aware) -----
function grabArrays(html, name) {
  // return every `const NAME = [ ... ]` block parsed (should be exactly one)
  const out = [];
  let from = 0, i;
  while ((i = html.indexOf(`const ${name} = [`, from)) >= 0) {
    const s = html.indexOf("[", i);
    let d = 0, j = s, inStr = false, esc = false;
    for (; j < html.length; j++) {
      const c = html[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "[") d++;
      else if (c === "]") { d--; if (d === 0) { j++; break; } }
    }
    out.push(JSON.parse(html.slice(s, j)));
    from = j;
  }
  return out;
}
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
