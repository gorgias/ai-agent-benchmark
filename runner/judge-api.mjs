#!/usr/bin/env node
// runner/judge-api.mjs — the LLM judge, running against the Anthropic API instead of harness subagents.
//
// This is the piece that lets the loop close without a laptop. Everything else in the pipeline was
// already automatable; judging was the one step that needed a model, and until now that model was a
// Claude Code subagent — which means a human session. This script does the same job over the API.
//
//   node judge-api.mjs <batchDir>        # judges every batch-*.json → scored-*.json
//   node judge-api.mjs <batchDir> --dry  # print the prompt + cost estimate, call nothing
//
// It is a DROP-IN for the subagent judges: it reads the same blind batches from eval-pack.js and
// writes the same scored-NNN.json shape that eval-merge.js consumes. The rubric is not duplicated
// here — it is read from runner/eval-rubric.md, so the spec stays versioned in one place and every
// score remains traceable to the exact rubric text that produced it.
//
// THREE PROPERTIES WORTH KEEPING WHEN YOU EDIT THIS FILE:
//
//  1. BLIND. The batch files are already anonymized by eval-pack.js (opaque key, vendor/store names
//     masked). Nothing here re-introduces identity, so the API judge is blind by construction — the
//     same fairness property the subagent judges had. Never pass the map-*.json files to a judge.
//  2. ONE CONVERSATION PER CALL. Not for cost — for correctness. A batch-sized call invites the
//     model to score relative to its neighbours in the batch, and a truncated response loses every
//     conversation in it rather than one.
//  3. EVIDENCE IS VERIFIED IN CODE. The rubric says a passing check must cite a verbatim quote. A
//     judge that asserts a quote which is not in the transcript has hallucinated the credit, so
//     every passing check's evidence is checked against the transcript here and demoted to
//     pass:false if it is not actually there. This is the guard that makes an unattended judge
//     trustworthy: without it, "no quote → no credit" is enforced only against empty strings
//     (eval-merge's check), not against invented ones.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const HERE = path.resolve(new URL(".", import.meta.url).pathname);
const RUBRIC = fs.readFileSync(path.join(HERE, "eval-rubric.md"), "utf8");
const dir = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!dir) { console.error("usage: node judge-api.mjs <batchDir> [--dry]"); process.exit(1); }

const MODEL = process.env.JUDGE_MODEL || "claude-opus-4-8";
const EFFORT = process.env.JUDGE_EFFORT || "high";
const CONC = Number(process.env.JUDGE_CONCURRENCY || 4);
const MAX_CONVS = Number(process.env.JUDGE_MAX || 0);         // 0 = no cap (cost ceiling for a night)

// ── the check sets, mirrored from runner/eval-score.js ────────────────────────────
// Duplicated deliberately: this file must state the exact keys it demands from the model, and a
// silent drift against eval-score.js surfaces immediately as "incomplete checks" at merge rather
// than as a quietly mis-scored board.
const CHECKS = {
  shopping: ["a_direct", "a_consistent", "a_no_ignored", "d_clarify", "d_progressive", "d_not_dump",
             "r_named", "r_fit", "r_plausible", "e_price", "e_link", "e_reviews", "e_options",
             "c_cta", "c_cart", "c_clean"],
  support: ["s_answered", "s_outcome", "s_no_deflect", "g_specific", "g_consistent", "g_grounded",
            "t_steps", "t_complete", "k_expectations", "k_clean"],
};

const schemaFor = (mode) => ({
  type: "object",
  properties: {
    checks: {
      type: "object",
      properties: Object.fromEntries(CHECKS[mode].map((c) => [c, {
        type: "object",
        properties: {
          pass: { type: "boolean" },
          evidence: { type: "string", description: "Short VERBATIM quote from the transcript. Required when pass is true — it is verified against the transcript in code and the check is failed if the quote is not found." },
        },
        required: ["pass", "evidence"],
        additionalProperties: false,
      }])),
      required: CHECKS[mode],
      additionalProperties: false,
    },
    resolution_class: { type: "string", enum: ["resolved", "partial", "deflected", "failed"] },
    learning: { type: "string", description: "One concise sentence: the standout strength or gap." },
  },
  required: ["checks", "resolution_class", "learning"],
  additionalProperties: false,
});

