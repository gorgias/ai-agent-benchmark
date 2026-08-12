# The daily loop (one box, end to end)

One scheduled Machine runs the whole thing and nothing needs a laptop:

```
source-merchants.mjs   +2 verified storefronts per vendor
        ↓
balance.mjs → run.js   balanced capture → results/<date>/conv/  ── git push every 10 min
        ↓
healthcheck.mjs        anomalies → Slack, and writes the publish verdict
        ↓
publish.sh             eval-pack → judge-api → eval-merge → integrity-check
                       → gen.js → verify-data (HARD GATE) → git push
                       → vercel deploy → verify-live.mjs (live == local)
```

## What stops a bad board going out

Capture used to push raw conversations and stop there, and publishing lived on a laptop — so the
box *couldn't* publish a bad board. Closing the loop gives that separation up, so the protection is
now explicit and in-band:

| Guard | Refuses to publish when |
|---|---|
| `verify-data.js` — the hard gate | judge coverage < 90%, or any impossible statistic |
| healthcheck verdict | latency inflated across ≥3 vendors — that is our box, not the vendors, and nothing downstream filters it |
| evidence verification in `judge-api.mjs` | a passing check cites a quote that is not in the transcript |
| `verify-live.mjs` | the deployed page does not match what was baked |

A failed gate still commits the judging work — scores cost money — but reverts the baked artifacts,
so the repo never carries a board that did not pass. **A stale board is a far cheaper failure than
a wrong one**, and every guard is written to prefer staleness.

## The judge

`runner/judge-api.mjs` scores conversations through the Anthropic API, reading the rubric from
`runner/eval-rubric.md` so the spec stays versioned in one place. It is a drop-in for the Claude
Code subagent judges: same blind batches in, same `scored-*.json` out.

- **Blind by construction** — batches arrive anonymized from `eval-pack.js`; nothing re-introduces
  vendor identity, and `map-*.json` is never shown to a judge.
- **One conversation per call** — not for cost, for correctness: a batch-sized call invites scoring
  relative to neighbours, and one truncation loses the whole batch.
- **Evidence verified in code** — the rubric says a passing check must quote the transcript. Every
  quote is checked against the transcript and the check is demoted to `fail` if it is not there.
  Without this, "no quote → no credit" only catches *empty* quotes, not invented ones.

Cost is roughly **$0.09/conversation** on `claude-opus-4-8` (~$6/night at 70/day), most of it
output tokens. `JUDGE_MAX` caps a night. To trade cost for a different model, set `JUDGE_MODEL` —
but run the calibration below first.

### Before you change the judge model or prompt

Rankings run over a trailing 90-day window, so the corpus always mixes conversations scored at
different times. A judge that is systematically harsher or softer than the previous one moves every
vendor for a reason that has nothing to do with vendor behaviour, and it lands hardest on whoever
was captured most recently. Nothing else we check would catch it.

```bash
node runner/eval-pack.js /tmp/calib 6 --rejudge-file cohort.json   # already-scored conversations
node runner/judge-api.mjs /tmp/calib
node server/judge-calibrate.mjs /tmp/calib
```

The API judge was accepted on this basis: **bias −0.5 pts, r = 0.92** against a 22-conversation
cohort spanning 0–100 in both lanes — indistinguishable from the subagent judges that built the
corpus. Re-run it whenever the judge changes.

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

## Secrets the box needs

All via `fly secrets set` — never in a file, never in the image.

| Secret | Without it |
|---|---|
| `GIT_SSH_KEY` (repo deploy key) or `GIT_TOKEN` | captures stay on the volume and never reach the board |
| `ANTHROPIC_API_KEY` | nothing is judged, so nothing publishes; captures still accumulate |
| `VERCEL_TOKEN` | the board is baked, gated and pushed, but the live site stays stale |
| `SITE_PASSWORD` | the deploy happens but cannot be read back, so it reports **UNVERIFIED** rather than success |
| `SLACK_WEBHOOK_URL` | alerts print to the log instead of reaching anyone |

Each missing secret degrades one step and says so loudly — none of them fail silently.

---

# The full daily stack

Four stages in one wake-up, run by `server/pipeline.sh`. Ordered, not independent — sourcing must
finish before capture reads `vendors.js`, and publishing must not start until capture is done — but
each stage fails without taking the next one down.

