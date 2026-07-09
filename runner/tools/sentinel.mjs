// tools/sentinel.mjs — the self-improving capture-quality loop, end to end.
//
//   DETECT → DIAGNOSE (signature match) → REMEDIATE (auto-run the matching fix)
//          → VERIFY (quality gate) → LEARN (harvest new failure vocabulary) → REPORT
//
// Every capture bug shipped this week (stall-timed answers, turn-boundary bleed, silent
// escalations, label leaks) was found by a human eyeballing the report. This tool runs the
// same forensics automatically so the NEXT variant is caught at bake time, not in a
// screenshot from Max. Run it after every capture wave (and from the weekly job):
//
//   node tools/sentinel.mjs            # detect + diagnose + learn (read-only)
//   node tools/sentinel.mjs --fix      # also apply the known remediations + re-verify
//
// What it checks (each maps to a remediation):
//   1. STALL-TIMED turns   — timed answer with no post-strip substance
//                             → fix-mistimed-stalls.mjs (+ GEN_RE candidates harvested)
//   2. BOUNDARY-BLEED      — role-label leaks / post-unanswered contamination
//                             → fix-boundary-bleed.mjs
//   3. MID-CONV DEATH      — engaged then silent, no handover explanation
//                             → harvest the last-good/first-dead tails: if a repeated
//                               phrase precedes death across convs, it is an ESCALATION/
//                               GATE candidate → written to sentinel-triage.json for the
//                               vendor pattern table (reclass tool + vendors.js)
//   4. JUDGE-COVERAGE DRIFT — valid convs missing scores → prints the eval-pack command
//   5. GATE                 — verify-data.js invariants must hold after any fix
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stripWidgetChrome } from "../reply-clean.js";

const FIX = process.argv.includes("--fix");
// Phrasings that look gate-ish but are trailing UI buttons / optional-help text appended
// AFTER a complete automated answer — must NEVER be learned as escalation gates (the
// 2026-07-10 Gorgias regression). A real gate uses escalation SEMANTICS instead.
const KNOWN_FALSE_GATE = /verify order details|(once |if ).{0,20}logged? in|log in (so|to check)|check your order|track your order|view (your )?order/i;
const ESCALATION_SEMANTICS = /\b(human|agent|team|teammate|representative|colleague|advisor|specialist|associate|concierge|join(ing|ed)?|transfer|escalat|hand(ed|ing)? off|connect you|reach out|get back to you|follow up|respond|via e-?mail|leave your e-?mail|in the queue|be with you|shortly)\b/i;
const HOURS = Number((process.argv.find((a) => /^\d+$/.test(a))) || 24 * 14);
const cut = Date.now() - HOURS * 3600 * 1000;
const out = { checkedConvs: 0, stallTimed: [], bleed: [], midDeath: [], unjudged: 0, stallVocabCandidates: {}, gateCandidates: {} };

const scores = (() => { try { return new Set(Object.keys(JSON.parse(readFileSync("eval-scores.json", "utf8")))); } catch { return new Set(); } })();

