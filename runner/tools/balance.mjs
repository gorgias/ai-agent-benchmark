// tools/balance.mjs — equalize valid-conversation counts ACROSS providers ("water-fill").
//
// Always feeds the provider CURRENTLY furthest behind TARGET, one store at a time, until
// BUDGET new valid conversations are added or every reachable provider hits TARGET.
// Structural low-vol vendors (deflectors, headed walls, never-captured) can't reach parity
// unattended — chasing them yields invalid convs — so a strike system RETIRES a vendor
// after ~3 zero-valid stores in a row and the budget flows to vendors that deliver.
//
// Run FROM runner/ (relative paths):    cd runner
//   INCLUDE="Envive,Yuma" TARGET=80 BUDGET=60 STORE_TIMEOUT_MIN=8 LOAD_CAP=9 \
//     RUN_DATE=$(date +%F) node tools/balance.mjs           # --dry to preview picks
// Parallel streams: give each instance a DISJOINT INCLUDE list (see docs/RUNBOOK.md);
// run.js conversation locks make overlap safe, but disjoint lists waste nothing.
// LOAD_CAP pauses capture while system load is high so measured latencies stay clean.
//
// HARD RULE: convs are written by run.js to results/$RUN_DATE/conv/ and are NEVER moved,
// renamed, or archived. This script only READS counts + shells out to run.js. Amazon Rufus
// runs as its own headed/logged-in stream (secrets/rufus-capture.mjs), not here.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { STORES } from "../vendors.js";

const RUN_DATE = process.env.RUN_DATE || "2026-07-08";
const TARGET   = Number(process.env.TARGET) || 82;    // per-vendor equality level (≈ Ada, the #2 leader)
const BUDGET   = Number(process.env.BUDGET) || 345;   // max NEW valid non-Amazon convs to add (rest is Rufus)
const HEADED   = new Set(["Rep AI", "Kodif", "Humind"]);            // these only capture cleanly headed
const EXCLUDE  = new Set(["Amazon Rufus", "Spiffy.ai", "Google Agentic", "Shopify Inbox"]); // separate/structural-zero
// INCLUDE (optional whitelist): when set, ONLY these vendors are candidates — used to target the
// productive, automatable tier (Envive/Yuma/DG/Siena) instead of draining the night into vendors
// that can't be captured unattended.
//
// STORE_TIMEOUT_MIN: incident 2026-07-16 — the old 22min default killed run.js mid-batch on
// slower-but-ALIVE vendors (Decagon ~42s/turn: 10 turns x 5 sequential waves at concurrency 2
// needs ~35-40min) before all 10 conversations could finish. The kill orphans every in-flight
// conversation with a generic "browser.newContext: ...closed" error and the store gets charged
// a false strike — 3 such stores burned ~65min for 3/30 valid convs that night. A truly-dead
// widget already fails fast on its own (open() bails within ~10-25s, TURN_TIMEOUT_MS=60s caps
// any single hung turn) — this ceiling only needs to be long enough for a SLOW-but-responsive
// vendor to complete, not to detect dead ones. Raised to give real vendors room to finish.
const INCLUDE  = (process.env.INCLUDE || "").split(",").map(s => s.trim()).filter(Boolean);
const STORE_TIMEOUT_MS = (Number(process.env.STORE_TIMEOUT_MIN) || 40) * 60 * 1000;
const DRY = process.argv.includes("--dry");

const L = (...a) => console.log(new Date().toISOString() + " " + a.join(" "));

// per-vendor store rotation
const byV = {};
for (const s of STORES) {
  if (EXCLUDE.has(s.vendor)) continue;
  if (INCLUDE.length && !INCLUDE.includes(s.vendor)) continue;
  (byV[s.vendor] = byV[s.vendor] || []).push(s);
}

