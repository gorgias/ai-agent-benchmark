// daily-plan.js — pick the day's ~30-conversation capture plan and write next-run.json
// (consumed by daily-run.sh to know WHAT to run, and by runstatus.js to show "Upcoming runs").
//
// Selection policy (grows pool diversity + keeps data fresh):
//   1. NEVER-captured stores first (candidate/backlog sites → measure new sites, more diversity)
//   2. then the STALEST measured stores (oldest last-capture) — recency matters (14-day ranking)
// Greedily add stores until the planned conversation count reaches the target (default 30).
//
//   node daily-plan.js [targetConvs] [runDate]     # prints plan + writes ../run-next.json
import { readFile, writeFile, readdir } from "node:fs/promises";
import { STORES } from "./vendors.js";
import { SHOPPING_THEMES, SUPPORT_THEMES } from "./pools.js";

const TARGET = Number(process.argv[2]) || 30;
const RUN_DATE = process.argv[3] || new Date().toISOString().slice(0, 10);
const RESULTS = new URL("./results/", import.meta.url).pathname;
const OUT = new URL("../run-next.json", import.meta.url).pathname;

const modesFor = (s) => s.modes || ["shopping", "support"];
const convCount = (s) => modesFor(s).reduce((n, m) => n + (m === "support" ? SUPPORT_THEMES : SHOPPING_THEMES).length, 0);

// Most recent capture date per store key, scanning every results/<date>/conv dir.
async function lastCaptureByStore() {
  const last = {};
  let dates = [];
  try { dates = (await readdir(RESULTS, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name).sort(); } catch {}
  for (const date of dates) {
    let files = [];
    try { files = await readdir(`${RESULTS}${date}/conv`); } catch { continue; }
    for (const f of files) { const key = f.replace(/-(shopping|support)-.*$/, ""); last[key] = date; } // later dates overwrite
  }
  return last;
}

const eligible = STORES.filter(s => s.url && !(s.candidate && !s.widget)); // has a real widget/url
const last = await lastCaptureByStore();

// rank: never-captured (lastRun=null) first, then oldest lastRun first, then stable by key
const ranked = eligible
  .map(s => ({ key: s.key, vendor: s.vendor, store: s.store, convs: convCount(s), lastRun: last[s.key] || null }))
  .sort((a, b) => {
    if (!a.lastRun && b.lastRun) return -1;
    if (a.lastRun && !b.lastRun) return 1;
    if (a.lastRun !== b.lastRun) return (a.lastRun || "") < (b.lastRun || "") ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });

const plan = [];
let total = 0;
for (const s of ranked) { if (total >= TARGET) break; plan.push(s); total += s.convs; }

const newSites = plan.filter(s => !s.lastRun).length;
const out = {
  planFor: RUN_DATE,
  generatedAt: new Date().toISOString(),
  targetConvs: TARGET,
  plannedConvs: total,
  newSites,                                   // never-captured stores in this plan (diversity growth)
  stores: plan,
  note: `${plan.length} stores (${newSites} never-measured, ${plan.length - newSites} stalest) → ~${total} conversations`,
};
await writeFile(OUT, JSON.stringify(out, null, 2));
console.log(out.note);
console.log("stores:", plan.map(s => s.key + (s.lastRun ? "" : "*")).join(" "));   // * = new site
// emit the --store args for daily-run.sh to consume
console.log("STORE_ARGS=" + plan.map(s => s.key).join(" "));
