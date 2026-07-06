#!/usr/bin/env node
// Dry-run scoreboard recompute. This intentionally does NOT write report.html,
// takeaways.html, run-status.html, or eval-scores.json.
//
// Examples:
//   node scoreboard-preview.js
//   node scoreboard-preview.js --exclude 2026-07-01/gorgias-madura-support-tracking.json
//   node scoreboard-preview.js --exclude-file .eval-wip/quarantine.txt --json .eval-wip/scoreboard-preview.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { STORES as SITES } from "./vendors.js";
import { SHOPPING_THEMES, SUPPORT_THEMES } from "./pools.js";
import { convoValidity, convoOutcome, connectivityFail } from "./classify.js";
import { QUARANTINE_IDS } from "./conversation-quarantine.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const RESULTS = path.join(HERE, "results");
const SCORES = path.join(HERE, "eval-scores.json");
const TAKEAWAYS = path.join(ROOT, "takeaways.html");
const MIN_RANK_CONVS = 5;
const DEFAULT_WINDOW_DAYS = 14;

const PALETTE = {
  Gorgias: "#f0603f",
  Envive: "#22c55e",
  Ada: "#64748b",
  Siena: "#a855f7",
  Sierra: "#0ea5e9",
  Kodif: "#eab308",
  "Meta AI": "#3b82f6",
  "Rep AI": "#ef4444",
  DigitalGenius: "#8b5cf6",
  Yuma: "#14b8a6",
  Humind: "#f59e0b",
  "Google Agentic": "#4285F4",
  Klaviyo: "#111",
  "Shopify Inbox": "#95BF47",
};

function usage() {
  console.log(`Usage: node runner/scoreboard-preview.js [options]

Options:
  --date YYYY-MM-DD           Recompute from one run date, matching gen.js --date.
  --exclude ID                Quarantine one conversation id from the recompute.
                              ID format: YYYY-MM-DD/filename.json. Repeatable.
  --exclude-file PATH         Read quarantined ids from JSON array or newline file.
  --include-quarantined       Include runner/conversation-quarantine.json entries.
  --window-days N             Ranking window in days. Default: ${DEFAULT_WINDOW_DAYS}.
  --json PATH                 Write the full preview payload as JSON.
  --no-baked                  Do not compare against takeaways.html's baked D object.
  --help                      Show this help.

This is a dry run: it never modifies report.html / takeaways.html / run-status.html.`);
}

