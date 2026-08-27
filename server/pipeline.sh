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
SOURCING_TIMEOUT="${SOURCING_TIMEOUT:-1800}"    # 30m wall clock on stage 1 — see the sourcing stage
PUSH_EVERY="${PUSH_EVERY:-600}"                 # incremental push interval (seconds)
# GLOBAL WALL CLOCK. Every stage now has a bound; this is the backstop for the stage that does not
# yet, and for the one nobody has written. It is not primarily about saving the night — it is about
# GUARANTEEING THE MACHINE EXITS. `--schedule daily` starts a STOPPED machine, so a run that never
# ends holds the schedule slot shut and costs every following night too (2026-08-24: one hang, four
# nights). Whatever goes wrong, this caps the blast radius at a single night.
#
# The default is deliberately just UNDER the anti-collision lock's staleness threshold
# (CAPTURE_SECONDS + 5400, see the lock below), which buys a property the lock could not previously
# promise: a run can never outlive its own lock, so "stale lock — taking over" can no longer fire
# against a run that is still alive. Budget inside it: sourcing <= SOURCING_TIMEOUT (1800) +
# capture <= CAPTURE_SECONDS + publish (~2400 for a 40-min judge pass) = ~4200 < 5100.
PIPELINE_MAX_SECONDS="${PIPELINE_MAX_SECONDS:-$(( CAPTURE_SECONDS + 5100 ))}"
# Robust logging: if the log directory is missing (e.g. a run without the volume attached), tee
# fails and — because say() pipes through it — every line would vanish silently. Fall back to /tmp
# rather than run blind.
mkdir -p "$(dirname "$LOG")" 2>/dev/null || LOG=/tmp/pipeline.log
touch "$LOG" 2>/dev/null || LOG=/tmp/pipeline.log
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG"; }

# Slack straight from the pipeline, for the things healthcheck.mjs structurally cannot report —
# it is stage 3, so anything that stops the run before it never gets announced. Best-effort by
# design: an alerter that can fail the run it is watching is worse than no alerter.
# node (not python/jq) does the JSON escaping because node is the one interpreter this image is
# guaranteed to have — a message with a quote or a newline in it must not produce invalid JSON.
slack() {
  [ -n "${SLACK_WEBHOOK_URL:-}" ] || { say "(no SLACK_WEBHOOK_URL — not posted: $1)"; return 0; }
  local body; body=$(node -e 'process.stdout.write(JSON.stringify({text:process.argv[1],mrkdwn:true}))' "$1" 2>/dev/null) || return 0
  curl -fsS -m 15 -X POST -H 'content-type: application/json' --data "$body" "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 \
    || say "Slack post failed (non-fatal)"
}

# ── DEAD-MAN'S SWITCH ─────────────────────────────────────────────────────────
# THE ONE THING THAT CANNOT LIVE IN THIS FILE. Every alert we had was downstream of the failure:
# healthcheck.mjs is stage 3, SLACK_WEBHOOK_URL was set and working, and a hang in stage 1 meant it
# simply never ran — four days of total silence with functioning alerting. No amount of in-band
# checking fixes that, because the process that would raise the alarm is the process that is dead.
# So the watcher has to be OUTSIDE: this pings a heartbeat service, and the SERVICE pages when the
# ping does not arrive. Silence stops being indistinguishable from success.
#
# DEADMAN_URL is a healthchecks.io-style check URL (Better Stack and Cronitor use the same
# convention): "$URL/start" when a run begins, "$URL" when it finishes, "$URL/fail" when it dies.
# Configure the check for a 1-day period with a grace longer than a full run (~15h covers
# CAPTURE_SECONDS=11h + sourcing + publish), and point it at the same Slack channel.
#
# It is a Fly secret, but a low-privilege one: the worst an attacker can do with the URL is post a
# healthy ping, i.e. suppress an alert. It grants no access to the box, the repo, or the board.
# Unset = pings skipped, same "degrades one step and says so" convention as every other secret.
DEADMAN_URL="${DEADMAN_URL:-}"
DEADMAN_STARTED=0
DEADMAN_FINISHED=0
deadman() {
  [ -n "$DEADMAN_URL" ] || return 0
  local ep="$1" url="$DEADMAN_URL"
  case "$ep" in
    start) url="$DEADMAN_URL/start" ;;
    fail)  url="$DEADMAN_URL/fail" ;;
  esac
  # --retry 3: a single dropped ping must not page a healthy run. Bounded so it can never become
  # the thing that hangs the pipeline (the failure mode this whole change exists to prevent).
  curl -fsS -m 15 --retry 3 --retry-max-time 60 -o /dev/null "$url" 2>/dev/null \
    || say "dead-man ping ($ep) FAILED — the switch may fire even though this run is healthy"
}

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
  # The 5400s of slack also has to cover bounded sourcing (SOURCING_TIMEOUT, 1800s default) now
  # that stage 1 has a wall clock: 1800 + a 40-min publish is 4200s, so the margin still holds.
  # Raise SOURCING_TIMEOUT past ~3000s and this needs raising with it.
  if [ "$LOCK_AGE" -lt $(( CAPTURE_SECONDS + 5400 )) ]; then
    say "another capture started ${LOCK_AGE}s ago (lock $LOCK) — exiting so latencies stay clean"
    exit 0
  fi
  say "stale lock (${LOCK_AGE}s old) — taking over"
