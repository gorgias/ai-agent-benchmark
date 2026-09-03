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
import { convoValidity, convoOutcome, guardrailLeak, connectivityFail, isHandoffOnly } from "./classify.js";
import { cleanAnswer, stripWidgetChrome } from "./reply-clean.js";
import { conversationTurnQuality } from "./turn-quality.js";
import { isQuarantinedConversation } from "./conversation-quarantine.js";

// Delivery style is an ENGINE property, not a per-conversation trait, and the
// growth_events proxy is unreliable at the extremes: it counts EVERY DOM length
// increase, so a widget's loader ("I'm looking into this…"), appended timestamps
// and multi-bubble answers inflate the count even when nothing streams (Gorgias
// medians ~4 = a placeholder loader, NOT tokens). Conversely a fast token stream
// can coalesce into a single measured jump (Amazon Rufus medians 1 despite really
// streaming). So we pin the engines we've verified by eye and fall back to the
// heuristic — with a higher bar (≥6) so loader/chrome churn no longer false-flags.
const DELIVERY_OVERRIDE = {
  "Gorgias": "atomic",       // "I'm looking into this…" is a loader, then the answer lands at once — not streaming
  "Amazon Rufus": "streaming", // genuinely token-streams; capture coalesces it, so the proxy misses it
};
import { extractRecommendedProducts } from "./product-recommendation-bars.js";
import { normalizeUserMessage } from "./message-style.js";
import { rankCutoff } from "./ranking-window.js";

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
// Trailing 90-day window (inclusive) for RANKINGS — the point is that older runs matter less
// as new ones accumulate. ISO date strings compare lexically, so a string cutoff is enough.
const RANK_CUTOFF = rankCutoff(LATEST);
// Rankability floor: a vendor needs at least this many judged conversations IN A LANE (in the
// window) to enter the scoreboard / head-to-head ranking. Set to 15 = at least THREE stores'
// worth (5 themes each) — a board metric shouldn't rank a vendor #1 off a single store, and a
// 5-conversation deflector (Klaviyo) shouldn't out-rank a 27-conversation vendor on noise
// (2026-07-10 decision). Below the floor a vendor is still SHOWN in the prose profiles, just
// not ranked head-to-head — "shown, insufficient sample".
const MIN_RANK_CONVS = 15;
console.log(`Generating report data from ${DATES.length} run(s): ${DATES.join(", ")}`);

// Per-CONVERSATION LLM-judge eval scores (eval-scores.json, built by eval-pack/eval-merge +
// the judge pass). Keyed by "<date>/<conv-filename>". Rubrics: shopping = answer35/rec25/
// rich25/close15; support = resolution40/accuracy25/actionability20/close15.
let EVALS = {};
try { EVALS = JSON.parse(await readFile(new URL("./eval-scores.json", import.meta.url).pathname, "utf8")); } catch {}

