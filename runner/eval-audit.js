// eval-audit.js — adversarial second pass over judge verdicts (see eval-rubric.md §Audit loop).
// Samples scored v2 conversations, re-packs them WITH their verdicts + transcripts for an
// independent auditor (a separate harness subagent), and merges the audit back:
//   AGREE            — verdict stands
//   FALSE_POSITIVE   — check credited without real evidence (trap T6/T7…)   → check flipped to fail
//   FALSE_NEGATIVE   — check failed on a judge trap (notes/judge-traps.md)  → check flipped to pass
// Re-derives scores after flips (same mapping as eval-merge.js). A run is TRUSTED when
// agreement ≥ 90%; the summary (per-check accuracy, trap hits) is written to eval-audit.json
// and surfaced in the report's method notes.
//
// Usage:
//   node eval-audit.js pack <outDir> [sampleSize=24]   # sample + write audit batches
//   node eval-audit.js merge <auditedDir>              # fold auditor outputs back in
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { convoSignals } from "./eval-signals.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCORES = path.join(HERE, "eval-scores.json");
const AUDIT = path.join(HERE, "eval-audit.json");
const RESULTS = path.join(HERE, "results");
const [cmd, dir, szArg] = process.argv.slice(2);
if (!cmd || !dir) { console.error("usage: node eval-audit.js pack <outDir> [sampleSize] | merge <auditedDir>"); process.exit(1); }

const CHECKS = {
  shopping: { answer: { a_direct: 14, a_consistent: 9, a_no_ignored: 7 }, discovery: { d_clarify: 8, d_progressive: 7, d_not_dump: 5 }, recommendation: { r_named: 9, r_fit: 8, r_plausible: 5 }, rich: { e_price: 6, e_link: 7, e_reviews: 3, e_options: 2 }, close: { c_cta: 5, c_cart: 3, c_clean: 2 } },
  support: { resolution: { s_answered: 18, s_outcome: 12, s_no_deflect: 10 }, accuracy: { g_specific: 13, g_consistent: 5, g_grounded: 7 }, actionability: { t_steps: 12, t_complete: 8 }, close: { k_expectations: 8, k_clean: 7 } },
};
const SIGNAL_GATE = { e_price: "has_price", e_link: "has_link", e_reviews: "has_reviews", e_options: "has_options" };
// id format: "<date>/<file>.json" → on disk at results/<date>/conv/<file>.json
const convTurns = (id) => { try { return JSON.parse(fs.readFileSync(path.join(RESULTS, id.slice(0, 10), "conv", id.slice(11)), "utf8")).turns || []; } catch { return []; } };
const rederive = (mode, checks, signals) => {
  const rubric = {}; let total = 0;
  for (const [dim, defs] of Object.entries(CHECKS[mode])) {
    let s = 0;
    for (const [cid, pts] of Object.entries(defs)) {
      const c = checks[cid]; let pass = !!(c && c.pass);
      if (pass && SIGNAL_GATE[cid] && !signals[SIGNAL_GATE[cid]]) pass = false;
      if (pass) s += pts;
    }
    rubric[dim] = s; total += s;
  }
  return { rubric, total };
};

const scores = JSON.parse(fs.readFileSync(SCORES, "utf8"));

if (cmd === "pack") {
  const size = Number(szArg) || 24;
  const v2 = Object.entries(scores).filter(([, e]) => e.v === 2 && e.checks);
  // deterministic stratified sample: sort by id hash, alternate lanes
  const lane = (m) => v2.filter(([, e]) => e.mode === m).sort((a, b) => a[0].localeCompare(b[0]));
  const pick = [];
  const [sh, su] = [lane("shopping"), lane("support")];
  for (let i = 0; pick.length < Math.min(size, v2.length) && (i < sh.length || i < su.length); i++) {
    if (sh[i]) pick.push(sh[i]); if (su[i] && pick.length < size) pick.push(su[i]);
  }
  fs.mkdirSync(dir, { recursive: true });
  const items = pick.map(([id, e]) => {
    const turns = convTurns(id);
    return { id, mode: e.mode, verdicts: e.checks, resolution_class: e.resolution_class,
      turns: turns.filter((t) => !t.unsent).map((t) => ({ q: t.q, by: t.by, reply: (t.replyTail || "").slice(-450) })) };
  });
  const per = 8;
  let n = 0;
  for (let i = 0; i < items.length; i += per) fs.writeFileSync(path.join(dir, `audit-${String(++n).padStart(2, "0")}.json`), JSON.stringify(items.slice(i, i + per), null, 1));
  console.log(`packed ${items.length} scored conversations → ${n} audit batches in ${dir}`);
} else if (cmd === "merge") {
  let agree = 0, fp = 0, fn = 0, flips = 0;
  const perCheck = {}, trapHits = {};
  for (const f of fs.readdirSync(dir).filter((x) => /^audited-.*\.json$/.test(x)).sort()) {
    let arr; try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { console.error(`SKIP ${f}`); continue; }
    for (const a of arr) {
      const e = scores[a.id]; if (!e || e.v !== 2) continue;
      let changed = false;
      for (const [cid, verdict] of Object.entries(a.audit || {})) {
        const pc = (perCheck[cid] = perCheck[cid] || { agree: 0, fp: 0, fn: 0 });
        if (verdict.classification === "AGREE") { agree++; pc.agree++; continue; }
        if (verdict.classification === "FALSE_POSITIVE" && e.checks[cid]) { fp++; pc.fp++; e.checks[cid].pass = false; changed = true; }
        if (verdict.classification === "FALSE_NEGATIVE" && e.checks[cid]) { fn++; pc.fn++; e.checks[cid].pass = true; e.checks[cid].evidence = String(verdict.evidence || e.checks[cid].evidence || "").slice(0, 160); changed = true; }
        if (verdict.trap) trapHits[verdict.trap] = (trapHits[verdict.trap] || 0) + 1;
      }
      if (changed) {
        const d = rederive(e.mode, e.checks, convoSignals(convTurns(a.id)));
        e.rubric = d.rubric; e.total = d.total; e.audited = true; flips++;
      }
    }
  }
  const totalVerdicts = agree + fp + fn;
  const agreement = totalVerdicts ? Math.round(1000 * agree / totalVerdicts) / 10 : null;
  const summary = { audited_at: new Date().toISOString(), verdicts: totalVerdicts, agreement_pct: agreement,
    trusted: agreement != null && agreement >= 90, false_positives: fp, false_negatives: fn, rescored: flips, perCheck, trapHits };
  fs.writeFileSync(AUDIT, JSON.stringify(summary, null, 1));
  fs.writeFileSync(SCORES, JSON.stringify(scores, null, 1));
  console.log(`audit merged: ${totalVerdicts} verdicts · agreement ${agreement}% (${summary.trusted ? "TRUSTED" : "NOT trusted — investigate"}) · ${fp} FP + ${fn} FN → ${flips} conversations re-scored`);
} else { console.error("unknown command"); process.exit(1); }
