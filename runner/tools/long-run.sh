#!/bin/bash
# long-run.sh — a multi-hour capture stream that SURVIVES THE DATE ROLL.
#
# Why this exists: a RUN_DATE holds at most 10 conversations per store (5 themes x 2 lanes).
# Once a store is full, run.js prints "ALL DONE — every conversation already captured for this
# run-date", the balancer scores that as a failure, and three such stores retire a perfectly
# healthy VENDOR. A run launched with a fixed RUN_DATE therefore decays to nothing after a few
# hours — which is exactly what happened to the 2026-07-26 overnight run.
#
# This wrapper re-evaluates `date +%F` before every balancer pass, so when midnight rolls the
# whole store space reopens automatically and no capture is ever mislabelled with the wrong day.
#
# Usage: long-run.sh <label> <INCLUDE csv> <TARGET> <BUDGET-per-pass> <CONCURRENCY> <END-EPOCH>
set -u
RUNNER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RUNNER" || exit 1
LABEL="$1"; INC="$2"; TGT="$3"; BUD="$4"; CONC="$5"; END="$6"
LOG="$RUNNER/long-$LABEL.log"

echo "===== long-run $LABEL start $(date '+%F %T') · until $(date -r "$END" '+%F %T') =====" >>"$LOG"
while [ "$(date +%s)" -lt "$END" ]; do
  D=$(date +%F)
  echo "----- pass on RUN_DATE=$D at $(date '+%T') -----" >>"$LOG"
  RUN_DATE="$D" BENCHMARK_CAPTURE_ORIGIN=claude \
    INCLUDE="$INC" TARGET="$TGT" BUDGET="$BUD" CONCURRENCY="$CONC" \
    LOAD_CAP="${LOAD_CAP:-9}" STORE_TIMEOUT_MIN="${STORE_TIMEOUT_MIN:-40}" \
    TURN_TIMEOUT_MS="${TURN_TIMEOUT_MS:-60000}" \
    node tools/balance.mjs >>"$LOG" 2>&1
  # A pass can end because the budget is spent, every vendor reached TARGET, or every candidate
  # store is saturated for today. In all three cases the useful move is the same: wait for the
  # date to roll (or for headroom to appear) rather than hammering a full store space.
  [ "$(date +%s)" -ge "$END" ] && break
  echo "pass ended at $(date '+%T') — sleeping 20 min before re-evaluating the date" >>"$LOG"
  sleep 1200
done
echo "===== long-run $LABEL done $(date '+%F %T') =====" >>"$LOG"
