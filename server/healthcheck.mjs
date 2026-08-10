#!/usr/bin/env node
// server/healthcheck.mjs — post-capture anomaly detection + Slack alert.
//
// Run AFTER every capture. Each check below exists because that exact failure actually happened
// and cost real capture time; a green run means none of them recurred. Silence is the failure
// mode this guards against: every one of these bugs produced valid-looking logs and no error.
//
//   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... node server/healthcheck.mjs
//   node server/healthcheck.mjs --dry     # print the payload, post nothing
//
// Exit code: 0 = ok/warnings, 1 = at least one CRITICAL (so cron/systemd also flags it).
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const RUNNER = path.join(ROOT, "runner");
const RESULTS = path.join(RUNNER, "results");
const DRY = process.argv.includes("--dry");
const TODAY = process.env.RUN_DATE || new Date().toISOString().slice(0, 10);
const DAILY_TARGET = Number(process.env.DAILY_TARGET || 70);   // valid convs expected per day
const STATE = path.join(ROOT, "server", ".healthcheck-state.json");

const crit = [], warn = [], ok = [];
const C = (m) => crit.push(m), W = (m) => warn.push(m), OK = (m) => ok.push(m);

// ── load every conversation once ───────────────────────────────────────────────
const convs = [];
for (const d of existsSync(RESULTS) ? readdirSync(RESULTS).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) : []) {
  const dir = path.join(RESULTS, d, "conv");
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let j; try { j = JSON.parse(readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    const timed = (j.turns || []).some((t) => t.by === "ai" && (t.complete_ms || t.ai_latency_ms));
    const lat = (j.turns || []).filter((t) => t.by === "ai" && (t.complete_ms || t.ai_latency_ms))
      .map((t) => t.complete_ms || t.ai_latency_ms);
    convs.push({ date: d, file: f, vendor: j.vendor, key: j.key, timed, lat,
      mismatch: j.provider_mismatch === true, ambiguous: j.provider_ambiguous === true });
  }
}
const today = convs.filter((c) => c.date === TODAY);
const p75 = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(0.75 * s.length))]; };

// ── 1. YIELD — the "silent no-op" class. A stale TARGET, a dead widget set, or a
// crashed balancer all look like a clean log with no conversations in it. ───────
const valid = today.filter((c) => c.timed).length;
if (valid === 0) C(`*No valid conversations captured today* (target ${DAILY_TARGET}). Capture ran but produced nothing — check the balancer log and whether every vendor is already at the water-line.`);
else if (valid < DAILY_TARGET * 0.7) W(`Yield low: *${valid}* valid vs target ${DAILY_TARGET} (${Math.round(100 * valid / DAILY_TARGET)}%).`);
else OK(`${valid} valid conversations (target ${DAILY_TARGET})`);

// ── 2. HOLLOW RATE — captures with text but no timed answer mean OUR driver is
// misreading the widget, not that the vendor is slow. Decagon/Yuma burned entire
// budgets this way while logging success lines. ────────────────────────────────
const hollow = today.length - valid;
const hollowPct = today.length ? Math.round(100 * hollow / today.length) : 0;
if (today.length >= 20 && hollowPct > 40) C(`*Hollow-capture rate ${hollowPct}%* (${hollow}/${today.length}). Text captured but no timed answer — suspect a driver misreading the widget, not vendor latency. Probe the worst store: \`node tools/probe-generic.mjs <key> --classify\`.`);
else if (hollowPct > 25) W(`Hollow-capture rate ${hollowPct}% (${hollow}/${today.length}).`);
else if (today.length) OK(`hollow rate ${hollowPct}%`);

// ── 3. STORE CONCENTRATION — a vendor whose conversations come from one storefront
// is a single store's score wearing a vendor's name. ───────────────────────────
const byV = {};
for (const c of convs) { if (!c.timed || !c.vendor) continue; (byV[c.vendor] = byV[c.vendor] || {}); byV[c.vendor][c.key] = (byV[c.vendor][c.key] || 0) + 1; }
const conc = [];
for (const [v, stores] of Object.entries(byV)) {
  const vals = Object.values(stores).sort((a, b) => b - a); const n = vals.reduce((a, b) => a + b, 0);
  // Declared references/outliers are a single storefront BY DESIGN (Amazon Rufus is a
  // logged-in reference point, not a SaaS vendor ranked head-to-head) — never flag them.
  if (["Amazon Rufus", "Mavenoid", "Google Agentic", "Spiffy.ai"].includes(v)) continue;
  if (n < 30) continue;                       // too small to judge concentration
  const share = Math.round(100 * vals[0] / n);
  if (share >= 50) conc.push(`${v} ${share}% on one store (${vals.length} stores)`);
}
if (conc.length) W(`Store concentration: ${conc.join(" · ")}. The balancer feeds the least-captured store first, so this should decay — if it does not, those stores are failing to capture.`);
else OK("no vendor above 50% on a single store");

