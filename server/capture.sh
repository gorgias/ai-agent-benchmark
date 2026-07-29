#!/bin/bash
# SERVER CAPTURE — pull, capture with the balancer, push RAW conversations. Nothing else.
#
# Deliberately capture-only, mirroring runner/daily-equity.sh: raw convs are additive and
# gen.js filters invalid ones, so pushing them can never change the live board on its own.
# Judging (blind LLM subagents), baking, the quality gate and the Vercel deploy all stay on
# Max's laptop / the scheduled Claude task. That split is why this box needs no API key and no
# deploy credentials beyond a git push key.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
LOG="${CAPTURE_LOG:-/var/log/benchmark-capture.log}"
BUDGET_SECONDS="${BUDGET_SECONDS:-10800}"        # 3h wall by default

# One capture at a time: overlapping runs inflate every measured latency, which corrupts the
# headline metric far more than a missed night costs.
if pgrep -f 'tools/balance.mjs' >/dev/null || pgrep -f 'node run.js' >/dev/null; then
  echo "$(date -Is) capture already running — skip" >> "$LOG"; exit 0
fi

git pull --rebase --autostash origin master >/dev/null 2>&1 || true
cd runner || exit 1

# LOAD_CAP scales with the box. On a DEDICATED server the load is entirely ours, so the laptop
# default of 9 would throttle us for no reason; on a shared box keep it low to stay honest.
CORES="$(nproc 2>/dev/null || echo 4)"
: "${LOAD_CAP:=$(( CORES > 2 ? CORES : 2 ))}"

# TARGET intentionally UNSET → balance.mjs adaptive water-line (level every vendor up to the
# current leader, then feed each vendor's LEAST-captured store). Never goes stale.
echo "===== SERVER CAPTURE START $(date -Is) · cores=$CORES load_cap=$LOAD_CAP =====" >> "$LOG"
INCLUDE="${INCLUDE:-Siena,Klaviyo,Intercom,DigitalGenius,Kodif,Zendesk,Ada,Envive,Sierra,Gorgias,Decagon,Yuma,Rep AI}" \
  BUDGET="${BUDGET:-400}" CONCURRENCY="${CONCURRENCY:-5}" LOAD_CAP="$LOAD_CAP" \
  STORE_TIMEOUT_MIN="${STORE_TIMEOUT_MIN:-18}" RUN_DATE="$(date +%F)" \
  xvfb-run -a node tools/balance.mjs >> "$LOG" 2>&1 &
BAL=$!
( sleep "$BUDGET_SECONDS"; kill -0 $BAL 2>/dev/null && {
    echo "$(date -Is) wall clock reached — stopping" >> "$LOG"
    pkill -f 'node run.js'; kill -9 $BAL; sleep 2; pkill -f 'chrome-headless-shell'; } ) &
WD=$!
wait $BAL 2>/dev/null; kill $WD 2>/dev/null
pkill -f 'chrome-headless-shell' 2>/dev/null

# Push raw captures. NEVER move/rename/archive conversation JSONs — gen.js filters invalid ones.
D=$(date +%F)
cd ..
if compgen -G "runner/results/$D/conv/*.json" >/dev/null; then
  git pull --rebase --autostash origin master >/dev/null 2>&1 || true
  git add "runner/results/$D/conv" runner/driver-triage.json 2>/dev/null
  git commit -q -m "Server capture $D — raw unjudged convs" 2>/dev/null \
    && git push origin HEAD:master >/dev/null 2>&1 \
    && echo "$(date -Is) pushed $(ls runner/results/$D/conv/*.json | wc -l) files" >> "$LOG"
fi
echo "===== SERVER CAPTURE DONE $(date -Is) =====" >> "$LOG"
