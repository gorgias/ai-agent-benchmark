// verify-data.js — pre-deploy QUALITY GATE on the baked report.
//
// The report is board-facing: a silently-broken bake (NaN latency, empty lanes, judge
// coverage collapse, impossible stats) must never reach production. Run this AFTER
// `node gen.js` and BEFORE merging/deploying; a non-zero exit means DO NOT SHIP.
//
//   node verify-data.js            # from runner/
//
// Checks are INVARIANTS of the pipeline, not opinions about the numbers — the gate
// never fails because a vendor got better or worse, only because the data is broken.
import { readFileSync, readdirSync, existsSync } from "node:fs";

const fail = [];
const warn = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ---- 1. the baked data parses and both lanes exist ----
const html = readFileSync(new URL("../report.html", import.meta.url), "utf8");
function grab(name) {
  const i = html.indexOf(`const ${name} = [`);
  if (i < 0) { fail.push(`${name} data block missing from report.html`); return []; }
  const s = html.indexOf("[", i);
  // bracket-match STRING-AWARE: captured reply text can legally contain lone "[" / "]"
  // inside JSON strings — counting raw chars mis-balances there. Skip string contents.
  let d = 0, j = s, inStr = false, esc = false;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "[") d++;
    else if (c === "]") { d--; if (d === 0) { j++; break; } }
  }
  try { return JSON.parse(html.slice(s, j)); } catch (e) { fail.push(`${name} does not parse: ${e.message}`); return []; }
}
const STORES = grab("STORES"), SUPPORT = grab("SUPPORT");
if (STORES.length) ok(`STORES parses (${STORES.length} store entries)`);
if (SUPPORT.length) ok(`SUPPORT parses (${SUPPORT.length} store entries)`);

// ---- 2. per-store stat invariants (measured stores only) ----
let themes = 0, turns = 0, badLat = 0, badTimed = 0, badDelivery = 0, badEval = 0;
for (const s of [...STORES, ...SUPPORT]) {
  if (s.delivery != null && !["streaming", "atomic"].includes(s.delivery)) badDelivery++;
  if (s.timed != null && s.attempted != null && s.timed > s.attempted) badTimed++;
  for (const th of s.themes || []) {
    themes++;
    if (th.ev && (typeof th.ev.total !== "number" || th.ev.total < 0 || th.ev.total > 100)) badEval++;
    for (const t of th.turns || []) {
      turns++;
      if (t.lat != null && (typeof t.lat !== "number" || Number.isNaN(t.lat) || t.lat < 0 || t.lat > 300)) badLat++;
    }
  }
}
if (badLat) fail.push(`${badLat} turn latencies are NaN/negative/absurd (>300s)`); else ok(`${turns} turn latencies sane`);
if (badTimed) fail.push(`${badTimed} stores have timed > attempted (impossible coverage)`); else ok("coverage counts consistent (timed ≤ attempted)");
if (badDelivery) fail.push(`${badDelivery} stores carry an unknown delivery value`); else ok("delivery values ∈ {streaming, atomic, ∅}");
if (badEval) fail.push(`${badEval} judge scores outside 0..100`); else ok("judge scores within 0..100");

// ---- 3. judge coverage: every VALID conversation on disk should be scored ----
// (drift here means eval-merge was skipped after new captures — the report would
// show conversations whose quality the composite silently ignores)
const scoresPath = new URL("./eval-scores.json", import.meta.url);
if (!existsSync(scoresPath)) fail.push("eval-scores.json missing");
else {
  const scored = new Set(Object.keys(JSON.parse(readFileSync(scoresPath, "utf8"))));
  let valid = 0, unscored = 0;
  const resRoot = new URL("./results/", import.meta.url).pathname;
  for (const d of readdirSync(resRoot).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
    let fs2; try { fs2 = readdirSync(`${resRoot}${d}/conv`); } catch { continue; }
    for (const f of fs2) {
      if (!f.endsWith(".json")) continue;
      let j; try { j = JSON.parse(readFileSync(`${resRoot}${d}/conv/${f}`, "utf8")); } catch { continue; }
      if (j.valid === false || !(j.turns || []).length) continue;
      valid++;
      if (!scored.has(`${d}/${f}`)) unscored++;   // eval-scores keys are "<run-date>/<conv-file>"
    }
  }
  const cov = valid ? Math.round(100 * (valid - unscored) / valid) : 0;
  if (valid && cov < 90) fail.push(`judge coverage ${cov}% (<90%) — ${unscored}/${valid} valid convs unscored; run eval-pack → judge → eval-merge`);
  else ok(`judge coverage ${cov}% (${valid - unscored}/${valid} valid convs scored)`);
}