| # | Stage | What it does | Fails how |
|---|---|---|---|
| 1 | `source-merchants.mjs` | Finds up to 2 NEW verified storefronts per vendor, appends them to `vendors.js` | Adds nothing. Capture continues on the existing store list. |
| 2 | `balance.mjs` → `run.js` | Balanced capture → pushes raw conversations every 10 min | No new conversations. The board still republishes with what exists. |
| 3 | `healthcheck.mjs` | Anomalies → Slack; writes the publish verdict | Publish proceeds; the verdict file is rewritten every run so it can never go stale. |
| 4 | `publish.sh` | Judge → merge → bake → gate → push → deploy → verify | Board stays as it was. Judging work is still committed. |

Everything runs on one scale-to-zero Machine, so a whole day costs one boot.

Why one script rather than four scheduled jobs: on scale-to-zero compute the container only exists
for the length of one invocation, so sequencing in-process is both cheaper (one boot) and safer
(no window where two stages overlap on the same volume).

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

## Running a one-off by hand (read this first)

```bash
fly machine run <image> -a gorgias-benchmark-capture --rm --restart no \
  --entrypoint /usr/bin/env -- <command>
```

Three traps, each of which cost a real incident:

1. **`--restart no` is mandatory.** A one-off machine does NOT inherit the policy from `fly.toml`
   or from the scheduled machine. Without it the default is `on-failure`, and since the pipeline
   exits non-zero to *report* problems, the machine reboots and re-runs the whole capture in a
   loop. Observed live: an integration run exited 1, rebooted, and started capturing again.
2. **`fly machine run` silently ignores `--command`** and runs the image's default CMD — which is
   the full pipeline. Pass the command positionally after `--`. Without `--`, flags like `--yes`
   and `-c` are swallowed by flyctl's own parser (`-c` is `--config`).
3. **A one-off has no volume**, so it never sees the anti-collision lock on `/data` and can start a
   second concurrent capture — which inflates every measured latency. `pipeline.sh` refuses to run
   without the volume for exactly this reason; only override with `REQUIRE_VOLUME=0` when you know
   the scheduled machine is stopped.

## Why 150/day, and the two separate levers behind it

Measured throughput over three real days: **20–39 valid conversations per hour** (mean ≈29), at
concurrency 5. Two independent problems were found and fixed on 2026-08-12 after two unattended
runs came in at 12 and 17 valid conversations against the *old* 70/day target — worth understanding
because they point at two different knobs, and conflating them leads to the wrong fix:

- **Yield (% of attempts that produce a valid conversation).** The store-least-captured-first pick
  (below) kept re-selecting storefronts that were structurally dead, and `genericOpenChat` scanned
  for the chat launcher once at a fixed 2500ms — a race some heavier stores lost *every* time, not
  intermittently. Both fixed: dead stores auto-park after repeated 0-valid runs, and the launcher
  scan now polls for up to 9s. On top of that, `CONCURRENCY=5` — 5 headless Chromium contexts
  rendering modern storefronts at once — was starved on the original 2-vCPU machine; three
  previously-100%-dead stores captured cleanly at `concurrency=1` with identical driver code,
  isolating CPU contention rather than a driver bug. Fixed by moving to `performance-4x`.
- **Throughput (total attempts within the window).** `CONCURRENCY` cannot be raised past 5 to buy
  this — it is a structural ceiling, not a CPU one: more simultaneous sessions against the same
  store's backend risks inflating the vendor's *measured* latency past what a real shopper would
  see, and latency is the headline metric. A bigger machine cannot lift this ceiling, which is why
  `performance-4x` (not 8x or 16x) is the right size — enough dedicated CPU per browser context,
  no more. The only safe lever for more attempts is a longer wall-clock window:
  `CAPTURE_SECONDS`, now 5.5h (was 3h). At the measured mean this clears 150/day with margin;
  `BUDGET` (400, unchanged) is a hard ceiling well above target, so higher-than-expected post-fix
  throughput exits early via the adaptive water-line rather than overshooting.

A run that has to sprint is a run that inflates its own latency measurements — the 5.5h window, not
a higher concurrency, is what buys the extra volume.

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