function parseArgs(argv) {
  const out = {
    date: null,
    excludes: [],
    excludeFiles: [],
    json: null,
    windowDays: DEFAULT_WINDOW_DAYS,
    baked: true,
    includeQuarantined: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else if (a === "--date") {
      out.date = argv[++i];
    } else if (a === "--exclude") {
      out.excludes.push(...String(argv[++i] || "").split(",").map((x) => x.trim()).filter(Boolean));
    } else if (a === "--exclude-file") {
      out.excludeFiles.push(argv[++i]);
    } else if (a === "--json") {
      out.json = argv[++i];
    } else if (a === "--window-days") {
      out.windowDays = Number(argv[++i]);
    } else if (a === "--no-baked") {
      out.baked = false;
    } else if (a === "--include-quarantined") {
      out.includeQuarantined = true;
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  if (out.date && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error(`Invalid --date: ${out.date}`);
  if (!Number.isFinite(out.windowDays) || out.windowDays < 1) throw new Error(`Invalid --window-days: ${out.windowDays}`);
  return out;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function speedScore(lat) {
  return Math.max(0, Math.min(100, ((22 - lat) / 19) * 100));
}

function composite(m) {
  if (!m) return null;
  const parts = [
    [0.4, m.a],
    [0.4, m.q],
    [0.2, m.l != null ? speedScore(m.l) : null],
  ].filter((p) => p[1] != null);
  const w = parts.reduce((a, p) => a + p[0], 0);
  return w ? Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / w) : null;
}

function host(url) {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
  } catch {
    return String(url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  }
}

async function allDates() {
  const dirs = (await readdir(RESULTS, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  return dirs.filter((d) => fs.existsSync(path.join(RESULTS, d, "conv")));
}

async function loadExcludedFiles(files) {
  const ids = [];
  for (const file of files) {
    const txt = await readFile(file, "utf8");
    try {
      const parsed = JSON.parse(txt);
      if (!Array.isArray(parsed)) throw new Error("JSON exclude file must be an array");
      ids.push(...parsed.map(String));
    } catch {
      ids.push(...txt.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#")));
    }
  }
  return ids;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readBakedScoreboard() {
  const html = await readFile(TAKEAWAYS, "utf8");
  const m = html.match(/\/\*SCORES_START\*\/\s*const D = ([\s\S]*?);\s*\/\*SCORES_END\*\//);
  if (!m) return null;
  return JSON.parse(m[1]);
}

function cutoffFor(latest, windowDays) {
  const d = new Date(`${latest}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (windowDays - 1));
  return d.toISOString().slice(0, 10);
}

function evalOutFromAgg(evalAgg) {
  return evalAgg.n
    ? {
        n: evalAgg.n,
        total: Math.round(evalAgg.total / evalAgg.n),
        dims: Object.fromEntries(Object.entries(evalAgg.dims).map(([k, v]) => [k, Math.round(v / evalAgg.n)])),
        cls: evalAgg.cls,
      }
    : null;
}

async function loadAgg({ site, mode, date, evals, excluded }) {
  const dir = path.join(RESULTS, date, "conv");
  if (!fs.existsSync(dir)) return null;
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.startsWith(`${site.key}-${mode}-`) && f.endsWith(".json"));
  } catch {
    return null;
  }
  if (!files.length) return null;

  const themes = [];
  const auto = { automated: 0, handover: 0, deflected: 0, no_answer: 0 };
  const evalAgg = { n: 0, total: 0, dims: {}, cls: {} };

  for (const f of files) {
    const id = `${date}/${f}`;
    if (excluded.has(id)) continue;
    let obj;
    try {
      obj = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    if (obj.theme === "guardrails") continue;
    if (connectivityFail(obj.turns || [])) continue;

    auto[convoOutcome(obj.turns || []).outcome]++;
    const ev = evals[id];
    if (ev && ev.total != null) {
      evalAgg.n++;
      evalAgg.total += ev.total;
      for (const [k, v] of Object.entries(ev.rubric || {})) evalAgg.dims[k] = (evalAgg.dims[k] || 0) + v;
      evalAgg.cls[ev.resolution_class] = (evalAgg.cls[ev.resolution_class] || 0) + 1;
    }

    let dt = obj.capturedAt;
    if (!dt) {
      try {
        dt = (await stat(path.join(dir, f))).mtime.toISOString();
      } catch {}
    }
    obj._datetime = dt || null;
    obj._id = id;

    if (obj.valid === false) continue;
    if (!convoValidity(obj.turns || []).valid) continue;
    themes.push(obj);
  }

  const engaged = auto.automated + auto.handover + auto.deflected;
  const autoOut = {
    ...auto,
    engaged,
    rate: engaged ? Math.round((auto.automated / engaged) * 100) : null,
  };
  const evalq = evalOutFromAgg(evalAgg);
  if (!themes.length) {
    if (engaged) return { themes: [], stats: null, auto: autoOut, evalq };
    return null;
  }

  const order = (mode === "support" ? SUPPORT_THEMES : SHOPPING_THEMES).map((t) => t.key);
  themes.sort((a, b) => order.indexOf(a.theme) - order.indexOf(b.theme));
  const aiTurns = themes.flatMap((t) => (t.turns || []).filter((x) => x.by === "ai" && x.complete_ms != null));
  const aiMs = aiTurns.map((x) => x.complete_ms);
  const totalTurns = themes.reduce((a, t) => a + ((t.turns && t.turns.length) || 0), 0);
  const answered = aiTurns.length;
  return {
    auto: autoOut,
    evalq,
    themes: themes.map((t) => ({
      id: t._id,
      theme: t.theme,
      datetime: t._datetime,
      turns: t.turns || [],
      stats: t.stats || null,
    })),
    stats: {
      n_themes: themes.length,
      turns_total: totalTurns,
      answered_no_handover: answered,
      avg_ms: aiMs.length ? Math.round(aiMs.reduce((a, b) => a + b, 0) / aiMs.length) : null,
      p75_ms: aiMs.length ? Math.round(percentile(aiMs, 75)) : null,
      min_ms: aiMs.length ? Math.min(...aiMs) : null,
      max_ms: aiMs.length ? Math.max(...aiMs) : null,
    },
  };
}

function measuredEntry(site, mode, agg, date) {
  const avgS = agg.stats.avg_ms != null ? round1(agg.stats.avg_ms / 1000) : null;
  return {
    id: `${site.key}-${mode}-${date}`,
    date,
    vendor: site.vendor,
    store: site.store,
    site: host(site.url),
    us: !!site.us,
    lat: avgS != null ? `~${avgS}s` : "--",
    auto: agg.auto,
    evalq: agg.evalq,
    timed: agg.stats.answered_no_handover,
    attempted: agg.stats.turns_total,
    themes: agg.themes.map((t) => ({
      key: t.theme,
      id: t.id,
      turns: (t.turns || []).map((x) => ({
        by: x.by,
        lat: x.ai_latency_ms != null ? round1(x.ai_latency_ms / 1000) : null,
      })),
    })),
  };
}

function outcomeOnlyEntry(site, mode, agg, date) {
  return {
    id: `${site.key}-${mode}-${date}`,
    date,
    vendor: site.vendor,
    store: site.store,
    site: host(site.url),
    us: !!site.us,
    lat: "--",
    auto: agg.auto,
    evalq: agg.evalq,
    timed: 0,
    attempted: 0,
    themes: [],
  };
}

async function buildMode({ mode, dates, evals, excluded }) {
  const out = [];
  const vendorsWithReal = new Set(SITES.filter((s) => s.url && !s.candidate).map((s) => s.vendor));
  for (const site of SITES) {
    if (!site.url) continue;
    if (site.vendor === "Gorgias" && site.v3 === false) continue;
    if (site.key === "gorgias-madura" && mode === "shopping") continue;
    let anyMeasured = false;
    for (const date of dates) {
      const agg = await loadAgg({ site, mode, date, evals, excluded });
      if (agg && agg.themes && agg.themes.length) {
        out.push(measuredEntry(site, mode, agg, date));
        anyMeasured = true;
      } else if (agg && agg.auto && agg.auto.engaged) {
        out.push(outcomeOnlyEntry(site, mode, agg, date));
        anyMeasured = true;
      }
    }
    // Pending rows do not affect D_OBJ, so they are deliberately omitted here.
    if (!anyMeasured && site.candidate && !vendorsWithReal.has(site.vendor)) {
      // Keep this branch explicit to document parity with gen.js candidate handling.
    }
  }
  return out;
}

function latNum(entry) {
  const m = String(entry.lat || "").match(/[\d.]+/);
  return m ? Number(m[0]) : null;
}

function laneScores(entries, cutoff) {
  const byV = {};
  entries.filter((s) => !s.date || s.date >= cutoff).forEach((s) => {
    (byV[s.vendor] = byV[s.vendor] || []).push(s);
  });
  const out = {};
  for (const [vendor, es] of Object.entries(byV)) {
    const ag = es.reduce((a, s) => {
      if (s.auto) {
        a.a += s.auto.automated;
        a.e += s.auto.engaged;
      }
      return a;
    }, { a: 0, e: 0 });
    const qN = es.map((s) => s.evalq && s.evalq.total).filter((x) => x != null);
    const lN = es.map(latNum).filter((x) => x != null);
    const convN = es.reduce((n, s) => n + ((s.themes && s.themes.length) || 0), 0);
    if (!qN.length || convN < MIN_RANK_CONVS) continue;
    const turnLats = es.flatMap((s) => (s.themes || [])
      .flatMap((t) => (t.turns || []).filter((x) => x.by === "ai" && x.lat != null).map((x) => x.lat)));
    out[vendor] = {
      a: ag.e ? Math.round((100 * ag.a) / ag.e) : null,
      q: Math.round(qN.reduce((x, y) => x + y, 0) / qN.length),
      l: lN.length ? round1(lN.reduce((x, y) => x + y, 0) / lN.length) : null,
      l75: turnLats.length ? round1(percentile(turnLats, 75)) : null,
      n: convN,
    };
  }
  return out;
}

async function compute({ dates, latest, windowDays, evals, excluded }) {
  const cutoff = cutoffFor(latest, windowDays);
  const shopping = await buildMode({ mode: "shopping", dates, evals, excluded });
  const support = await buildMode({ mode: "support", dates, evals, excluded });
  const shopS = laneScores(shopping, cutoff);
  const supS = laneScores(support, cutoff);
  const allEntries = [...shopping, ...support];
  const D = {};
  for (const vendor of new Set([...Object.keys(shopS), ...Object.keys(supS)])) {
    const us = allEntries.find((s) => s.vendor === vendor && s.us) ? 1 : 0;
    D[vendor] = {
      ...(us ? { us: 1 } : {}),
      col: PALETTE[vendor] || "#888",
      s: shopS[vendor] || null,
      p: supS[vendor] || null,
    };
  }
  return {
    dates,
    latest,
    cutoff,
    entries: { shopping: shopping.length, support: support.length },
    D,
  };
}

function rowList(D) {
  return Object.entries(D).map(([vendor, d]) => {
    const cs = composite(d.s);
    const cp = composite(d.p);
    const comps = [cs, cp].filter((x) => x != null);
    return {
      vendor,
      shopping: cs,
      support: cp,
      overall: comps.length ? Math.round(comps.reduce((a, b) => a + b, 0) / comps.length) : null,
      s: d.s,
      p: d.p,
    };
  }).sort((a, b) => ((b.shopping || 0) + (b.support || 0)) - ((a.shopping || 0) + (a.support || 0)));
}

function fmt(v, suffix = "") {
  return v == null ? "-" : `${v}${suffix}`;
}

function pad(s, n, align = "left") {
  s = String(s);
  if (s.length >= n) return s;
  const fill = " ".repeat(n - s.length);
  return align === "right" ? fill + s : s + fill;
}

function renderTable(title, D) {
  const rows = rowList(D);
  console.log(`\n${title}`);
  console.log(`${pad("#", 3)} ${pad("Vendor", 16)} ${pad("Overall", 7, "right")} ${pad("Shop", 5, "right")} ${pad("Support", 7, "right")}  ${pad("Shop a/q/l/n", 18)} ${pad("Support a/q/l/n", 18)}`);
  rows.forEach((r, i) => {
    const ss = r.s ? `${fmt(r.s.a)}/${fmt(r.s.q)}/${fmt(r.s.l, "s")}/${fmt(r.s.n)}` : "-";
    const ps = r.p ? `${fmt(r.p.a)}/${fmt(r.p.q)}/${fmt(r.p.l, "s")}/${fmt(r.p.n)}` : "-";
    console.log(`${pad(i + 1, 3, "right")} ${pad(r.vendor, 16)} ${pad(fmt(r.overall), 7, "right")} ${pad(fmt(r.shopping), 5, "right")} ${pad(fmt(r.support), 7, "right")}  ${pad(ss, 18)} ${pad(ps, 18)}`);
  });
}

function laneDelta(before, after, laneKey) {
  const b = before && before[laneKey] ? before[laneKey] : null;
  const a = after && after[laneKey] ? after[laneKey] : null;
  const keys = ["a", "q", "l", "l75", "n"];
  const out = {};
  for (const k of keys) {
    const bv = b && b[k] != null ? b[k] : null;
    const av = a && a[k] != null ? a[k] : null;
    if (JSON.stringify(bv) !== JSON.stringify(av)) out[k] = { before: bv, after: av, delta: bv != null && av != null ? round1(av - bv) : null };
  }
  const bc = composite(b);
  const ac = composite(a);
  if (JSON.stringify(bc) !== JSON.stringify(ac)) out.comp = { before: bc, after: ac, delta: bc != null && ac != null ? ac - bc : null };
  return Object.keys(out).length ? out : null;
}

function diffScoreboards(before, after) {
  const vendors = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes = [];
  for (const vendor of [...vendors].sort()) {
    const s = laneDelta(before[vendor], after[vendor], "s");
    const p = laneDelta(before[vendor], after[vendor], "p");
    if (s || p) changes.push({ vendor, ...(s ? { shopping: s } : {}), ...(p ? { support: p } : {}) });
  }
  return changes;
}

function renderDiff(title, changes) {
  console.log(`\n${title}`);
  if (!changes.length) {
    console.log("  No metric changes.");
    return;
  }
  for (const c of changes) {
    console.log(`  ${c.vendor}`);
    for (const lane of ["shopping", "support"]) {
      if (!c[lane]) continue;
      const parts = Object.entries(c[lane]).map(([k, v]) => `${k}: ${fmt(v.before)} -> ${fmt(v.after)}${v.delta != null ? ` (${v.delta >= 0 ? "+" : ""}${v.delta})` : ""}`);
      console.log(`    ${lane}: ${parts.join("; ")}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fileExcludes = await loadExcludedFiles(args.excludeFiles);
  const builtInExcludes = args.includeQuarantined ? [] : [...QUARANTINE_IDS];
  const manualExcludes = [...args.excludes, ...fileExcludes];
  const excluded = new Set([...builtInExcludes, ...manualExcludes]);
  const dates = args.date ? [args.date] : await allDates();
  if (!dates.length) throw new Error("No results/<date>/conv directories found");
  const latest = dates[dates.length - 1];
  const evals = await readJson(SCORES, {});

  const active = await compute({ dates, latest, windowDays: args.windowDays, evals, excluded });
  const unquarantined = builtInExcludes.length
    ? await compute({ dates, latest, windowDays: args.windowDays, evals, excluded: new Set(manualExcludes) })
    : null;
  const baked = args.baked ? await readBakedScoreboard().catch(() => null) : null;

  console.log("Scoreboard dry-run recompute");
  console.log(`Runs: ${dates.join(", ")}`);
  console.log(`Trailing window: ${args.windowDays} days (${active.cutoff} -> ${active.latest})`);
  console.log(`Built-in quarantine: ${builtInExcludes.length ? builtInExcludes.join(", ") : "disabled"}`);
  console.log(`Conversation quarantine: ${excluded.size ? [...excluded].join(", ") : "none"}`);
  console.log("No files were modified.");

  if (baked) {
    renderDiff("Baked takeaways.html vs active source recompute", diffScoreboards(baked, active.D));
  }
  if (unquarantined) {
    renderDiff("Built-in quarantine delta vs unquarantined source", diffScoreboards(unquarantined.D, active.D));
  }
  renderTable("Active source recompute", active.D);

  const payload = {
    generated_at: new Date().toISOString(),
    dates,
    latest,
    window_days: args.windowDays,
    cutoff: active.cutoff,
    excluded: [...excluded],
    baked,
    active,
    unquarantined,
    baked_vs_active: baked ? diffScoreboards(baked, active.D) : null,
    quarantine_vs_unquarantined: unquarantined ? diffScoreboards(unquarantined.D, active.D) : null,
  };
  if (args.json) {
    await mkdir(path.dirname(args.json), { recursive: true });
    await writeFile(args.json, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${args.json}`);
  }
}

main().catch((err) => {
  console.error(`scoreboard-preview failed: ${err.message}`);
  process.exit(1);
});
