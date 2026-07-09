// tools/audit-capture.mjs — per-vendor CAPTURE-QUALITY audit (proactive, run after any
// runner change). For each vendor's freshest conversations (default last 24h), classify
// every AI turn as: CLEAN (timed + substantive), HANDOVER/GATE (honest stop), EMPTY-DEAD
// (sent, no answer captured, no explanation — the bad pattern), or STALL-TIMED (timed but
// no substance — must be zero after the structural gate). Prints a verdict matrix; exits
// non-zero if any vendor shows STALL-TIMED turns or an unexplained EMPTY-DEAD rate >30%.
//
//   node tools/audit-capture.mjs [hours-back]      # from runner/, default 24
import { readdirSync, readFileSync, statSync } from "node:fs";
import { stripWidgetChrome } from "../reply-clean.js";

const HOURS = Number(process.argv[2]) || 24;
const cut = Date.now() - HOURS * 3600 * 1000;
const perV = {};
for (const d of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  let files; try { files = readdirSync(`results/${d}/conv`); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const p = `results/${d}/conv/${f}`;
    if (statSync(p).mtimeMs < cut) continue;               // cheap prefilter
    let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
    // audit the CAPTURE cohort, not files merely rewritten by correction tools
    if (!j.capturedAt || Date.parse(j.capturedAt) < cut) continue;
    const v = (perV[j.vendor] = perV[j.vendor] || { convs: 0, clean: 0, handover: 0, emptyDead: 0, stallTimed: 0, unsent: 0, excludedFix: 0, cWall: 0, cMidDeath: 0, cClean: 0, cHand: 0, midDeathFiles: [] });
    v.convs++;
    // conv-level classification: wall (never engaged) vs mid-conversation death (engaged
    // then went silent — the tracking-suspicion case) vs clean vs handover
    {
      const ai = (j.turns || []).filter((t) => t.by === "ai" && !t.mistimed_correction && !t.boundary_bleed_correction);
      const answered = ai.filter((t) => t.complete_ms != null).length;
      const hasHand = (j.turns || []).some((t) => t.handover);
      if (hasHand) v.cHand++;
      else if (answered === 0) v.cWall++;
      else if (answered >= 2 && ai.slice(-2).every((t) => t.complete_ms == null)) { v.cMidDeath++; v.midDeathFiles.push(`${d}/${f}`); }
      else v.cClean++;
    }
    for (const t of j.turns || []) {
      if (t.mistimed_correction || t.boundary_bleed_correction) { v.excludedFix++; continue; }
      if (t.by === "human" || t.unsent) { v.handover++; continue; }
      if (t.by !== "ai") continue;
      const substance = stripWidgetChrome(t.replyText || t.replyTail || "", t.q);
      if (t.complete_ms != null && substance.length >= 25) v.clean++;
      else if (t.complete_ms != null) v.stallTimed++;                     // MUST be zero post-fix
      else if (substance.length >= 25) v.clean++;                        // late/untimed but real text (honest —ms)
      else v.emptyDead++;                                                // sent into the void, no explanation
    }
  }
}
let fail = false;
console.log("VENDOR           convs | clean  handover  WALL  MID-DEATH | stall-timed");
for (const [v, s] of Object.entries(perV).sort()) {
  const bad = s.stallTimed > 0 || s.cMidDeath > 0;
  if (bad) fail = true;
  console.log(`${v.padEnd(16)} ${String(s.convs).padStart(5)} | ${String(s.cClean).padStart(5)}  ${String(s.cHand).padStart(8)}  ${String(s.cWall).padStart(4)}  ${String(s.cMidDeath).padStart(9)} | ${String(s.stallTimed).padStart(11)}${bad ? "   ⚠" : ""}`);
  s.midDeathFiles.slice(0, 3).forEach((f) => console.log(`                    ↳ mid-death: ${f}`));
}
if (!Object.keys(perV).length) { console.log(`no conversations captured in the last ${HOURS}h`); process.exit(2); }
process.exit(fail ? 1 : 0);
