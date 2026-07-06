#!/bin/bash
# priority-klaviyo-decagon-run.sh — focused Shopping coverage for undersampled vendors.
#
# This intentionally runs one headed driver only. If another capture is active, it
# exits without touching it.
set -euo pipefail
cd "$(dirname "$0")"

if pgrep -f "node run.js" >/dev/null; then
  echo "driver already running — skip focused Klaviyo/Decagon run"
  exit 0
fi

export RUN_DATE=${RUN_DATE:-$(date +%F)}
export TURN_TIMEOUT_MS=${TURN_TIMEOUT_MS:-60000}
export BENCHMARK_CAPTURE_ORIGIN=${BENCHMARK_CAPTURE_ORIGIN:-codex}

EXTRA_ARGS=(--mode "${MODE:-shopping}" --themes "${THEMES:-3}" --max-conversations "${MAX_CONVERSATIONS:-24}")
if [ "${NO_RESUME:-0}" = "1" ]; then EXTRA_ARGS+=(--no-resume); fi

echo "▶ Focused Klaviyo + Decagon capture — date $RUN_DATE — mode ${MODE:-shopping} — themes ${THEMES:-3} — max ${MAX_CONVERSATIONS:-24} — origin $BENCHMARK_CAPTURE_ORIGIN"
caffeinate -i node run.js --headed --concurrency "${CONCURRENCY:-2}" --vendor Klaviyo Decagon "${EXTRA_ARGS[@]}"

node gen.js
node runstatus.js || true
