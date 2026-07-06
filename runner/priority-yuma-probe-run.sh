#!/bin/bash
# priority-yuma-probe-run.sh — fast Yuma-native drivability probe.
#
# Use this before a full Yuma widening run. It runs a tiny headed pass against
# native app.yuma.ai storefronts, so bad targets are rejected after one bounded
# conversation instead of burning a whole multi-store batch.
set -euo pipefail
cd "$(dirname "$0")"

if pgrep -f "^node run\\.js --headed" >/dev/null; then
  echo "headed driver already running — skip Yuma probe"
  exit 0
fi

export RUN_DATE=${RUN_DATE:-$(date +%F)}
export TURN_TIMEOUT_MS=${TURN_TIMEOUT_MS:-25000}
export BENCHMARK_CAPTURE_ORIGIN=${BENCHMARK_CAPTURE_ORIGIN:-codex}

if [ "$#" -gt 0 ]; then
  STORES=("$@")
else
  STORES=(yuma-meshki-au yuma-meshki-uk)
fi

MAX=${MAX_CONVERSATIONS:-${#STORES[@]}}
THEME_COUNT=${THEMES:-1}
CONC=${CONCURRENCY:-1}

echo "▶ Yuma native probe — date $RUN_DATE — stores ${STORES[*]} — themes $THEME_COUNT — max $MAX — timeout ${TURN_TIMEOUT_MS}ms — origin $BENCHMARK_CAPTURE_ORIGIN"
caffeinate -i node run.js --headed --concurrency "$CONC" --mode shopping --store "${STORES[@]}" --themes "$THEME_COUNT" --max-conversations "$MAX"
