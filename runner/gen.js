// gen.js — regenerate report.html's STORES/SUPPORT data from the runner output.
//
// Reads results/<date>/<key>-<mode>.json (the multi-theme aggregate shape written
// by run.js) and rebuilds the two inline data arrays in ../report.html. Each store
// carries 5 themed conversations (apple-to-apple) plus an aggregate row.
//
//   node gen.js                 # newest results dir
//   node gen.js --date 2026-06-30
//
// Honesty: the per-turn "a" text is the ACTUAL captured reply tail (truncated),
// never a fabricated summary. Human turns are flagged and never timed.

import { readFile, writeFile, readdir, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { STORES as SITES } from "./vendors.js";
import { SHOPPING_THEMES, SUPPORT_THEMES } from "./pools.js";
import { convoValidity, convoOutcome, guardrailLeak } from "./classify.js";

// Themes whose turns must NOT count toward latency / automation / quality (robustness only).
const GUARDRAIL_KEYS = new Set(["guardrails"]);

const args = process.argv.slice(2);
const dateArg = (() => { const i = args.indexOf("--date"); return i >= 0 ? args[i + 1] : null; })();

const RESULTS = new URL("./results/", import.meta.url).pathname;
async function newestDate() {
  const dirs = (await readdir(RESULTS, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name).sort();
  return dirs[dirs.length - 1];
}
async function allDates() {
  // only run-dates that use the per-conversation format (have a conv/ subdir)
  const dirs = (await readdir(RESULTS, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name).sort();
  return dirs.filter(d => existsSync(`${RESULTS}${d}/conv`));
}
// Runs ACCUMULATE: read EVERY results/<date>/ dir and emit one dated entry per
// (store, mode, run-date). The report's date picker narrows the sample; old runs
// are kept. Pass --date to regenerate from a single run only.
const DATES = dateArg ? [dateArg] : (await allDates());
const LATEST = DATES[DATES.length - 1];
console.log(`Generating report data from ${DATES.length} run(s): ${DATES.join(", ")}`);

// LLM-judge Relevance/Resolution Quality scores, per store+mode (populated by the judge pass).
let QSCORES = { shopping: {}, support: {} };
try { QSCORES = JSON.parse(await readFile(new URL("./quality-scores.json", import.meta.url).pathname, "utf8")); QSCORES.shopping = QSCORES.shopping || {}; QSCORES.support = QSCORES.support || {}; } catch {}

// Per-CONVERSATION LLM-judge eval scores (eval-scores.json, built by eval-pack/eval-merge +
// the judge pass). Keyed by "<date>/<conv-filename>". Rubrics: shopping = answer35/rec25/
// rich25/close15; support = resolution40/accuracy25/actionability20/close15.
let EVALS = {};
try { EVALS = JSON.parse(await readFile(new URL("./eval-scores.json", import.meta.url).pathname, "utf8")); } catch {}

// ---- per-store capability matrix (SHOPPING only). 1=yes, 0=no, 2=untested. ----
const CAPS = {
  "spiffy-supergoop": { qr: 1, cards: 1, reviews: 1, completes: 1 },
  "gorgias-madura": { qr: 0, cards: 0, reviews: 0, completes: 1 },
  "gorgias-jade": { qr: 1, cards: 0, reviews: 0, completes: 1 },
  "gorgias-beekman": { qr: 1, cards: 0, reviews: 0, completes: 1 },
  "gorgias-babybee": { qr: 1, cards: 0, reviews: 0, completes: 1 },
  "gorgias-shoebacca": { qr: 1, cards: 0, reviews: 0, completes: 1 },
  "sierra-casper": { qr: 1, cards: 1, reviews: 2, completes: 1 },
  "sierra-scotts": { qr: 2, cards: 2, reviews: 2, completes: 2 },
  "siena-simplemodern": { qr: 2, cards: 0, reviews: 2, completes: 2 },
  "siena-figs": { qr: 2, cards: 2, reviews: 2, completes: 2 },
  "yuma-evryjewels": { qr: 2, cards: 0, reviews: 2, completes: 1 },
  "dg-bloomwild": { qr: 2, cards: 2, reviews: 2, completes: 0 },
  "meta-dermalogica": { qr: 2, cards: 2, reviews: 2, completes: 0 },
  "ada-loop": { qr: 2, cards: 2, reviews: 2, completes: 2 },
  "envive-kut": { qr: 1, cards: 0, reviews: 0, completes: 1 },
  "repai-fresh": { qr: 2, cards: 2, reviews: 2, completes: 2 },
  "kodif-dsc": { qr: 2, cards: 2, reviews: 2, completes: 2 },
  "humind-chaiselongue": { qr: 2, cards: 2, reviews: 2, completes: 2 },
};

// ---- curated fallback for sites we currently cannot drive cold (no fresh JSON). ----
const CURATED = {
  "ada-loop": { method: "down", successTxt: "backend down", successCls: "p-na", what: "Ada bot backend was unavailable on the test days. Pending a working run." },
  "sierra-scotts": { method: "pending", successTxt: "pending", successCls: "p-na", what: "Sierra widget detected (sierraConfig) but didn't open/post in a cold headless run — harness pending." },
  "siena-figs": { method: "pending", successTxt: "pending", successCls: "p-na", what: "Siena widget didn't initialize in a cold headless run (lazy-loaded / bot-protected). Live capture pending." },
  "repai-fresh": { method: "pending", successTxt: "pending", successCls: "p-na", what: "Rep AI (initRep) loads only in a headed browser and uses a closed shadow DOM — automated drive pending." },
  "kodif-dsc": { method: "pending", successTxt: "pending", successCls: "p-na", what: "Kodif (kodif-chat-widget) detects headless and refuses to load — headed-capture harness pending." },
  "humind-chaiselongue": { method: "pending", successTxt: "pending", successCls: "p-na", what: "Humind widget (FR) detects headless — headed-capture harness pending." },
};

const host = (url) => { try { return new URL(url).host.replace(/^www\./, "") + new URL(url).pathname.replace(/\/$/, ""); } catch { return (url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, ""); } };
const round1 = (n) => Math.round(n * 10) / 10;

// Clean the captured reply tail into a short, honest answer cell.
function cleanReply(s) {
  if (!s) return "";
  let t = String(s).replace(/\s+/g, " ").trim();
  // drop a leading timestamp / "You said" echo if present
  t = t.replace(/^\d{1,2}:\d{2}\s*(AM|PM)?\.?\s*/i, "");
  if (t.length > 170) t = t.slice(-170).replace(/^\S*\s/, "…");
  return t;
}
function aText(turn) {
  if (turn.unsent) return "⏹ not sent — conversation was handed to a human";
  if (turn.by === "human") return "🚩 human took over";
  if (turn.complete_ms == null) {
    const tail = cleanReply(turn.replyTail);
    return tail ? "(streamed past timing window) " + tail : "AI replied (streamed past timing window)";
  }
  return cleanReply(turn.replyTail) || "AI answered";
}
// Truncate the transcript at the first handover turn — once a human takes over the
// conversation is over; we never show turns past that point.
const themeTurns = (t) => {
  let turns = t.turns || [];
  const ho = turns.findIndex(x => x.handover);
  if (ho >= 0) turns = turns.slice(0, ho + 1);
  return turns.map(x => ({ q: x.q, a: aText(x), by: x.by, lat: x.ai_latency_ms != null ? round1(x.ai_latency_ms / 1000) : null }));
};
const tk = (ticket) => ticket && ticket.subdomain ? { sub: ticket.subdomain, acct: ticket.account_id || null, conv: ticket.conversation_id || null } : null;

// Aggregate ON READ from the per-conversation files results/<date>/conv/<key>-<mode>-*.json.
// Handles PARTIAL groups (e.g. 3/5 themes done) — so the report shows conversations as
// they accumulate. Nothing is lost if a run was killed mid-way.
async function loadAgg(key, mode, date) {
  const dir = `${RESULTS}${date}/conv`;
  if (!existsSync(dir)) return null;
  let files;
  try { files = (await readdir(dir)).filter(f => f.startsWith(`${key}-${mode}-`) && f.endsWith(".json")); } catch { return null; }
  if (!files.length) return null;
  const themes = [];
  // AUTOMATION outcomes tally over ALL captured conversations — including early-bail
  // handovers that the latency validity gate rightly excludes. Latency needs ≥3 timed
  // answers; automation must count a T1 handover as a failure, not drop it.
  const auto = { automated: 0, handover: 0, deflected: 0, no_answer: 0 };
  const evalAgg = { n: 0, total: 0, dims: {}, cls: {}, learnings: [] };
  // GUARDRAIL conversations are scored on ROBUSTNESS, not latency/automation — a refusal
  // is fast and "automated", which would flatter both metrics. Kept out of the store's
  // headline stats and surfaced separately (guardrailOut).
  const guard = { n: 0, held: 0, leaked: [], convs: [] };
  for (const f of files) {
    try {
      const obj = JSON.parse(await readFile(`${dir}/${f}`, "utf8"));
      const isGuard = obj.theme === "guardrails" || GUARDRAIL_KEYS.has(obj.theme);
      if (isGuard) {
        const ev = EVALS[`${date}/${f}`];
        guard.n++;
        guard.convs.push({ theme: obj.theme, turns: obj.turns, datetime: obj.capturedAt || null, eval: ev || null });
        continue;   // never in latency/automation/quality aggregates
      }
      auto[convoOutcome(obj.turns || []).outcome]++;
      const ev = EVALS[`${date}/${f}`];
      if (ev && ev.total != null) {
        evalAgg.n++; evalAgg.total += ev.total;
        for (const [k, v] of Object.entries(ev.rubric || {})) evalAgg.dims[k] = (evalAgg.dims[k] || 0) + v;
        evalAgg.cls[ev.resolution_class] = (evalAgg.cls[ev.resolution_class] || 0) + 1;
        if (ev.learning) evalAgg.learnings.push(ev.learning);
      }
      // datetime of the conversation: explicit capture stamp, else the file's mtime
      let dt = obj.capturedAt;
      if (!dt) { try { dt = (await stat(`${dir}/${f}`)).mtime.toISOString(); } catch {} }
      obj._datetime = dt || null;
      // Drop NOISE conversations: crawler-flagged invalid, or (fallback for older
      // captures) no timed AI answer and no handover — menu/offline/timeout junk.
      if (obj.valid === false) continue;
      if (!convoValidity(obj.turns || []).valid) continue;
      themes.push(obj);
    } catch {}
  }
  const engaged = auto.automated + auto.handover + auto.deflected;
  const autoOut = {
    ...auto, engaged,
    rate: engaged ? Math.round((auto.automated / engaged) * 100) : null,
  };
  const evalOut = evalAgg.n ? {
    n: evalAgg.n,
    total: Math.round(evalAgg.total / evalAgg.n),
    dims: Object.fromEntries(Object.entries(evalAgg.dims).map(([k, v]) => [k, Math.round(v / evalAgg.n)])),
    cls: evalAgg.cls,
    learnings: evalAgg.learnings.slice(0, 8),
  } : null;
  // Guardrail robustness facet: leak detection per conversation, pooled to held/total.
  const guardOut = guard.n ? (() => {
    let held = 0, code = 0, inj = 0;
    for (const c of guard.convs) { const g = guardrailLeak(c.turns); if (g.held) held++; if (g.codeLeak) code++; if (g.injectionLeak) inj++; }
    return { n: guard.n, held, codeLeak: code, injectionLeak: inj, convs: guard.convs };
  })() : null;
  if (!themes.length) {
    // No latency-valid conversation, but engaged outcomes still exist (early bails):
    // surface them so the automation table doesn't silently hide the worst failures.
    if (engaged || guardOut) return { themes: [], stats: null, ticket: null, auto: autoOut, evalq: evalOut, guard: guardOut };
    return null;
  }
  const order = (mode === "support" ? SUPPORT_THEMES : SHOPPING_THEMES).map(t => t.key);
  themes.sort((a, b) => order.indexOf(a.theme) - order.indexOf(b.theme));
  const aiTurns = themes.flatMap(t => (t.turns || []).filter(x => x.by === "ai" && x.complete_ms != null));
  const aiMs = aiTurns.map(x => x.complete_ms);
  // TTFT ("first signal") + delivery classification — Roman's key insight: a shopper
  // feels the first token / first card, not the full answer. ttft_ms is captured per
  // turn; growth_events distinguishes streaming (many DOM increments) from atomic
  // (1-2 jumps) delivery. A vendor is "streaming" if the median growth_events ≥ 4.
  const ttfts = aiTurns.map(x => x.ttft_ms).filter(x => x != null);
  const growth = aiTurns.map(x => x.growth_events).filter(x => x != null);
  const median = (a) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  const totalTurns = themes.reduce((a, t) => a + (t.turns ? t.turns.length : 0), 0);
  const answered = themes.reduce((a, t) => a + (t.turns || []).filter(x => x.by === "ai" && x.complete_ms != null).length, 0);
  const themesWithHandover = themes.filter(t => t.stats && t.stats.handover_turn != null).length;
  const tk = [...themes].reverse().find(t => t.ticket && t.ticket.conversation_id) || themes.find(t => t.ticket);
  const medGrowth = median(growth);
  return {
    auto: autoOut, evalq: evalOut, guard: guardOut,
    themes: themes.map(t => ({ theme: t.theme, label: t.themeLabel, turns: t.turns, stats: t.stats, ticket: t.ticket || null, error: t.error || null, datetime: t._datetime || null })),
    stats: {
      n_themes: themes.length, turns_total: totalTurns,
      avg_turns: themes.length ? Math.round((totalTurns / themes.length) * 10) / 10 : null,
      answered_no_handover: answered,
      success_rate: totalTurns ? Math.round((answered / totalTurns) * 100) : null,
      avg_ms: aiMs.length ? Math.round(aiMs.reduce((a, b) => a + b, 0) / aiMs.length) : null,
      min_ms: aiMs.length ? Math.min(...aiMs) : null,
      max_ms: aiMs.length ? Math.max(...aiMs) : null,
      ttft_ms: ttfts.length ? Math.round(median(ttfts)) : null,      // median first-signal
      delivery: medGrowth == null ? null : (medGrowth >= 4 ? "streaming" : "atomic"),
      med_growth: medGrowth,
      themes_with_handover: themesWithHandover,
    },
    ticket: tk ? tk.ticket : null,
  };
}

// Engaged conversations exist (early bails / deflections) but none passed the latency
// validity gate — an OUTCOME-ONLY entry so the automation table shows the failure
// instead of silently hiding the store for that run.
function outcomeOnlyEntry(site, mode, agg, date) {
  return {
    id: `${site.key}-${mode}-${date}`, date, vendor: site.vendor, store: site.store, site: host(site.url), url: site.url,
    method: "new", us: !!site.us, lat: "—", latPct: 0, success: null, successTxt: "—",
    auto: agg.auto, evalq: agg.evalq, guard: agg.guard,
    what: `Engaged ${agg.auto.engaged} conversation(s) but none produced ≥3 timed AI answers — ` +
      (agg.auto.handover ? `${agg.auto.handover} early handover(s). ` : "") +
      (agg.auto.deflected ? `${agg.auto.deflected} deflection(s). ` : "") +
      `Counted in automation rate, excluded from latency.`,
    datetime: null, themes: [], turns: [],
  };
}

function measuredEntry(site, mode, agg, date) {
  const st = agg.stats;
  const avgS = st.avg_ms != null ? round1(st.avg_ms / 1000) : null;
  const hadHandover = st.themes_with_handover || 0;
  const allHuman = avgS == null; // no AI turn ever timed
  const success = st.success_rate;
  const what = allHuman
    ? `Cold private run (${st.n_themes} themes): a human owned every conversation — no AI self-service this session.`
    : `${st.n_themes} cold private conversations (${mode === "support" ? "support themes" : "shopping themes"}). `
      + (hadHandover ? `Handover in ${hadHandover}/${st.n_themes} themes. ` : `No handover in any theme. `)
      + `Avg end-to-end latency ~${avgS}s across ${st.answered_no_handover} AI-timed turns.`;
  const e = {
    id: `${site.key}-${mode}-${date}`, date, vendor: site.vendor, store: site.store, site: host(site.url), url: site.url,
    method: "new", us: !!site.us,
    lat: avgS != null ? `~${avgS}s` : "—", latPct: avgS != null ? Math.min(100, Math.round(avgS / 25 * 100)) : 0,
    ttft: st.ttft_ms != null ? round1(st.ttft_ms / 1000) : null, delivery: st.delivery,
    success, successTxt: success != null ? success + "%" : "—",
    avgTurns: st.avg_turns,
    timed: st.answered_no_handover, attempted: st.turns_total,   // latency-measurement coverage
    auto: agg.auto, evalq: agg.evalq, guard: agg.guard,
    ticket: tk(agg.ticket),
    what,
    datetime: agg.themes.map(t => t.datetime).filter(Boolean).sort().pop() || null,
    themes: agg.themes.map(t => ({
      key: t.theme, label: t.label, datetime: t.datetime || null,
      lat: t.stats.avg_ms != null ? `~${round1(t.stats.avg_ms / 1000)}s` : "—",
      success: t.stats.success_rate, successTxt: (t.stats.success_rate != null ? t.stats.success_rate + "%" : "—"),
      handoverTurn: t.stats.handover_turn,
      ticket: tk(t.ticket),
      turns: themeTurns(t),
    })),
  };
  if (mode === "shopping" && CAPS[site.key]) e.caps = CAPS[site.key];
  // Relevance/Resolution Quality — LLM-judge scores from quality-scores.json (per store+mode).
  const qs = QSCORES[mode] && QSCORES[mode][site.key];
  if (qs) e.quality = qs;
  // flat turns = first theme, for any legacy code path
  e.turns = e.themes[0] ? e.themes[0].turns : [];
  return e;
}

function pendingEntry(site, mode) {
  const cur = CURATED[site.key] || { method: "pending", successTxt: "pending", successCls: "p-na", what: "Not captured in a cold run yet — pending." };
  const e = {
    id: `${site.key}-${mode}-pending`, date: LATEST, vendor: site.vendor, store: site.store, site: host(site.url), url: site.url,
    method: cur.method, us: !!site.us, lat: "—", success: null, successTxt: cur.successTxt, successCls: cur.successCls,
    what: cur.what, turns: [],
  };
  if (mode === "shopping" && CAPS[site.key]) e.caps = CAPS[site.key];
  return e;
}

// Vendors that already have a NON-candidate store — used to hide untested
// breadth-candidate 2nd stores (Sonos, Chubbies…) while still showing a new
// vendor whose only listed store happens to be flagged candidate (Rep/Kodif/Humind).
const vendorsWithReal = new Set(SITES.filter(s => s.url && !s.candidate).map(s => s.vendor));

async function buildMode(mode) {
  const out = [];
  for (const site of SITES) {
    if (!site.url) continue;                 // skip TBD placeholder rows
    // Accumulate: one dated entry per run that actually captured this store.
    let anyMeasured = false;
    for (const date of DATES) {
      const agg = await loadAgg(site.key, mode, date);
      if (agg && agg.themes && agg.themes.length) { out.push(measuredEntry(site, mode, agg, date)); anyMeasured = true; }
      else if (agg && agg.auto && agg.auto.engaged) { out.push(outcomeOnlyEntry(site, mode, agg, date)); anyMeasured = true; }
    }
    // No data in ANY run → one pending row (skip untested breadth-candidates whose vendor is already represented).
    if (!anyMeasured && !(site.candidate && vendorsWithReal.has(site.vendor))) out.push(pendingEntry(site, mode));
  }
  return out;
}

const STORES = await buildMode("shopping");
const SUPPORT = await buildMode("support");

const banner = (name) => `// ---- ${name} — GENERATED by runner/gen.js from runs [${DATES.join(", ")}]. Do not hand-edit. ----`;
const block = `${banner("SHOPPING (one entry per store; .themes = 5 apple-to-apple conversations)")}\nconst STORES = ${JSON.stringify(STORES, null, 1)};\n\n${banner("SUPPORT (same store list, support themes)")}\nconst SUPPORT = ${JSON.stringify(SUPPORT, null, 1)};\n\n`;

if (args.includes("--print")) {
  const line = (s) => `  ${s.method.padEnd(7)} ${(s.vendor + '/' + s.store).padEnd(32)} ${(s.lat || '—').padStart(7)} ${(s.successTxt || '').padStart(6)} ${s.themes ? '· ' + s.themes.length + ' themes' : ''}`;
  console.log("\nSHOPPING:"); STORES.forEach(s => console.log(line(s)));
  console.log("\nSUPPORT:"); SUPPORT.forEach(s => console.log(line(s)));
  console.log("\n(--print: report.html NOT modified)");
  process.exit(0);
}
const REPORT = new URL("../report.html", import.meta.url).pathname;
let html = await readFile(REPORT, "utf8");
const a = html.indexOf("const STORES = [");
const b = html.indexOf("let MODE='shopping';");
if (a < 0 || b < 0 || b < a) { console.error("Could not find STORES…let MODE markers in report.html"); process.exit(1); }
html = html.slice(0, a) + block + html.slice(b);
await writeFile(REPORT + ".tmp", html);   // atomic: write tmp then rename, so a live reload never sees a half-written file
await rename(REPORT + ".tmp", REPORT);

const summarize = (arr, mode) => {
  const m = arr.filter(s => s.method === "new");
  console.log(`  ${mode}: ${m.length}/${arr.length} measured · ${arr.length - m.length} pending/legacy`);
};
summarize(STORES, "shopping");
summarize(SUPPORT, "support");
console.log(`Wrote ${REPORT} (runs ${DATES.join(", ")}).`);
