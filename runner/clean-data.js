// clean-data.js — data-quality audit + cleanup for the accumulated corpus.
//
// WHY: conversations captured BEFORE the brand-named-bot fix (2026-07-02) could be
// killed by a FALSE handover ("Tediber says:", "AI says:" misread as a human agent).
// The runner then stopped sending turns, so those conversations are TRUNCATED-BY-BUG:
// they are neither "automated" nor a real "handover" — keeping them poisons the
// automation rate (counted as handover failures that never happened).
//
// WHAT IT DOES: for every stored conversation, re-run the CURRENT handover classifier
// (classify.js detectHandover, with the widget's extra patterns and the store/vendor
// brand names) over each turn's stored replyTail AND the stored handover_hit string.
//   - stored handover=true, recompute=true  → REAL handover, keep.
//   - stored handover=true, recompute=false → FALSE handover (bug-truncated) → move
//     the file to results/<date>/quarantine/ (kept for forensics, excluded from gen.js
//     which only reads conv/).
//   - stored handover=false → untouched.
//
// Dry-run by default; pass --apply to actually move files. Re-runnable, idempotent.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { detectHandover } from "./classify.js";
import { WIDGETS } from "./vendors.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, "results");
const APPLY = process.argv.includes("--apply");

const summary = {};
let checked = 0, falseHO = 0, realHO = 0, moved = 0;

for (const date of fs.readdirSync(RESULTS).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
  const dir = path.join(RESULTS, date, "conv");
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    const hoTurns = (j.turns || []).filter((t) => t.handover);
    if (!hoTurns.length) continue;
    checked++;
    const extra = (WIDGETS[j.widget] && WIDGETS[j.widget].handover) || [];
    const selfNames = [j.store, j.vendor];
    // A handover is REAL if the current classifier still fires on the stored evidence
    // (the reply tail at that moment, or the recorded hit string itself).
    const stillReal = hoTurns.some((t) =>
      detectHandover(t.replyTail || "", extra, selfNames) ||
      detectHandover(t.handover_hit || "", extra, selfNames));
    if (stillReal) { realHO++; continue; }
    falseHO++;
    const k = `${j.vendor}|${j.mode}|${date}`;
    summary[k] = summary[k] || [];
    summary[k].push({ file: f, hit: (hoTurns[0].handover_hit || "").slice(0, 60) });
    if (APPLY) {
      const qdir = path.join(RESULTS, date, "quarantine");
      fs.mkdirSync(qdir, { recursive: true });
      fs.renameSync(path.join(dir, f), path.join(qdir, f));
      moved++;
    }
  }
}

console.log(`${checked} conversations with a stored handover · ${realHO} REAL (kept) · ${falseHO} FALSE (bug-truncated)`);
for (const [k, arr] of Object.entries(summary)) {
  console.log(`\n■ ${k} — ${arr.length} false handover(s):`);
  for (const e of arr) console.log(`   ${e.file}   hit: "${e.hit}"`);
}
console.log(APPLY ? `\n${moved} file(s) moved to quarantine/.` : `\nDRY RUN — pass --apply to quarantine the false-handover files.`);
