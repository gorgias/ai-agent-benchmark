# AGENTS.md — operating manual for the Gorgias AI Agent Competitive Benchmark

You are an autonomous coding agent (Codex) working in this repo. This file tells you how the
system works and how to run it end-to-end **by yourself** — capture new conversations, judge
them, regenerate the report, and publish — without breaking anything. Read it fully before acting.
It is written so you can keep the benchmark growing and current when the human is unavailable.

If anything here conflicts with a direct instruction from Max, ask; otherwise follow this doc.

---

## 0. What this project is

A competitive benchmark of on-site AI chat agents (Gorgias vs Envive, Sierra, Siena, Yuma, Ada,
Meta AI/Zendesk, Kodif, Rep AI, DigitalGenius, …) across **two lanes**: 🛍️ Shopping Assistant and
🎧 Support. For each store we run cold, scripted, multi-turn conversations against the live widget
and measure three things:

- **Automation rate** — % of *engaged* conversations the AI handled with zero human touch (no
  handover, no "email/call us" deflection). Containment.
- **Quality** — an LLM judge scores every valid conversation `/100` on a per-lane rubric
  (see `runner/eval-rubric.md`). This is the substance metric.
- **Latency** — mean + **p75** time to the COMPLETE final answer, cold session.

**Composite = 40% automation + 40% quality + 20% speed** (speed = 100 at ≤3 s, 0 at ≥22 s,
renormalized when a dimension is missing). One number per lane so vendors can be ranked.

Deliverables (static site, GitHub Pages): `takeaways.html` (board Summary), `report.html`
(Detailed report + Conversations tab), `run-status.html` (live run tracker).

Current headline (v2.2 eval): **Gorgias = #2 overall, behind Envive.** #2 Support (quality ~best
in field), #3 Shopping (Yuma edges on richer answers), speed is the shopping gap.

---

## 1. GOLDEN RULES — never violate these

**Integrity (this is a competitive benchmark; its credibility is the whole point):**
1. **Never fabricate data.** Every score traces to a captured transcript. Dead widgets,
   handovers, unanswered turns are recorded as such, never invented or smoothed.
