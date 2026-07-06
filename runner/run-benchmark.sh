#!/bin/bash
# ============================================================================
# ONE-COMMAND benchmark capture — run in a normal macOS Terminal (NOT inside
# Claude Code, so nothing reaps it). Uses YOUR residential IP (fewest bot-blocks),
# is fully RESUMABLE (kills/sleeps lose nothing), and serves a LIVE report.
#
#   caffeinate -i bash run-benchmark.sh            # headless bulk (34 sites)
#   caffeinate -i bash run-benchmark.sh headed     # Rep AI / Kodif / Humind (visible)
#
# caffeinate -i keeps the Mac awake while it runs. Leave the Terminal open.
# Watch it fill in live at:  http://localhost:8765/report.html
# ============================================================================
cd "$(dirname "$0")"
DATE=${RUN_DATE:-2026-07-01}
export BENCHMARK_CAPTURE_ORIGIN=${BENCHMARK_CAPTURE_ORIGIN:-manual}
MODE_ARG="--skip-candidates"; LABEL="headless — Gorgias + Gorgias/Zendesk-shell vendors (fast)"
if [ "$1" = "headed" ]; then MODE_ARG='--headed'; LABEL="HEADED — ALL vendors (real browser; Envive/Sierra/Siena/Ada/Meta/Rep/Kodif/Humind). Resume skips done."; fi

echo "▶ Benchmark capture — $LABEL — run-date $DATE"

# 1) report server on :8765 (if not already up)
if ! lsof -i :8765 >/dev/null 2>&1; then ( cd .. && python3 -m http.server 8765 >/dev/null 2>&1 & ); echo "  report server → http://localhost:8765/report.html"; fi

# 2) live report regenerator (gen.js every 40s; needs no network)
( while true; do node gen.js --date "$DATE" >/dev/null 2>&1; sleep 40; done ) &
REFRESH=$!; trap 'kill $REFRESH 2>/dev/null; pkill -f "chromium.*headless" 2>/dev/null' EXIT

# 3) resumable capture loop until every conversation is on disk
CONC=3; [ "$1" = "headed" ] && CONC=2
for i in $(seq 1 200); do
  echo "── pass $i @ $(date +%H:%M:%S) ──"
  OUT=$(TURN_TIMEOUT_MS=70000 RUN_DATE="$DATE" node run.js $MODE_ARG --concurrency $CONC 2>&1)
  echo "$OUT" | grep -E "RESUME|Running [0-9]|✔ \[|Done" | tail -20
  if echo "$OUT" | grep -q "ALL DONE"; then echo "✅ COMPLETE — every conversation captured."; break; fi
  pkill -f "chromium.*headless" 2>/dev/null; sleep 3
done
node gen.js --date "$DATE" >/dev/null 2>&1
echo "Done. Report: http://localhost:8765/report.html"
