#!/usr/bin/env node
// runner/vendor-changes.mjs — bakes vendor-changes.html: a table of every merchant that has been
// RECLASSIFIED from one vendor to another in runner/vendors.js (e.g. the 2026-07-14 "Meta AI" →
// Zendesk relabel, or the Spiffy.ai → Envive merge). This is a correction log, not a ranking
// signal, so it's a footer-only page (see AGENTS.md rule 6: prune non-representative entries and
// document it — this page IS that documentation).
//
// Source of truth: git history of vendors.js. A merchant's `vendor` field changing between two
// commits for the SAME `key` is a reclassification. Run after any commit that changes an existing
// store's vendor (gen.js does not call this automatically — run it by hand when needed):
//   node vendor-changes.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HERE = path.resolve(new URL(".", import.meta.url).pathname);
const ROOT = path.resolve(HERE, "..");

const log = execSync(
  `git log --follow --format='COMMIT %H %aI' -p -- runner/vendors.js`,
  { cwd: ROOT, maxBuffer: 1024 * 1024 * 64 }
).toString("utf8");

function extract(line) {
  const key = line.match(/key:\s*"([^"]+)"/);
  const vendor = line.match(/vendor:\s*"([^"]+)"/);
  const store = line.match(/store:\s*"([^"]+)"/);
  if (!key || !vendor) return null;
  return { key: key[1], vendor: vendor[1], store: store ? store[1] : key[1] };
}

let curCommit = null, curDate = null;
let removed = new Map(), added = new Map();
const changes = [];

function flush() {
  for (const [key, oldE] of removed) {
    const newE = added.get(key);
    if (newE && newE.vendor !== oldE.vendor && !/^\(.*\)$/.test(newE.store)) {
      changes.push({ date: curDate, store: newE.store, from: oldE.vendor, to: newE.vendor, commit: curCommit.slice(0, 7) });
    }
  }
  removed = new Map(); added = new Map();
}

for (const line of log.split("\n")) {
  const cm = line.match(/^COMMIT (\S+) (\S+)/);
  if (cm) { flush(); curCommit = cm[1]; curDate = cm[2].slice(0, 10); continue; }
  if (line.startsWith("-") && !line.startsWith("---")) {
    const e = extract(line.slice(1)); if (e) removed.set(e.key, e);
  } else if (line.startsWith("+") && !line.startsWith("+++")) {
    const e = extract(line.slice(1)); if (e) added.set(e.key, e);
  }
}
flush();
changes.sort((a, b) => b.date.localeCompare(a.date));

const rows = changes.map((c) => `
      <tr>
        <td class="mono">${c.date}</td>
        <td>${escapeHtml(c.store)}</td>
        <td><span class="pill from">${escapeHtml(c.from)}</span></td>
        <td><span class="pill to">${escapeHtml(c.to)}</span></td>
      </tr>`).join("");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Cache-Control" content="no-cache, must-revalidate">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vendor changes — Gorgias AI Agent Benchmark</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Inter+Tight:wght@600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#fafafa;--surface:#ffffff;--line:rgba(30,36,46,.10);--glass-border:rgba(30,36,46,.10);
    --on:#1e242e;--on-muted:#5c6370;--on-faint:#8a929e;
    --primary:#683fcf;--primary-2:#7e55f6;
    --e8:0 1px 2px rgba(30,36,46,.05),0 6px 24px rgba(30,36,46,.06);--r:16px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--on);-webkit-font-smoothing:antialiased;min-height:100vh}
  .mono{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
  .wrap{max-width:820px;margin:0 auto;padding:48px 24px 24px}
  .back{font-size:13px;font-weight:600;color:var(--on-muted);text-decoration:none}
  .back:hover{color:var(--primary)}
  h1{font-family:'Inter Tight','Inter',sans-serif;font-size:30px;font-weight:800;letter-spacing:-.02em;margin:18px 0 8px}
  p.sub{color:var(--on-muted);font-size:14.5px;line-height:1.6;margin-bottom:28px;max-width:640px}
  table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;box-shadow:var(--e8)}
  th{text-align:left;font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--on-faint);padding:12px 16px;border-bottom:1px solid var(--line)}
  td{padding:12px 16px;font-size:13.5px;border-bottom:1px solid var(--line);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#fbfaff}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .pill.from{background:#fdecec;color:#a3213a}
  .pill.to{background:#eaf7ef;color:#147656}
  .empty{padding:40px 16px;text-align:center;color:var(--on-faint);font-size:13.5px}
  .sitefoot{margin-top:60px;padding:34px 26px 46px;border-top:1px solid var(--glass-border);text-align:center;font-size:12.5px;color:var(--on-muted)}
  .sitefoot a{color:var(--primary);font-weight:600;text-decoration:none;margin:0 10px}
</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="takeaways.html">← Back to Summary</a>
  <h1>Vendor reclassifications</h1>
  <p class="sub">Every merchant whose detected vendor was corrected after further verification — a
  mislabeled widget, a vendor merge (e.g. Spiffy.ai → Envive), or a provider audit finding the wrong
  AI behind a chat bubble. This is a correction log, not a ranking signal.</p>
  <table>
    <thead><tr><th>Date</th><th>Merchant</th><th>Former vendor</th><th>New vendor</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" class="empty">No reclassifications recorded.</td></tr>`}</tbody>
  </table>
</div>
<footer class="sitefoot">
  <div style="font-family:'Inter Tight';font-weight:800;font-size:14px;margin-bottom:8px">GORGIAS · AI AGENT BENCHMARK</div>
  <a href="takeaways.html">Summary</a> · <a href="report.html">Best AI Agent</a> · <a href="run-status.html">Run status</a>
</footer>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "vendor-changes.html"), html);
console.log(`Wrote vendor-changes.html (${changes.length} reclassification(s))`);
