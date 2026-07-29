// tools/prune-quarantine.mjs — release capture-integrity quarantine entries whose conversation
// still carries real agent prose.
//
// WHY: `integrity-check --quarantine` used to discard a WHOLE conversation as soon as any one
// turn tripped a high-severity rule. Two of the three rules (CHROME_ONLY_REPLY,
// ECHO_USER_MESSAGE) fire on the PREFIX of a reply whose real answer follows immediately, so
// captures with ten good turns were thrown away. integrity-check now gates on
// isHollowCapture(); this script applies the same gate retroactively to entries already in the
// file, so code and data agree.
//
// Only `capture_integrity_*` reasons are considered. Deliberate, human-reasoned exclusions
// (human_desk_no_ai_agent, provider_mismatch_*, intercom_timestamp_drift_*, yuma_stale_*,
// latency_misattributed_*) are never touched.
//
// Usage: node tools/prune-quarantine.mjs [--apply]     (dry-run by default)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isHollowCapture, substantiveTurnCount } from "../integrity.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.dirname(HERE);
const QF = path.join(RUNNER, "conversation-quarantine.json");
const APPLY = process.argv.includes("--apply");
const INTEGRITY_REASON = /^capture_integrity_/;

const q = JSON.parse(fs.readFileSync(QF, "utf8"));
const release = [];
const keep = [];
const missing = [];

for (const [id, meta] of Object.entries(q.conversations)) {
  if (!INTEGRITY_REASON.test(meta.reason || "")) continue;
  const file = path.join(RUNNER, "results", id.replace("/", "/conv/"));
  if (!fs.existsSync(file)) { missing.push(id); continue; }
  let conv;
  try { conv = JSON.parse(fs.readFileSync(file, "utf8")); } catch { missing.push(id); continue; }
  const n = substantiveTurnCount(conv);
  (isHollowCapture(conv) ? keep : release).push({ id, vendor: conv.vendor || "?", n, reason: meta.reason });
}

const tally = (rows) => rows.reduce((m, r) => ((m[r.vendor] = (m[r.vendor] || 0) + 1), m), {});
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ");

console.log(`capture-integrity quarantine entries: ${release.length + keep.length}`);
console.log(`  hollow, stay quarantined : ${keep.length}   ${fmt(tally(keep))}`);
console.log(`  substantive, to release  : ${release.length}   ${fmt(tally(release))}`);
if (missing.length) console.log(`  capture file absent      : ${missing.length} (left untouched)`);

const byReason = release.reduce((m, r) => ((m[r.reason] = (m[r.reason] || 0) + 1), m), {});
console.log(`\nreleased by original rule:`);
for (const [r, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);

if (!APPLY) { console.log("\n(dry run — pass --apply to write)"); process.exit(0); }

for (const r of release) delete q.conversations[r.id];
fs.writeFileSync(QF, JSON.stringify(q, null, 2) + "\n");
console.log(`\napplied: quarantine now holds ${Object.keys(q.conversations).length} conversations`);
