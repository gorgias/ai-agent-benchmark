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
const ARTIFACTS = ["../report.html", "../report-archive.html", "../takeaways.html", "../takeaways-archive.html", "../conv-text.json"];
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

// The scoreboard renders a ± beside each lane composite, baked by gen.js via composite-ci.js.
// A malformed interval is worse than none: it is a confidence claim the page makes on the
// board's behalf, so the shape is asserted rather than trusted.
test("baked composite intervals are well formed", () => {
  const h = read("../takeaways.html");
  const m = h.match(/\/\*SCORES_START\*\/([\s\S]*?)\/\*SCORES_END\*\//);
  const [D] = grabObjects(m[1], "D");
  let seen = 0;
  for (const [vendor, d] of Object.entries(D)) {
    for (const lane of ["s", "p"]) {
      const v = d[lane];
      if (!v || v.ci == null) continue;
      seen++;
      assert.ok(v.ci >= 0, `${vendor}.${lane}: negative interval ${v.ci}`);
      assert.ok(Number.isFinite(v.ci), `${vendor}.${lane}: non-finite interval`);
      // composite-ci.js refuses to bound fewer than three storefronts; a baked interval that
      // claims otherwise means the two disagree about the unit of replication.
      assert.ok(v.ciStores >= 3, `${vendor}.${lane}: interval on ${v.ciStores} storefront(s)`);
    }
  }
  assert.ok(seen > 0, "no vendor carries an interval — gen.js stopped baking them");
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

test("plain /report does not inherit conversations from saved state", () => {
  const h = read("../report.html");
  assert.match(h, /if\(VIEW==='best'\|\|VIEW==='conversations'\) VIEW='shopping'/);
  assert.match(h, /if\(_pv==='conversations'\) VIEW='conversations';\s*else VIEW='support';/);
});

test("report.html conversations view has markup and is not stubbed", () => {
  const h = read("../report.html");
  assert.ok(/id="conv-sec"/.test(h), "missing #conv-sec");
  assert.ok(/id="conv-feed"/.test(h), "missing #conv-feed");
  assert.ok(/id="conv-filters"/.test(h), "missing #conv-filters");
  assert.ok(!/function ensureConvText\(\)\{\s*return;/.test(h), "ensureConvText is stubbed");
  assert.ok(!/function renderConv\(\)\{\s*return;/.test(h), "renderConv is stubbed");
  const keys = Object.keys(JSON.parse(read("../conv-text.json")));
  assert.ok(keys.length > 0, "conv-text.json has no conversations");
  const sample = JSON.parse(read("../conv-text.json"))[keys[0]];
  assert.ok(Array.isArray(sample) && sample.some((t) => t && (t.q || t.a)), "conv-text.json turns have no q/a");
});

// Regression: the verdict used to claim quality 94 while its own scoreboard said 77.
// Check every occurrence, including head-to-head and provider-profile copy.
test("summary metrics match the scoreboard and have no unfilled placeholders", () => {
  const assertKeys = (html, keys, g) => {
    const expected = {
      SUPPORT_QUALITY: g.p.q, SHOPPING_QUALITY: g.s.q,
      SUPPORT_AUTO: g.p.a, SHOPPING_AUTO: g.s.a,
      SUPPORT_LAT: g.p.l, SHOPPING_LAT: g.s.l,
      SUPPORT_P75: g.p.l75, SHOPPING_P75: g.s.l75,
    };
    for (const key of keys) {
      const matches = [...html.matchAll(new RegExp(`<!--${key}-->(.*?)<!--/${key}-->`, "g"))];
      assert.ok(matches.length, `missing summary metric ${key}`);
      for (const match of matches) assert.equal(match[1], String(expected[key]), `stale ${key}`);
    }
  };
  const homepage = read("../takeaways.html");
  const archive = read("../takeaways-archive.html");
  const [D] = grabObjects(homepage, "D");
  const g = D.Gorgias;
  // Brand 2.0 Overview uses a shorter marker set (lane ranks / rounded latency, not every p75).
  assertKeys(homepage, ["SUPPORT_QUALITY", "SHOPPING_AUTO", "SUPPORT_AUTO"], g);
  assertKeys(archive, [
    "SUPPORT_QUALITY", "SHOPPING_QUALITY", "SUPPORT_AUTO", "SHOPPING_AUTO",
    "SUPPORT_LAT", "SHOPPING_LAT", "SUPPORT_P75", "SHOPPING_P75",
  ], g);
  const badges = [...homepage.matchAll(/<!--RANK_BADGE-->(.*?)<!--\/RANK_BADGE-->/g)];
  assert.ok(badges.length >= 1);
  for (const badge of badges) assert.equal(badge[1], badges[0][1], "contradictory summary rank");
  const archiveBadges = [...archive.matchAll(/<!--RANK_BADGE-->(.*?)<!--\/RANK_BADGE-->/g)];
  assert.ok(archiveBadges.length >= 3);
  for (const badge of archiveBadges) assert.equal(badge[1], archiveBadges[0][1], "contradictory archive rank");
  assert.ok(!/<!--(?:SUPPORT_POSITION|SHOPPING_POSITION|SUMMARY_WEIGHTS)-->—/.test(archive));
});

test("overview job table is baked from the scoreboard, not a hand-typed copy", () => {
  const h = read("../takeaways.html");
  const [D] = grabObjects(h, "D");
  const m = h.match(/\/\*FJB_START\*\/([\s\S]*?)\/\*FJB_END\*\//);
  assert.ok(m, "FJB markers missing");
  const FJB = JSON.parse(m[1].replace(/^var FJB=/, "").replace(/;$/, ""));
  assert.ok(FJB && FJB.overall && FJB.overall.length, "FJB.overall is empty — gen.js did not bake it");
  const g = FJB.overall.find((r) => r.v === "Gorgias");
  assert.ok(g, "Gorgias missing from FJB");
  assert.equal(g.ov, D.Gorgias.ov.score);
  const shop = FJB.shopping.find((r) => r.v === "Gorgias");
  assert.equal(shop.q, D.Gorgias.s.q);
  assert.equal(shop.a, D.Gorgias.s.a);
});

test("howto store count matches the baked STATS_JSON", () => {
  const tk = read("../takeaways.html");
  const hw = read("../brand/howto.html");
  const stats = JSON.parse(tk.match(/STATS_JSON:(\{.*?\})/)[1]);
  const m = hw.match(/<!--STAT_STORES-->(.*?)<!--\/STAT_STORES-->/);
  assert.ok(m, "howto.html missing STAT_STORES");
  assert.equal(m[1], String(stats.stores));
});

test("quality-by-intent is baked and not the old hand-typed bars", () => {
  const h = read("../report.html");
  const m = h.match(/<!--QBI-->[\s\S]*?<!--\/QBI-->/);
  assert.ok(m, "QBI markers missing");
  assert.ok(!m[0].includes("Waiting for bake"), "QBI still placeholder");
  assert.ok(/qbi-cap/.test(m[0]), "QBI missing data-derived caption");
  assert.ok(/qbi-row/.test(m[0]), "QBI missing intent rows");
});

test("full results CTA downloads the rubric PDF", () => {
  const h = read("../report.html");
  assert.match(h, /href="\/rubric\.pdf"[^>]*>Download</);
  assert.doesNotMatch(h, /See how the scoring works/);
  assert.doesNotMatch(h, /emptyRow=/);
});

test("downloadable rubric PDF is generated from eval-rubric.md", async () => {
  const { mdToHtml } = await import("./render-rubric-pdf.mjs");
  const { CHECKS } = await import("./eval-score.js");
  const { readFileSync, existsSync } = await import("node:fs");
  const md = readFileSync(new URL("./eval-rubric.md", import.meta.url), "utf8");
  const html = mdToHtml(md);
  for (const lane of Object.values(CHECKS)) {
    for (const dim of Object.values(lane)) {
      for (const id of Object.keys(dim)) assert.ok(html.includes(id), `PDF HTML missing check ${id}`);
    }
  }
  const pdf = new URL("../rubric.pdf", import.meta.url);
  assert.ok(existsSync(pdf), "rubric.pdf missing");
  const buf = readFileSync(pdf);
  assert.ok(buf.slice(0, 5).toString() === "%PDF-", "rubric.pdf is not a PDF");
  assert.ok(buf.length > 20_000, "rubric.pdf is suspiciously small");
});

