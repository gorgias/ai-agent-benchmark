// tools/revert-gorgias-false-gate.mjs — undo the 2026-07-10 over-correction.
//
// reclass-gorgias-handovers.mjs treated "Verify order details" / "once you're logged in"
// as silent escalation gates and flipped 54 Gorgias conversations to human/handover,
// nulling their timings. Those strings are NOT gates — "Verify order details" is a trailing
// UI button and "if you log in we can check…" is optional-help phrasing that Gorgias appends
// AFTER a complete, automated answer. The AI kept answering every subsequent question. The
// bad reclass crushed Gorgias's automation rate + latency → #1 → #4/#11 on the report.
//
// This reverts ONLY the false-positive convs (hit turn's handover_hit matches the bad
// phrasings). The genuine "…is joining the chat / will respond as soon as they join"
// escalations are left untouched. Restoration is exact: reclass stored was_by +
// was_complete_ms per flipped turn (audit fields), and on every healthy Gorgias turn
// ai_latency_ms === complete_ms, so both are rebuilt exactly. ttft_ms was not stored, so it
// stays null on reverted turns — gen.js filters nulls out of the ttft median (no fabrication).
//
//   node tools/revert-gorgias-false-gate.mjs           # dry run (before/after per conv)
//   node tools/revert-gorgias-false-gate.mjs --apply
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { convoValidity } from "../classify.js";

const APPLY = process.argv.includes("--apply");
const FALSE_GATE = /verify order details|once you.?re logged in/i;

let convsReverted = 0, turnsRestored = 0, convsKept = 0;
for (const d of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  let files; try { files = readdirSync(`results/${d}/conv`); } catch { continue; }
  for (const f of files) {
    if (!f.startsWith("gorgias") || !f.endsWith(".json")) continue;
    const path = `results/${d}/conv/${f}`;
    let j; try { j = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    const ts = j.turns || [];
    const hit = ts.find((t) => t.handover_hit);
    if (!hit) continue;                                  // never reclassed
    if (!FALSE_GATE.test(hit.handover_hit || "")) { convsKept++; continue; } // genuine escalation → leave

    const before = ts.filter((t) => t.by === "ai" && t.complete_ms != null).length;
    let restored = 0;
    // (a) reclass-tool convs carry audit fields → exact restore
    for (const t of ts) {
      if (!t.handover_reclass) continue;
      const r = t.handover_reclass;
      t.by = r.was_by;
      if (r.was_complete_ms != null) { t.complete_ms = r.was_complete_ms; t.ai_latency_ms = r.was_complete_ms; }
      // was originally unanswered → restore to captured "ai, no answer" truth (do not fabricate)
      delete t.handover; delete t.handover_hit; delete t.handover_reclass;
      restored++;
    }
    // (b) LIVE-captured convs: run.js saw the false gate in a COMPLETE answer, flagged
    // handover and abandoned the rest of the conversation. The detecting turn keeps its real
    // timing (never nulled) → restore it to ai; the abandoned tail (human + no reply + no
    // timing) was never sent → mark unsent so it is honestly excluded, not counted as human.
    const liveHit = ts.find((t) => !t.handover_reclass && t.handover && FALSE_GATE.test(t.handover_hit || ""));
    if (liveHit) {
      liveHit.by = "ai"; delete liveHit.handover; delete liveHit.handover_hit; restored++;
      for (const t of ts) {
        if (t === liveHit) continue;
        if (t.by === "human" && t.complete_ms == null && !(t.replyText || t.replyTail)) { t.unsent = true; restored++; }
      }
    }
    if (!restored) continue;

    // re-derive stats + validity exactly like the reclass tool did (inverse direction)
    const ai = ts.filter((t) => t.by === "ai" && t.complete_ms != null).map((t) => t.complete_ms);
    const v = convoValidity(ts);
    j.valid = v.valid; j.invalid_reason = v.reason ?? null;
    if (j.stats) {
      Object.assign(j.stats, {
        answered_no_handover: ai.length,
        success_rate: ts.length ? Math.round(ai.length / ts.length * 100) : null,
        avg_ms: ai.length ? Math.round(ai.reduce((a, b) => a + b, 0) / ai.length) : null,
        min_ms: ai.length ? Math.min(...ai) : null, max_ms: ai.length ? Math.max(...ai) : null,
        valid: v.valid, timed_turns: v.timed,
      });
      delete j.stats.handover_turn;
    }
    j.false_gate_revert = { fixed: "2026-07-10", was_hit: hit.handover_hit?.slice(0, 60) ?? null };
    convsReverted++; turnsRestored += restored;
    if (APPLY) writeFileSync(path, JSON.stringify(j));
    else console.log(`  revert ${d}/${f} — answered ${before}→${ai.length}, ${restored} turns restored, valid=${v.valid}`);
  }
}
console.log(`${APPLY ? "REVERTED" : "DRY RUN —"} ${convsReverted} false-gate Gorgias convs (${turnsRestored} turns), kept ${convsKept} genuine escalation convs`);
