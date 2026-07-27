#!/bin/bash
# wave-launch.sh — start ONE detached balancer stream and record its PID.
# Usage: wave-launch.sh <label> <INCLUDE csv> <TARGET> <BUDGET> <CONCURRENCY>
# Teardown is by PID only (see docs/RUNBOOK.md §7) — every PID lands in /tmp/run.pids.
set -u
RUNNER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RUNNER" || exit 1

LABEL="$1"; INC="$2"; TGT="$3"; BUD="$4"; CONC="$5"
LOG="$RUNNER/wave-$LABEL.log"

nohup caffeinate -dimsu env \
  RUN_DATE="${RUN_DATE:-$(date +%F)}" \
  BENCHMARK_CAPTURE_ORIGIN="${BENCHMARK_CAPTURE_ORIGIN:-claude}" \
  INCLUDE="$INC" TARGET="$TGT" BUDGET="$BUD" CONCURRENCY="$CONC" \
  LOAD_CAP="${LOAD_CAP:-9}" STORE_TIMEOUT_MIN="${STORE_TIMEOUT_MIN:-40}" \
  TURN_TIMEOUT_MS="${TURN_TIMEOUT_MS:-60000}" \
  node tools/balance.mjs >>"$LOG" 2>&1 &

PID=$!
disown
echo "$PID" >> /tmp/run.pids
echo "stream $LABEL pid=$PID include=$INC target=$TGT budget=$BUD conc=$CONC log=$LOG"
