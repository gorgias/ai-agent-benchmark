// eval-pack.js — prepares LLM-judge eval batches from captured conversations. (judge spec v2)
// Scans runner/results/*/conv/*.json, keeps VALID conversations (same gate as the
// report), skips ones already scored in eval-scores.json (incremental), and writes
// compact batch files for the judge. The judge itself runs as harness subagents
// (no API key on this machine); eval-merge.js folds their outputs back in.
//
// v2 (see eval-rubric.md, the canonical judge spec):
//  - BLIND batches: each conversation is keyed by an opaque `k`; vendor/store names are
//    stripped from metadata and masked inside transcript text. Judges score behavior,
//    not brands. A sidecar map-###.json (k → conversation id) stays with the batch dir
//    and is consumed by eval-merge.js — it is never shown to a judge.
//  - DETERMINISTIC SIGNALS: price/link/review/option presence is detected here by regex
//    and re-enforced at merge; rich-element checks can't pass without the signal.
//
// Usage: node eval-pack.js <outDir> [batchSize=12] [--rejudge id1,id2 | --rejudge-file list.json]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { convoValidity, convoOutcome } from "./classify.js";
import { convoSignals } from "./eval-signals.js";
import { stripWidgetChrome } from "./reply-clean.js";
import { isQuarantinedConversation } from "./conversation-quarantine.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, "results");
const SCORES = path.join(HERE, "eval-scores.json");

const args = process.argv.slice(2);
const outDir = args[0];
const batchSize = Number(args[1]) || 12;
if (!outDir || outDir.startsWith("--")) { console.error("usage: node eval-pack.js <outDir> [batchSize] [--rejudge ids | --rejudge-file f]"); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

// --rejudge: pack ONLY these already-scored conversation ids (pinned-cohort re-runs —
// same conversations, current judge spec — so before/after comparisons are same-sample).
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
let rejudge = null;
if (flag("--rejudge")) rejudge = new Set(flag("--rejudge").split(","));
if (flag("--rejudge-file")) rejudge = new Set(JSON.parse(fs.readFileSync(flag("--rejudge-file"), "utf8")));

// deterministic rich-element signals live in eval-signals.js (side-effect-free shared module —
// eval-merge.js/eval-audit.js must never import THIS file: its top level runs the packer)

// Mask vendor/store identity in transcript text so judging is blind. Masks the store name,
// the vendor name, and common "Powered by <vendor>" footers.
function maskText(s, names) {
  let out = s || "";
  for (const n of names.filter(Boolean)) {
    if (n.length < 3) continue;
    out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "the store");
  }
  return out.replace(/powered by [a-z0-9 .&-]{2,30}/gi, "");
}

const scored = fs.existsSync(SCORES) ? JSON.parse(fs.readFileSync(SCORES, "utf8")) : {};
const packets = [];
for (const date of fs.readdirSync(RESULTS).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
  const dir = path.join(RESULTS, date, "conv");
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const id = `${date}/${f}`;
    if (isQuarantinedConversation(id)) continue;
    if (rejudge ? !rejudge.has(id) : scored[id]) continue;   // incremental, or pinned re-judge
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if (!convoValidity(j.turns).valid) continue;
    const o = convoOutcome(j.turns);
    const names = [j.store, j.vendor, (j.store || "").split(/\s+/)[0]];
    const turns = (j.turns || []).filter((t) => !t.unsent).map((t) => ({
      q: maskText(t.q, names), by: t.by, answered: t.complete_ms != null,
      // strip widget chrome / suggested-reply chips / product-card fragments before the judge
      // sees it (reply-clean.js) so chips can't be mis-credited as discovery/rich elements.
      // Price/link/review presence is captured separately via convoSignals, so no signal is lost.
      reply: maskText(stripWidgetChrome(t.replyTail, t.q).slice(0, 700), names),
    }));
    packets.push({ id, mode: j.mode, theme: j.themeLabel || j.theme, outcome: o.outcome, signals: convoSignals(j.turns), turns });
  }
}

let n = 0;
for (let i = 0; i < packets.length; i += batchSize) {
  const slice = packets.slice(i, i + batchSize);
  const nn = String(++n).padStart(3, "0");
  // judge-visible batch: opaque keys, no ids/vendors/stores
  const blind = slice.map((p, idx) => ({ k: `c${nn}-${String(idx + 1).padStart(2, "0")}`, mode: p.mode, theme: p.theme, signals: p.signals, turns: p.turns }));
  fs.writeFileSync(path.join(outDir, `batch-${nn}.json`), JSON.stringify(blind, null, 1));
  // merge-side map: k → conversation id (NOT for judges)
  fs.writeFileSync(path.join(outDir, `map-${nn}.json`), JSON.stringify(Object.fromEntries(slice.map((p, idx) => [`c${nn}-${String(idx + 1).padStart(2, "0")}`, p.id])), null, 1));
}
console.log(`${packets.length} conversations → ${n} blind batches of ≤${batchSize} in ${outDir} (judge spec v2 — see eval-rubric.md; map-*.json is merge-side only)`);
