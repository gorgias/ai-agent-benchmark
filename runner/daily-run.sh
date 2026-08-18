#!/bin/bash
# daily-run.sh — the DAILY ~30-conversation benchmark run on Max's Mac (launchd: daily 08:00).
# Picks the day's plan (never-measured sites first for diversity, then the stalest), captures
# headed (competitor widgets need a real browser), regenerates the report, commits & pushes.
# Then recomputes the plan so the report's "Upcoming runs" shows what tomorrow will cover.
# Costs ZERO GitHub Actions minutes. See weekly-local.sh for the fuller (all-store) run.
#
# Quality (LLM judge) is NOT run here — it needs a Claude session (no API key locally).
# Automation / latency / coverage / p75 refresh daily; ask Claude to "run the eval pass"
# to refresh quality scores. New CANDIDATE sites are sourced in a Claude session too
# (intelligent discovery needs the model) and land in vendors.js; this run then measures
# them first (they're never-captured → top of the plan).
set -euo pipefail
cd "$(dirname "$0")"

LOG=~/ai-chat-latency-benchmark/runner/daily-run.log
exec >>"$LOG" 2>&1
echo "===== daily run $(date '+%F %T') ====="

# never stack drivers — one headed capture at a time
if pgrep -f "node run.js" >/dev/null; then echo "driver already running — skip"; exit 0; fi

export RUN_DATE=$(date +%F)
export TURN_TIMEOUT_MS=45000
export BENCHMARK_CAPTURE_ORIGIN=${BENCHMARK_CAPTURE_ORIGIN:-automation}

# pick today's ~30-conversation plan (writes ../run-next.json + prints STORE_ARGS=)
PLAN_OUT=$(node daily-plan.js 30 "$RUN_DATE")
echo "$PLAN_OUT"
STORE_ARGS=$(printf '%s\n' "$PLAN_OUT" | sed -n 's/^STORE_ARGS=//p')
if [ -z "$STORE_ARGS" ]; then echo "empty plan — nothing stale to run — skip"; exit 0; fi

caffeinate -i node run.js --headed --concurrency 2 --store $STORE_ARGS || true

node gen.js                 # rebuild report + takeaways + Pages stats
# recompute the plan AFTER capture so "Upcoming runs" reflects the next-stalest set for tomorrow
node daily-plan.js 30 "$(date -v+1d +%F 2>/dev/null || date +%F)" || true

cd ..
git add -A
git commit -m "Daily benchmark $(date +%F) — ~30 conv (new sites + stalest)" || { echo "no changes"; exit 0; }
git pull --rebase origin master && git push origin master
git push personal master || true
echo "NOTE: quality (LLM judge) NOT refreshed — run the eval pass in a Claude session."
echo "===== done $(date '+%F %T') ====="
