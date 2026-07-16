// tools/driver-health.mjs — per-widget / per-store capture-health matrix over a rolling window.
//
// WHY: the standing self-improvement loop (see memory: driver-interpretation-first) needs a
// data-driven starting point — which widget families are healthy, which stores burn budget at
// 0% yield, and what the dominant failure signature is. Run this BEFORE any capture campaign
// and after any driver change; a store at 0% over ≥N attempts is either a driver bug (probe it
// with tools/probe-generic.mjs) or a structural wall (flag `wall: true` in vendors.js so the
// balancer skips it).
//
//   node tools/driver-health.mjs            # last 7 days
//   DAYS=14 node tools/driver-health.mjs    # wider window
//   MIN_N=5 node tools/driver-health.mjs    # only flag stores with ≥5 attempts
import { readdirSync, readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { STORES } = require("../vendors.js");

const DAYS = Number(process.env.DAYS) || 7;
const MIN_N = Number(process.env.MIN_N) || 3;
const cutoff = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - DAYS); return d.toISOString().slice(0, 10); })();

const meta = {};
for (const s of STORES) meta[s.key] = { vendor: s.vendor, widget: s.widget, wall: !!s.wall, ecommerce: s.ecommerce !== false };

const agg = {};
for (const date of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= cutoff)) {
  let files; try { files = readdirSync(`results/${date}/conv`); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    let j; try { j = JSON.parse(readFileSync(`results/${date}/conv/${f}`, "utf8")); } catch { continue; }
    const key = f.replace(/-(shopping|support)-[a-z-]+\.json$/, "");
    const m = meta[key] || { vendor: j.vendor || "?", widget: j.widget || "?" };
    const w = m.widget || "?";
    agg[w] = agg[w] || { n: 0, v: 0, stores: {} };
    agg[w].n++; if (j.valid) agg[w].v++;
    const st = (agg[w].stores[key] = agg[w].stores[key] || { n: 0, v: 0, reasons: {}, wall: m.wall, ecom: m.ecommerce });
    st.n++; if (j.valid) st.v++;
    else { const r = (j.invalid_reason || "?").slice(0, 44); st.reasons[r] = (st.reasons[r] || 0) + 1; }
  }
}

console.log(`=== DRIVER HEALTH — last ${DAYS} days (stores flagged at <34% yield with ≥${MIN_N} attempts) ===`);
let burns = 0;
for (const w of Object.keys(agg).sort((a, b) => agg[a].v / agg[a].n - agg[b].v / agg[b].n)) {
  const A = agg[w];
  console.log(`\n${w.toUpperCase().padEnd(14)} ${A.v}/${A.n} valid (${Math.round((100 * A.v) / A.n)}%)`);
  const bad = Object.entries(A.stores)
    .filter(([, s]) => s.n >= MIN_N && s.v / s.n < 0.34)
    .sort((x, y) => x[1].v / x[1].n - y[1].v / y[1].n);
  for (const [k, s] of bad) {
    const top = Object.entries(s.reasons).sort((x, y) => y[1] - x[1])[0];
    const tag = s.wall ? " [wall]" : !s.ecom ? " [non-ecom]" : "";
    if (!s.wall && s.ecom) burns++;
    console.log(`   ⚠ ${k.padEnd(28)} ${s.v}/${s.n}${tag}  ${top ? "— " + top[0] : ""}`);
  }
}
console.log(`\n${burns} unexplained low-yield store(s) (no wall/non-ecom tag) — probe these with tools/probe-generic.mjs before the next campaign.`);
