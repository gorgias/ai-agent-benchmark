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
# Robust logging: if the log directory is missing (e.g. a run without the volume attached), tee
# fails and — because say() pipes through it — every line would vanish silently. Fall back to /tmp
# rather than run blind.
mkdir -p "$(dirname "$LOG")" 2>/dev/null || LOG=/tmp/pipeline.log
touch "$LOG" 2>/dev/null || LOG=/tmp/pipeline.log
say() { echo "$(date -Is) $*" | tee -a "$LOG"; }

git config --global user.email "${GIT_EMAIL:-benchmark-bot@gorgias.com}"
git config --global user.name  "${GIT_NAME:-benchmark capture}"
git config --global --add safe.directory "$(pwd)"

# Git auth inside the container. Two supported paths, because which one you can use depends on
# GitHub org policy, not on preference:
#
#   GIT_SSH_KEY  — a repo DEPLOY KEY (write-enabled). Scoped to this single repo, addable by any
#                  repo admin, and it needs no organisation-level approval. Preferred: least
#                  privilege AND fewest external dependencies.
#   GIT_TOKEN    — a personal access token. Fine-grained tokens require the org to have opted in;
#                  a classic token needs `repo` scope, which grants far more than this box needs.
#
# Whichever is set, it arrives as a Fly secret so it never lands in the image or the logs.
if [ -n "${GIT_SSH_KEY:-}" ]; then
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  printf '%s\n' "$GIT_SSH_KEY" > /root/.ssh/id_ed25519
  chmod 600 /root/.ssh/id_ed25519
  ssh-keyscan -t rsa,ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null
  export GIT_SSH_COMMAND="ssh -i /root/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  git remote set-url origin "git@github.com:${GIT_REPO:-gorgias/ai-agent-benchmark}.git"
elif [ -n "${GIT_TOKEN:-}" ]; then
  git remote set-url origin "https://x-access-token:${GIT_TOKEN}@github.com/${GIT_REPO:-gorgias/ai-agent-benchmark}.git"
fi
if ! git ls-remote --exit-code origin >/dev/null 2>&1; then
  say "WARNING: cannot reach origin — captures will stay on the volume and never reach the board."
  say "         Set GIT_SSH_KEY (repo deploy key, write access) or GIT_TOKEN, then redeploy."
fi

say "===== PIPELINE START ====="
git pull --rebase --autostash origin master >/dev/null 2>&1 || true

# ── 1. sourcing (independent: a failure here must not stop capture) ────────────
if [ "${SKIP_SOURCING:-0}" != "1" ]; then
  say "--- sourcing merchants (PER_VENDOR=${PER_VENDOR:-2}) ---"
  node server/source-merchants.mjs 2>&1 | tee -a "$LOG" || say "sourcing failed (non-fatal) — continuing to capture"
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
    xvfb-run -a node tools/balance.mjs 2>&1 | tee -a "$LOG" ) &
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
RUN_DATE="$D" node server/healthcheck.mjs 2>&1 | tee -a "$LOG"; HC=${PIPESTATUS[0]}
say "===== PIPELINE DONE (healthcheck exit $HC) ====="
exit $HC
