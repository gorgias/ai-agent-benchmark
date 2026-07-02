#!/bin/bash
# HEADED capture driver — Rep AI / Kodif / Humind only (their widgets load only in a
# visible browser). Same durable/resumable model: one file per conversation, theme-level
# resume. Writes into the SAME conv/ dir as the headless driver (different keys, no clash).
# Does NOT run gen.js (the headless driver owns report regeneration, to avoid write races).
cd /Users/maxpruvost/ai-chat-latency-benchmark/runner
LOG=capture-headed-2026-07-01.log
: > "$LOG"
for i in $(seq 1 60); do
  echo "===== HEADED ITERATION $i @ $(date +%H:%M:%S) =====" >> "$LOG"
  OUT=$(TURN_TIMEOUT_MS=45000 RUN_DATE=2026-07-01 node run.js --headed --vendor "Rep AI" Kodif Humind --concurrency 2 2>&1)
  echo "$OUT" | tail -50 >> "$LOG"
  CONVS=$(ls results/2026-07-01/conv/*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "---- $CONVS total conversations on disk after headed iteration $i ----" >> "$LOG"
  if echo "$OUT" | grep -q "ALL DONE"; then echo "===== HEADED COMPLETE @ $(date +%H:%M:%S) =====" >> "$LOG"; break; fi
  sleep 3
done
echo "headed driver exited" >> "$LOG"