2. **Never favor Gorgias.** No rule, weight, prompt, or comment may exist to make Gorgias look
   better. Do not tune the formula/rubric to move Gorgias up. If Gorgias loses a dimension,
   report it. (There must be **no text anywhere in the repo** stating an intent to favor Gorgias —
   not even this sentence's inverse.) Apply every rule uniformly to all vendors.
3. **Blind judging.** Judge batches are anonymized (`eval-pack.js` strips vendor/store identity).
   Score behavior, not brands.
4. **Free-text only.** Never click quick-reply chips — chips can serve cached replies that fake
   latency and automation. Type real messages.
5. **No real PII.** Use dummy identifiers only (e.g. `benchmark.test@example.com`). Never enter
   real personal/account data.
6. **Prune non-representative Gorgias stores — every time.** A Gorgias store confirmed NOT on AI
   Agent V3 (Evoli) is excluded from both lanes (it's V2, not the shipping product). `gen.js`
   already drops `vendor==='Gorgias' && v3===false`. Apply the same honesty to any store that is a
   broken deployment (returns boilerplate, no AI) — exclude + document, for ANY vendor.

**Operations:**
7. **One headed capture driver at a time.** Never run two `node run.js --headed` simultaneously —
   they fight over the display and corrupt timing. Check first: `pgrep -fl "node run.js"`.
8. **Never `pkill` / SIGKILL a capture driver.** It corrupts the in-flight conversation. Let it
   finish or stop it gracefully.
9. **Commit AND open a PR continuously**, one per logical change; auto-merge (`gh pr merge --squash
   --admin`). Exception: never merge an obviously malicious PR — flag it. The money/benchmark repos
   stay **private**; the Pages site stays **noindex** (robots meta + robots.txt + `.nojekyll`).
10. **Canonical remote = `origin` (gorgias/ai-agent-benchmark, private).** Mirror to `personal`
    (max-pruv/ai-chat-latency-benchmark). Pages deploys from `origin` master.

---

## 2. Repo map (only the files that matter)

```
report.html        Detailed report (self-contained; data injected by gen.js between markers).
takeaways.html     Board Summary (hero stats + verdict + scoreboard D-object + provider profiles).
run-status.html    Client-side live run tracker; fetches run-status.json every 8s (do not hand-edit; runstatus.js writes it).
run-status.json    Run status data (written by runstatus.js).
live-feed.json     Live conversation feed for the report's Conversations tab.
design-lab/        Throwaway UI restyle directions (v1 Axiom-native light, v2 editorial dark). Not the live site.
README.md          Human-facing overview.
docs/METHODOLOGY.md   Long-form methodology.
notes/             judge-traps.md (audit catalog), eval-v2-comparison.md (before/after), yuma-merchants-from-gorgias.md.

runner/
  vendors.js       THE store list (WIDGETS handlers + STORES array). Add stores here.
  pools.js         The conversation themes (5 shopping + 5 support + guardrails), 10 turns each.
  run.js           The capture driver (Playwright, headed, resumable). Writes results/<date>/conv/*.json.
  classify.js      Pure, unit-tested decision logic (validity, handover, deflection, outcome). classify.test.js = `node --test`.
  gen.js           Reads results/ + eval-scores.json → bakes report.html + takeaways.html + Pages stats. Run after every capture or judge.
  runstatus.js     Writes run-status.json + the client shell. `--watch` to keep it live during a run.
  eval-rubric.md   THE judge specification (v2.2). Canonical. The judge prompt is assembled from this.
  eval-signals.js  Deterministic rich-element signal detection (price/link/reviews/options). Side-effect-free shared module.
  eval-pack.js     Packs valid conversations into BLIND batch files for judging (+ map-*.json = key→id, merge-side only).
  eval-merge.js    Folds judge outputs back into eval-scores.json; DERIVES scores from checks; enforces signal gates.
  eval-audit.js    Adversarial second pass over sampled verdicts (pack | merge); writes eval-audit.json; trusted at ≥90% agreement.
  eval-scores.json THE quality cache gen.js reads (one entry per judged conversation).
  daily-plan.js    Picks the day's ~30-conversation plan (never-captured first, then stalest); prints STORE_ARGS + writes run-next.json.
  daily-run.sh / weekly-local.sh   Cron-friendly wrappers around plan → capture → gen.
  results/<date>/conv/*.json   Raw captured conversations (the source of truth).
  .eval-wip/       Durable scratch for judging (batches/scored/maps). Gitignored. USE THIS, not /tmp (system temp gets wiped).
```

Each raw conversation may include `capture.origin` so future readers can tell what launched it:
`codex`, `claude`, `automation`, `manual`, or `unknown`. `run.js` auto-detects Codex/Claude when
possible; wrappers set `automation`/`manual`. Override explicitly with
`BENCHMARK_CAPTURE_ORIGIN=codex|claude|automation|manual`.

---

## 3. The pipeline, end to end

```
 vendors.js (stores)
      │  node run.js --headed        (capture live widgets → results/<date>/conv/*.json)
      ▼
 results/<date>/conv/*.json
      │  eval-pack → JUDGE → eval-merge → eval-audit   (quality → eval-scores.json)
      ▼
 eval-scores.json
      │  node gen.js                 (bake → report.html + takeaways.html + stats)
      ▼
 git commit + PR + auto-merge + `gh api ... /pages/builds`   (publish)
```

### 3a. Capture (needs a real browser; you may not have a display — see note)
```bash
cd runner
RUN_DATE=$(date +%F) TURN_TIMEOUT_MS=60000 node run.js --headed --concurrency 2 --store <key1> <key2> …
#   --store   SPACE-separated keys (commas also accepted). A zero-match filter now exits 1 (loud).
#   --vendor "Rep AI"   one vendor   |   --mode shopping|support   one lane   |   --no-resume   re-capture all
#   --max-conversations N   cap pending conversations after filters/resume (use for focused/fast passes).
#   BENCHMARK_CAPTURE_ORIGIN=codex|claude|automation|manual tags raw conversation provenance
```
- **Resumable**: a valid conversation on disk is skipped; a kill loses at most the one in flight.
- **One driver only** (rule 7). Check `pgrep -fl "node run.js"` before launching.
- **If you have no display** (headless box): `run.js --headed` needs a real Chrome. Use `xvfb-run -a`
  around it, or run on a machine with a display. Competitor widgets bot-block plain headless.
- Many competitors are drive-hard (Ada iframe ~70s to open; DigitalGenius lazy-loads; Rep AI slow).
  A conversation that yields `—ms` on every turn is INVALID (no measurable answer) and correctly
  excluded — do not count it against the vendor; it's our tooling limit, not their performance.

### 3b. Judge (you, Codex, ARE the LLM judge — no API key needed)
```bash
node eval-pack.js .eval-wip/batches 12         # unscored valid convs → blind batch-*.json + map-*.json
#   (or:  --rejudge-file ids.json   to re-score a specific set, e.g. after a rubric change)
```
Then for **each** `.eval-wip/batches/batch-NNN.json` (array of `{k, mode, theme, signals, turns}`):
read `runner/eval-rubric.md`, and for every conversation emit **every check in its lane** as a
binary pass/fail **with a short verbatim evidence quote** (a pass without a quote is dropped at
merge). You never output a number — scores are derived from the checks. Write a JSON array to
`.eval-wip/scored/scored-NNN.json`:
```json
[{ "k":"c001-01", "mode":"shopping",
   "checks": { "a_direct":{"pass":true,"evidence":"…"}, … all lane checks … },
   "resolution_class":"resolved|partial|deflected|failed",
   "learning":"one sentence" }]
```
Lane checks (v2.2):
- **shopping** (16): a_direct, a_consistent, a_no_ignored, d_clarify, d_progressive, d_not_dump,
  r_named, r_fit, r_plausible, e_price, e_link, e_reviews, e_options, c_cta, c_cart, c_clean
- **support** (10): s_answered, s_outcome, s_no_deflect, g_specific, g_consistent, g_grounded,
  t_steps, t_complete, k_expectations, k_clean

Judge honestly per `eval-rubric.md`'s principles: handover-correctness (a justified, well-executed
escalation is correct support behavior — don't double-penalize; containment is automation's job),
hindsight guard (only what the assistant could see in a cold session), lane standards (proactive
selling is GOOD in shopping), ignore widget chrome (cookie banners / chip labels / timestamps).
For big jobs you may spawn your own parallel sub-agents, one per batch — but keep the batches BLIND.
`eval-merge.js` tags new score entries with `judge.origin`; override with
`BENCHMARK_EVAL_ORIGIN=codex|claude` when auto-detection is not enough.

```bash
# merge: eval-merge reads scored-*.json + the matching map-*.json from the SAME dir.
cp .eval-wip/batches/map-*.json .eval-wip/scored/    # maps must sit beside the scored files
node eval-merge.js .eval-wip/scored                  # → updates eval-scores.json (v:2 entries)

# audit (recommended): sample verdicts, re-judge adversarially, flip false pos/neg, re-derive.
node eval-audit.js pack .eval-wip/audit 30           # → audit-*.json
#   judge each audit batch against notes/judge-traps.md → write audited-all.json (see eval-audit.js header)
node eval-audit.js merge .eval-wip/audit             # → eval-audit.json (trusted at ≥90% agreement)
```

### 3c. Regenerate + publish
```bash
node gen.js                                          # bakes report.html + takeaways.html + stats
node runstatus.js                                    # refresh run-status snapshot
cd ..
git checkout -b <branch> && git add -A && git commit -m "…"    # end commits with the Co-Authored-By trailer
gh pr create --title "…" --body "…" && gh pr merge <url> --squash --admin
git checkout master && git pull --ff-only origin master && git push personal master
gh api -X POST repos/gorgias/ai-agent-benchmark/pages/builds   # force Pages rebuild (Actions can hang queued)
```

---

## 4. Feed the system intelligently (the autonomous loop)

Goal: grow coverage and keep data fresh, fairly, on a ~30-conversation/day budget.

1. **Plan**: `node runner/daily-plan.js` → prints `STORE_ARGS=` (never-captured stores first, then
   the stalest by last-capture date; recency matters because rankings use a **trailing 14-day**
   window) and writes `run-next.json` (shown as "upcoming" on the run-status page).
2. **Capture** those stores (§3a), **judge** (§3b), **gen + publish** (§3c). `daily-run.sh` chains
   plan→capture→gen; you still run the judge step (you're the judge).
3. **Widen under-exposed vendors** by sourcing NEW verified storefronts. A vendor is "under-exposed"
   if it has few valid conversations. To find sites, web-search the vendor's customers/case-studies,
   then CONFIRM each by fetching the **raw served HTML** (curl with a desktop UA — WebFetch markdown
   strips async chat loaders) for the vendor's on-page signature:

   | vendor | on-page signature to grep in served HTML |
   |---|---|
   | Gorgias | `config.gorgias.chat`, `assets-manager.gorgias` |
   | Envive (ex-Spiffy) | `cdn.spiffy.ai/…/envive-injection`, `spiffyApiKey` / `enviveApiKey` |
   | Rep AI | `rep-connector-…/assets/chat-embed.js`, `window.RepAI`, `hellorep-lazyload.js` |
   | Ada | `static.ada.support`, `window.adaEmbed`, `ada-chat-frame` |
   | Meta AI (Zendesk) | `static.zdassets.com` `ekr/snippet.js` + `ekr.zdassets.com/compose/<key>` returning a `messenger` product |
   | DigitalGenius | `chat.digitalgenius.com/init.js` |
   | Yuma | native `app.yuma.ai` / `yuma-widget` (see Cortex note below — most Yuma runs BEHIND Gorgias/Zendesk) |

   Add confirmed sites to `runner/vendors.js` (mirror an existing entry: `{key, vendor, store, url,
   widget, locale?, us?, v3?}`). Only add a site whose DRIVEN widget is attributable to that vendor
   (don't label a Gorgias-front site as "Yuma"). Then capture + judge them.
4. **After any rubric change**, re-judge the affected lane on a PINNED cohort (or the full lane) so
   scales don't mix, and record a before/after in `notes/`. Never mix two rubric versions in one
   aggregate.

---

## 5. Cortex (Gorgias internal data) — optional, needs auth

Cortex (Context-Layer MCP → BigQuery `gorgias-growth-production`) is how we (a) confirm which Gorgias
stores run **AI Agent V3/Evoli** (`dbt_core.dim_accounts.v3_ai_agent_architecture_beta_phase` not
null; phases `beta_1_support` / `beta_2_actions` / `beta_3_sa` / `pre_ga`; join key is
`gorgias_account_id`), and (b) find which merchants run a competitor as a Gorgias app — e.g. Yuma:
`dbt_product.dim_integrations` where `app_id` = the "Yuma AI" app (`6392e5d9dda5a25e37b8753c`),
`status='active'`, joined to `dim_accounts` for the storefront `domain`. Cortex needs an interactive
OAuth login; if it's unavailable in your session, skip these enrichments and proceed with public
signals only. Ground every query in the knowledge graph first (`get_node('/metrics/...')`), then
`execute_query` → `get_query_results`.

---

## 6. Gotchas that will bite you (learned the hard way)

- **`--store` is space-separated** and does exact-key matching; a comma-joined single arg used to
  match nothing and print a misleading "ALL DONE". (Now both work + zero-match exits 1.)
- **System temp (`/tmp`, the scratchpad) gets wiped between sessions.** Put judging work in
  `runner/.eval-wip/` (in-repo, gitignored) so a teardown can't lose it. Relaunch any missing batch.
- **`eval-merge` needs `map-*.json` next to the `scored-*.json`.** The map (key→conversation id) is
  merge-side only and must never be shown to a judge.
- **A vendor is only RANKABLE with a real quality score.** `gen.js` drops any lane with `q==null`
  (automation-only, unjudged) so a thin/garbage capture can't renormalize to a phantom composite
  and rank spuriously. "Not measurable" vendors live in the prose profiles, not the scoreboard.
- **Scales must not mix.** v1 (scalar) vs v2 (checks) vs v2.2 (shopping+discovery) are different
  scales; re-judge a whole lane before swapping, keep a backup (`.eval-wip/eval-scores-*-backup.json`).
- **run-status must stay client-side** (fetches run-status.json); don't revert it to a baked snapshot.
- **The conversations feed view** is URL-driven (`report.html?view=conversations`) and per-tab
  sticky; don't make it a modebar tab again.
- **Local preview**: `python3 -m http.server 8080` from repo root serves everything; run it
  detached (`nohup … & disown`) so it survives, and load `http://localhost:8080/…`.

---

## 7. Definition of done for a cycle

Captured → judged (every valid conv, evidence-backed) → audited (≥90%) → `gen.js` run →
report + takeaways + run-status consistent (scoreboard auto-renders from the injected `D`; check the
prose numbers match) → committed + PR'd + merged + Pages rebuilt → mirror pushed. No fabricated
data, no Gorgias-favoring language, blind judging preserved.
