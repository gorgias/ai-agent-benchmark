// tools/rederive-scores.mjs — re-applies the deterministic scoring rules (eval-score.js) to
// EVERY conversation already in eval-scores.json, using each entry's stored judge CHECKS +
// freshly-recomputed signals. It does NOT change any judge verdict — it only re-derives the
// rubric sub-scores and /100 total, so a scoring-rule change (e.g. the no_deflect gate) is
// applied retroactively to history without re-judging. Read-only on results/; rewrites
// eval-scores.json in place.
//
// Usage: node tools/rederive-scores.mjs [--dry]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { deriveScores } from "../eval-score.js";
import { convoSignals } from "../eval-signals.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, "..");
const SCORES = path.join(RUNNER, "eval-scores.json");
const RESULTS = path.join(RUNNER, "results");
const DRY = process.argv.includes("--dry");

const convTurns = (id) => {
  try { const [d, f] = [id.slice(0, 10), id.slice(11)]; return JSON.parse(fs.readFileSync(path.join(RESULTS, d, "conv", f), "utf8")).turns || []; }
  catch { return null; }
};

const all = JSON.parse(fs.readFileSync(SCORES, "utf8"));
let changed = 0, gatedNow = 0, noTurns = 0, skipped = 0;
const drops = [];
for (const [id, v] of Object.entries(all)) {
  if (!v || !v.checks || !v.mode) { skipped++; continue; }
  const turns = convTurns(id);
  if (!turns) { noTurns++; continue; }                      // transcript gone → leave entry as-is
  const d = deriveScores(v.mode, v.checks, convoSignals(turns));
  if (!d) { skipped++; continue; }                          // incomplete stored checks → leave as-is
  gatedNow += d.gated.length;
  if (d.total !== v.total) { drops.push({ id, from: v.total, to: d.total, gated: d.gated }); changed++; }
  if (!DRY) { v.rubric = d.rubric; v.total = d.total; }
}
drops.sort((a, b) => (a.to - a.from) - (b.to - b.from));    // biggest drops first
console.log(`re-derived ${Object.keys(all).length} convs · ${changed} totals changed · ${gatedNow} checks signal-gated · ${noTurns} missing transcript · ${skipped} skipped${DRY ? "  [DRY RUN]" : ""}`);
for (const d of drops.slice(0, 20)) console.log(`  ${d.from} → ${d.to}  ${d.id}  gated:[${d.gated.join(",")}]`);
if (drops.length > 20) console.log(`  … +${drops.length - 20} more`);
if (!DRY) { fs.writeFileSync(SCORES, JSON.stringify(all, null, 1)); console.log("wrote eval-scores.json"); }