const INSTRUCTIONS = `You are a blind quality judge for an e-commerce AI-agent benchmark.

You will receive ONE conversation between a shopper and a store's AI chat agent. Score it against
the rubric above, for the lane given in the conversation's \`mode\` field.

Rules that matter most:
- You are BLIND on purpose. Vendor and store names are masked ("the store"). Score the behaviour in
  front of you. Never speculate about which product or vendor this is, and never let a guess affect
  a check.
- Every check for the lane must appear in your output.
- A check may only pass if you can cite a SHORT VERBATIM quote from this transcript. The quote is
  verified programmatically against the transcript text; if it is not found character-for-character
  (whitespace and quote-style normalised), the check is recorded as FAILED. So quote exactly, and
  copy from the transcript rather than paraphrasing. Use "..." only to elide a middle section.
- For a failing check, leave evidence as an empty string or a brief reason. Only passes need quotes.
- \`signals\` are deterministic regex measurements of the transcript (price/link/review/option
  presence, and whether the conversation was a channel deflection). They are enforced as caps at
  merge time regardless of what you say, so do not pass a rich-element check whose signal is false.
- Judge only what the assistant could see: a cold session, no account, no order history. Apply the
  hindsight self-check before failing a check.
- A justified, well-executed handover is \`partial\`, not \`failed\`.
- Substance over style. Warmth, enthusiasm and emojis are not substance (rubric v2.3).`;

// ── evidence verification ────────────────────────────────────────────────────────
// Judges legitimately normalise curly quotes, collapse whitespace, and elide with "...". Those are
// faithful quotation, so normalise both sides before comparing rather than demanding byte equality —
// otherwise the guard would strip credit from honest judges and teach us nothing about dishonest
// ones. Everything else (a paraphrase, an invented sentence) fails.
const norm = (s) => String(s || "")
  .replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"')
  .replace(/[–—−]/g, "-").replace(/ | | /g, " ")
  .replace(/\s+/g, " ").trim().toLowerCase();

function evidenceFound(quote, haystack) {
  const q = norm(quote);
  if (q.length < 3) return false;
  const h = norm(haystack);
  if (h.includes(q)) return true;
  // elision: every fragment long enough to be meaningful must appear, in order
  const parts = q.split(/\s*(?:\.\.\.|…)\s*/).map((p) => p.trim()).filter((p) => p.length >= 8);
  if (parts.length < 2) return false;
  let at = 0;
  for (const p of parts) {
    const i = h.indexOf(p, at);
    if (i < 0) return false;
    at = i + p.length;
  }
  return true;
}

// ── judge one conversation ───────────────────────────────────────────────────────
const client = new Anthropic({ maxRetries: 5, timeout: 10 * 60 * 1000 });
const usageTotals = { in: 0, out: 0, cache_read: 0, cache_write: 0 };

async function judgeOne(conv) {
  const mode = conv.mode === "support" ? "support" : "shopping";
  const transcript = (conv.turns || []).map((t) => `${t.by === "ai" ? "AGENT" : "SHOPPER"}: ${t.by === "ai" ? t.reply : t.q}`).join("\n\n");
  const body = JSON.stringify({ mode, theme: conv.theme, signals: conv.signals, turns: conv.turns }, null, 1);

  // Streaming, not a plain create: adaptive thinking on a 1M-context model can run long enough to
  // trip a request timeout on a non-streaming call, and a nightly job must not fail on that.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: [
      // The rubric is ~2.6k tokens and identical for every conversation in every batch — cache it
      // once and every subsequent call reads it at a tenth of the input price.
      { type: "text", text: RUBRIC, cache_control: { type: "ephemeral" } },
      { type: "text", text: INSTRUCTIONS },
    ],
    messages: [{ role: "user", content: `Score this conversation (lane: ${mode}).\n\n${body}` }],
    output_config: { format: { type: "json_schema", schema: schemaFor(mode) }, effort: EFFORT },
  });
  const msg = await stream.finalMessage();

  const u = msg.usage || {};
  usageTotals.in += u.input_tokens || 0;
  usageTotals.out += u.output_tokens || 0;
  usageTotals.cache_read += u.cache_read_input_tokens || 0;
  usageTotals.cache_write += u.cache_creation_input_tokens || 0;

  if (msg.stop_reason === "max_tokens") throw new Error("response truncated (max_tokens)");
  if (msg.stop_reason === "refusal") throw new Error("model refused");

  let out = msg.parsed_output;
  if (!out) {
    const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    out = JSON.parse(text);           // structured output guarantees valid JSON; no salvage needed
  }

  // enforce "no quote → no credit" against invented quotes, not just empty ones
  let demoted = 0;
  for (const [cid, c] of Object.entries(out.checks || {})) {
    if (c && c.pass && !evidenceFound(c.evidence, transcript)) { c.pass = false; c.evidence = `[unverified quote] ${String(c.evidence || "").slice(0, 100)}`; demoted++; }
  }
  return { entry: { k: conv.k, mode, checks: out.checks, resolution_class: out.resolution_class, learning: out.learning, judged_at: new Date().toISOString() }, demoted };
}