// live valid-conv counts per vendor across ALL run dirs (baseline + everything added tonight)
function validCounts() {
  const c = {};
  for (const d of readdirSync("results").filter(x => /^2026/.test(x))) {
    let fs; try { fs = readdirSync(`results/${d}/conv`); } catch { continue; }
    for (const f of fs) {
      if (!f.endsWith(".json")) continue;
      let j; try { j = JSON.parse(readFileSync(`results/${d}/conv/${f}`, "utf8")); } catch { continue; }
      if (j.valid === false) continue;
      c[j.vendor] = (c[j.vendor] || 0) + 1;
    }
  }
  return c;
}

const strikes = {}, rot = {}, retired = new Set();
Object.keys(byV).forEach(v => { strikes[v] = 0; rot[v] = 0; });
const strikeLimit = v => Math.min(3, byV[v].length);   // one vendor gives up after ~a short losing streak

L(`=== OVERNIGHT BALANCE start · RUN_DATE=${RUN_DATE} · TARGET=${TARGET}/vendor · BUDGET=${BUDGET} non-Amazon${DRY ? " · DRY-RUN" : ""} ===`);
const c0 = validCounts();
L("baseline: " + Object.keys(byV).sort().map(v => `${v}=${c0[v] || 0}`).join("  "));

import os from "node:os";
const LOAD_CAP = Number(process.env.LOAD_CAP) || 9;   // pause before capturing if the box is busy — protects latency fidelity
async function loadGuard() {
  let waited = 0;
  while (os.loadavg()[0] > LOAD_CAP && waited < 600) {
    L(`⏸ load ${os.loadavg()[0].toFixed(1)} > ${LOAD_CAP} — pausing 60s so measured latencies stay clean`);
    await new Promise(r => setTimeout(r, 60000)); waited += 60;
  }
}

let added = 0, step = 0;
while (added < BUDGET) {
  await loadGuard();
  const counts = validCounts();
  const cands = Object.keys(byV).filter(v => !retired.has(v) && (counts[v] || 0) < TARGET);
  if (!cands.length) { L("all reachable providers at TARGET — nothing left below the water line. done."); break; }
  cands.sort((a, b) => (counts[a] || 0) - (counts[b] || 0));   // always feed the furthest-behind
  const v = cands[0];
  const store = byV[v][rot[v] % byV[v].length]; rot[v]++;
  const headed = HEADED.has(v);
  step++;
  L(`[step ${step}] pick ${v} (${counts[v] || 0}/${TARGET}) → ${store.key}${headed ? " [headed]" : ""} · added ${added}/${BUDGET}`);
  if (DRY) { added += 5; if (step > 60) { L("dry-run cap"); break; } continue; }

  const before = counts[v] || 0;
  try {
    const args = ["run.js", "--store", store.key, "--themes", "5", "--concurrency", "2"];
    if (headed) args.push("--headed");
    execFileSync("node", args, { stdio: "inherit", timeout: STORE_TIMEOUT_MS,
      env: { ...process.env, RUN_DATE, BENCHMARK_CAPTURE_ORIGIN: "claude" } });
  } catch (e) { L(`run.js error for ${store.key}: ${String(e.message || e).slice(0, 100)}`); }

  const gained = (validCounts()[v] || 0) - before;
  added += Math.max(0, gained);
  if (gained <= 0) {
    strikes[v]++;
    L(`  +0 valid from ${store.key} — strike ${strikes[v]}/${strikeLimit(v)} for ${v}`);
    if (strikes[v] >= strikeLimit(v)) { retired.add(v); L(`  ⛔ retire ${v} (structural — can't add valid convs unattended)`); }
  } else { strikes[v] = 0; L(`  +${gained} valid ${v} · total added ${added}/${BUDGET}`); }
}

const cEnd = validCounts();
L("=== OVERNIGHT BALANCE done · added " + added + " non-Amazon valid convs ===");
L("final: " + Object.keys(byV).sort().map(v => `${v}=${cEnd[v] || 0}`).join("  "));
if (retired.size) L("retired (structural, below parity): " + [...retired].join(", "));
