// tools/fix-mistimed-stalls.mjs — data correction for the 2026-07-09 Kodif stall bug.
//
// Bug: Kodif's rotating progress lines ("Agent is thinking…", "Getting the context…",
// "Cooking up something good…", "Got it. Popping the hood…") sit FROZEN >5s while the
// real answer generates. They predate the GEN_RE patterns added on 2026-07-09, so
// timeTurn's settle check saw a stable transcript and recorded the INDICATOR as the
// completed answer — a fake latency and a fake "answered" turn.
//
// Correction (in place — conversations are NEVER moved or deleted): for every AI turn
// whose captured reply, once stall/chrome lines are removed, contains NO substance yet
// carries a complete_ms, null out complete_ms / ai_latency_ms / ttft_ms (the real answer
// was never observed — its latency is UNKNOWN, not 6.8s), keep the original values in a
// `mistimed_correction` audit field, then re-derive the conversation's stats + validity.
//
//   node tools/fix-mistimed-stalls.mjs           # from runner/ — dry run (report only)
//   node tools/fix-mistimed-stalls.mjs --apply   # write corrections
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { convoValidity } from "../classify.js";
import { stripWidgetChrome } from "../reply-clean.js";

const APPLY = process.argv.includes("--apply");
const STALL_ONLY_MAX = 25;   // post-strip substance below this = no real answer was captured

let convsTouched = 0, turnsFixed = 0;
const byVendor = {};
for (const d of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  let files; try { files = readdirSync(`results/${d}/conv`); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const path = `results/${d}/conv/${f}`;
    let j; try { j = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    let touched = false;
    for (const t of j.turns || []) {
      if (t.by !== "ai" || t.complete_ms == null) continue;
      const raw = t.replyText || t.replyTail || "";
      if (!/(agent is thinking|getting the context|cooking up something|popping the hood|crunching the numbers)/i.test(raw)) continue;
      const substance = stripWidgetChrome(raw, t.q);       // stall/chrome lines now stripped
      if (substance.length > STALL_ONLY_MAX) continue;     // real answer present → timing legit
      t.mistimed_correction = { was_complete_ms: t.complete_ms, was_ttft_ms: t.ttft_ms ?? null, fixed: "2026-07-09", reason: "stall indicator recorded as answer (pre-GEN_RE-fix)" };
      t.complete_ms = null; t.ai_latency_ms = null; if ("ttft_ms" in t) t.ttft_ms = null;
      turnsFixed++; touched = true;
    }
    if (!touched) continue;
    convsTouched++;
    byVendor[j.vendor] = (byVendor[j.vendor] || 0) + 1;
    // re-derive stats + validity from the corrected turns (same math as capture)
    const ai = (j.turns || []).filter((t) => t.by === "ai" && t.complete_ms != null).map((t) => t.complete_ms);
    const answered = ai.length;
    const fh = (j.turns || []).find((t) => t.handover);
    const v = convoValidity(j.turns || []);
    j.valid = v.valid; j.invalid_reason = v.reason ?? j.invalid_reason;
    if (j.stats) Object.assign(j.stats, {
      answered_no_handover: answered,
      success_rate: (j.turns || []).length ? Math.round(answered / j.turns.length * 100) : null,
      avg_ms: ai.length ? Math.round(ai.reduce((a, b) => a + b, 0) / ai.length) : null,
      min_ms: ai.length ? Math.min(...ai) : null,
      max_ms: ai.length ? Math.max(...ai) : null,
      handover_turn: fh ? fh.turn : null, valid: v.valid, timed_turns: v.timed,
    });
    if (APPLY) writeFileSync(path, JSON.stringify(j));
    else console.log(`  would fix ${d}/${f} (${(j.turns || []).filter((t) => t.mistimed_correction).length} turns)`);
  }
}
console.log(`${APPLY ? "FIXED" : "DRY RUN —"} ${turnsFixed} mistimed turns across ${convsTouched} conversations`);
console.log(Object.entries(byVendor).map(([v, n]) => `${v}:${n}`).join("  ") || "none");
if (!APPLY && convsTouched) console.log("re-run with --apply to write corrections");
