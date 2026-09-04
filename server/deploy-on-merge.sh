#!/bin/bash
# server/deploy-on-merge.sh — deploy the CURRENT master to Vercel, without judging.
#
# WHY THIS EXISTS. The live site only updated when the nightly pipeline published (judge → bake →
# gate → deploy), so a merged PR — even a presentation-only one — sat invisible for up to a day.
# This script closes that gap: it re-bakes the board from the repo's own committed data (results +
# eval-scores are committed by capture and publish), runs the SAME quality gate publish.sh runs,
# and deploys only if the bake differs from what master already ships. It never judges, never
# captures, never pushes to git — it is a pure deploy of what already passed review.
#
#   bash server/deploy-on-merge.sh          # from the repo root, on the capture box
#
# Runs on the Fly machine (it has VERCEL_TOKEN, the vercel CLI, and the repo checkout). It is
# invoked by the post-merge poller in pipeline.sh (DEPLOY_ON_MERGE=1) or by hand.
#
# SAFETY vs the nightly publish:
#   - The gate (verify-data.js) runs on the re-baked board. A PR that breaks the bake fails here
#     and nothing deploys — the live site keeps the last good board.
#   - If the re-bake is byte-identical to what master already ships (a docs/runner-only change),
#     the deploy is skipped: no churn, no cost, no alias flip.
#   - It does NOT push to git. The nightly publish remains the only writer of baked artifacts.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
LOG="${CAPTURE_LOG:-/data/pipeline.log}"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || LOG=/tmp/pipeline.log
touch "$LOG" 2>/dev/null || LOG=/tmp/pipeline.log
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [deploy-on-merge] $*" | tee -a "$LOG"; }

slack() {
  [ -n "${SLACK_WEBHOOK_URL:-}" ] || return 0
  curl -s -X POST -H 'content-type: application/json' \
    --data "$(node -e 'process.stdout.write(JSON.stringify({text:process.argv[1],mrkdwn:true}))' "$1")" \
    "$SLACK_WEBHOOK_URL" >/dev/null 2>&1
}

# ── 0. preconditions ──────────────────────────────────────────────────────────
if [ -z "${VERCEL_TOKEN:-}" ]; then
  say "VERCEL_TOKEN not set — cannot deploy. (Set it with: fly secrets set VERCEL_TOKEN=…)"
  exit 0
fi

say "===== DEPLOY-ON-MERGE START ====="
git pull --rebase --autostash origin master >/dev/null 2>&1 || true

# ── 1. re-bake from committed data ────────────────────────────────────────────
# gen.js reads runner/results/<date>/conv/*.json + runner/eval-scores.json — both committed to
# master by capture/publish. So a fresh bake reproduces the board the nightly pipeline would,
# minus conversations that are captured-but-not-yet-judged (those land on the nightly run).
say "--- baking from committed data (gen.js) ---"
cd runner || exit 1
node gen.js 2>&1 | tail -15 | tee -a "$LOG"
GRC=${PIPESTATUS[0]}
if [ "$GRC" -ne 0 ]; then
  say "gen.js FAILED ($GRC) — nothing deployed; live site unchanged"
  slack ":red_circle: *Deploy-on-merge failed* — \`gen.js\` errored re-baking master. Live site unchanged (nightly publish will retry)."
  exit 1
fi

# ── 2. THE GATE — same invariant checks the nightly publish runs ─────────────
say "--- quality gate (verify-data.js) ---"
GATE_OUT=$(node verify-data.js 2>&1); GATE_RC=$?
echo "$GATE_OUT" | tail -20 | tee -a "$LOG"
if [ "$GATE_RC" -ne 0 ]; then
  say "GATE FAILED ($GATE_RC) — NOT deploying. Live site keeps the last good board."
  slack ":red_circle: *Deploy-on-merge blocked by the quality gate* — master's committed data fails verify-data.js. Live site unchanged.
\`\`\`$(echo "$GATE_OUT" | grep -E '✗' | head -6)\`\`\`"
  exit 1
fi
say "gate PASSED"
cd ..

# ── 3. skip the deploy when the bake is identical to what master already ships ─
# A PR that only touches docs/runner code produces the same bytes; deploying anyway would flip
# the alias for nothing. Compare the working tree against the last commit that touched the
# baked files: if the checkout is clean and HEAD already contains these bytes, skip.
if git diff --quiet HEAD -- report.html takeaways.html conv-text.json 2>/dev/null; then
  say "baked files unchanged vs HEAD — nothing to deploy"
  exit 0
fi

# ── 4. deploy ─────────────────────────────────────────────────────────────────
say "--- deploying to Vercel ---"
if command -v vercel >/dev/null 2>&1; then VC="vercel"; else VC="npx --yes vercel@53"; fi
DEPLOY=$($VC deploy --prod --yes --token "$VERCEL_TOKEN" 2>&1)
say "$(echo "$DEPLOY" | grep -E 'Production:|Aliased:|error|Error' | head -4)"
if ! echo "$DEPLOY" | grep -qE '"readyState": *"READY"|Aliased: *https://'; then
  say "deploy produced no URL — treating as failed"
  slack ":red_circle: *Deploy-on-merge failed* — \`vercel deploy\` returned no URL. Live site unchanged."
  exit 1
fi

# ── 5. prove it ───────────────────────────────────────────────────────────────
say "--- verifying live == local ---"
VOUT=$(SITE_PASSWORD="${SITE_PASSWORD:-}" node server/verify-live.mjs 2>&1); VRC=$?
echo "$VOUT" | tee -a "$LOG"
if [ "$VRC" -eq 0 ]; then
  say "===== DEPLOY-ON-MERGE DONE — live board matches master ====="
  slack ":white_check_mark: *Deploy-on-merge shipped* — master deployed and verified live == local."
elif [ "$VRC" -eq 2 ]; then
  say "deployed, but could not verify (no SITE_PASSWORD) — reporting as UNVERIFIED"
  slack ":large_yellow_circle: *Deploy-on-merge deployed (unverified)* — SITE_PASSWORD missing, could not read the live page back."
else
  say "deployed but live != local — flagging"
  slack ":red_circle: *Deploy-on-merge deployed but NOT verified* — live page differs from the local bake. Check the Vercel dashboard."
  exit 1
fi
