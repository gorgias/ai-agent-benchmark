#!/bin/bash
# server/publish.sh — judge → merge → bake → GATE → push → deploy → prove it went live.
#
# This is the half of the loop that was previously a human sitting in a Claude Code session. It runs
# after capture, in the same wake-up, and it is the only thing in the stack allowed to change the
# public board.
#
#   1. eval-pack        pack unjudged valid conversations into blind batches
#   2. judge-api        score them via the Anthropic API (rubric v2.3, evidence verified in code)
#   3. eval-merge       fold scores in, deriving totals from the check booleans
#   4. integrity-check  quarantine misread captures
#   5. gen              bake report.html / takeaways.html / conv-text.json (90-day window)
#   6. verify-data      HARD GATE — below 90% judge coverage or any impossible stat, nothing ships
#   7. healthcheck verdict — refuse to publish numbers we already know are wrong
#   8. commit + push, deploy to Vercel, verify live == local
#
# WHAT PROTECTS THE BOARD. The old split kept publishing on a laptop so a bad capture could never
# reach production. Automating it removes that separation, so the protection has to be explicit and
# in-band instead:
#   - verify-data.js is a hard gate and runs BEFORE any deploy. It exits non-zero on coverage
#     collapse or impossible stats, and this script exits with it.
#   - the healthcheck verdict blocks the deploy when the run's own data is known-corrupt (latency
#     inflated across vendors = our box, not the vendors; provider mismatch = scores on the wrong
#     vendor). A stale board is a much cheaper failure than a wrong one.
#   - a failed gate still commits the judging work (scores are expensive) but reverts the baked
#     artifacts, so the repo never carries a board that didn't pass.
#   - nothing here ever edits a score. Judging is the only thing that writes scores, and it is blind.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
LOG="${CAPTURE_LOG:-/data/pipeline.log}"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || LOG=/tmp/pipeline.log
touch "$LOG" 2>/dev/null || LOG=/tmp/pipeline.log
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [publish] $*" | tee -a "$LOG"; }

slack() {
  [ -n "${SLACK_WEBHOOK_URL:-}" ] || return 0
  curl -s -X POST -H 'content-type: application/json' \
    --data "$(node -e 'process.stdout.write(JSON.stringify({text:process.argv[1],mrkdwn:true}))' "$1")" \
    "$SLACK_WEBHOOK_URL" >/dev/null 2>&1
}

D="${RUN_DATE:-$(date +%F)}"
EB="${EVAL_BATCH_DIR:-/data/eb}/$D"     # fresh dir per day: stale scored-*.json must never re-merge
# DRY_RUN=1 runs the real judging, baking and gate but touches nothing outside the working tree:
# no commit, no push, no deploy. This is how you test a change to this script without gambling the
# public board on it being correct.
DRY="${DRY_RUN:-0}"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  say "ANTHROPIC_API_KEY not set — cannot judge, so nothing can be published. Captures are safe on disk."
  slack ":large_yellow_circle: *Benchmark publish skipped* — ANTHROPIC_API_KEY missing on the capture box. Conversations are captured and pushed, but the board will stay stale until the key is set (\`fly secrets set ANTHROPIC_API_KEY=…\`)."
  exit 0
fi

say "===== PUBLISH START ($D) ====="
git pull --rebase --autostash origin master >/dev/null 2>&1 || true
mkdir -p "$EB" || { say "cannot create $EB"; exit 1; }

# ── 1. pack ───────────────────────────────────────────────────────────────────
cd runner || exit 1
PACK=$(node eval-pack.js "$EB" "${BATCH_SIZE:-12}" 2>&1); say "$PACK"
if ! compgen -G "$EB/batch-*.json" >/dev/null; then
  say "nothing to judge — every valid conversation is already scored"
  # Not an error and not a no-op worth alerting on: capture may simply have added nothing new.
  # Still fall through to bake+deploy, because a previous run may have been blocked mid-way.
fi

# ── 2. judge ──────────────────────────────────────────────────────────────────
if compgen -G "$EB/batch-*.json" >/dev/null; then
  say "--- judging (model ${JUDGE_MODEL:-claude-opus-4-8}, max ${JUDGE_MAX:-unlimited}) ---"
  node judge-api.mjs "$EB" 2>&1 | tee -a "$LOG"
  JRC=${PIPESTATUS[0]}
  [ "$JRC" -ne 0 ] && say "judge exited $JRC — continuing with whatever scored cleanly (unjudged convs stay queued)"
