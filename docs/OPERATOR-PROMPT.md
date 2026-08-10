# Operator prompt — add conversations end to end

Paste the block below into a **Claude Code** session to run the full pipeline on your own
machine: capture new conversations → blind-judge → merge scores → bake → quality gate →
deploy. Set the budget in the first line (the reference mission is ~300 valid convs).

Requirements: push access to `gorgias/ai-agent-benchmark`, `gh` authenticated, Node 20+.
No secrets needed (Amazon Rufus is optional and self-contained — see below).

---

```
You are operating the Gorgias AI-agent competitive benchmark (repo: gorgias/ai-agent-benchmark,
deployed at https://gorgias-ai-benchmark.vercel.app/report — password-gated). Your mission, end to end:
ADD ~300 NEW VALID CONVERSATIONS, get them blind-judged, merge the scores, rebake the report,
pass the quality gate, and deploy. Everything you need is documented in docs/RUNBOOK.md — read
it first and follow it over anything you'd improvise.

## Setup
1. git clone https://github.com/gorgias/ai-agent-benchmark && cd ai-agent-benchmark/runner
2. npm install && npx playwright install chromium
3. export RUN_DATE=$(date +%F); export BENCHMARK_CAPTURE_ORIGIN=<your-github-handle>

## Goal & allocation (cross-vendor parity)
The dataset must stay BALANCED across vendors. Before capturing, compute current per-vendor
VALID conversation counts (a conv JSON with valid !== false) across ALL results/<date>/conv/
dirs, then spend the budget water-filling the LOWEST vendors first. Use the tracked
balancer — it does exactly this:
  INCLUDE="<comma-separated vendors>" TARGET=<parity line> BUDGET=<n> STORE_TIMEOUT_MIN=8 \
  LOAD_CAP=9 RUN_DATE=$RUN_DATE node tools/balance.mjs        # add --dry first to preview
- Achievable vendors (capture unattended, feed these): Envive, Yuma, Siena, Gorgias, Ada,
  Kodif, Sierra, Meta AI, DigitalGenius (low yield ~0.8 valid/store — cap your patience).
- WALLS — do NOT burn budget on: Humind, Shopify Inbox, Google Agentic (0 valid ever),
  and treat Klaviyo/Decagon/Rep AI as low-yield probes (≤1 store attempt each, then move on).
- Amazon Rufus is a special headed+logged-in stream (secrets/rufus-capture.mjs) — skip it
  unless you specifically need it; it requires regenerating secrets/amazon-state.json via
  secrets/amazon-login.mjs (credentials in .amazon-creds — dummy account, committed).

## Capture safety rules (non-negotiable — they protect the MEASUREMENT)
- Max 3 parallel streams (≈6 headless pages) on a laptop; give each stream a DISJOINT
  INCLUDE list. run.js has cross-process conversation locks, so overlap is safe but wasteful.
- Keep LOAD_CAP=9: capture pauses while system load is high — latency IS the benchmark;
  an overloaded machine inflates the numbers you're measuring.
- Launch detached so runs survive your session: nohup caffeinate -dimsu node tools/balance.mjs
  ... & disown  — and RECORD EVERY PID (echo $! >> /tmp/run.pids).
- Teardown by PID ONLY (kill -9 $(cat /tmp/run.pids); then reap chrome-headless-shell and
  verify zero: ps aux | grep -cE '[r]un.js --store|[c]hrome-headless-shell' → 0).
  Never broad-pkill: it leaves zombie chromium that corrupts load → latencies.
- NEVER move, rename, or archive ANYTHING in results/<date>/conv/ — valid AND invalid
  captures stay in place forever. gen.js filters invalids. No latency-outlier pruning either.

## Judge (blind LLM eval) — after capture (or in waves as convs land)
1. node eval-pack.js /tmp/evalbatch 12       # packs UNSCORED valid convs into blind batches
2. For EACH batch-NNN.json, spawn a fresh general-purpose subagent with EXACTLY this task:
   ---
   Blind LLM judge for an AI-chat-quality benchmark. Follow the rubric EXACTLY, write a JSON ARRAY.
   1. Read rubric: <repo>/runner/eval-rubric.md (v2.3 — per-lane binary checks with verbatim
      evidence, resolution_class, exact scored schema).
   2. Read batch: /tmp/evalbatch/batch-NNN.json (blinded convs, ids like cNNN-01; score from
      text only, never guess the vendor).
   3. Score EVERY conversation: one entry per conv with `k` (blind id), `mode`, per-dimension
      `checks` {pass, evidence-verbatim}, `resolution_class`, one-sentence `learning`.
   4. Write a JSON ARRAY of entries (NOT an object keyed by id) to /tmp/evalbatch/scored-NNN.json —
      each element carries its own `k`. This exact array shape is required by eval-merge.js.
   Rules: score ALL convs; evidence quotes verbatim; every dimension score = the sum of its
   binary checks. Final message: one line — count, mean, min/max.
   ---
   Run several judges in parallel (one per batch). If a judge dies with your session, respawn
   it — scored-*.json files are the durable output; missing ones just get re-run.
3. node eval-merge.js /tmp/evalbatch         # scored arrays → eval-scores.json (loud on rejects)

## Bake → Verify → Deploy
1. node gen.js                                # rebake report.html + takeaways.html
2. node verify-data.js                        # QUALITY GATE — must print PASSED; if it fails, FIX
                                              # the pipeline (usually: unjudged convs → rerun step 2)
3. node --test ./*.test.js                    # 52+ tests must pass
4. From repo root: branch off origin/master, commit report.html, conv-text.json, takeaways.html,
   runner/eval-scores.json, runner/results/<date>/conv (git add the conv DIR — new + modified),
   push, open a PR with a body stating: convs added per vendor, new dataset totals
   (takeaways sync line prints them), judge batch means. Squash-merge it yourself
   (repo policy: PRs are merged immediately, no review wait), then force the Pages build:
     vercel deploy --prod --yes     # Vercel, not Pages; then verify with server/verify-live.mjs
   and verify live (~15 s): curl the deployed takeaways.html and grep the new conv total.

## Cadence & reporting
Work in waves: capture ~50-100 → judge → merge → bake → verify → deploy, then repeat until
the budget of new VALID convs is merged. Deploying intermediate waves is encouraged (the
report only ever improves). At the end, report: per-vendor before/after counts, total valid
added, invalid rate per vendor (walls confirmed), judge means per batch, and the live URL.

## Known traps (they will bite you otherwise)
- A store capturing "—ms" on every turn: see the troubleshooting table in docs/RUNBOOK.md
  (email gates, persona false-handovers, auto-greetings, container resets, machine load).
- Deflector vendors (Klaviyo/Meta) produce valid=false convs that COUNT AS ZERO — the
  balancer's strike system handles this; don't fight it manually.
- eval-merge only accepts ARRAYS of entries carrying `k` — an object keyed by id is
  silently worth zero ("SKIP: not an array").
- GitHub Actions is org-disabled on this repo: CI won't run for you; the local gate + tests
  (steps 2-3 above) are mandatory, and Pages builds must be forced via the API.
```

---

Notes for operators on a new machine:

- **Latency comparability across machines**: measurements are dominated by the vendor
  widget's network/model wait, so results are comparable as long as you respect the
  3-stream / LOAD_CAP rules. If your vendor baselines diverge >20 % from the live report,
  flag it before merging.
- The vendor counts in the prompt's allocation section go stale — always recompute from
  `results/` at the start of your run; the balancer does it for you.
