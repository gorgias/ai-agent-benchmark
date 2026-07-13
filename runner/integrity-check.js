#!/usr/bin/env node
// Scan every VALID conversation for capture-integrity problems (misread UI) and write a review
// queue to integrity-report.json. Does NOT delete or exclude anything — it flags for review.
//
//   node integrity-check.js                 # scan + write integrity-report.json + summary
//   node integrity-check.js --high-only      # only list high-severity (near-certain misreads)
//   node integrity-check.js --quarantine     # ALSO append high-severity flags to the
//                                             # conversation-quarantine.json (review-gated; asks nothing)
//
// A conversation is scanned only if it currently counts (valid, not already quarantined).
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanConversation } from "./integrity.js";
import { convoValidity } from "./classify.js";
import { isQuarantinedConversation } from "./conversation-quarantine.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, "results");
const HIGH_ONLY = process.argv.includes("--high-only");
const DO_QUARANTINE = process.argv.includes("--quarantine");

async function main() {
  const dates = existsSync(RESULTS) ? (await readdir(RESULTS)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  const flagged = [];
  let scanned = 0;
  for (const date of dates) {
    const dir = path.join(RESULTS, date, "conv");
    if (!existsSync(dir)) continue;
    for (const f of await readdir(dir)) {
      if (!f.endsWith(".json")) continue;
      const id = `${date}/${f}`;
      if (isQuarantinedConversation(id)) continue;
      let conv;
      try { conv = JSON.parse(await readFile(path.join(dir, f), "utf8")); } catch { continue; }
      // only conversations that actually count today
      const valid = conv.valid === true || (conv.valid === undefined && convoValidity(conv.turns || []).valid);
      if (!valid) continue;
      scanned++;
      const flags = scanConversation(conv);
      if (!flags.length) continue;
      const rank = { high: 3, medium: 2, low: 1 };
      const severity = flags.reduce((s, x) => (rank[x.severity] > rank[s] ? x.severity : s), "low");
      if (HIGH_ONLY && severity !== "high") continue;
      flagged.push({
        id, vendor: conv.vendor || f.split("-")[0], store: conv.store || null,
        mode: conv.mode || null, severity,
        codes: [...new Set(flags.map((x) => x.code))],
        flags,
      });
    }
  }

  // ---- summaries ----
  const bySeverity = flagged.reduce((m, x) => ((m[x.severity] = (m[x.severity] || 0) + 1), m), {});
  const byCode = {};
  for (const x of flagged) for (const c of x.codes) byCode[c] = (byCode[c] || 0) + 1;
  const byVendor = {};
  for (const x of flagged) byVendor[x.vendor] = (byVendor[x.vendor] || 0) + 1;

  const report = {
    generatedFromDates: dates,
    scannedValid: scanned,
    flaggedTotal: flagged.length,
    bySeverity, byCode, byVendor,
    flagged: flagged.sort((a, b) => ({ high: 3, medium: 2, low: 1 }[b.severity] - { high: 3, medium: 2, low: 1 }[a.severity])),
  };
  await writeFile(path.join(HERE, "integrity-report.json"), JSON.stringify(report, null, 2) + "\n");

  console.log(`Integrity scan: ${scanned} valid conversations`);
  console.log(`  flagged: ${flagged.length}  (high ${bySeverity.high || 0} · medium ${bySeverity.medium || 0} · low ${bySeverity.low || 0})`);
  console.log(`  by code:   ${Object.entries(byCode).map(([k, v]) => `${k}=${v}`).join("  ") || "—"}`);
  console.log(`  by vendor: ${Object.entries(byVendor).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ") || "—"}`);
  console.log(`  → wrote integrity-report.json`);

  if (DO_QUARANTINE) {
    const QF = path.join(HERE, "conversation-quarantine.json");
    const q = JSON.parse(readFileSync(QF, "utf8"));
    let added = 0;
    for (const x of flagged.filter((f) => f.severity === "high")) {
      if (!q.conversations[x.id]) {
        q.conversations[x.id] = {
          reason: "capture_integrity_" + x.codes[0].toLowerCase(),
          detected_at: new Date().toISOString().slice(0, 10),
          detected_by: "integrity-check",
          scope: ["scoreboard", "report", "eval-pack"],
          notes: `Auto-flagged misread capture: ${x.codes.join(", ")}. Evidence: ${x.flags[0].evidence}`,
        };
        added++;
      }
    }
    await writeFile(QF, JSON.stringify(q, null, 2) + "\n");
    console.log(`  → quarantined ${added} high-severity conversations`);
  }
}
main();
