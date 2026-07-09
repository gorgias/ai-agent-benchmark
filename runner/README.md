# Cold headless runner — the monthly engine

Drives each store's **live on-site AI assistant** through a standardized ~10-turn
conversation in a **fresh browser context (cold session)** and records, per store:

- **latency** (time to a full reply, per turn), and
- **success rate** = % of turns the AI answered **itself, with no human handover**.

A fresh context per store means **no warm-session carryover** — the thing a single
live Chrome window can't give us (the widget's session lives in cross-origin storage
the page can't reset). Headless also has no background-tab timer throttling, so timing
is reliable at depth.

## Why cold matters

Re-running a store live reuses its warm session (the assistant "remembers" the prior
chat, or a human agent already owns the thread), which contaminates both latency and
the handover signal. CI runs in a fresh container every time → cold by construction.

## What it measures

- **No turn asks for a human** ([`pools.js`](pools.js)). So any handover the assistant
  initiates is **unprompted = a failure** (it couldn't finish the job). The detector
  catches escalations, ticket flows, lead-capture/email gates, and **a human agent
  joining the thread** ("… joined the chat", "X says:", "je transfère … conseiller
  humain", "laissez votre e-mail").
- Two modes: **shopping** (discovery → recommendation) and **support** (shipping /
  returns / policy).

## Stores

2–3 storefronts per vendor (see `STORES` in [`vendors.js`](vendors.js)). Stores marked
`candidate: true` still need their widget verified — the runner attempts them and records
an error if the chat isn't found, rather than guessing. Harness logic is keyed by **widget
type** (`gorgias`, `spiffy`, `sierra`, `siena`, `dg`, `zendesk`, `ada`) so stores on the
same tech share code.

> Gorgias (us) is tested on **Madura** and **Masderm** — **Glamnetic is intentionally excluded.**

## Run it

```bash
npm install
npm run install:browser        # playwright install chromium
node run.js                     # all stores, both modes  → results/<date>/
node run.js --concurrency 6     # run 6 stores at once (default 4)
node run.js --vendor Sierra     # all of one vendor's stores
node run.js --store gorgias-madura
node run.js --mode shopping
node run.js --skip-candidates   # only verified stores
```

**Parallel + always incognito.** Jobs (one per store×mode) run through a concurrency
pool (`--concurrency`, default 4) so the full pass finishes in roughly `total / N` time.
Each job runs in its **own brand-new Playwright context** — zero cookies / localStorage /
IndexedDB / cache for any origin (including the widget's cross-origin storage), so there is
**never a pre-existing conversation**. Latency is network/model-bound, so modest concurrency
doesn't skew the timing; push it higher on a beefy CI runner.

**Multiple run.js instances at once are safe.** Every conversation is claimed via an
O_EXCL lock file (`results/<date>/conv/.locks/<store>-<mode>-<theme>.lock`, owner PID
inside) before capture: a conversation claimed by a live process is skipped, a stale lock
(dead PID) is stolen, and claiming re-checks whether a parallel run already completed the
conversation. This is what lets the equalization balancer (`tools/balance.mjs`), a manual
top-up, and an overnight stream overlap without double-capturing. Operating limits — ≤3
streams on a laptop, `LOAD_CAP` pause, disjoint vendor lists per stream, teardown by PID —
are in `../docs/RUNBOOK.md`.

**Before deploying a bake:** `node verify-data.js` — the quality gate (baked-data
invariants + judge-coverage threshold). CI runs it plus all `*.test.js` suites on every PR.

## Output

- `results/<date>/<store>-<mode>.json` — per-turn latency, handover flag + hit, reply tail,
  and a `stats` block (`success_rate`, `avg_ms`, `min/max_ms`, `handover_turn`).
- `results/<date>/summary.json` — `perStore` rows + a `perVendor` rollup (avg success rate
  + avg latency per vendor per mode), matching the report's top **Summary by vendor** table.

## Monthly automation

[`.github/workflows/monthly-benchmark.yml`](../.github/workflows/monthly-benchmark.yml)
runs `node run.js` on the 1st of each month in a fresh Ubuntu container (cold) and commits
the results. One broken widget doesn't fail the run.

## Adding / verifying a store

1. Add a row to `STORES` in `vendors.js` (`vendor`, `store`, `url`, `widget`, optional
   `us`, `locale`).
2. If it's a new widget tech, add a harness to `WIDGETS` (`scope`, `open`, `send`, optional
   `handover` regexes).
3. `node run.js --store <key> --mode shopping` and check the JSON / console for handover hits.
