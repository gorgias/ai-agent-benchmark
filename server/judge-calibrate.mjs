#!/usr/bin/env node
// server/judge-calibrate.mjs — does a new judge score like the judge that built the corpus?
//
// WHY THIS EXISTS. Rankings are computed over a trailing 90-day window, so the corpus is always a
// mix of conversations scored at different times. If a new judge (a different model, a rewritten
// prompt, a new API path) is systematically harsher or softer than the one before it, every vendor's
// score drifts for a reason that has nothing to do with vendor behaviour — and the drift lands on
// whichever vendors happen to have been captured most recently. That is invisible in every other
// check we run, and it would quietly invalidate the board.
//
// So: re-judge an already-scored cohort with the new judge and compare. Same conversations, same
// rubric — the only variable is the judge.
//
//   node runner/eval-pack.js /tmp/calib 6 --rejudge-file cohort.json
//   node runner/judge-api.mjs /tmp/calib
//   node server/judge-calibrate.mjs /tmp/calib
//
// Read the result as: mean delta = systematic bias (the number that matters for the board);
// mean|delta| = per-conversation noise (judges legitimately disagree at the margin); r = whether
// the new judge still ranks conversations in the same order.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const RUNNER = path.join(ROOT, "runner");
const dir = process.argv[2];
if (!dir) { console.error("usage: node server/judge-calibrate.mjs <judgedBatchDir>"); process.exit(1); }

// Node in the container is old enough that require() of these ESM modules fails — import by URL.
const { deriveScores } = await import(pathToFileURL(path.join(RUNNER, "eval-score.js")).href);
const { convoSignals } = await import(pathToFileURL(path.join(RUNNER, "eval-signals.js")).href);

const OLD = JSON.parse(fs.readFileSync(path.join(RUNNER, "eval-scores.json"), "utf8"));
const KMAP = {};
for (const f of fs.readdirSync(dir).filter((x) => /^map-.*\.json$/.test(x))) Object.assign(KMAP, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

const rows = [];
for (const f of fs.readdirSync(dir).filter((x) => /^scored-.*\.json$/.test(x))) {
  for (const e of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
    const id = KMAP[e.k];
    if (!id || !OLD[id] || OLD[id].total == null) continue;
    let turns;
    try { turns = JSON.parse(fs.readFileSync(path.join(RUNNER, "results", id.slice(0, 10), "conv", id.slice(11)), "utf8")).turns || []; } catch { continue; }
    const der = deriveScores(e.mode, e.checks || {}, convoSignals(turns));
    if (!der) { console.error(`incomplete checks: ${id}`); continue; }
    rows.push({ id, mode: e.mode, before: OLD[id].total, after: der.total, checks: e.checks, oldChecks: OLD[id].checks || {} });
  }
}
if (!rows.length) { console.error("no overlap between this batch dir and eval-scores.json — was it packed with --rejudge-file?"); process.exit(1); }

rows.sort((a, b) => a.before - b.before);
console.log("mode     before -> after   delta");
for (const r of rows) {
  const d = r.after - r.before;
  console.log(`${r.mode.padEnd(8)} ${String(r.before).padStart(4)} -> ${String(r.after).padStart(4)}   ${d > 0 ? "+" : ""}${d}`);
}

const stat = (a) => {
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const s = a.slice().sort((x, y) => x - y);
  return { mean, median: s[Math.floor(s.length / 2)] };
};
const deltas = rows.map((r) => r.after - r.before);
const { mean, median } = stat(deltas);
const absMean = stat(deltas.map(Math.abs)).mean;
const mb = stat(rows.map((r) => r.before)).mean, ma = stat(rows.map((r) => r.after)).mean;
const cov = rows.reduce((a, r) => a + (r.before - mb) * (r.after - ma), 0);
const sb = Math.sqrt(rows.reduce((a, r) => a + (r.before - mb) ** 2, 0));
const sa = Math.sqrt(rows.reduce((a, r) => a + (r.after - ma) ** 2, 0));
const r = cov / (sb * sa);

console.log(`\nn=${rows.length}   mean ${mb.toFixed(1)} -> ${ma.toFixed(1)}`);
console.log(`systematic bias (mean delta): ${mean > 0 ? "+" : ""}${mean.toFixed(1)} pts   median ${median > 0 ? "+" : ""}${median}`);
console.log(`per-conversation noise (mean |delta|): ${absMean.toFixed(1)} pts`);
console.log(`rank agreement (Pearson r): ${r.toFixed(3)}`);
for (const m of ["shopping", "support"]) {
  const s = rows.filter((x) => x.mode === m);
  if (s.length) console.log(`  ${m.padEnd(8)} n=${s.length}  bias ${(stat(s.map((x) => x.after - x.before)).mean).toFixed(1)}`);
}

// Per-check disagreement: where a systematic bias comes from is more actionable than its size.
const flips = {};
for (const row of rows) {
  for (const [cid, c] of Object.entries(row.checks || {})) {
    const o = row.oldChecks[cid];
    if (!o || typeof o.pass !== "boolean") continue;
    flips[cid] = flips[cid] || { harsher: 0, softer: 0, same: 0 };
    if (o.pass && !c.pass) flips[cid].harsher++;
    else if (!o.pass && c.pass) flips[cid].softer++;
    else flips[cid].same++;
  }
}
const notable = Object.entries(flips).filter(([, f]) => f.harsher + f.softer > 0)
  .sort((a, b) => (b[1].harsher + b[1].softer) - (a[1].harsher + a[1].softer));
if (notable.length) {
  console.log(`\nper-check disagreement (new judge vs corpus):`);
  for (const [cid, f] of notable.slice(0, 12)) console.log(`  ${cid.padEnd(14)} ${f.harsher} now fail (were pass) · ${f.softer} now pass (were fail) · ${f.same} agree`);
}

// The verdict thresholds are judgement calls, stated openly so they can be argued with:
// ±3 pts of bias is within the noise two competent judges produce on the same transcript; beyond
// ~5 pts the corpus is no longer self-consistent and old scores need re-judging before publishing.
console.log("");
if (Math.abs(mean) <= 3 && r >= 0.9) console.log(`VERDICT: consistent with the existing corpus (bias ${mean.toFixed(1)}, r ${r.toFixed(2)}). Safe to judge new conversations with this judge.`);
else if (Math.abs(mean) <= 6) console.log(`VERDICT: borderline (bias ${mean.toFixed(1)}, r ${r.toFixed(2)}). Usable, but note the drift in the methodology and re-judge the corpus if it grows.`);
else console.log(`VERDICT: NOT consistent (bias ${mean.toFixed(1)}, r ${r.toFixed(2)}). Mixing these scores with the corpus would move vendors for a reason that is not vendor behaviour. Re-judge the whole corpus with one judge before publishing.`);