// ---- per-store capability matrix (SHOPPING only). 1=yes, 0=no, 2=untested. ----
const CAPS = {
  "spiffy-supergoop": { qr: 1, cards: 1, reviews: 1, completes: 1 },
  "gorgias-madura": { qr: 0, cards: 1, reviews: 0, completes: 1 },   // V3 SA renders product cards (transcript evidence: product links/cards)
  "gorgias-jade": { qr: 1, cards: 0, reviews: 0, completes: 1 },     // (excluded from Shopping — not V3)
  "gorgias-beekman": { qr: 1, cards: 1, reviews: 0, completes: 1 },  // V3 SA (beta_3_sa) — product cards observed
  "gorgias-shoebacca": { qr: 1, cards: 1, reviews: 0, completes: 1 },// product cards observed in transcripts
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
// p-th percentile (nearest-rank) — used for p75 latency, Gorgias's headline latency metric.
const percentile = (arr, p) => { if (!arr || !arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

// Clean the captured reply tail into a short, honest answer cell.
function cleanReply(s) {
  if (!s) return "";
  let t = String(s).replace(/\s+/g, " ").trim();
  // drop a leading timestamp / "You said" echo if present
  t = t.replace(/^\d{1,2}:\d{2}\s*(AM|PM)?\.?\s*/i, "");
  if (t.length > 170) t = t.slice(-170).replace(/^\S*\s/, "…");
  return t;
}
function aText(turn, names = []) {
  if (turn.unsent) return "⏹ not sent — conversation was handed to a human";
  if (turn.by === "human") return "🚩 human took over";
  // cleanAnswer strips widget chrome / suggested-reply chips / product-card fragments
  // (see reply-clean.js) and shows the START of the real answer — not the chip tail.
  // Prefer replyText (the FULL turn reply captured by run.js since 2026-07-07; replyTail
  // keeps only the last 500 chars, which beheads long answers) and keep line breaks so
  // paragraphs/bullets render. Cap 2400 = the window the LLM-judge scores (eval-pack.js),
  // so the reader sees the same answer text the quality score was based on. `names`
  // (store/vendor/bot personas) lets the cleaner drop bare sender-label lines ("Willow").
  const clean = cleanAnswer(turn.replyText || turn.replyTail, turn.q, 2400, { breaks: true, names });
  if (turn.complete_ms == null) {
    return clean ? "(streamed past timing window) " + clean : "AI replied (streamed past timing window)";
  }
  return clean || "AI answered";
}
// Human-readable label + tone for a per-turn quality flag (from turn_quality.js).
const TQ_FLAG = {
  low_question_coverage:      ["missed part of the ask", "warn"],
  sales_prompt_on_support_ask:["sales prompt on a support question", "warn"],
  missing_responsible_party:  ["didn't say who's responsible", "warn"],
  missing_timeframe:          ["no timeframe given", "warn"],
  missing_contact_path:       ["no contact path given", "warn"],
  no_measured_answer:         ["no timed answer", "bad"],
  not_substantive:            ["thin / non-substantive", "bad"],
  echoed_question:            ["echoed the question back", "warn"],
  thin_answer:                ["thin answer", "warn"],
  likely_chip_menu:           ["chip menu, not prose", "warn"],
  clarifying_question:        ["clarifying the need ↩", "ok"],
};
const normalizeDisplayTurns = (turns) => (turns || []).map((turn) => ({
  ...turn,
  q: normalizeUserMessage(turn.q),
}));
// Truncate the transcript at the first handover turn — once a human takes over the
// conversation is over; we never show turns past that point.
const themeTurns = (t, mode = "", names = []) => {
  let turns = t.turns || [];
  const ho = turns.findIndex(x => x.handover);
  if (ho >= 0) turns = turns.slice(0, ho + 1);
  // Per-turn quality signals (turn-quality.js). Prefer the copy the LLM-judge attached
  // (t.tq), but these signals are 100% DETERMINISTIC — coverage + flags derived from the
  // transcript text, no model. So when a conversation was never judged (e.g. a fresh
  // capture, or a vendor the judge skipped), compute them on the fly here. This keeps the
  // Conversations tab's per-message quality chips present on EVERY conversation, not just
  // the judged subset. (Was the "lost metadata on the conversation tab" gap.)
  // ALWAYS recompute turn-quality at bake time (pure + cheap): stored tq snapshots go
  // stale whenever the chip rules improve (e.g. clarifying-turn suppression, 2026-07-09).
  let tq = [];
  if (turns.length) {
    try { tq = conversationTurnQuality(turns, mode).turns || []; } catch { tq = (t.tq && t.tq.turns) || []; }
  }
  return turns.map((x, i) => {
    // EXCLUDED turns (Max's call, 2026-07-09): a turn whose capture was corrupted by the
    // stall/boundary bugs shows an explicit exclusion note instead of garbage — no fake
    // text, no timing, no quality chips. Raw files keep everything for audit; the report
    // simply does not present a corrupted message as if it were the vendor's answer.
    if (x.mistimed_correction || x.boundary_bleed_correction) {
      return { q: normalizeUserMessage(x.q), a: "⚠ capture error — this reply was not recorded cleanly and is excluded from display and metrics", by: x.by, lat: null, excluded: true };
    }
    const s = tq[i] || null;
    const flags = ((s && s.flags) || []).map(f => TQ_FLAG[f] ? { t: TQ_FLAG[f][0], k: TQ_FLAG[f][1] } : { t: f.replace(/_/g, " "), k: "warn" });
    const clarify = s && (s.flags || []).includes("clarifying_question");
    const cov = !clarify && s && s.keyword_coverage && s.keyword_coverage.asked ? Math.round(s.keyword_coverage.ratio * 100) : null;
    return {
      q: normalizeUserMessage(x.q), a: aText(x, names), by: x.by,
      lat: x.ai_latency_ms != null ? round1(x.ai_latency_ms / 1000) : null,
      ...(flags.length ? { fl: flags } : {}),
      ...(cov != null ? { cov } : {}),
    };
  });
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
    const id = `${date}/${f}`;
    if (isQuarantinedConversation(id)) continue;
    try {
      const obj = JSON.parse(await readFile(`${dir}/${f}`, "utf8"));
      const isGuard = obj.theme === "guardrails" || GUARDRAIL_KEYS.has(obj.theme);
      if (isGuard) {
        const ev = EVALS[id];
        guard.n++;
        guard.convs.push({ theme: obj.theme, turns: normalizeDisplayTurns(obj.turns), datetime: obj.capturedAt || null, capture: obj.capture || null, eval: ev || null });
        continue;   // never in latency/automation/quality aggregates
      }
      // CONNECTIVITY FAILURE: widget dropped mid-session (offline/reconnecting) — measures the
      // store's transport, not AI quality. Excluded from ALL aggregates, every vendor alike.
      if (connectivityFail(obj.turns || [])) continue;
      // LOGIN WALL: a logged-out cold harness hit an order-specific login/verification gate it
      // cannot pass, so the AI stopped — a harness limitation, NOT an automation failure. Like
      // connectivity fails, gate_blocked convs are excluded from ALL aggregates (automation
      // included), every vendor alike (see METHODOLOGY §Ranking). Counting them as handover/
      // deflection would penalize vendors that run the most order-specific support flows.
      if (obj.gate_blocked) continue;
      // PROVIDER MISMATCH: at capture the widget serving this store was a DIFFERENT provider
      // than the one we attribute it to (the store switched providers). Exclude from all
      // aggregates so a conversation is never credited to the wrong vendor — the vendors.js
      // mapping should be corrected. (Detected by provider-detect.js at capture time.)
      if (obj.provider_mismatch) continue;
      // HANDOFF-ONLY re-derivation: a reply whose entire substance is a "talk to a human" /
      // "transfer you to an agent" button (no actual answer) is a DEFLECTION, not a fast
      // automated answer. Mark it (→ convoOutcome reads deflected/engaged) and drop its
      // latency (→ not a timed answer for validity/latency). Guarded by length in
      // isHandoffOnly so a real answer that merely offers a human in passing is untouched
      // (false-gate lesson). Symmetric across vendors — chiefly corrects pure-deflection
      // Zendesk stores that were being scored as 100%-success ~2s automated answers.
      for (const t of (obj.turns || [])) {
        if (t.by !== "ai") continue;
        // Clean once and stash it: convoOutcome reads t.replyClean so deflection detection runs
        // on the AI's prose, not on suggested-reply chips that survive in the raw replyTail.
        const clean = stripWidgetChrome(t.replyText || t.replyTail || "", t.q || "");
        t.replyClean = clean;
        if (!t.handover && isHandoffOnly(clean)) { t.handoff_cta = true; t.complete_ms = null; t.ai_latency_ms = null; }
      }
      auto[convoOutcome(obj.turns || []).outcome]++;
      const ev = EVALS[id];
      obj._eval = ev || null;   // carry the eval (incl. per-turn turn_quality) onto the theme
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
    // Bake turn METRICS only — raw replyTail/replyText is never rendered client-side and
    // leaks widget chrome ("Seen • Just now") into the artifact (Intercom audit 2026-07-15).
    const lean = guard.convs.map((c) => ({ ...c, turns: (c.turns || []).map(({ replyTail, replyText, ...rest }) => rest) }));
    return { n: guard.n, held, codeLeak: code, injectionLeak: inj, convs: lean };
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
  // (1-2 jumps) delivery. Fallback heuristic only (DELIVERY_OVERRIDE wins): a vendor
  // streams if median growth_events ≥ 6 — the bar is high because loaders, appended
  // timestamps and multi-bubble answers each add increments (~4) without any streaming.
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
    themes: themes.map(t => ({ theme: t.theme, label: t.themeLabel, turns: t.turns, stats: t.stats, ticket: t.ticket || null, error: t.error || null, datetime: t._datetime || null, capture: t.capture || null, tq: (t._eval && t._eval.turn_quality) || null,
      // Compact per-conversation LLM-judge eval so the Conversations tab can show the
      // quality score + dimension breakdown per conversation (not just the aggregate).
      ev: (t._eval && t._eval.total != null) ? { total: t._eval.total, cls: t._eval.resolution_class || null, dims: t._eval.rubric || {}, note: t._eval.learning || null } : null })),
    stats: {
      n_themes: themes.length, turns_total: totalTurns,
      avg_turns: themes.length ? Math.round((totalTurns / themes.length) * 10) / 10 : null,
      answered_no_handover: answered,
      success_rate: totalTurns ? Math.round((answered / totalTurns) * 100) : null,
      avg_ms: aiMs.length ? Math.round(aiMs.reduce((a, b) => a + b, 0) / aiMs.length) : null,
      p75_ms: aiMs.length ? Math.round(percentile(aiMs, 75)) : null,   // Gorgias benchmarks on p75
      min_ms: aiMs.length ? Math.min(...aiMs) : null,
      max_ms: aiMs.length ? Math.max(...aiMs) : null,
      ttft_ms: ttfts.length ? Math.round(median(ttfts)) : null,      // median first-signal
      delivery: medGrowth == null ? null : (medGrowth >= 6 ? "streaming" : "atomic"),
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
    widget: site.widget, locale: site.locale || "en-US",
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
    widget: site.widget, locale: site.locale || "en-US",
    method: "new", us: !!site.us,
    lat: avgS != null ? `~${avgS}s` : "—", latPct: avgS != null ? Math.min(100, Math.round(avgS / 25 * 100)) : 0,
    latP75: st.p75_ms != null ? round1(st.p75_ms / 1000) : null,   // p75 latency (seconds)
    ttft: st.ttft_ms != null ? round1(st.ttft_ms / 1000) : null, delivery: DELIVERY_OVERRIDE[site.vendor] || st.delivery,
    success, successTxt: success != null ? success + "%" : "—",
    avgTurns: st.avg_turns,
    timed: st.answered_no_handover, attempted: st.turns_total,   // latency-measurement coverage
    auto: agg.auto, evalq: agg.evalq, guard: agg.guard,
    ticket: tk(agg.ticket),
    what,
    datetime: agg.themes.map(t => t.datetime).filter(Boolean).sort().pop() || null,
    themes: agg.themes.map(t => {
      const products = mode === "shopping" ? extractRecommendedProducts(t.turns || []) : [];
      return {
        key: t.theme, label: t.label, datetime: t.datetime || null,
        lat: t.stats.avg_ms != null ? `~${round1(t.stats.avg_ms / 1000)}s` : "—",
        success: t.stats.success_rate, successTxt: (t.stats.success_rate != null ? t.stats.success_rate + "%" : "—"),
        handoverTurn: t.stats.handover_turn,
        ticket: tk(t.ticket),
        ...(mode === "shopping" ? { productRecs: { count: products.length, names: products.map(p => p.name) } } : {}),
        ...(t.ev ? { ev: t.ev } : {}),   // per-conversation judge eval (score + dims + note)
        turns: themeTurns(t, mode, [site.store, site.vendor, ...(site.personas || [])]),
      };
    }),
  };
  if (mode === "shopping" && CAPS[site.key]) e.caps = CAPS[site.key];
  // Quality comes EXCLUSIVELY from the per-conversation LLM-judge evals (evalq).
  // The legacy quality-scores.json fallback (hand-curated, pre-eval methodology) was
  // removed 2026-07-03 — mixing two scoring methods in one column made numbers
  // uncomparable across stores.
  // flat turns = first theme, for any legacy code path
  e.turns = e.themes[0] ? e.themes[0].turns : [];
  return e;
}

function pendingEntry(site, mode) {
  const cur = CURATED[site.key] || { method: "pending", successTxt: "pending", successCls: "p-na", what: "Not captured in a cold run yet — pending." };
  const e = {
    id: `${site.key}-${mode}-pending`, date: LATEST, vendor: site.vendor, store: site.store, site: host(site.url), url: site.url,
    widget: site.widget, locale: site.locale || "en-US",
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
    // E-commerce-only benchmark (Max): Gorgias is a pure e-commerce agent, so every compared
    // store must be a real merchant. Non-ecommerce deployments (SaaS, fintech, services —
    // e.g. Intercom on Synthesia/Kajabi, Decagon on Bilt/Hertz) are excluded from BOTH lanes;
    // `ecommerce:false` is set on those store rows in vendors.js.
    if (site.ecommerce === false) continue;
    // NOTE (2026-07-17): the former version-tier store filter (Gorgias-only "v3:false → exclude
    // from both lanes") was REMOVED for benchmark neutrality. It keyed off a private field with
    // no cross-vendor equivalent — no vendor should have its non-latest deployments filtered out
    // when others don't. Every live, verified store now counts (impact ~1 pt/lane).
    // Madura's SHOPPING lane is misconfigured — the agent treats shopping openers ("guide me")
    // as payment-method queries (card/PayPal/Alma), a store-specific config gap, NOT the V3 agent's
    // behavior (other Gorgias stores sell fine: Beekman 88, Addison Bay 86). Excluded from Shopping
    // as a non-representative shopping deployment per the standing prune-misconfigured-stores rule.
    // Its SUPPORT is a valid, strong deployment (100/100/100) and is kept.
    if (site.key === "gorgias-madura" && mode === "shopping") continue;
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

// SPLIT PAYLOAD for load speed: turn TEXT (q/a — ~3 MB, half the report) is written to
// conv-text.json and fetched lazily when the Conversations view opens. The inline payload
// keeps every NUMERIC per-turn field (lat/by/cov/fl) so Summary / Best / latency deep-dive
// render instantly from a ~2 MB parse instead of 6 MB. Compact JSON (no pretty-print)
// shaves another ~0.8 MB of whitespace the browser would otherwise tokenize.
const CONVTEXT = {};
const stripTurnText = (arr) => arr.map((s) => ({
  ...s,
  themes: (s.themes || []).map((th) => {
    CONVTEXT[`${s.id}|${th.key}`] = (th.turns || []).map((t) => ({ q: t.q, a: t.a }));
    return { ...th, turns: (th.turns || []).map(({ q, a, ...rest }) => rest) };
  }),
}));
const STORES_LITE = stripTurnText(STORES);
const SUPPORT_LITE = stripTurnText(SUPPORT);
const CONVTEXT_JSON = JSON.stringify(CONVTEXT);

const banner = (name) => `// ---- ${name} — GENERATED by runner/gen.js from runs [${DATES.join(", ")}]. Do not hand-edit. ----`;
const block = `${banner("SHOPPING (one entry per store; .themes = 5 apple-to-apple conversations; turn text in conv-text.json)")}\nconst STORES = ${JSON.stringify(STORES_LITE)};\n\n${banner("SUPPORT (same store list, support themes)")}\nconst SUPPORT = ${JSON.stringify(SUPPORT_LITE)};\n\nconst CONVTEXT_URL = "conv-text.json?v=${CONVTEXT_JSON.length.toString(36)}";\n\n`;

if (args.includes("--print")) {
  const line = (s) => `  ${s.method.padEnd(7)} ${(s.vendor + '/' + s.store).padEnd(32)} ${(s.lat || '—').padStart(7)} ${(s.successTxt || '').padStart(6)} ${s.themes ? '· ' + s.themes.length + ' themes' : ''}`;
  console.log("\nSHOPPING:"); STORES.forEach(s => console.log(line(s)));
  console.log("\nSUPPORT:"); SUPPORT.forEach(s => console.log(line(s)));
  console.log("\n(--print: report.html NOT modified)");
  process.exit(0);
}
const REPORT = new URL("../report.html", import.meta.url).pathname;
let html = await readFile(REPORT, "utf8");
const generatedStart = html.indexOf("// ---- SHOPPING (one entry per store; .themes = 5 apple-to-apple conversations)");
const a = generatedStart >= 0 ? generatedStart : html.indexOf("const STORES = [");
const b = html.indexOf("let MODE='shopping';");
if (a < 0 || b < 0 || b < a) { console.error("Could not find STORES…let MODE markers in report.html"); process.exit(1); }
html = html.slice(0, a) + block + html.slice(b);
await writeFile(REPORT + ".tmp", html);   // atomic: write tmp then rename, so a live reload never sees a half-written file
await rename(REPORT + ".tmp", REPORT);
// lazy-loaded turn text — must be committed/deployed ALONGSIDE report.html
const CONVTEXT_PATH = new URL("../conv-text.json", import.meta.url).pathname;
await writeFile(CONVTEXT_PATH + ".tmp", CONVTEXT_JSON);
await rename(CONVTEXT_PATH + ".tmp", CONVTEXT_PATH);
console.log(`Wrote conv-text.json (${(CONVTEXT_JSON.length / 1048576).toFixed(1)} MB turn text, fetched on Conversations open).`);

const summarize = (arr, mode) => {
  const m = arr.filter(s => s.method === "new");
  console.log(`  ${mode}: ${m.length}/${arr.length} measured · ${arr.length - m.length} pending/legacy`);
};
summarize(STORES, "shopping");
summarize(SUPPORT, "support");
console.log(`Wrote ${REPORT} (runs ${DATES.join(", ")}).`);

// ---- SINGLE SOURCE OF TRUTH: push the same headline counts into takeaways.html ----
// The Summary (takeaways) and the Detailed report must never disagree on totals. We
// compute from the SAME baked arrays the report uses, so both pages move together.
const convCount = (arr) => arr.reduce((n, s) => n + ((s.themes && s.themes.length) || 0), 0);
// judged counted ONLY over conversations actually shown in the report (evalq.n per entry) —
// so "conversations" and "LLM-judged" describe the SAME set and align, instead of the raw
// eval-file count which also includes guardrail + connectivity-failed conversations.
const judgedShown = (arr) => arr.reduce((n, s) => n + ((s.themes || []).filter((t) => t.ev && t.ev.total != null).length), 0);
const allEntries = [...STORES, ...SUPPORT];
const STATS = {
  convs: convCount(STORES) + convCount(SUPPORT),
  judged: judgedShown(STORES) + judgedShown(SUPPORT),
  vendors: new Set(allEntries.map(s => s.vendor)).size,
  stores: new Set(allEntries.filter(s => s.method === "new").map(s => s.site)).size,
  runs: DATES.length,
};
// Per-vendor lane composites — computed with the EXACT formula the report uses, then injected
// into takeaways' scoreboard so the Summary can NEVER drift from the Detailed report again.
const PALETTE = { Gorgias:"#f0603f", Envive:"#22c55e", Ada:"#64748b", Siena:"#a855f7", Sierra:"#0ea5e9",
  Kodif:"#eab308", "Zendesk":"#3b82f6", "Rep AI":"#ef4444", DigitalGenius:"#8b5cf6", Yuma:"#14b8a6",
  Humind:"#f59e0b", "Google Agentic":"#4285F4", Klaviyo:"#111", "Shopify Inbox":"#95BF47" };
const speedScoreG = (l) => Math.max(0, Math.min(100, (22 - l) / 19 * 100));
const latNumG = (s) => { const m = (s.lat || "").match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };
function laneScores(arr) {
  // rankings use only the trailing 90 days (recency-weighted — older runs age out)
  const byV = {}; arr.filter(s => !s.date || s.date >= RANK_CUTOFF).forEach(s => { (byV[s.vendor] = byV[s.vendor] || []).push(s); });
  const out = {};
  for (const [v, es] of Object.entries(byV)) {
    const ag = es.reduce((a, s) => { if (s.auto) { a.a += s.auto.automated; a.e += s.auto.engaged; } return a; }, { a: 0, e: 0 });
    const qN = es.map(s => s.evalq && s.evalq.total).filter(x => x != null);
    const lN = es.map(latNumG).filter(x => x != null);
    const a = ag.e ? Math.round(100 * ag.a / ag.e) : null;
    const q = qN.length ? Math.round(qN.reduce((x, y) => x + y, 0) / qN.length) : null;
    const l = lN.length ? Math.round(lN.reduce((x, y) => x + y, 0) / lN.length * 10) / 10 : null;
    // p75 pooled over EVERY timed AI turn across the vendor's stores (baked turn.lat = seconds)
    const turnLats = es.flatMap(s => (s.themes || []).flatMap(t => (t.turns || []).filter(x => x.by === "ai" && x.lat != null).map(x => x.lat)));
    const l75 = turnLats.length ? Math.round(percentile(turnLats, 75) * 10) / 10 : null;
    // RANKABLE only with a real quality score: quality is a 40% pillar of the composite, so a
    // vendor with automation+latency but no judged quality (e.g. Klaviyo/Decagon — thin/unjudged
    // capture) must NOT get a composite (it renormalizes to automation+speed and ranks spuriously).
    // Those vendors live in the prose profiles as "not measurable / capture in progress", not the scoreboard.
    const convN = es.reduce((n, s) => n + ((s.themes && s.themes.length) || 0), 0);
    if (q == null || convN < MIN_RANK_CONVS) continue;   // no judged quality, or thin sample → not rankable
    out[v] = { a, q, l, l75, n: convN };
  }
  return out;
}
const shopS = laneScores(STORES), supS = laneScores(SUPPORT);
const D_OBJ = {};
for (const v of new Set([...Object.keys(shopS), ...Object.keys(supS)])) {
  const us = allEntries.find(s => s.vendor === v && s.us) ? 1 : 0;
  D_OBJ[v] = { ...(us ? { us: 1 } : {}), col: PALETTE[v] || "#888",
    s: shopS[v] || null, p: supS[v] || null };
}
const D_JSON = " const D = " + JSON.stringify(D_OBJ) + ";";

// ---- AUTO-GENERATED VERDICT: rank claims are derived from the same lane composites, never
// hand-typed — so the Summary headline can never contradict the scoreboard again. ----
const OUTLIER_V = new Set(["Amazon Rufus"]);  // references, not ranked head-to-head
// LANE-SPECIFIC composite weights (2026-07-10, Max): SHOPPING weights speed higher — latency
// is critical to conversion (a shopper won't wait); SUPPORT weights automation higher —
// containment (not handing off to a human) is the point. Quality stays 0.3 in both.
// LANE-SPECIFIC weights. Shopping weights speed up (latency drives conversion); support
// weights automation up (containment is the job). Must match report.html + takeaways.html —
// locked by lane-weights.test.js.
//
// SUPPORT REWEIGHT (2026-09-03): speed 20% -> 10%, quality 30% -> 40%. Rationale: latency
// tolerance in support is materially higher than in shopping — a customer waiting on a
// return-policy answer is not a shopper abandoning a cart — so 20% overweighted speed in the
// lane where it matters least. Quality absorbs it: at 30%, answer quality was too weak a
// check on containment, and a vendor that contains tickets with poor answers should not
// outrank one that actually resolves them.
//
// DISCLOSURE: this moves Gorgias #3 -> #2 in support, and moves Yuma #2 -> #1. Adopted with
// the effect on every vendor computed first (notes/lane-weights-2026-09-03.md); it does not
// hand Gorgias the top position. Per the rule in ranking-window.js, a weighting change must
// be validated across every vendor and must never be adopted because it favours Gorgias.
const LANE_W = { shopping: { a: 0.4, q: 0.35, s: 0.25 }, support: { a: 0.5, q: 0.4, s: 0.1 } };
const laneRank = (scores, w) => Object.entries(scores)
  .filter(([v, sc]) => sc && sc.q != null && sc.n >= MIN_RANK_CONVS && !OUTLIER_V.has(v))
  .map(([v, sc]) => ({ v, comp: Math.round(w.a * sc.a + w.q * sc.q + w.s * speedScoreG(sc.l)) }))
  .sort((a, b) => b.comp - a.comp);
const rShop = laneRank(shopS, LANE_W.shopping), rSupp = laneRank(supS, LANE_W.support);
const shopC = Object.fromEntries(rShop.map(r => [r.v, r.comp])), suppC = Object.fromEntries(rSupp.map(r => [r.v, r.comp]));
// overall = mean of the two lane composites, for vendors ranked in BOTH lanes
const rOverall = Object.keys(shopC).filter(v => v in suppC)
  .map(v => ({ v, mean: (shopC[v] + suppC[v]) / 2 })).sort((a, b) => b.mean - a.mean);
const gShop = rShop.findIndex(r => r.v === "Gorgias") + 1;
const gSupp = rSupp.findIndex(r => r.v === "Gorgias") + 1;
const gOv = rOverall.findIndex(r => r.v === "Gorgias") + 1;
const suppLeader = rSupp[0] && rSupp[0].v, shopLeader = rShop[0] && rShop[0].v, ovLeader = rOverall[0] && rOverall[0].v;
const suppTxt = "#" + gSupp + " support", shopTxt = "#" + gShop + " shopping", ovTxt = "#" + gOv + " overall";
const RANK_OVERALL = gOv ? ("#" + gOv) : "\u2014";
const RANK_LANES = `${suppTxt} (${suppC["Gorgias"] != null ? suppC["Gorgias"] : "\u2014"}), ${shopTxt} (${shopC["Gorgias"] != null ? shopC["Gorgias"] : "\u2014"})`;
const RANK_TITLE = `Gorgias: ${ovTxt} \u2014 ${gSupp === 1 ? "best-in-class support" : suppTxt}, ${gShop === 1 ? "top shopping" : "one shopping-speed gap"}.`;
const RANK_BADGE = `${ovTxt} \u00b7 ${suppTxt} \u00b7 ${shopTxt}`;
const RANK_H = `Gorgias is ${gOv === 1 ? "the #1 AI agent overall in the field (mean of both lanes)" : (ovTxt + ", behind " + ovLeader)} \u2014 ${gSupp === 1 ? "#1 in support (best-in-field answer quality + elite automation)" : (suppTxt + " (behind " + suppLeader + ")")} and ${gShop === 1 ? "#1 in shopping" : (shopTxt + ", behind " + shopLeader)}. The one gap is shopping speed.`;

try {
  const TK = new URL("../takeaways.html", import.meta.url).pathname;
  let tk = await readFile(TK, "utf8");
  // replace the scoreboard data object between markers (kept in sync forever)
  tk = tk.replace(/\/\*SCORES_START\*\/[\s\S]*?\/\*SCORES_END\*\//, `/*SCORES_START*/${D_JSON}/*SCORES_END*/`);
  // inject the live values as data-count so the count-up animation uses them
  tk = tk.replace(/(data-stat="convs"[^>]*data-count=")\d+(")/, `$1${STATS.convs}$2`)
         .replace(/(data-count=")\d+("[^>]*data-stat="convs")/, `$1${STATS.convs}$2`)
         .replace(/(data-count=")\d+("\s+data-stat="judged")/, `$1${STATS.judged}$2`)
         .replace(/(data-count=")\d+("\s+data-stat="vendors")/, `$1${STATS.vendors}$2`)
         .replace(/(data-count=")\d+("[^>]*data-stat="stores")/, `$1${STATS.stores}$2`)
         .replace(/<!-- STATS_JSON:.*?-->/, `<!-- STATS_JSON:${JSON.stringify(STATS)} -->`);
  // reconcile the prose count in the method note (any "NNN LLM-judged conversations")
  tk = tk.replace(/\b\d{3}\s+LLM-judged conversations\b/g, `${STATS.judged} LLM-judged conversations`);
  // generated verdict — replace between markers so the headline rank claims stay in sync
  tk = tk.replace(/<!--RANK_TITLE-->[\s\S]*?<!--\/RANK_TITLE-->/, `<!--RANK_TITLE-->${RANK_TITLE}<!--/RANK_TITLE-->`)
         .replace(/<!--RANK_BADGE-->[\s\S]*?<!--\/RANK_BADGE-->/, `<!--RANK_BADGE-->${RANK_BADGE}<!--/RANK_BADGE-->`)
         .replace(/<!--RANK_H-->[\s\S]*?<!--\/RANK_H-->/, `<!--RANK_H-->${RANK_H}<!--/RANK_H-->`);
  tk = tk.replace(/<!--RANK_OVERALL-->[\s\S]*?<!--\/RANK_OVERALL-->/, `<!--RANK_OVERALL-->${RANK_OVERALL}<!--/RANK_OVERALL-->`);
  tk = tk.replace(/<!--RANK_LANES-->[\s\S]*?<!--\/RANK_LANES-->/, `<!--RANK_LANES-->${RANK_LANES}<!--/RANK_LANES-->`);
  // "Refreshed <Month Year>" in the hero eyebrow — was hand-typed and went stale; now derived
  // from the actual latest run date every bake, same DATES/LATEST the rest of the page uses.
  const REFRESHED = `Refreshed ${new Date(LATEST + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  tk = tk.replace(/<!--REFRESHED-->[\s\S]*?<!--\/REFRESHED-->/, `<!--REFRESHED-->${REFRESHED}<!--/REFRESHED-->`);
  await writeFile(TK + ".tmp", tk); await rename(TK + ".tmp", TK);
  console.log(`Synced takeaways.html stats: ${STATS.convs} convs · ${STATS.judged} judged · ${STATS.vendors} vendors · ${STATS.stores} stores`);
} catch (e) { console.log("takeaways sync skipped:", e.message); }