for (const d of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  let files; try { files = readdirSync(`results/${d}/conv`); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    let j; try { j = JSON.parse(readFileSync(`results/${d}/conv/${f}`, "utf8")); } catch { continue; }
    if (!j.capturedAt || Date.parse(j.capturedAt) < cut) continue;
    out.checkedConvs++;
    const id = `${d}/${f}`;
    if (j.valid !== false && !scores.has(id)) out.unjudged++;
    const ai = (j.turns || []).filter((t) => t.by === "ai");
    let answeredSeen = 0;
    for (const t of ai) {
      if (t.mistimed_correction || t.boundary_bleed_correction || t.handover_reclass) continue;
      const raw = t.replyText || t.replyTail || "";
      const substance = stripWidgetChrome(raw, t.q);
      // 1. stall-timed: the structural gate should make this impossible on new captures
      if (t.complete_ms != null && substance.length <= 25) {
        out.stallTimed.push(`${id} T${t.turn}`);
        // LEARN: frozen short lines are stall-vocabulary candidates
        raw.split(/\n+/).map((x) => x.trim()).filter((x) => x && x.length <= 60 && !/[.?!]$/.test(x) === false || /[.…]{2,}$/.test(x)).forEach((line) => {
          if (line.length <= 60 && /[.…]$/.test(line)) out.stallVocabCandidates[line.toLowerCase()] = (out.stallVocabCandidates[line.toLowerCase()] || 0) + 1;
        });
      }
      // 2. bleed signature — mirrors fix-boundary-bleed rule A exactly (label leak AND the
      // previous turn unanswered); a label on a healthy turn is chrome, not contamination
      {
        const prev = ai[ai.indexOf(t) - 1];
        if (/(^|\n)\s*(user )?response:/i.test(raw) && t.complete_ms != null && prev && prev.complete_ms == null && !prev.unsent) out.bleed.push(`${id} T${t.turn}`);
      }
      if (t.complete_ms != null) answeredSeen++;
      // 3. mid-death: engaged (>=2 answers) then this turn dead with no handover flag
      if (answeredSeen >= 2 && t.complete_ms == null && !t.handover && substance.length <= 25) {
        out.midDeath.push(`${id} T${t.turn}`);
        // LEARN: the tail of the LAST ANSWERED turn often carries the escalation/gate line
        const prev = [...ai].reverse().find((x) => x.complete_ms != null && x.turn < t.turn);
        const tailLines = (prev?.replyText || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(-3);
        tailLines.forEach((line) => {
          if (/^(⚡\s*)?(powered\s)?by\s/i.test(line) || /give us feedback|^ask |says:$|specialist$|feedback$/i.test(line)) return;   // chrome, not an escalation line
          // DENYLIST — trailing UI buttons / optional-help phrasing that appear AFTER a
          // complete automated answer. These are NOT gates; harvesting them once nuked 54
          // Gorgias convs (2026-07-10). Never re-propose them as escalation candidates.
          if (KNOWN_FALSE_GATE.test(line)) return;
          // an escalation candidate must actually SOUND like a handoff/gate — otherwise it is
          // ordinary answer content (e.g. "no, different discount") that happens to end a turn.
          if (!ESCALATION_SEMANTICS.test(line)) return;
          if (line.length >= 12 && line.length <= 90) {
            const k = `${j.vendor} :: ${line.toLowerCase()}`;
            out.gateCandidates[k] = (out.gateCandidates[k] || 0) + 1;
          }
        });
        break; // one mid-death record per conv is enough
      }
    }
  }
}

console.log(`SENTINEL — ${out.checkedConvs} convs (last ${HOURS}h)`);
console.log(`  stall-timed turns : ${out.stallTimed.length}${out.stallTimed.length ? "  ⚠ " + out.stallTimed.slice(0, 3).join(", ") : "  ✓"}`);
console.log(`  bleed signatures  : ${out.bleed.length}${out.bleed.length ? "  ⚠" : "  ✓"}`);
console.log(`  mid-conv deaths   : ${out.midDeath.length}${out.midDeath.length ? "  (triage below)" : "  ✓"}`);
console.log(`  unjudged valid    : ${out.unjudged}${out.unjudged ? "  → node eval-pack.js /tmp/batch 12 && judge && node eval-merge.js /tmp/batch" : "  ✓"}`);

// LEARNED candidates (repeated across >=2 convs = strong signal, hand to the pattern tables)
const vocab = Object.entries(out.stallVocabCandidates).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
const gates = Object.entries(out.gateCandidates).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
if (vocab.length) { console.log("  LEARNED stall-vocabulary candidates (add to GEN_RE + reply-clean):"); vocab.slice(0, 8).forEach(([p, n]) => console.log(`    ${n}× ${JSON.stringify(p)}`)); }
if (gates.length) { console.log("  LEARNED escalation/gate candidates (add to vendors.js + reclass TABLE):"); gates.slice(0, 8).forEach(([p, n]) => console.log(`    ${n}× ${p.slice(0, 110)}`)); }
writeFileSync("sentinel-triage.json", JSON.stringify({ at: new Date().toISOString(), ...out, stallVocabCandidates: Object.fromEntries(vocab), gateCandidates: Object.fromEntries(gates) }, null, 1));
console.log("  full triage → runner/sentinel-triage.json");

if (FIX && (out.stallTimed.length || out.bleed.length)) {
  console.log("\nREMEDIATE:");
  if (out.stallTimed.length) { console.log("  → fix-mistimed-stalls --apply"); execFileSync("node", ["tools/fix-mistimed-stalls.mjs", "--apply"], { stdio: "inherit" }); }
  if (out.bleed.length) { console.log("  → fix-boundary-bleed --apply"); execFileSync("node", ["tools/fix-boundary-bleed.mjs", "--apply"], { stdio: "inherit" }); }
  console.log("  → rebake + gate");
  execFileSync("node", ["gen.js"], { stdio: "inherit" });
  execFileSync("node", ["verify-data.js"], { stdio: "inherit" });
}

process.exit(out.stallTimed.length || out.bleed.length ? 1 : 0);
