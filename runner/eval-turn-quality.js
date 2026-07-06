// Backfill per-turn quality signals into eval-scores.json.
//
// Usage:
//   node eval-turn-quality.js              # annotate every score with a transcript
//   node eval-turn-quality.js --check      # do not write; exit 1 if any entry would change

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { conversationTurnQuality } from "./turn-quality.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCORES = path.join(HERE, "eval-scores.json");
const RESULTS = path.join(HERE, "results");
const CHECK = process.argv.includes("--check");

function readTurns(id) {
  try {
    const [date, file] = [id.slice(0, 10), id.slice(11)];
    return JSON.parse(fs.readFileSync(path.join(RESULTS, date, "conv", file), "utf8")).turns || null;
  } catch {
    return null;
  }
}

const scores = JSON.parse(fs.readFileSync(SCORES, "utf8"));
let annotated = 0, missing = 0, changed = 0;

for (const [id, score] of Object.entries(scores)) {
  const turns = readTurns(id);
  if (!turns) { missing++; continue; }
  const next = conversationTurnQuality(turns, score.mode);
  annotated++;
  if (JSON.stringify(score.turn_quality || null) !== JSON.stringify(next)) {
    score.turn_quality = next;
    changed++;
  }
}

if (CHECK) {
  console.log(`turn-quality check: ${annotated} annotatable, ${missing} missing transcript, ${changed} would change`);
  process.exit(changed ? 1 : 0);
}

fs.writeFileSync(SCORES, JSON.stringify(scores, null, 1));
console.log(`turn-quality annotated ${annotated} scores (${missing} missing transcript, ${changed} changed)`);

