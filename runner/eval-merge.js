// eval-merge.js — folds judge outputs back into eval-scores.json (the cache gen.js reads).
// Validates shape hard: a malformed judge output is skipped and reported, never merged.
// Usage: node eval-merge.js <scoredDir>   (reads scored-*.json files)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCORES = path.join(HERE, "eval-scores.json");
const dir = process.argv[2];
if (!dir) { console.error("usage: node eval-merge.js <scoredDir>"); process.exit(1); }

const isNum = (x, hi) => typeof x === "number" && x >= 0 && x <= hi;
function validEntry(e) {
  if (!e || typeof e.id !== "string") return false;
  const r = e.rubric;
  if (!r) return false;
  if (e.mode === "shopping") {
    if (!(isNum(r.answer, 35) && isNum(r.recommendation, 25) && isNum(r.rich, 25) && isNum(r.close, 15))) return false;
  } else {
    if (!(isNum(r.resolution, 40) && isNum(r.accuracy, 25) && isNum(r.actionability, 20) && isNum(r.close, 15))) return false;
  }
  return isNum(e.total, 100) && ["resolved", "partial", "deflected", "failed"].includes(e.resolution_class) && typeof e.learning === "string";
}

const all = fs.existsSync(SCORES) ? JSON.parse(fs.readFileSync(SCORES, "utf8")) : {};
let merged = 0, bad = 0;
for (const f of fs.readdirSync(dir).filter((x) => /^scored-.*\.json$/.test(x)).sort()) {
  let arr; try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { console.error(`SKIP ${f}: unparseable`); bad++; continue; }
  if (!Array.isArray(arr)) { console.error(`SKIP ${f}: not an array`); bad++; continue; }
  for (const e of arr) {
    if (!validEntry(e)) { console.error(`  bad entry in ${f}: ${e && e.id}`); bad++; continue; }
    all[e.id] = { mode: e.mode, rubric: e.rubric, total: e.total, resolution_class: e.resolution_class, learning: e.learning.slice(0, 300), judged_at: e.judged_at || null };
    merged++;
  }
}
fs.writeFileSync(SCORES, JSON.stringify(all, null, 1));
console.log(`merged ${merged} scores (${bad} rejected) → ${SCORES} now has ${Object.keys(all).length} conversations`);
