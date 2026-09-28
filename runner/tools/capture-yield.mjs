// tools/capture-yield.mjs — WHY captures are unusable, by failure signature, per widget and store.
//
// driver-health.mjs says WHICH stores yield nothing; this says WHY, in terms that map to a fix:
//   no_text        — the widget's transcript was never readable on any turn (scope/mount/consent/load)
//   killed_offer   — died before 3 timed answers on a handover signal that the CURRENT classifier
//                    reads as an OFFER or a false positive (fixed by classifyHandover, 2026-09-28)
//   killed_transfer— died early on a genuine hand-off to a human (a real finding, not a bug)
//   locked         — a turn hit its hard timeout (composer uneditable, e.g. DigitalGenius rating prompt)
//   untimed_text   — text arrived but turns never settled into a timed answer
//   error:<kind>   — capture error (goto/open timeout, navigation, widget-absent)
//
//   node tools/capture-yield.mjs                 # since 30 days ago
//   SINCE=2026-08-18 node tools/capture-yield.mjs
//   TOP=40 node tools/capture-yield.mjs          # stores listed per signature
import { readdirSync, readFileSync } from "fs";
import { classifyHandover } from "../classify.js";
import { stripWidgetChrome } from "../reply-clean.js";
import { WIDGETS, STORES } from "../vendors.js";

const SINCE = process.env.SINCE || (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); })();
const TOP = Number(process.env.TOP) || 15;
const meta = Object.fromEntries(STORES.map((s) => [s.key, s]));

function signature(j) {
  if (j.valid) return "valid";
  if (j.error) return "error:" + (/widget-absent/.test(j.error) ? "widget-absent" : /hard-timeout:open/.test(j.error) ? "open-timeout"
    : /ERR_INTERNET|ERR_NETWORK|ERR_TIMED_OUT|goto: Timeout/.test(j.error) ? "network" : /Execution context/.test(j.error) ? "navigation" : "other");
  const turns = j.turns || [];
  const ai = turns.filter((t) => !t.unsent && (t.by === "ai" || t.handover));
  if (!ai.length) return "no_turns";
  const h = turns.find((t) => t.handover);
  if (h) {
    const st = meta[j.key] || {};
    const k = classifyHandover(stripWidgetChrome(h.replyText || h.replyTail || "", h.q), (WIDGETS[j.widget] || {}).handover || [], [st.store || j.store, j.vendor, ...(st.personas || [])]);
    return k && k.kind === "transfer" ? "killed_transfer" : "killed_offer";
  }
  if (!ai.some((t) => (t.replyTail || "").trim() || (t.replyText || "").trim())) return "no_text";
  if (ai.some((t) => /hard-timeout:turn/.test(t.error || ""))) return "locked";
  return "untimed_text";
}

const byW = {}, byS = {};
let total = 0;
for (const d of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= SINCE)) {
  let files; try { files = readdirSync(`results/${d}/conv`); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    let j; try { j = JSON.parse(readFileSync(`results/${d}/conv/${f}`, "utf8")); } catch { continue; }
    const s = signature(j); total++;
    const w = (byW[j.widget] = byW[j.widget] || {}); w[s] = (w[s] || 0) + 1;
    const k = (byS[s] = byS[s] || {}); k[j.key] = (k[j.key] || 0) + 1;
  }
}

console.log(`=== CAPTURE YIELD since ${SINCE} — ${total} conversations ===\n`);
const sigs = [...new Set(Object.values(byW).flatMap((w) => Object.keys(w)))].sort();
for (const [w, c] of Object.entries(byW).sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y) - Object.values(a[1]).reduce((x, y) => x + y))) {
  const n = Object.values(c).reduce((x, y) => x + y, 0);
  console.log(`${w.padEnd(10)} n=${String(n).padStart(5)}  valid ${String(Math.round((100 * (c.valid || 0)) / n)).padStart(3)}%   ` +
    sigs.filter((s) => s !== "valid" && c[s]).sort((a, b) => c[b] - c[a]).map((s) => `${s}:${c[s]}`).join("  "));
}
for (const s of sigs.filter((x) => x !== "valid")) {
  const rows = Object.entries(byS[s]).sort((a, b) => b[1] - a[1]).slice(0, TOP);
  console.log(`\n── ${s} (${Object.values(byS[s]).reduce((x, y) => x + y, 0)}) ──  ` + rows.map(([k, n]) => `${k}:${n}`).join("  "));
}
