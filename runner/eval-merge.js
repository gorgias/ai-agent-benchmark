// eval-merge.js — folds judge outputs back into eval-scores.json (the cache gen.js reads).
// Validates shape hard: a malformed judge output is skipped and reported, never merged.
//
// v2 (see eval-rubric.md): judges emit binary evidence-forced CHECKS keyed by an opaque `k`;
// this script resolves `k` → conversation id via the batch dir's map-*.json, DERIVES the
// sub-scores and /100 total from the check booleans (the judge never picks a number),
// re-derives the deterministic rich-element signals from the stored transcript and enforces
// them as caps (a signal-gated check cannot pass without its signal), and rejects any
// passed check that carries no evidence quote. Legacy v1 entries (rubric+total emitted by
// the judge) remain readable in eval-scores.json; new entries are written with v:2.
//
// Usage: node eval-merge.js <scoredDir>   (reads scored-*.json + map-*.json files)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { convoSignals } from "./eval-signals.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCORES = path.join(HERE, "eval-scores.json");
const RESULTS = path.join(HERE, "results");
const dir = process.argv[2];
if (!dir) { console.error("usage: node eval-merge.js <scoredDir>"); process.exit(1); }

function normalizeOrigin(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return null;
  if (["codex", "openai-codex", "codex-desktop"].includes(v)) return "codex";
  if (["claude", "claude-code", "anthropic-claude"].includes(v)) return "claude";
  if (["automation", "cron", "launchd"].includes(v)) return "automation";
  return v.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function detectEvalOrigin() {
  const explicit = normalizeOrigin(process.env.BENCHMARK_EVAL_ORIGIN || process.env.BENCHMARK_CAPTURE_ORIGIN || process.env.AGENT_ORIGIN);
  if (explicit) return { origin: explicit, explicit: true };
  if (process.env.CODEX_SHELL || process.env.CODEX_CI || /codex/i.test(process.env.__CFBundleIdentifier || "")) return { origin: "codex", explicit: false };
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE || /claude/i.test(process.env.__CFBundleIdentifier || "")) return { origin: "claude", explicit: false };
  return { origin: "unknown", explicit: false };
}

const EVAL_ORIGIN = detectEvalOrigin();

// ---- the fixed check → points mapping (mirrors eval-rubric.md; the single source of scoring) ----
const CHECKS = {
  shopping: {
    answer: { a_direct: 14, a_consistent: 9, a_no_ignored: 7 },
    discovery: { d_clarify: 8, d_progressive: 7, d_not_dump: 5 },   // v2.2 — PMF core
    recommendation: { r_named: 9, r_fit: 8, r_plausible: 5 },
    rich: { e_price: 6, e_link: 7, e_reviews: 3, e_options: 2 },
    close: { c_cta: 5, c_cart: 3, c_clean: 2 },
  },
  support: {
    resolution: { s_answered: 18, s_outcome: 12, s_no_deflect: 10 },
    accuracy: { g_specific: 13, g_consistent: 5, g_grounded: 7 },   // v2.1: g_consistent split (calibration)
    actionability: { t_steps: 12, t_complete: 8 },
    close: { k_expectations: 8, k_clean: 7 },
  },
};
// signal gates: check → signal that must be true in the transcript for the check to pass
const SIGNAL_GATE = { e_price: "has_price", e_link: "has_link", e_reviews: "has_reviews", e_options: "has_options" };
const RESOLUTION_CLASSES = ["resolved", "partial", "deflected", "failed"];

function deriveScores(mode, checks, signals) {
  const dims = CHECKS[mode]; if (!dims) return null;
  const rubric = {}, gated = [];
  let total = 0;
  for (const [dim, defs] of Object.entries(dims)) {
    let s = 0;
    for (const [cid, pts] of Object.entries(defs)) {
      const c = checks[cid];
      if (!c || typeof c.pass !== "boolean") return null;                    // every check must be present
      let pass = c.pass;
      if (pass && !(typeof c.evidence === "string" && c.evidence.trim().length >= 3)) pass = false;  // no quote → no credit
      if (pass && SIGNAL_GATE[cid] && !signals[SIGNAL_GATE[cid]]) { pass = false; gated.push(cid); } // deterministic cap
      if (pass) s += pts;
    }
    rubric[dim] = s; total += s;
  }
  return { rubric, total, gated };
}

// map-*.json (opaque key → conversation id), from the same batch dir
const KMAP = {};
for (const f of fs.readdirSync(dir).filter((x) => /^map-.*\.json$/.test(x))) {
  try { Object.assign(KMAP, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch {}
}
// id format: "<date>/<file>.json" → on disk at results/<date>/conv/<file>.json
const convTurns = (id) => { try { const [d, f] = [id.slice(0, 10), id.slice(11)]; return JSON.parse(fs.readFileSync(path.join(RESULTS, d, "conv", f), "utf8")).turns || []; } catch { return null; } };

const all = fs.existsSync(SCORES) ? JSON.parse(fs.readFileSync(SCORES, "utf8")) : {};
let merged = 0, bad = 0, gatedTotal = 0;
for (const f of fs.readdirSync(dir).filter((x) => /^scored-.*\.json$/.test(x)).sort()) {
  let arr; try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { console.error(`SKIP ${f}: unparseable`); bad++; continue; }
  if (!Array.isArray(arr)) { console.error(`SKIP ${f}: not an array`); bad++; continue; }
  for (const e of arr) {
    const id = e && (KMAP[e.k] || e.id);                                    // v2 opaque key, or explicit id
    if (!id || !["shopping", "support"].includes(e.mode) || !RESOLUTION_CLASSES.includes(e.resolution_class) || typeof e.learning !== "string") {
      console.error(`  bad entry in ${f}: ${e && (e.k || e.id)}`); bad++; continue;
    }
    const turns = convTurns(id);
    if (!turns) { console.error(`  no transcript on disk for ${id}`); bad++; continue; }
    const derived = deriveScores(e.mode, e.checks || {}, convoSignals(turns));
    if (!derived) { console.error(`  incomplete checks in ${f}: ${id}`); bad++; continue; }
    gatedTotal += derived.gated.length;
    all[id] = { v: 2, mode: e.mode, rubric: derived.rubric, total: derived.total,
      checks: Object.fromEntries(Object.entries(e.checks).map(([k, c]) => [k, { pass: !!c.pass, evidence: String(c.evidence || "").slice(0, 160) }])),
      resolution_class: e.resolution_class, learning: e.learning.slice(0, 300), judged_at: e.judged_at || null,
      judge: { origin: EVAL_ORIGIN.origin, origin_explicit: EVAL_ORIGIN.explicit, runner: "eval-merge.js", schema: 1 } };
    merged++;
  }
}
fs.writeFileSync(SCORES, JSON.stringify(all, null, 1));
console.log(`merged ${merged} scores (${bad} rejected, ${gatedTotal} checks signal-gated, judge origin ${EVAL_ORIGIN.origin}) → ${SCORES} now has ${Object.keys(all).length} conversations`);
