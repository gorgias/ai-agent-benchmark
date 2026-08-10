# Server capture (capture on a box, evals on your laptop)

The pipeline already splits cleanly, so moving capture off the laptop is a hosting change, not
a re-architecture:

```
SERVER (this folder)                          LAPTOP / scheduled Claude task
─────────────────────                         ──────────────────────────────
balance.mjs → run.js → results/<date>/conv/   git pull
      │                                       eval-pack → blind judges → eval-merge
      └── git push  ──── raw, unjudged ──────▶ integrity-check → gen.js → verify-data (gate)
                                              git push → vercel deploy → verify live==local
```

Raw conversations are additive and `gen.js` filters invalid ones, so the server pushing captures
can **never** change the live board by itself. Judging, baking, the quality gate and the deploy
stay where the judgement lives.

**The server needs no Anthropic API key.** Capture is pure Playwright — zero LLM calls. Only the
eval side spends tokens, and today that runs free through Claude Code subagents on the laptop.

## What to run it on

A small **dedicated** VPS beats a shared CI runner here, because the headline metric is latency:
noisy neighbours inflate every measurement.

| Option | Fit |
|---|---|
| **Dedicated VPS, 4 vCPU / 8 GB** (Hetzner, OVH…) | **Recommended.** ~€5–20/mo, full control, quiet CPU, stable IP. |
| Fly.io machine | Fine, scale-to-zero, slightly more moving parts. |
| GitHub Actions | Avoid for latency data — shared runners vary run-to-run. |

5 concurrent conversations fit comfortably in 4 vCPU / 8 GB.

## Setup

```bash
# 1. On the server: clone with a deploy key that has PUSH rights (capture pushes raw convs)
git clone git@github.com:gorgias/ai-agent-benchmark.git && cd ai-agent-benchmark

# 2. Either Docker…
docker build -f server/Dockerfile -t benchmark-capture .
docker run --rm -v ~/.ssh:/root/.ssh:ro benchmark-capture

# 3. …or bare metal
cd runner && npm ci && npx playwright install --with-deps chromium && cd ..
sudo apt-get install -y xvfb
bash server/capture.sh
```

Nightly, via cron (02:00 server time):

```cron
0 2 * * * cd /home/bench/ai-agent-benchmark && CAPTURE_LOG=/var/log/benchmark-capture.log bash server/capture.sh
```

Knobs (all optional — the defaults are the balanced ones): `INCLUDE`, `BUDGET`, `CONCURRENCY`,
`STORE_TIMEOUT_MIN`, `LOAD_CAP`, `BUDGET_SECONDS`. **Leave `TARGET` unset** so the adaptive
water-line applies: level every vendor up to the current leader, and inside each vendor feed the
least-captured storefront first.

## Validate before you trust the data

Two things differ on a server and both can silently corrupt results. Check them on the first run:

1. **Latency parity.** Capture the same 2–3 stores on the server and on the laptop the same day,
   then compare p75 per vendor. A dedicated box should be equal or slightly faster. If the server
   is materially slower, the box is undersized or throttled — fix that before mixing the data
   into the board, otherwise the time series shows a step change that is pure infrastructure.
2. **IP reputation.** Datacenter ranges hit more bot walls than a home connection. After the
   first run, check `driver-triage.json` for a jump in `RECAPTCHA_WALL` / `HUMAN_FRONT_DOOR`
   classifications versus the laptop baseline. If a vendor walls only on the server, that is an
   infrastructure artifact, not vendor behaviour — do not let it score as a failure.

## What stays on the laptop

Everything that needs judgement: `eval-pack.js` → blind judge subagents → `eval-merge.js` →
`integrity-check.js --quarantine` → `gen.js` → `verify-data.js` (hard gate) → push →
`vercel deploy --prod` → verify `live == local`. The gate refuses to deploy below 90% judge
coverage, so a server that out-captures your judging simply queues work — it can never publish
a half-evaluated board.

---

# The full daily stack

Three independent services. Independent on purpose: sourcing must not be able to break capture,
and neither can publish a board on its own.

| # | Service | When | What it does | Fails how |
|---|---|---|---|---|
| 1 | `server/source-merchants.mjs` | 01:00 | Finds up to 2 NEW verified storefronts per vendor, appends them to `vendors.js`, pushes | Adds nothing. Capture continues on the existing store list. |
| 2 | `server/capture.sh` | 02:00 | Balanced capture → pushes raw, unjudged conversations | No new conversations. Board unchanged. |
| 3 | `server/healthcheck.mjs` | after capture | Detects anomalies, posts to Slack, exits 1 on critical | Cron/systemd surfaces the non-zero exit. |

