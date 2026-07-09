// tools/reclass-gorgias-handovers.mjs — reclassify Gorgias conversations killed by a
// SILENT escalation or a verification gate (2026-07-09).
//
// Gorgias escalates mid-conversation with "A support agent is joinING the chat — our team
// will respond as soon as they join", or blocks with a login gate ("Verify order details",
// "Once you're logged in…"). The old handover patterns only knew "joinED the chat", so the
// runner kept sending questions to a dead AI: turns recorded as EMPTY failures instead of
// an honest handover (user-reported screenshot: T4-T7 empty).
//
// Reclassification (in place, audited): first turn whose stored text matches an
// escalation/gate pattern → that turn and everything after become by:"human" (handover),
// timings nulled, stats + validity re-derived. This is the same outcome run.js now
// records live with the fixed patterns in vendors.js.
//
//   node tools/reclass-gorgias-handovers.mjs           # dry run
//   node tools/reclass-gorgias-handovers.mjs --apply
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { convoValidity } from "../classify.js";

const APPLY = process.argv.includes("--apply");
// per-vendor escalation/gate phrasings discovered by the capture audit (extend as found)
const TABLE = {
  gorgias: [
    /(is |agent )joining the (chat|conversation)/i,
    /will respond as soon as they join/i,
    // NB: do NOT add "verify order details" / "once you're logged in" here — they are a
    // trailing UI button + optional-help phrasing appended AFTER a complete automated
    // answer, not an escalation. See revert-gorgias-false-gate.mjs (2026-07-10).
    /please (log|sign) in to (continue|proceed|verify)/i,
  ],
  dg: [/submit an email and we.?ll (come|get) back/i],
  siena: [/routed to (a )?human agent/i, /we.?ll (follow up|reach out to you)( shortly)?( with more information)? via e-?mail/i],
};

let convsTouched = 0, turnsFlipped = 0;
for (const d of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  let files; try { files = readdirSync(`results/${d}/conv`); } catch { continue; }
  for (const f of files) {
    const prefix = Object.keys(TABLE).find((p) => f.startsWith(p));
    if (!prefix || !f.endsWith(".json")) continue;
    const PATTERNS = TABLE[prefix];
    const path = `results/${d}/conv/${f}`;
    let j; try { j = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    if (j.turns?.some((t) => t.handover_reclass)) continue;   // already processed
    const ts = j.turns || [];
    const hit = ts.findIndex((t) => PATTERNS.some((re) => re.test(t.replyText || t.replyTail || "")));
    if (hit < 0) continue;
    const matched = PATTERNS.map((re) => (ts[hit].replyText || ts[hit].replyTail || "").match(re)).find(Boolean)?.[0] || "escalation/gate";
    let flipped = 0;
    for (let i = hit; i < ts.length; i++) {
      const t = ts[i];
      if (t.by === "human") continue;                          // already classified
      // keep turns that genuinely got answered AFTER the banner (rare; the gate text can
      // appear inside an otherwise-answered turn's delta) — only flip unanswered ones,
      // except the detecting turn itself which becomes the handover point.
      if (i > hit && t.complete_ms != null) continue;
      t.handover_reclass = { was_by: t.by, was_complete_ms: t.complete_ms ?? null, fixed: "2026-07-09" };
      t.by = "human"; t.complete_ms = null; t.ai_latency_ms = null; if ("ttft_ms" in t) t.ttft_ms = null;
      if (i === hit) { t.handover = true; t.handover_hit = matched.slice(0, 80); }
      flipped++;
    }
    if (!flipped) continue;
    convsTouched++; turnsFlipped += flipped;
    const ai = ts.filter((t) => t.by === "ai" && t.complete_ms != null).map((t) => t.complete_ms);
    const v = convoValidity(ts);
    j.valid = v.valid; j.invalid_reason = v.reason ?? j.invalid_reason;
    if (j.stats) Object.assign(j.stats, {
      answered_no_handover: ai.length,
      success_rate: ts.length ? Math.round(ai.length / ts.length * 100) : null,
      avg_ms: ai.length ? Math.round(ai.reduce((a, b) => a + b, 0) / ai.length) : null,
      min_ms: ai.length ? Math.min(...ai) : null, max_ms: ai.length ? Math.max(...ai) : null,
      handover_turn: hit + 1, valid: v.valid, timed_turns: v.timed,
    });
    if (APPLY) writeFileSync(path, JSON.stringify(j));
    else console.log(`  would reclass ${d}/${f} — handover@T${hit + 1} ("${matched.slice(0, 50)}"), ${flipped} turns flipped`);
  }
}
console.log(`${APPLY ? "RECLASSED" : "DRY RUN —"} ${convsTouched} Gorgias convs, ${turnsFlipped} turns → human/handover`);
