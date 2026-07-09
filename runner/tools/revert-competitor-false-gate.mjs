// tools/revert-competitor-false-gate.mjs — extend the 2026-07-10 fairness correction to
// competitors reclassed with the same over-broad "text contains X → handover" rule.
//
// The Gorgias regression (see revert-gorgias-false-gate.mjs) was one instance of a systemic
// mistake: a phrase that appears AFTER a complete answer (a trailing UI button, a partial
// "I'll have someone email you that one detail", an optional login nudge) was treated as a
// full conversation-level handover, nulling real answers and crushing automation rate.
// The same reclass logic was applied to Siena and DigitalGenius — so the SAME bug may be
// unfairly *suppressing competitors*. That is an integrity problem: the benchmark must be
// honest in both directions.
//
// Principle (symmetric across every vendor): an AI turn that produced a SUBSTANTIVE answer is
// automated — full stop. A turn is a handover ONLY if the AI produced no answer and genuinely
// handed off. So:
//   - keptAnswering  = the AI gave a substantive answer on ANY turn AFTER the flagged one
//                      → the widget never handed off → FALSE POSITIVE → restore the whole conv.
//   - otherwise      = genuine escalation (AI went silent after the banner) → keep it, BUT
//                      still restore the detecting turn's own answer if it had one (don't
//                      undercount the answer the AI gave before handing off).
//
//   node tools/revert-competitor-false-gate.mjs [siena|dg ...]        # dry run (default: siena)
//   node tools/revert-competitor-false-gate.mjs siena dg --apply
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { convoValidity } from "../classify.js";
import { stripWidgetChrome } from "../reply-clean.js";

const APPLY = process.argv.includes("--apply");
const prefixes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const PREFIXES = prefixes.length ? prefixes : ["siena"];
const SUBSTANCE = 80;

let fullRevert = 0, answerOnlyRestore = 0, kept = 0, turnsRestored = 0;
for (const d of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  let files; try { files = readdirSync(`results/${d}/conv`); } catch { continue; }
  for (const f of files) {
    if (!PREFIXES.some((p) => f.startsWith(p)) || !f.endsWith(".json")) continue;
    const path = `results/${d}/conv/${f}`;
    let j; try { j = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    const ts = j.turns || [];
    const hi = ts.findIndex((t) => t.handover_reclass);
    if (hi < 0) continue;                                        // not reclassed by the tool

    const substantive = (t) => t.complete_ms != null && stripWidgetChrome(t.replyText || t.replyTail || "", t.q).length >= SUBSTANCE;
    const keptAnswering = ts.slice(hi + 1).some(substantive);

    let restored = 0, mode;
    if (keptAnswering) {
      // FALSE POSITIVE — widget stayed in control. Restore every reclassed turn from audit.
      mode = "full";
      for (const t of ts) {
        if (!t.handover_reclass) continue;
        const r = t.handover_reclass;
        t.by = r.was_by;
        if (r.was_complete_ms != null) { t.complete_ms = r.was_complete_ms; t.ai_latency_ms = r.was_complete_ms; }
        delete t.handover; delete t.handover_hit; delete t.handover_reclass;
        restored++;
      }
    } else {
      // genuine escalation — keep the handover, but un-null the detecting turn's OWN answer
      const t = ts[hi];
      if (t.handover_reclass && t.handover_reclass.was_complete_ms != null) {
        mode = "answer-only";
        t.by = "ai"; t.complete_ms = t.handover_reclass.was_complete_ms; t.ai_latency_ms = t.handover_reclass.was_complete_ms;
        // it answered THEN handed off: mark the handoff on this turn but count its answer
        t.handover = true; delete t.handover_reclass;
        restored++;
      } else { kept++; continue; }
    }
    if (!restored) { kept++; continue; }

    const ai = ts.filter((t) => t.by === "ai" && t.complete_ms != null).map((t) => t.complete_ms);
    const v = convoValidity(ts);
    j.valid = v.valid; j.invalid_reason = v.reason ?? null;
    if (j.stats) {
      Object.assign(j.stats, {
        answered_no_handover: ts.filter((t) => t.by === "ai" && t.complete_ms != null && !t.handover).length,
        success_rate: ts.length ? Math.round(ai.length / ts.length * 100) : null,
        avg_ms: ai.length ? Math.round(ai.reduce((a, b) => a + b, 0) / ai.length) : null,
        min_ms: ai.length ? Math.min(...ai) : null, max_ms: ai.length ? Math.max(...ai) : null,
        valid: v.valid, timed_turns: v.timed,
      });
      if (mode === "full") delete j.stats.handover_turn;
    }
    j.false_gate_revert = { fixed: "2026-07-10", mode, vendor: j.vendor };
    if (mode === "full") fullRevert++; else answerOnlyRestore++;
    turnsRestored += restored;
    if (APPLY) writeFileSync(path, JSON.stringify(j));
    else console.log(`  ${mode.padEnd(11)} ${d}/${f} — answered→${ai.length}, +${restored} turns, valid=${v.valid}`);
  }
}
console.log(`${APPLY ? "APPLIED" : "DRY RUN —"} full-revert ${fullRevert} · answer-restore ${answerOnlyRestore} · kept-as-handover ${kept} · ${turnsRestored} turns restored [${PREFIXES.join(",")}]`);
