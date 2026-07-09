// tools/fix-boundary-bleed.mjs — data correction for the 2026-07-09 turn-boundary bug.
//
// Bug: an answer that outlives TURN_TIMEOUT lands INSIDE the next turn's window — turn N
// records empty ("streamed past timing window") and turn N+1's delta captures answer(N)
// (Kodif's DOM even leaks a raw "response:" node next to the rendered copy). The N+1
// timing then measures the tail of N's generation, not N+1's answer. Probe evidence:
// tools/probe-turn-boundary.mjs on kodif-neuro (generations regularly exceed 45s).
//
// Correction (in place — conversations NEVER moved/deleted):
//   RULE A (all vendors): turn whose raw reply leaks a "(user )response:" role label AND
//          previous turn unanswered → timing untrustworthy → null complete/ttft.
//   RULE B (Kodif only — probe-validated slow generations): any timed turn directly after
//          an unanswered (non-unsent) AI turn → same nulling. Other vendors answer within
//          the window, so their "timeout then normal turn" pattern is benign — not touched.
// Original values kept in `boundary_bleed_correction`; stats + validity re-derived.
// Display/judge text is repaired upstream by reply-clean (label strip + raw/rendered dedupe).
//
//   node tools/fix-boundary-bleed.mjs           # dry run
//   node tools/fix-boundary-bleed.mjs --apply
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { convoValidity } from "../classify.js";

const APPLY = process.argv.includes("--apply");
let turnsFixed = 0, convsTouched = 0; const byVendor = {}, ids = [];
for (const d of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  let files; try { files = readdirSync(`results/${d}/conv`); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const path = `results/${d}/conv/${f}`;
    let j; try { j = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    let touched = false;
    const ts = j.turns || [];
    for (let i = 1; i < ts.length; i++) {
      const prev = ts[i - 1], t = ts[i];
      if (t.by !== "ai" || t.complete_ms == null || t.boundary_bleed_correction || t.mistimed_correction) continue;
      const prevUnanswered = prev.by === "ai" && prev.complete_ms == null && !prev.unsent && !prev.error;
      const raw = t.replyText || t.replyTail || "";
      const hasLabel = /(^|\n)\s*(user )?response:/i.test(raw);
      const ruleA = hasLabel && prevUnanswered;
      const ruleB = j.vendor === "Kodif" && prevUnanswered;
      if (!ruleA && !ruleB) continue;
      t.boundary_bleed_correction = { was_complete_ms: t.complete_ms, was_ttft_ms: t.ttft_ms ?? null, rule: ruleA ? "A:label" : "B:kodif-post-unanswered", fixed: "2026-07-09" };
      t.complete_ms = null; t.ai_latency_ms = null; if ("ttft_ms" in t) t.ttft_ms = null;
      turnsFixed++; touched = true;
    }
    if (!touched) continue;
    convsTouched++; byVendor[j.vendor] = (byVendor[j.vendor] || 0) + 1; ids.push(`${d}/${f}`);
    const ai = ts.filter((t) => t.by === "ai" && t.complete_ms != null).map((t) => t.complete_ms);
    const fh = ts.find((t) => t.handover);
    const v = convoValidity(ts);
    j.valid = v.valid; j.invalid_reason = v.reason ?? j.invalid_reason;
    if (j.stats) Object.assign(j.stats, {
      answered_no_handover: ai.length,
      success_rate: ts.length ? Math.round(ai.length / ts.length * 100) : null,
      avg_ms: ai.length ? Math.round(ai.reduce((a, b) => a + b, 0) / ai.length) : null,
      min_ms: ai.length ? Math.min(...ai) : null, max_ms: ai.length ? Math.max(...ai) : null,
      handover_turn: fh ? fh.turn : null, valid: v.valid, timed_turns: v.timed,
    });
    if (APPLY) writeFileSync(path, JSON.stringify(j));
  }
}
console.log(`${APPLY ? "FIXED" : "DRY RUN —"} ${turnsFixed} bleed-contaminated turns across ${convsTouched} convs`);
console.log(Object.entries(byVendor).map(([v, n]) => `${v}:${n}`).join("  ") || "none");
if (APPLY) writeFileSync("/tmp/rejudge-bleed.json", JSON.stringify(ids));
if (APPLY) console.log(`conv ids for re-judge → /tmp/rejudge-bleed.json (${ids.length})`);