// ── 4. NEW PARKED STORES — the self-improvement loop parks a store when its driver
// stops working. New entries since the last run are driver regressions. ────────
const triagePath = path.join(RUNNER, "driver-triage.json");
const triage = existsSync(triagePath) ? JSON.parse(readFileSync(triagePath, "utf8")).stores || {} : {};
const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const parkedNow = Object.entries(triage).filter(([, e]) => !e.fixed).map(([k]) => k);
// FIRST RUN has no prior snapshot, so every already-parked store would look brand new.
// Treat run #1 as the baseline and only alert on deltas from then on.
const firstRun = !prev.parked;
const newParked = firstRun ? [] : parkedNow.filter((k) => !prev.parked.includes(k));
if (firstRun) OK(`parked-store baseline recorded (${parkedNow.length} currently parked)`);
else if (newParked.length >= 3) C(`*${newParked.length} stores newly parked*: ${newParked.slice(0, 6).join(", ")}. Several drivers failing at once usually means an environment problem (network, IP reputation, a Playwright upgrade), not many vendors breaking simultaneously.`);
else if (newParked.length) W(`Newly parked: ${newParked.join(", ")} (${triage[newParked[0]]?.class || "?"}).`);
else if (!firstRun) OK("no new parked stores");

// ── 5. LATENCY DRIFT — this is the check that catches an undersized or throttled
// server. Latency is the headline metric, so a box that inflates it corrupts the
// board more quietly than a crash would. ──────────────────────────────────────
const drift = [];
for (const v of Object.keys(byV)) {
  const t = p75(today.filter((c) => c.vendor === v && c.timed).flatMap((c) => c.lat));
  const base = p75(convs.filter((c) => c.vendor === v && c.timed && c.date < TODAY && c.date >= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).flatMap((c) => c.lat));
  if (t == null || base == null || base < 1000) continue;
  const d = Math.round(100 * (t - base) / base);
  if (d > 40) drift.push(`${v} p75 ${(t / 1000).toFixed(1)}s vs ${(base / 1000).toFixed(1)}s baseline (+${d}%)`);
}
if (drift.length >= 3) C(`*Latency inflated across ${drift.length} vendors*: ${drift.slice(0, 4).join(" · ")}. When several vendors slow at once the cause is almost always our box (CPU contention, too many parallel streams), not the vendors — do not publish this as vendor latency.`);
else if (drift.length) W(`Latency drift: ${drift.join(" · ")}.`);
else OK("latency stable vs 7-day baseline");

// ── 6. JUDGE COVERAGE — the gate refuses to deploy below 90%. Surfacing it here
// tells you the queue is growing before the deploy step blocks. ───────────────
const scoresPath = path.join(RUNNER, "eval-scores.json");
if (existsSync(scoresPath)) {
  const scored = new Set(Object.keys(JSON.parse(readFileSync(scoresPath, "utf8"))));
  // Mirror verify-data.js: quarantined conversations are excluded from the board, so counting
  // them here would under-report coverage and cry wolf while the real gate is green.
  const qPath = path.join(RUNNER, "conversation-quarantine.json");
  let quarantined = new Set();
  if (existsSync(qPath)) {
    const q = JSON.parse(readFileSync(qPath, "utf8"));
    quarantined = new Set(Array.isArray(q) ? q : (q.quarantined || Object.keys(q)));
  }
  const validAll = convs.filter((c) => c.timed && !quarantined.has(`${c.date}/${c.file}`));
  const done = validAll.filter((c) => scored.has(`${c.date}/${c.file}`)).length;
  const pct = validAll.length ? Math.round(100 * done / validAll.length) : 100;
  if (pct < 90) W(`Judge coverage *${pct}%* (${validAll.length - done} unjudged) — the quality gate blocks deploys below 90%. Run the judging waves.`);
  else OK(`judge coverage ${pct}%`);
}

// ── 7. PROVIDER ATTRIBUTION — a store that switched vendors, or where a second
// widget answers, silently scores one vendor's behaviour as another's. ────────
const mm = today.filter((c) => c.mismatch).length, amb = today.filter((c) => c.ambiguous).length;
if (mm) C(`*${mm} conversations with a provider MISMATCH today* — the widget that answered is not the vendor on record. Those scores belong to the wrong vendor until the store row is corrected.`);
else if (amb) W(`${amb} conversations flagged provider-ambiguous (expected vendor present but out-ranked by another chat widget on the page).`);
else OK("provider attribution clean");

// ── report ────────────────────────────────────────────────────────────────────
const level = crit.length ? "CRITICAL" : warn.length ? "WARNING" : "OK";
const icon = crit.length ? ":red_circle:" : warn.length ? ":large_yellow_circle:" : ":white_check_mark:";
const lines = [
  `${icon} *Benchmark capture — ${TODAY} — ${level}*`,
  `${valid} valid / ${today.length} captured · ${Object.keys(byV).length} vendors`,
  ...crit.map((m) => `:red_circle: ${m}`),
  ...warn.map((m) => `:large_yellow_circle: ${m}`),
  ...(crit.length || warn.length ? [] : [`_${ok.join(" · ")}_`]),
];
const text = lines.join("\n");

writeFileSync(STATE, JSON.stringify({ parked: parkedNow, at: new Date().toISOString() }, null, 1));

if (DRY || !process.env.SLACK_WEBHOOK_URL) {
  console.log(text);
  if (!DRY) console.error("\n(no SLACK_WEBHOOK_URL set — printed instead of posted)");
} else {
  const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, mrkdwn: true }),
  }).catch((e) => ({ ok: false, status: String(e) }));
  console.log(res.ok ? `posted to Slack (${level})` : `Slack post FAILED: ${res.status}`);
}
process.exit(crit.length ? 1 : 0);