fi
date +%s > "$LOCK"
# The lock release is UNCHANGED and stays FIRST: releasing it must never be blocked by, or made
# conditional on, anything added after it. Everything else in the handler is best-effort.
# The dead-man "fail" ping lives here so an ABNORMAL exit (a stage exiting the script early, a
# SIGTERM from the host) pages immediately instead of waiting out the heartbeat's grace period.
# DEADMAN_STARTED gates it so the two guards below — both of which exit 0 on purpose, before the
# run has begun — never announce a failure that did not happen.
on_exit() {
  rm -f "$LOCK"
  kill "${WATCHDOG:-}" 2>/dev/null
  if [ "$DEADMAN_STARTED" = 1 ] && [ "$DEADMAN_FINISHED" = 0 ]; then
    say "pipeline exited without reaching the end — pinging the dead-man switch"
    deadman fail
  fi
}
trap on_exit EXIT

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

# BOTH EARLY-EXIT GUARDS ARE BEHIND US (the lock said no other run is live, and the volume is
# mounted), so from here the run is real and the dead-man switch should expect a finish. Pinging
# any earlier would page every time a stray trigger exited harmlessly at the lock.
deadman start; DEADMAN_STARTED=1

# The global wall clock (see PIPELINE_MAX_SECONDS). Deliberately NOT `kill $$`: bash defers a trap
# until the foreground command returns, so signalling the script while it is blocked in a wedged
# `node` would do nothing — which is exactly the situation this exists for. It does the cleanup
# itself, in the order that matters (page first, release the lock, then kill), and SIGKILLs the
# script. Fly stops the Machine once the entrypoint process is gone, which is the point: the
# schedule slot reopens no matter what state the run was in.
(
  sleep "$PIPELINE_MAX_SECONDS"
  kill -0 $$ 2>/dev/null || exit 0
  say "PIPELINE WALL CLOCK reached (${PIPELINE_MAX_SECONDS}s) — killing this run so the Machine exits and tomorrow's schedule can start it"
  slack ":red_circle: *Benchmark pipeline killed at its wall clock* (${PIPELINE_MAX_SECONDS}s) — a stage hung. The Machine is being stopped so tonight's stall cannot swallow tomorrow's run too. Check \`/data/pipeline.log\` for the last stage that logged."
  deadman fail
  rm -f "$LOCK"
  kill -9 $$ 2>/dev/null
) &
WATCHDOG=$!

git pull --rebase --autostash origin master >/dev/null 2>&1 || true

# ── 0. DID WE MISS A NIGHT? ──────────────────────────────────────────────
# Runs after the pull, so it reads what the last successful run actually pushed. This is the CHEAP
# half of the stall problem and explicitly NOT the dead-man switch: it can only speak when a run
# happens, and in the 2026-08-24 stall no run happened for four days — it would have reported the
# gap only once a human had already found it. Its job is to make the RECOVERY run state plainly how
# much was lost, so a silent multi-night gap cannot be mistaken for a quiet week on the board.
missed_nights() {
  local today last="" d gap
  today=$(date +%F)
  for d in $(ls -1 runner/results 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort -r); do
    [ "$d" = "$today" ] && continue
    if compgen -G "runner/results/$d/conv/*.json" >/dev/null; then last="$d"; break; fi
  done
  [ -n "$last" ] || { say "no previous capture on disk — first run, nothing to compare"; return 0; }
  gap=$(( ( $(date -d "$today" +%s 2>/dev/null || echo 0) - $(date -d "$last" +%s 2>/dev/null || echo 0) ) / 86400 ))
  # 1 = yesterday, the normal nightly cadence. 2+ means at least one night produced nothing.
  if [ "$gap" -ge 2 ]; then
    say "MISSED NIGHTS: last capture $last, today $today ($((gap - 1)) night(s) with no data)"
    slack ":red_circle: *Benchmark pipeline missed $((gap - 1)) night(s)* — last capture was *$last*, today is *$today*. This run is the first since then. A gap this size is a stalled or unstarted run, not a slow night; check \`/data/pipeline.log\` and whether the Machine was left STATE=started."
  else
    say "last capture $last — nightly cadence intact"
  fi
}
missed_nights

