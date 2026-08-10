#!/bin/bash
# server/pipeline.sh — the whole nightly server run, in order, for a scale-to-zero Machine.
#
#   1. source new merchants   (independent; adds verified storefronts, or adds nothing)
#   2. capture                (balanced across vendors AND stores; pushes RAW convs)
#   3. healthcheck            (anomaly detection → Slack; non-zero exit on critical)
#
# Judging, baking, the quality gate and the deploy are NOT here and never will be. That is the
# safety property of this split: this box cannot publish a board, so it cannot publish a bad one.
#
# WHY ONE SCRIPT INSTEAD OF THREE CRON LINES: on a scale-to-zero Machine the container exists only
# for the length of one invocation. Running the three services sequentially in a single wake-up is
# both cheaper (one boot) and safer (sourcing finishes before capture reads vendors.js).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
LOG="${CAPTURE_LOG:-/data/pipeline.log}"
CAPTURE_SECONDS="${CAPTURE_SECONDS:-10800}"     # 3h — measured throughput puts 70 valid convs at ~2.5-3h
PUSH_EVERY="${PUSH_EVERY:-600}"                 # incremental push interval (seconds)
say() { echo "$(date -Is) $*" | tee -a "$LOG"; }

git config --global user.email "${GIT_EMAIL:-benchmark-bot@gorgias.com}"
git config --global user.name  "${GIT_NAME:-benchmark capture}"
git config --global --add safe.directory "$(pwd)"

say "===== PIPELINE START ====="
git pull --rebase --autostash origin master >/dev/null 2>&1 || true

# ── 1. sourcing (independent: a failure here must not stop capture) ────────────
if [ "${SKIP_SOURCING:-0}" != "1" ]; then
  say "--- sourcing merchants (PER_VENDOR=${PER_VENDOR:-2}) ---"
  node server/source-merchants.mjs >>"$LOG" 2>&1 || say "sourcing failed (non-fatal) — continuing to capture"
  git pull --rebase --autostash origin master >/dev/null 2>&1 || true
fi

# ── 2. capture, with INCREMENTAL push ─────────────────────────────────────────
# THE REASON THIS MATTERS: on ephemeral/scale-to-zero compute, anything not pushed when the
# container dies is gone. A single push at the end means a timeout or an OOM at hour 2:59 throws
# away the whole night. Pushing every PUSH_EVERY seconds caps the worst case at one interval.
# Raw conversations are additive and gen.js filters invalid ones, so partial pushes are safe:
# they can never change the live board on their own.
D=$(date +%F)
push_convs() {
  compgen -G "runner/results/$D/conv/*.json" >/dev/null || return 0
  git pull --rebase --autostash -X theirs origin master >/dev/null 2>&1 || true
  git add "runner/results/$D/conv" runner/driver-triage.json 2>/dev/null
  git diff --cached --quiet && return 0                     # nothing new since last push
  local n; n=$(ls runner/results/"$D"/conv/*.json 2>/dev/null | wc -l | tr -d ' ')
  git commit -q -m "Server capture $D — raw unjudged convs ($n files so far)" 2>/dev/null || return 0
  git push origin HEAD:master >/dev/null 2>&1 && say "pushed (${n} files on disk)"
}

say "--- capture (concurrency ${CONCURRENCY:-5}, wall ${CAPTURE_SECONDS}s) ---"
CORES="$(nproc 2>/dev/null || echo 4)"
: "${LOAD_CAP:=$(( CORES > 2 ? CORES : 2 ))}"
( cd runner && INCLUDE="${INCLUDE:-Siena,Klaviyo,Intercom,DigitalGenius,Zendesk,Ada,Envive,Sierra,Gorgias}" \
    BUDGET="${BUDGET:-400}" CONCURRENCY="${CONCURRENCY:-5}" LOAD_CAP="$LOAD_CAP" \
    STORE_TIMEOUT_MIN="${STORE_TIMEOUT_MIN:-18}" RUN_DATE="$D" \
    xvfb-run -a node tools/balance.mjs >>"$LOG" 2>&1 ) &
BAL=$!

elapsed=0
while kill -0 $BAL 2>/dev/null; do
  sleep "$PUSH_EVERY"; elapsed=$((elapsed + PUSH_EVERY))
  push_convs
  if [ "$elapsed" -ge "$CAPTURE_SECONDS" ]; then
    say "wall clock reached — stopping capture"
    pkill -f 'node run.js' 2>/dev/null; kill -9 $BAL 2>/dev/null; break
  fi
done
wait $BAL 2>/dev/null
pkill -f 'chrome-headless-shell' 2>/dev/null
push_convs                                                  # final push

# ── 3. healthcheck → Slack ────────────────────────────────────────────────────
say "--- healthcheck ---"
RUN_DATE="$D" node server/healthcheck.mjs >>"$LOG" 2>&1; HC=$?
say "===== PIPELINE DONE (healthcheck exit $HC) ====="
exit $HC
