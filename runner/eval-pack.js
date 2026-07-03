// eval-pack.js — prepares LLM-judge eval batches from captured conversations.
// Scans runner/results/*/conv/*.json, keeps VALID conversations (same gate as the
// report), skips ones already scored in eval-scores.json (incremental), and writes
// compact batch files for the judge. The judge itself runs as harness subagents
// (no API key on this machine); eval-merge.js folds their outputs back in.
//
// Usage: node eval-pack.js <outDir> [batchSize=12]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { convoValidity, convoOutcome } from "./classify.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, "results");
const SCORES = path.join(HERE, "eval-scores.json");

const outDir = process.argv[2];
const batchSize = Number(process.argv[3]) || 12;
if (!outDir) { console.error("usage: node eval-pack.js <outDir> [batchSize]"); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const scored = fs.existsSync(SCORES) ? JSON.parse(fs.readFileSync(SCORES, "utf8")) : {};
const packets = [];
for (const date of fs.readdirSync(RESULTS).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
  const dir = path.join(RESULTS, date, "conv");
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const id = `${date}/${f}`;
    if (scored[id]) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if (!convoValidity(j.turns).valid) continue;
    const o = convoOutcome(j.turns);
    packets.push({
      id, vendor: j.vendor, store: j.store, mode: j.mode, theme: j.themeLabel || j.theme,
      outcome: o.outcome,
      turns: (j.turns || []).filter((t) => !t.unsent).map((t) => ({
        q: t.q, by: t.by, answered: t.complete_ms != null,
        reply: (t.replyTail || "").slice(-450),
      })),
    });
  }
}

let n = 0;
for (let i = 0; i < packets.length; i += batchSize) {
  const file = path.join(outDir, `batch-${String(++n).padStart(3, "0")}.json`);
  fs.writeFileSync(file, JSON.stringify(packets.slice(i, i + batchSize), null, 1));
}
console.log(`${packets.length} unscored valid conversations → ${n} batches of ≤${batchSize} in ${outDir}`);
