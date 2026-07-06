#!/bin/bash
# weekly-local.sh — the sustainable weekly benchmark run, on Max's Mac (launchd: Monday 07:00).
# Captures a bounded headed stale/new-site plan (competitor widgets need a real browser),
# regenerates the report, commits and pushes. Costs ZERO GitHub Actions minutes — the cloud workflow
# (benchmark-cloud.yml) stays as a MANUAL fallback only.
#
# Evals (LLM judge) are NOT run here — they need a Claude session. After a run, ask
# Claude: "run the benchmark eval pass" (eval-pack → judge agents → eval-merge → gen → push).
set -euo pipefail
cd "$(dirname "$0")"

LOG=~/ai-chat-latency-benchmark/runner/weekly-local.log
exec >>"$LOG" 2>&1
echo "===== weekly run $(date '+%F %T') ====="

# never stack drivers — if a capture is already running, bail
if pgrep -f "node run.js" >/dev/null; then echo "driver already running — skip"; exit 0; fi

export RUN_DATE=$(date +%F)
export TURN_TIMEOUT_MS=60000
export BENCHMARK_CAPTURE_ORIGIN=${BENCHMARK_CAPTURE_ORIGIN:-automation}

if [ "${FULL_RUN:-0}" = "1" ]; then
  echo "FULL_RUN=1 — running the entire store/theme backlog."
  caffeinate -i node run.js --headed --concurrency "${CONCURRENCY:-2}" || true
else
  TARGET_CONVS=${WEEKLY_TARGET_CONVS:-80}
  PLAN_OUT=$(node daily-plan.js "$TARGET_CONVS" "$RUN_DATE")
  echo "$PLAN_OUT"
  STORE_ARGS=$(printf '%s\n' "$PLAN_OUT" | sed -n 's/^STORE_ARGS=//p')
  if [ -z "$STORE_ARGS" ]; then echo "empty plan — nothing stale to run — skip"; exit 0; fi
  # Keep weekly bounded. daily-plan selects whole stores, which can exceed TARGET_CONVS;
  # max-conversations enforces the actual wall-clock budget after resume/filtering.
  caffeinate -i node run.js --headed --concurrency "${CONCURRENCY:-2}" --store $STORE_ARGS --max-conversations "$TARGET_CONVS" || true
fi

node gen.js   # rebuilds report.html + takeaways.html + Pages stats (single source of truth)

cd ..
# stage EVERYTHING gen.js touches (results + report.html + takeaways.html + index/robots),
# not just report.html — else the Summary + public Pages drift from the data.
git add -A
git commit -m "Weekly local benchmark $(date +%F)" || { echo "no changes"; exit 0; }
git pull --rebase origin master && git push origin master
echo "NOTE: new conversations are captured but NOT yet LLM-judged — run the eval pass in a Claude session (eval-pack → judge → eval-merge → gen → push) to refresh quality scores."
echo "===== done $(date '+%F %T') ====="
