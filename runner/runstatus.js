// runstatus.js — generate a self-contained run-status.html for the CURRENT (or most recent)
// capture run: what's done, what's failing, what's left. Reads the runner LOG (--log <path>
// or RUN_LOG env) plus the results/<date>/conv dir. Re-runnable; pass --watch to regenerate
// every 10s while a headed capture is live (the page meta-refreshes to pick it up).
//
//   node runstatus.js --log /path/to/run.log            # one snapshot
//   node runstatus.js --log /path/to/run.log --watch     # live, every 10s
//
// Writes ../run-status.html at the repo root (served by the static site + committed for Pages).
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { STORES } from "./vendors.js";
import { SHOPPING_THEMES, SUPPORT_THEMES } from "./pools.js";

const args = process.argv.slice(2);
const pick = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const LOG = pick("--log") || process.env.RUN_LOG || null;
const WATCH = args.includes("--watch");
const RESULTS = new URL("./results/", import.meta.url).pathname;
const OUT = new URL("../run-status.html", import.meta.url).pathname;

const VCOL = { Gorgias:"#f0603f", "Envive":"#22c55e", Spiffy:"#22c55e", Sierra:"#0ea5e9", Siena:"#a855f7",
  Kodif:"#eab308", Ada:"#64748b", "Meta AI":"#3b82f6", "Rep AI":"#ef4444", DigitalGenius:"#8b5cf6",
  Klaviyo:"#f59e0b", Humind:"#14b8a6", Yuma:"#ec4899", Decagon:"#7c3aed" };

async function newestDate() {
  const dirs = (await readdir(RESULTS, { withFileTypes: true }))
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name).sort();
  return dirs[dirs.length - 1];
}
const themesFor = (mode) => (mode === "support" ? SUPPORT_THEMES : SHOPPING_THEMES).length;
const modesFor = (s) => s.modes || ["shopping", "support"];

// Parse the runner log into completed / failed / in-flight events.
function parseLog(text) {
  const lines = text.split("\n");
  let total = 0, done = 0;
  const doneKeys = new Set(), failed = [], events = [];
  const perTask = {};                       // "key/mode/theme" -> {success, avg, handover, valid}
  for (const ln of lines) {
    let m = ln.match(/✔ \[(\d+)\/(\d+)\]\s+(\S+)\/(\S+)\/(\S+)\s+·\s+success\s+(\S+)%?\s+·\s+avg\s+(\S+)/);
    if (m) {
      total = Math.max(total, +m[2]); done = Math.max(done, +m[1]);
      const id = `${m[3]}/${m[4]}/${m[5]}`; doneKeys.add(id);
      perTask[id] = { success: m[6], avg: m[7], handover: /handover@/.test(ln) };
      events.push({ t: "done", id, txt: ln.trim() });
      continue;
    }
    m = ln.match(/\[(\S+)\/(\S+)\/(\S+)\]\s+(INVALID.*|FAILED.*)/);
    if (m) { const id = `${m[1]}/${m[2]}/${m[3]}`; failed.push({ id, why: m[4].slice(0, 90) }); events.push({ t: "fail", id, txt: ln.trim() }); continue; }
    m = ln.match(/✗\s+(\S+)\/(\S+)\/(\S+)\s+ERR\s+(.*)/);
    if (m) { const id = `${m[1]}/${m[2]}/${m[3]}`; failed.push({ id, why: m[4].slice(0, 90) }); continue; }
    m = ln.match(/\[(\S+)\/(\S+)\/(\S+)\]\s+(page @|widget open|T\d+)/);
    if (m) events.push({ t: "run", id: `${m[1]}/${m[2]}/${m[3]}`, txt: ln.trim() });
  }
  const finished = /Done\. Wrote \d+ conversations/.test(text);
  // the store/theme currently mid-flight = last "run" event whose task isn't done yet
  const running = [...new Set(events.filter(e => e.t === "run" && !doneKeys.has(e.id)).map(e => e.id))].slice(-4);
  return { total, done, doneKeys, perTask, failed, events, running, finished };
}

