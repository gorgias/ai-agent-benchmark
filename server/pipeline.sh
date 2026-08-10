#!/bin/bash
# server/pipeline.sh — the whole nightly server run, in order, for a scale-to-zero Machine.
#
#   1. source new merchants   (independent; adds verified storefronts, or adds nothing)
#   2. capture                (balanced across vendors AND stores; pushes RAW convs)
#   3. healthcheck            (anomaly detection → Slack; writes the publish verdict)
#   4. publish                (judge → merge → bake → GATE → push → deploy → verify live)
#
# Step 4 used to be deliberately absent: keeping publishing on a laptop meant this box could not
# put a bad board in front of anyone. Closing the loop gives that up, so the protection had to move
# in-band instead of being an org-chart accident — verify-data.js is a hard gate that runs before
# any deploy, and the healthcheck can veto a publish whose data it already knows is wrong. See the
# header of publish.sh. Capture still pushes raw conversations incrementally, so even a publish
# that refuses to ship never loses a night's work.
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
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG"; }

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

# ANTI-COLLISION LOCK. Two captures running at once inflate every measured latency, which
# corrupts the headline metric far more quietly than a missed night costs. This can happen easily:
# a manual trigger while the scheduled run is still going, or a retry after a perceived failure.
# The lock lives on the volume so it survives across machines of the same app.
LOCK="${LOCK_FILE:-/data/capture.lock}"
mkdir -p "$(dirname "$LOCK")" 2>/dev/null || LOCK=/tmp/capture.lock
if [ -f "$LOCK" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
  # Stale lock: a machine killed mid-run leaves the file behind, so expire it past the longest
  # possible run rather than blocking every night forever.
  # Budget for capture AND the publish phase that now follows it (judging ~70 conversations takes
  # 20-40 min), or a still-healthy run would look stale and get trampled by the next trigger.
  if [ "$LOCK_AGE" -lt $(( CAPTURE_SECONDS + 5400 )) ]; then
    say "another capture started ${LOCK_AGE}s ago (lock $LOCK) — exiting so latencies stay clean"
    exit 0
  fi
  say "stale lock (${LOCK_AGE}s old) — taking over"
fi
date +%s > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

say "===== PIPELINE START ====="

# REFUSE TO RUN WITHOUT THE VOLUME. This is not about losing data — it is the anti-collision lock.
# The lock lives on /data so it is shared across machines of this app, which means a machine that
# booted WITHOUT the volume never sees it and happily starts a second concurrent capture. Two
# captures at once inflate every measured latency, and latency is the headline metric — so the
# corruption is silent and lands directly on the board. (This happened: a one-off `fly machine run`
# started the default CMD on a volumeless machine in another region while the real run was live.)
# A missing volume means this machine is not the scheduled worker, so it must do nothing at all.
# Read /proc/mounts rather than call `mountpoint`: if that binary were ever absent from the image,
# the check would fail closed and silently stop the job running at all — a guard that can disable
# the whole pipeline is worse than the collision it prevents.
if [ "${REQUIRE_VOLUME:-1}" = "1" ] && ! grep -q " /data " /proc/mounts 2>/dev/null; then
  say "/data is not a mounted volume — refusing to run so this cannot become a second concurrent capture."
  say "         If you meant to run a one-off, set REQUIRE_VOLUME=0 and expect no cross-machine locking."
  exit 0
fi

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

# ── 3. healthcheck → Slack (also writes the publish verdict publish.sh reads) ──
say "--- healthcheck ---"
RUN_DATE="$D" node server/healthcheck.mjs 2>&1 | tee -a "$LOG"; HC=${PIPESTATUS[0]}

# ── 4. publish ────────────────────────────────────────────────────────────────
# Runs even when the healthcheck exited non-zero: most criticals are operational (nothing captured,
# drivers regressed) and the right response is still to publish the judged backlog. The ones that
# would put wrong numbers on the board set block_publish in the verdict, and publish.sh honours it.
if [ "${SKIP_PUBLISH:-0}" != "1" ]; then
  RUN_DATE="$D" bash server/publish.sh; PB=$?
else
  say "SKIP_PUBLISH=1 — capture only, board untouched"; PB=0
fi

say "===== PIPELINE DONE (healthcheck $HC, publish $PB) ====="
# Surface the publish result first: a stale board is the failure a human needs to act on, whereas
# a healthcheck warning about one night's yield usually resolves itself the next night.
[ "$PB" -ne 0 ] && exit "$PB"
exit $HC