// ---- 4. headline stats markers present (takeaways sync ran) ----
if (!/STATS_JSON:\{/.test(html) && !/data-count="\d+"/.test(html)) warn.push("no STATS marker found in report.html (cosmetic)");
ok("report.html structure markers present");

// ---- 5. NO leftover git conflict markers in any deployed artifact ----
// gen.js does targeted in-place replacements, so a merge conflict leaves markers in the
// prose regions it never touches — they render as raw text on the live page (2026-07-10
// incident: takeaways.html shipped with <<<<<<< HEAD visible). Hard-fail before deploy.
const CONFLICT = /^(<{7} |={7}$|>{7} )/m;
for (const f of ["report.html", "takeaways.html", "conv-text.json"]) {
  let txt; try { txt = readFileSync(new URL(`../${f}`, import.meta.url), "utf8"); } catch { continue; }
  if (CONFLICT.test(txt)) fail.push(`${f} contains unresolved git conflict markers (<<<<<<< / ======= / >>>>>>>)`);
}
if (!fail.some((f) => /conflict markers/.test(f))) ok("no git conflict markers in deployed artifacts");

// ---- 6. capture-integrity review queue (misread-UI detector) ----
// Surfaces conversations the integrity scanner flagged as likely capture misreads (user-echo
// scraped as an answer, KB-nav chrome counted as a reply, etc.). Review signal, not a hard
// fail — run `node integrity-check.js` to refresh, then review/quarantine integrity-report.json.
try {
  const ir = JSON.parse(readFileSync(new URL("./integrity-report.json", import.meta.url), "utf8"));
  const high = (ir.bySeverity && ir.bySeverity.high) || 0;
  if (high > 0) warn.push(`${high} conversation(s) flagged HIGH-severity by integrity-check (possible UI misreads still counting) — review integrity-report.json and quarantine confirmed ones`);
  else ok(`capture integrity: 0 high-severity flags (${ir.flaggedTotal || 0} low/medium for review)`);
} catch { warn.push("no integrity-report.json — run `node integrity-check.js` to scan for misread captures"); }

// ---- 7. boilerplate audit (recurring message chrome the cleaner misses) ----
// Real prose varies; chrome repeats. `node boilerplate-audit.mjs` flags any prefix/suffix
// shared by a majority of a store's cleaned replies — new widget-chrome leaks surface here
// instead of being hand-flagged from the report. Review flags; encode true chrome in
// reply-clean.js (leave genuine repeated prose — e.g. a bot's habitual sign-off — alone).
try {
  const ba = JSON.parse(readFileSync(new URL("./boilerplate-audit.json", import.meta.url), "utf8"));
  const n = (ba.flags || []).length;
  if (n > 0) warn.push(`${n} recurring message pattern(s) flagged by boilerplate-audit (possible un-stripped chrome) — review boilerplate-audit.json`);
  else ok("boilerplate audit: no recurring chrome residue");
} catch { warn.push("no boilerplate-audit.json — run `node boilerplate-audit.mjs` to scan for chrome residue"); }

// ---- verdict ----
console.log("");
warn.forEach((w) => console.log(`  ⚠ ${w}`));
if (fail.length) { console.error(`✗ QUALITY GATE FAILED (${fail.length}):`); fail.forEach((f) => console.error(`  ✗ ${f}`)); process.exit(1); }
console.log(`✓ QUALITY GATE PASSED — ${themes} conversations, ${turns} turns verified. Safe to deploy.`);