fi

# ── 3. merge + integrity ──────────────────────────────────────────────────────
if compgen -G "$EB/scored-*.json" >/dev/null; then
  node eval-merge.js "$EB" 2>&1 | tee -a "$LOG"
else
  say "no scored-*.json produced this run"
fi
node integrity-check.js --quarantine 2>&1 | tail -20 | tee -a "$LOG"
node boilerplate-audit.mjs 2>&1 | tail -12 | tee -a "$LOG" || true

# ── 4. bake ───────────────────────────────────────────────────────────────────
say "--- baking (gen.js) ---"
node gen.js 2>&1 | tail -25 | tee -a "$LOG"
GRC=${PIPESTATUS[0]}
if [ "$GRC" -ne 0 ]; then
  say "gen.js FAILED ($GRC) — nothing baked, nothing deployed"
  slack ":red_circle: *Benchmark publish failed* — \`gen.js\` errored while baking the board. Nothing was deployed; the live site still shows the previous data."
  exit 1
fi

# ── 5. THE GATE ───────────────────────────────────────────────────────────────
say "--- quality gate (verify-data.js) ---"
GATE_OUT=$(node verify-data.js 2>&1); GATE_RC=$?
echo "$GATE_OUT" | tail -30 | tee -a "$LOG"
cd ..

if [ "$GATE_RC" -ne 0 ]; then
  say "QUALITY GATE FAILED — keeping the judging work, discarding the baked board, NOT deploying"
  # Scores cost real money to produce, so never throw them away. The baked artifacts, however, did
  # not pass the gate and must not enter the repo where a later run could push them.
  git checkout -- report.html takeaways.html conv-text.json 2>/dev/null
  git add runner/eval-scores.json runner/conversation-quarantine.json runner/driver-triage.json 2>/dev/null
  git commit -q -m "Judging $D — scores merged (board NOT published: quality gate failed)" 2>/dev/null \
    && git push origin HEAD:master >/dev/null 2>&1 && say "pushed scores only"
  slack ":red_circle: *Benchmark board NOT published — quality gate failed*