// ── run every batch ──────────────────────────────────────────────────────────────
const batches = fs.readdirSync(dir).filter((f) => /^batch-.*\.json$/.test(f)).sort();
if (!batches.length) { console.log(`no batch-*.json in ${dir} — nothing to judge`); process.exit(0); }

let queued = [];
for (const f of batches) {
  const nn = f.match(/^batch-(.*)\.json$/)[1];
  if (fs.existsSync(path.join(dir, `scored-${nn}.json`))) { console.log(`batch-${nn}: already scored, skipping`); continue; }
  for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) queued.push({ nn, conv: c });
}
if (MAX_CONVS && queued.length > MAX_CONVS) {
  // Whole batches only: a partially-scored batch would be re-judged from scratch next run, so the
  // cap must fall on a batch boundary to stay incremental.
  const keep = new Set();
  for (const q of queued) { if (keep.size >= MAX_CONVS && !keep.has(q.nn)) break; keep.add(q.nn); }
  const before = queued.length;
  queued = queued.filter((q) => keep.has(q.nn));
  console.log(`JUDGE_MAX=${MAX_CONVS}: judging ${queued.length} of ${before} (whole batches only) — the rest stay queued for the next run`);
}
if (!queued.length) { console.log("every batch already has a scored-*.json — nothing to judge"); process.exit(0); }

console.log(`judging ${queued.length} conversations from ${batches.length} batches · model ${MODEL} · concurrency ${CONC}`);
if (DRY) {
  console.log(`\n--- system (rubric ${RUBRIC.length}c, cached) + instructions (${INSTRUCTIONS.length}c) ---`);
  console.log(INSTRUCTIONS.slice(0, 400) + "...");
  console.log(`\nfirst conversation: k=${queued[0].conv.k} mode=${queued[0].conv.mode} turns=${(queued[0].conv.turns || []).length}`);
  console.log(`\n--dry: no API calls made. Estimated ~$${(queued.length * 0.05).toFixed(2)} at ~$0.05/conversation on ${MODEL}.`);
  process.exit(0);
}

const results = {}, failures = [];
let done = 0, demotedTotal = 0;
await Promise.all(Array.from({ length: Math.min(CONC, queued.length) }, async () => {
  for (;;) {
    const item = queued.shift();
    if (!item) return;
    try {
      const { entry, demoted } = await judgeOne(item.conv);
      (results[item.nn] = results[item.nn] || []).push(entry);
      demotedTotal += demoted;
      done++;
      if (done % 10 === 0 || done === 1) console.log(`  ${done} judged…`);
    } catch (e) {
      // One conversation failing must not cost the batch. It stays unjudged, so the next run picks
      // it up again — the pipeline is incremental by design.
      failures.push(`${item.conv.k}: ${e.message}`);
      console.error(`  FAILED ${item.conv.k}: ${e.message}`);
    }
  }
}));

// Write one scored file per batch. Only batches whose every conversation succeeded are written as
// complete; a partial batch is still written (merge is per-entry) but reported, because the missing
// conversations must remain unscored so eval-pack re-queues them.
for (const [nn, arr] of Object.entries(results)) {
  fs.writeFileSync(path.join(dir, `scored-${nn}.json`), JSON.stringify(arr, null, 1));
}

// Per-MTok list rates, input/output — cache write is 1.25x input, cache read is 0.1x input.
const RATES = {
  "claude-opus-4-8": [5, 25], "claude-opus-4-7": [5, 25], "claude-opus-4-6": [5, 25],
  "claude-opus-5": [5, 25], "claude-sonnet-5": [3, 15], "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
};
const [rateIn, rateOut] = RATES[MODEL] || RATES["claude-opus-4-8"];
const cost = (usageTotals.in * rateIn + usageTotals.cache_write * rateIn * 1.25 + usageTotals.cache_read * rateIn * 0.1 + usageTotals.out * rateOut) / 1e6;
console.log(`\nscored ${done} conversations → ${Object.keys(results).length} scored-*.json in ${dir}`);
console.log(`evidence guard: ${demotedTotal} passing checks demoted for an unverifiable quote`);
console.log(`tokens: ${usageTotals.in} in · ${usageTotals.cache_read} cache-read · ${usageTotals.cache_write} cache-write · ${usageTotals.out} out`);
console.log(`estimated cost: $${cost.toFixed(2)} (${done ? `$${(cost / done).toFixed(3)}/conversation` : "-"}) on ${MODEL}`);
if (failures.length) console.log(`${failures.length} conversations failed and stay unjudged: ${failures.slice(0, 5).join(" · ")}`);
process.exit(0);