# ── 1. sourcing (independent: a failure here must not stop capture) ────────────
# BOUNDED, and that is the whole point. "A failure here must not stop capture" used to be enforced
# by `|| say ...`, which catches a non-zero EXIT and nothing else — a HANG is not a failure the
# shell can see. On 2026-08-24 sourcing wedged here (a storefront that never settles: goto() is
# capped at 45s but page.evaluate()/ctx.close() on a stuck renderer are not) and the run never
# reached capture. Cost: FOUR nights of no data, not one.
#
# WHY A HANG IS SO MUCH WORSE THAN A CRASH HERE: this Machine is scheduled with `--schedule daily`,
# and Fly starts a STOPPED machine. A machine still STATE=started has nothing to start, so every
# subsequent night was a silent no-op — the process that was supposed to produce data was also the
# thing holding the schedule slot shut. Stage 2 has had a wall clock since day one (backgrounded,
# PID captured, elapsed polled against CAPTURE_SECONDS); stage 1 simply never got one.
#
# `timeout` is coreutils, so it is present in the image. If it ever were not, the missing binary
# exits 127, which lands on the "sourcing failed (non-fatal)" branch below and capture still runs —
# this guard degrades to skipping sourcing, never to blocking the pipeline.
sweep_sourcing_browsers() {
  # AGENTS.md rule 8 ("never pkill / SIGKILL a capture driver") protects a driver that is MID-
  # CONVERSATION: killing one corrupts the conversation it is timing, and that data is the product.
  # This sweep is a different case and only that case:
  #   - it runs BEFORE capture starts, so there is no in-flight conversation to corrupt;
  #   - it targets headless Chromium only — sourcing verifies storefronts with a headless browser
  #     (source-merchants.mjs: chromium.launch({ headless: true })), while capture drives a HEADED
  #     browser under xvfb, so the patterns below cannot match a capture driver;
  #   - it refuses to run at all if a driver or the balancer is somehow alive anyway (belt and
  #     braces: the rule is load-bearing, so this fails safe rather than trusting the patterns);
  #   - each Fly Machine has its own PID namespace, so it can never reach another machine's run.
  # WHY SWEEP AT ALL: `timeout` signals the node process, not the browsers it spawned, so they are
  # orphaned. Stray Chromium competing for CPU inflates measured p75 latency — the headline metric,
  # and the corruption fly.toml's own [[vm]] sizing note and healthcheck #5 exist to prevent. The
  # incident left one spinning at 30% CPU and one holding 1.4GB RSS for three days.
  if pgrep -f 'node run.js' >/dev/null 2>&1 || pgrep -f 'tools/balance.mjs' >/dev/null 2>&1; then
    say "capture driver alive — NOT sweeping browsers (AGENTS.md rule 8); stray sourcing browsers may inflate latency"
    return 0
  fi
  # `pgrep -c` prints 0 AND exits 1 when nothing matches, so a `|| echo 0` fallback would append a
  # SECOND line and turn the count into "0\n0" — which fails `-eq` and takes the wrong branch.
  # Take the first line, keep only digits, and default an empty result to 0.
  local n; n=$(pgrep -fc 'chrome-headless-shell|headless_shell' 2>/dev/null | head -1 | tr -dc '0-9')
  [ -n "$n" ] || n=0
  if [ "$n" -eq 0 ]; then say "no orphaned sourcing browsers to sweep"; return 0; fi
  pkill    -f 'chrome-headless-shell|headless_shell' 2>/dev/null
  sleep 2
  pkill -9 -f 'chrome-headless-shell|headless_shell' 2>/dev/null
  say "swept ${n} orphaned sourcing browser process(es) before capture"
}

if [ "${SKIP_SOURCING:-0}" != "1" ]; then
  say "--- sourcing merchants (PER_VENDOR=${PER_VENDOR:-2}, timeout ${SOURCING_TIMEOUT}s) ---"
  # -k 30: SIGTERM first so playwright can close its browsers itself, SIGKILL 30s later if it does
  # not. PIPESTATUS[0] because the exit status of the pipeline is tee's, not the node process's.
  timeout -k 30 "$SOURCING_TIMEOUT" node server/source-merchants.mjs 2>&1 | tee -a "$LOG"
  SRC=${PIPESTATUS[0]}
  # 124 = timed out (SIGTERM took), 137 = SIGKILL after -k. Either way it hung.
  if [ "$SRC" -eq 124 ] || [ "$SRC" -eq 137 ]; then
    say "sourcing TIMED OUT after ${SOURCING_TIMEOUT}s — killed (non-fatal), continuing to capture"
    sweep_sourcing_browsers
  elif [ "$SRC" -ne 0 ]; then
    say "sourcing failed (exit $SRC, non-fatal) — continuing to capture"
    # A crash exits before source-merchants.mjs reaches its own browser.close(), so it orphans
    # browsers exactly like a timeout does. Same sweep, same reason.
    sweep_sourcing_browsers
  fi
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
if [ "$PB" -ne 0 ]; then RC="$PB"; else RC="$HC"; fi

# "done", even on a non-zero exit. The dead-man switch measures whether the run FINISHED, which is
# a different question from whether the run was HAPPY — and the second question already has an
# answer: healthcheck.mjs posts every critical to Slack, and publish.sh reports its own verdict.
# Pinging /fail for a healthcheck critical would page twice for one thing that is already covered,
# and a pager that duplicates a channel you already read is a pager you learn to ignore. Reaching
# this line at all is the signal — the failure this switch exists for is the run that never got
# here. DEADMAN_FINISHED stops the exit handler from contradicting it a moment later.
deadman done; DEADMAN_FINISHED=1
exit "$RC"