\`\`\`$(echo "$GATE_OUT" | grep -E '✗' | head -6)\`\`\`
Scores were merged and pushed; the live board still shows the previous, passing data."
  exit 1
fi
say "gate PASSED"

if [ "$DRY" = "1" ]; then
  say "DRY_RUN=1 — stopping before commit/push/deploy. The board was baked locally and passed the gate."
  cd runner && node scoreboard-preview.js --window-days 90 2>&1 | head -30 | tee -a "$LOG"; cd ..
  exit 0
fi

# ── 6. healthcheck verdict — refuse to publish data we know is wrong ──────────
V=server/.healthcheck-verdict.json
if [ -f "$V" ] && [ "$(node -e 'const v=require("./'"$V"'");process.stdout.write(String(v.block_publish===true&&v.run_date==="'"$D"'"))' 2>/dev/null)" = "true" ]; then
  REASONS=$(node -e 'const v=require("./'"$V"'");process.stdout.write((v.reasons||[]).join(" | "))' 2>/dev/null)
  say "healthcheck blocks publishing: $REASONS"
  git checkout -- report.html takeaways.html conv-text.json 2>/dev/null
  git add runner/eval-scores.json runner/conversation-quarantine.json 2>/dev/null
  git commit -q -m "Judging $D — scores merged (board NOT published: data-integrity block)" 2>/dev/null \
    && git push origin HEAD:master >/dev/null 2>&1
  slack ":no_entry: *Benchmark board NOT published — the run's data is known-bad*
$REASONS
The gate passed, but publishing was blocked because these numbers would be wrong on the board. Live site unchanged."
  exit 1
fi

# ── 7. commit + push the board ────────────────────────────────────────────────
git add report.html takeaways.html conv-text.json \
        runner/eval-scores.json runner/conversation-quarantine.json runner/driver-triage.json \
        "runner/results/$D/conv" 2>/dev/null
if git diff --cached --quiet; then
  say "nothing changed since the last publish — skipping deploy"
  exit 0
fi
SCORED=$(node -e 'process.stdout.write(String(Object.keys(require("./runner/eval-scores.json")).length))' 2>/dev/null || echo "?")
git commit -q -m "Daily board $D — judged + baked ($SCORED scored conversations)" 2>/dev/null
git push origin HEAD:master >/dev/null 2>&1 && say "pushed board to master" || say "push failed — deploying anyway (the board is the deliverable)"

# ── 8. deploy ─────────────────────────────────────────────────────────────────
# On the server the token is the only way in. On a laptop the CLI is usually already logged in, and
# demanding a token there would make this script untestable outside the container — which is how
# deploy bugs reach production in the first place.
TOKEN_ARG=()
if [ -n "${VERCEL_TOKEN:-}" ]; then
  TOKEN_ARG=(--token "$VERCEL_TOKEN")
elif vercel whoami >/dev/null 2>&1; then
  say "no VERCEL_TOKEN, but the local Vercel CLI is authenticated — using that session"
else
  say "VERCEL_TOKEN not set and the Vercel CLI is not logged in — board is baked and pushed but NOT deployed."
  slack ":large_yellow_circle: *Benchmark board baked but not deployed* — \`VERCEL_TOKEN\` is missing on the capture box, so the live site still shows older data. Set it with \`fly secrets set VERCEL_TOKEN=…\`."
  exit 0
fi
say "--- deploying to Vercel ---"
# Prefer the CLI baked into the image. Falling back to npx would work, but it puts an npm download
# on the critical path of an unattended 2am job — one registry hiccup and the board silently
# doesn't ship.
if command -v vercel >/dev/null 2>&1; then VC=(vercel); else VC=(npx --yes "vercel@${VERCEL_CLI_VERSION:-53}"); say "vercel CLI not in image — falling back to npx"; fi
DEPLOY=$("${VC[@]}" deploy --prod --yes "${TOKEN_ARG[@]}" 2>&1 | tail -5)
say "$DEPLOY"
if ! echo "$DEPLOY" | grep -qE 'https://'; then
  say "deploy produced no URL — treating as failed"
  slack ":red_circle: *Benchmark deploy failed* — the board passed the gate and is pushed to master, but \`vercel deploy\` did not return a URL. Live site unchanged.
\`\`\`$(echo "$DEPLOY" | tail -3)\`\`\`"
  exit 1
fi

# ── 9. prove it ───────────────────────────────────────────────────────────────
# Vercel returns before the alias is fully warm; retry rather than fail on a race.
say "--- verifying live == local ---"
for i in 1 2 3 4 5; do
  VOUT=$(node server/verify-live.mjs 2>&1); VRC=$?
  [ "$VRC" -eq 0 ] && break
  [ "$VRC" -eq 2 ] && break                      # cannot verify (no SITE_PASSWORD) — don't retry
  say "verify attempt $i failed, retrying in 20s"; sleep 20
done
echo "$VOUT" | tee -a "$LOG"

VALID_TODAY=$(node -e 'const fs=require("fs"),d="runner/results/'"$D"'/conv";let n=0;try{for(const f of fs.readdirSync(d)){const j=JSON.parse(fs.readFileSync(d+"/"+f,"utf8"));if((j.turns||[]).some(t=>t.by==="ai"&&(t.complete_ms||t.ai_latency_ms)))n++}}catch{};process.stdout.write(String(n))' 2>/dev/null || echo "?")

if [ "$VRC" -eq 0 ]; then
  say "===== PUBLISH DONE — live board updated ====="
  slack ":white_check_mark: *Benchmark board updated — $D*
$VALID_TODAY new valid conversations captured · $SCORED scored conversations on the board
Gate passed, deployed, and verified live == local. <https://gorgias-ai-benchmark.vercel.app/report|Open the board>"
  exit 0
elif [ "$VRC" -eq 2 ]; then
  say "deployed, but could not verify (no SITE_PASSWORD) — reporting as UNVERIFIED, not as success"
  slack ":large_yellow_circle: *Benchmark board deployed — $D (unverified)*
$VALID_TODAY new valid conversations · $SCORED scored. The deploy succeeded but the live page could not be read back because \`SITE_PASSWORD\` is not set on the capture box, so I cannot prove the site is serving the new data. Set it with \`fly secrets set SITE_PASSWORD=…\`."
  exit 0
else
  say "deployed but live != local — the site is NOT serving what we baked"
  slack ":red_circle: *Benchmark deploy did not take effect — $D*
The board passed the gate and \`vercel deploy\` succeeded, but the live pages do not match what was baked locally. Someone should check the Vercel dashboard for a failed or superseded build.
\`\`\`$(echo "$VOUT" | tail -4)\`\`\`"
  exit 1
fi