Judging, baking, the quality gate and the deploy stay on the laptop / the scheduled Claude task.
That is the safety property: **a server that captures badly can never publish a bad board**,
because publishing requires the gate, and the gate lives on the other side.

## Scheduling: use Fly's own scheduler

GitHub Actions is **disabled for this repository by the `gorgias` organization** (the API returns
`409 — GitHub Actions is disabled on this repository by the organization`). A repo admin cannot
override it; only an org owner can. `.github/workflows/nightly-capture.yml` is therefore inert
and kept only in case that policy changes.

Fly schedules Machines natively, which is better here anyway — no external scheduler, no Fly token
stored in a third-party system, one less thing to expire:

```bash
fly machine update <machine-id> --schedule daily -a gorgias-benchmark-capture
```

Create or update the machine at the hour you want the run to happen: Fly repeats it on roughly
that cadence. Aim for local night in the US (the market being measured), and remember the
anti-collision lock means a stray extra trigger exits harmlessly instead of corrupting latencies.

## Why 70/day is comfortable

Measured throughput over three real days: **20–39 valid conversations per hour** (mean ≈29), at
concurrency 5, with a 20–30% hollow rate already netted out. 70 valid conversations therefore
need roughly **2.5–3.5 hours** of capture. A 3-hour nightly window on a 4-vCPU box clears the
target with margin, which is what you want — a run that has to sprint is a run that inflates its
own latency measurements.

## How equality is enforced (both dimensions)

Two nested water-fills, both in `runner/tools/balance.mjs`, both vendor-blind:

1. **Across vendors** — always feed the vendor furthest below the water-line. With `TARGET` unset
   the line is the *current leader's count*, so the field levels up toward the front-runner and
   the line can never go stale. (A hardcoded `TARGET` is what silently turned the daily job into
   a no-op: every vendor had grown past it except one.)
2. **Across stores, inside the chosen vendor** — always feed that vendor's *least-captured*
   storefront, with rotation only as a tiebreak. Before this, the store pick was a round-robin
   whose index reset every process, so head-of-list stores were captured repeatedly and 72
   eligible storefronts had never been captured at all — one store owned 40–100% of several
   vendors' data, which makes a vendor's score a single merchant's score.

A never-captured store failing does **not** charge its vendor a strike: freshly sourced stores are
unproven by construction, and penalising the vendor for them retired healthy vendors.

## Slack alerts — what actually pages you

Each check exists because that failure happened and produced *valid-looking logs with no error*.
Silence is the enemy, so the alerter looks for the silence.

| Check | Catches |
|---|---|
| Yield vs `DAILY_TARGET` | The silent no-op: stale ceiling, dead widget set, crashed balancer |
| Hollow-capture rate | Our driver misreading a widget (text captured, no timed answer) |
| Store concentration | A vendor's score collapsing onto one storefront |
| Newly parked stores | Driver regressions — and 3+ at once means an environment problem, not 3 vendors breaking |
| Latency drift vs 7-day p75 | **An undersized or throttled server** — the one failure that silently corrupts the headline metric |
| Judge coverage | The queue growing before the gate blocks a deploy |
| Provider mismatch/ambiguous | A store that switched vendors, or a second widget answering — scores landing on the wrong vendor |

Set `SLACK_WEBHOOK_URL` (an incoming webhook — no MCP, no OAuth on the server). Without it the
report prints to stdout, which is also what `--dry` does.

## The candidate feed for sourcing

Sourcing needs a **tech-detection dataset, not an LLM** — the server makes zero LLM calls.
Preference order:

1. `STORELEADS_API_KEY` — query merchants by *detected* chat technology. This is the right source:
   it reflects what is installed, not what a vendor claims in marketing.
2. `server/candidates.json` — `{ "Vendor": ["https://store.com", …] }`, a manual or exported seed.

The feed only proposes. **Acceptance is always the same live check**, so a bad feed cannot reach
the board: a real browser loads the storefront cold, the vendor's widget host must load, and a
launcher must actually be **visible**. "Present" is not enough — a vendor can ship a non-chat
bundle that mounts hidden containers with no chat API at all, and one such store had been scoring
as that vendor's chat for 51 conversations. Stores where a second chat widget also loads are
recorded with a note so the driver targets the right launcher rather than guessing.
