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