async function build() {
  const date = pick("--date") || process.env.RUN_DATE || await newestDate();
  const convDir = `${RESULTS}${date}/conv`;
  let convFiles = [];
  try { convFiles = (await readdir(convDir)).filter(f => f.endsWith(".json")); } catch {}
  const validOf = (f) => { try { const j = JSON.parse(readFileSync(`${convDir}/${f}`, "utf8")); return j.valid === true; } catch { return false; } };

  let log = null;
  if (LOG && existsSync(LOG)) { try { log = parseLog(await readFile(LOG, "utf8")); } catch {} }

  // Which stores are IN this run? With a log, ONLY the stores it mentions (the true run scope).
  // Without a log, fall back to every store that has a conv file for this date (whole program).
  const mentioned = new Set();
  if (log) {
    [...log.doneKeys, ...log.running, ...log.failed.map(f => f.id), ...log.events.map(e => e.id)]
      .forEach(id => mentioned.add(id.split("/")[0]));
  } else {
    convFiles.forEach(f => mentioned.add(f.replace(/-(shopping|support)-.*$/, "")));
  }
  const runStores = STORES.filter(s => mentioned.has(s.key));

  // Per-store rows
  const rows = runStores.map(s => {
    const expected = modesFor(s).reduce((n, m) => n + themesFor(m), 0);
    const files = convFiles.filter(f => f.startsWith(s.key + "-"));
    const valid = files.filter(validOf).length;
    const captured = files.length;
    return { key: s.key, vendor: s.vendor, store: s.store || s.key, expected, captured, valid, invalid: captured - valid, pending: Math.max(0, expected - captured) };
  }).sort((a, b) => a.vendor.localeCompare(b.vendor) || a.store.localeCompare(b.store));

  const totExpected = rows.reduce((n, r) => n + r.expected, 0);
  const totValid = rows.reduce((n, r) => n + r.valid, 0);
  const totCaptured = rows.reduce((n, r) => n + r.captured, 0);
  const total = (log && log.total) || totExpected;
  const done = (log && log.done) || totCaptured;
  const pct = total ? Math.round(100 * done / total) : 0;
  const state = !log ? "idle" : log.finished ? "done" : "running";
  const now = new Date().toISOString();

  const bar = (v, max, col) => { const w = max ? Math.round(100 * v / max) : 0; return `<div class="bar"><span style="width:${w}%;background:${col}"></span></div>`; };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  const storeRows = rows.map(r => {
    const col = VCOL[r.vendor] || "#888";
    return `<tr>
      <td><span class="dot" style="background:${col}"></span><b>${esc(r.vendor)}</b> · ${esc(r.store)}</td>
      <td class="mono n">${r.valid}/${r.expected}</td>
      <td style="min-width:160px">${bar(r.valid, r.expected, col)}</td>
      <td class="mono n">${r.invalid ? `<span class="warn">${r.invalid}</span>` : "·"}</td>
      <td class="mono n">${r.pending || "·"}</td>
    </tr>`;
  }).join("");

  const failRows = (log?.failed || []).slice(-14).reverse().map(f =>
    `<tr><td class="mono">${esc(f.id)}</td><td class="note">${esc(f.why)}</td></tr>`).join("")
    || `<tr><td colspan="2" class="note">No failed/invalid conversations recorded.</td></tr>`;

  const activity = (log?.events || []).slice(-16).reverse().map(e =>
    `<div class="ev ev-${e.t}">${esc(e.txt).replace(/^\s+/, "")}</div>`).join("")
    || `<div class="note">No live log attached — showing filesystem snapshot only.</div>`;

  const running = (log?.running || []).map(id => `<span class="chip">${esc(id)}</span>`).join(" ") || "<span class='note'>—</span>";

  const stateBadge = { running: `<span class="badge live">● LIVE — capturing</span>`,
    done: `<span class="badge ok">✓ run complete</span>`, idle: `<span class="badge idle">idle — filesystem snapshot</span>` }[state];

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
${state === "running" ? '<meta http-equiv="refresh" content="12">' : ""}
<title>Run status — Gorgias AI Agent Benchmark</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Inter+Tight:wght@700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#16120D;--paper:#F6F2EC;--on:#1B1712;--mut:#6B6259;--faint:#A89D92;--coral:#F0603F;--mint:#1E9E6A;--amber:#D98A00;--red:#D64545;--line:rgba(27,23,18,.10)}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',-apple-system,sans-serif;background:var(--paper);color:var(--on);padding:28px 22px 60px;line-height:1.5}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}.n{text-align:right}.note{color:var(--mut);font-size:12.5px}.warn{color:var(--amber);font-weight:700}
.wrap{max-width:900px;margin:0 auto}
h1{font-family:'Inter Tight';font-size:30px;font-weight:900;letter-spacing:-.02em;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
a.back{color:var(--coral);text-decoration:none;font-weight:700;font-size:13px}
.badge{font-size:12px;font-weight:800;padding:4px 11px;border-radius:999px;letter-spacing:.02em}
.badge.live{background:#FDEAEA;color:var(--red)}.badge.ok{background:#E2F4EA;color:var(--mint)}.badge.idle{background:#EEE9E4;color:var(--faint)}
.sub{color:var(--mut);font-size:13px;margin-top:6px}
.big{margin:26px 0;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px 24px}
.big .pct{font-family:'Inter Tight';font-size:52px;font-weight:900;letter-spacing:-.03em;line-height:1}
.big .cap{color:var(--mut);font-size:13px;margin-top:2px}
.bar{height:9px;border-radius:999px;background:rgba(27,23,18,.08);overflow:hidden}.bar span{display:block;height:100%;border-radius:999px}
.big .bar{height:14px;margin-top:16px}.big .bar span{background:linear-gradient(90deg,var(--coral),#FF8B5D)}
.kpis{display:flex;gap:26px;margin-top:14px;flex-wrap:wrap}.kpi b{font-family:'Inter Tight';font-size:22px;font-weight:800}.kpi span{color:var(--mut);font-size:12px;display:block}
h2{font-family:'Inter Tight';font-size:16px;font-weight:800;margin:26px 0 10px}
table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);text-align:left;padding:9px 12px;border-bottom:1px solid var(--line)}
td{padding:9px 12px;border-bottom:1px solid rgba(27,23,18,.05);vertical-align:middle}tr:last-child td{border-bottom:none}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;vertical-align:baseline}
.chip{display:inline-block;font-size:11.5px;font-weight:700;background:#FDEAEA;color:var(--red);padding:2px 9px;border-radius:999px;margin:2px 0}
.feed{background:var(--ink);color:#E9E3DA;border-radius:14px;padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:11.5px;line-height:1.7;max-height:320px;overflow:auto}
.ev-done{color:#43D598}.ev-fail{color:#FF7A5C}.ev-run{color:#C9BEB0}
</style></head><body><div class="wrap">
<h1>Capture run status ${stateBadge}</h1>
<div class="sub">Run date <b>${date}</b> · snapshot ${now.replace("T"," ").slice(0,19)} UTC · <a class="back" href="report.html">← report</a> · <a class="back" href="takeaways.html">summary</a> · <a class="back" href="report.html?view=conversations">conversations</a></div>

<div class="big">
  <div class="pct">${pct}%</div>
  <div class="cap">${done} of ${total} conversations captured this run</div>
  ${bar(done, total)}
  <div class="kpis">
    <div class="kpi"><b class="mono">${totValid}</b><span>valid (timed)</span></div>
    <div class="kpi"><b class="mono">${totCaptured - totValid}</b><span>invalid / failed</span></div>
    <div class="kpi"><b class="mono">${Math.max(0, total - done)}</b><span>remaining</span></div>
    <div class="kpi"><b class="mono">${rows.length}</b><span>stores in run</span></div>
  </div>
  ${state === "running" ? `<div class="sub" style="margin-top:14px">⏳ In flight: ${running}</div>` : ""}
</div>

<h2>By store</h2>
<table><thead><tr><th>Store</th><th class="n">Valid</th><th>Progress</th><th class="n">Invalid</th><th class="n">Pending</th></tr></thead><tbody>${storeRows || `<tr><td colspan="5" class="note">No stores detected for this run.</td></tr>`}</tbody></table>

<h2>Failed / invalid</h2>
<table><thead><tr><th>Conversation</th><th>Reason</th></tr></thead><tbody>${failRows}</tbody></table>

<h2>Recent activity</h2>
<div class="feed">${activity}</div>
</div></body></html>`;

  await writeFile(OUT, html);
  return { pct, done, total, state, stores: rows.length };
}

if (WATCH) {
  const tick = async () => { try { const s = await build(); process.stdout.write(`\r[runstatus] ${s.pct}% ${s.done}/${s.total} (${s.state})   `); } catch (e) { console.error(e.message); } };
  await tick();
  const iv = setInterval(async () => { const s = await build().catch(() => null); if (s) { process.stdout.write(`\r[runstatus] ${s.pct}% ${s.done}/${s.total} (${s.state})   `); if (s.state === "done") { clearInterval(iv); console.log("\n[runstatus] run complete — final snapshot written."); process.exit(0); } } }, 10000);
} else {
  const s = await build();
  console.log(`Wrote run-status.html — ${s.pct}% (${s.done}/${s.total}), ${s.stores} stores, state=${s.state}`);
}
