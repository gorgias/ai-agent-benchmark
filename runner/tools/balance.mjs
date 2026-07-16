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
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
// SELF-IMPROVEMENT LOOP (Max, 2026-07-16): driver fails → auto-probe → classify → park →
// (human patches the driver) → re-probe marks it fixed → store re-enters the next campaign.
// driver-triage.json is the loop's ledger: stores parked with a structural class are skipped
// until a --classify re-probe returns ANSWERED (probe-generic then sets fixed:true).
const TRIAGE_FILE = new URL("../driver-triage.json", import.meta.url).pathname;
const triage = existsSync(TRIAGE_FILE) ? JSON.parse(readFileSync(TRIAGE_FILE, "utf8")) : { stores: {} };
const parked = new Set(Object.entries(triage.stores || {}).filter(([, e]) => !e.fixed).map(([k]) => k));

for (const s of STORES) {
  if (EXCLUDE.has(s.vendor)) continue;
  if (INCLUDE.length && !INCLUDE.includes(s.vendor)) continue;
  // Never burn budget on stores that can't reach the board (audit 2026-07-16: Bilt/Hertz/
  // Substack alone ate ~40 attempts over 7 days for 0 board-eligible convs):
  if (!s.url) continue;                    // placeholder / retired rows
  if (s.ecommerce === false) continue;     // excluded from the board by the e-commerce-only rule
  if (s.wall) continue;                    // probed structural wall (recaptcha, human front door…)
  if (parked.has(s.key)) continue;         // parked by the self-improvement loop, awaiting a driver fix
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
    // CONCURRENCY was silently hardcoded at 2 (audit 2026-07-16) — the env var passed by
    // campaign launchers was ignored. Max's directive: 5 parallel for these non-flagship runs.
    const args = ["run.js", "--store", store.key, "--themes", "5", "--concurrency", String(Number(process.env.CONCURRENCY) || 5)];
    if (headed) args.push("--headed");
    execFileSync("node", args, { stdio: "inherit", timeout: STORE_TIMEOUT_MS,
      env: { ...process.env, RUN_DATE, BENCHMARK_CAPTURE_ORIGIN: "claude" } });
  } catch (e) { L(`run.js error for ${store.key}: ${String(e.message || e).slice(0, 100)}`); }

  const gained = (validCounts()[v] || 0) - before;
  added += Math.max(0, gained);
  if (gained <= 0) {
    strikes[v]++;
    L(`  +0 valid from ${store.key} — strike ${strikes[v]}/${strikeLimit(v)} for ${v}`);
    // SELF-IMPROVEMENT: auto-probe the failing store NOW and classify the failure.
    // Structural classes park the store (skipped until a driver fix re-probes ANSWERED);
    // fixable classes are queued for a driver patch. Never silently strike again.
    try {
      const out = execFileSync("node", ["tools/probe-generic.mjs", store.key, "--classify"],
        { encoding: "utf8", timeout: 4 * 60 * 1000, env: { ...process.env } });
      const m = out.match(/CLASSIFICATION:\s*(\w+)/);
      const cls = m ? m[1] : "PROBE_FAILED";
      const structural = ["HUMAN_FRONT_DOOR", "RECAPTCHA_WALL", "WIDGET_ABSENT"].includes(cls);
      triage.stores[store.key] = { vendor: v, class: cls, at: new Date().toISOString(),
        action: structural ? "parked-structural" : cls === "ANSWERED" ? "flaky-retry-ok" : "needs-driver-fix", fixed: cls === "ANSWERED" };
      writeFileSync(TRIAGE_FILE, JSON.stringify(triage, null, 1));
      // Production lesson (2026-07-16, 3h for 1/270): a needs-driver-fix store must ALSO be
      // parked — it re-entered rotation every ~40min and burned the whole campaign. And
      // parked persists across campaigns until a --classify re-probe marks it fixed.
      if (structural || triage.stores[store.key].action === "needs-driver-fix") {
        parked.add(store.key); byV[v] = byV[v].filter((s) => s.key !== store.key);
      }
      L(`  🔧 auto-probe ${store.key} → ${cls} → ${triage.stores[store.key].action}`);
    } catch (e) { L(`  🔧 auto-probe ${store.key} failed: ${String(e.message || e).slice(0, 80)}`); }
    // PER-STORE campaign strike (same lesson): even a "flaky-retry-ok" store that just gave
    // +0 is benched for the REST OF THIS CAMPAIGN — the vendor's other stores (or other
    // vendors) get the budget instead of a 40-min retry of the same coin-flip.
    byV[v] = byV[v].filter((s) => s.key !== store.key);
    if (!byV[v].length) { retired.add(v); L(`  ⛔ retire ${v} — no un-benched stores left this campaign`); }
    if (strikes[v] >= strikeLimit(v)) { retired.add(v); L(`  ⛔ retire ${v} (structural — can't add valid convs unattended)`); }
  } else { strikes[v] = 0; L(`  +${gained} valid ${v} · total added ${added}/${BUDGET}`); }
}

const cEnd = validCounts();
L("=== OVERNIGHT BALANCE done · added " + added + " non-Amazon valid convs ===");
L("final: " + Object.keys(byV).sort().map(v => `${v}=${cEnd[v] || 0}`).join("  "));
if (retired.size) L("retired (structural, below parity): " + [...retired].join(", "));
