#!/bin/bash
# Resilient + incremental capture driver.
#   • run.js writes ONE file per conversation the instant it finishes (durable).
#   • RESUME is theme-level, so a kill loses at most the one conversation in flight.
#   • After each pass we regenerate the report from whatever's on disk (gen.js),
#     so the report GROWS live as conversations land.
# Loops until run.js reports "ALL DONE".
cd /Users/maxpruvost/ai-chat-latency-benchmark/runner
LOG=capture-2026-07-01.log
: > "$LOG"
for i in $(seq 1 60); do
  echo "===== ITERATION $i @ $(date +%H:%M:%S) =====" >> "$LOG"
  # concurrency 3 = network-safe (higher starves connections → ERR_INTERNET_DISCONNECTED).
  OUT=$(TURN_TIMEOUT_MS=35000 RUN_DATE=2026-07-01 node run.js --skip-candidates --concurrency 3 2>&1)
  echo "$OUT" | tail -40 >> "$LOG"
  # (report regeneration is owned by refresh-loop.sh — gen.js needs no network)
  CONVS=$(ls results/2026-07-01/conv/*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "---- $CONVS conversations on disk after iteration $i ----" >> "$LOG"
  if echo "$OUT" | grep -q "ALL DONE"; then
    echo "===== COMPLETE @ $(date +%H:%M:%S) — $CONVS conversations =====" >> "$LOG"
    break
  fi
  pkill -f "chromium.*headless" 2>/dev/null
  sleep 3
done
echo "driver exited" >> "$LOG"
