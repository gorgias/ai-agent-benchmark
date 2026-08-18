#!/bin/bash
# klaviyo-run.sh — focused headed capture for Klaviyo K:AI stores.
set -euo pipefail
cd "$(dirname "$0")"

# Never stack capture drivers. If the weekly/daily run is still active, let it finish.
if pgrep -f "node run.js" >/dev/null; then
  echo "driver already running — skip Klaviyo focused run"
  exit 0
fi

export RUN_DATE=${RUN_DATE:-$(date +%F)}
export TURN_TIMEOUT_MS=${TURN_TIMEOUT_MS:-60000}
export BENCHMARK_CAPTURE_ORIGIN=${BENCHMARK_CAPTURE_ORIGIN:-manual}

EXTRA_ARGS=()
if [ "${NO_RESUME:-0}" = "1" ]; then EXTRA_ARGS+=(--no-resume); fi

caffeinate -i node run.js --headed --concurrency "${CONCURRENCY:-2}" --vendor Klaviyo "${EXTRA_ARGS[@]}"
node gen.js
