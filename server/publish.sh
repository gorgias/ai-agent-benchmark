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
#   5. gen              bake report(-v2).html / takeaways(-v2).html / conv-text.json (90-day window)
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
# Keep the day's work on the volume. Since the "protect main" ruleset (2026-09-16: pull requests and signed
# commits on every branch, no bypass) this machine cannot push, and whatever it does not push is lost: its
# disk is reset to the image on every start. /data survives, so captures and merged scores are archived to
# /data/unpushed/<date> where a PR can pick them up. Bounded by free space so it can never starve the judge.
KEEP="/data/unpushed/$D"
keep() {
  local free; free=$(df -Pm /data 2>/dev/null | awk 'NR==2 {print $4}')
  [ "${free:-0}" -ge 200 ] || { say "not keeping $1 on /data: only ${free:-?} MB free"; return 1; }
  mkdir -p "$KEEP" && tar -czf "$KEEP/$1.tar.gz" "${@:2}" 2>/dev/null
}
# DRY_RUN=1 runs the real judging, baking and gate but touches nothing outside the working tree:
# no commit, no push, no deploy. This is how you test a change to this script without gambling the
# public board on it being correct.
DRY="${DRY_RUN:-0}"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  say "ANTHROPIC_API_KEY not set — cannot judge, so nothing can be published. Captures are safe on disk."
  slack ":large_yellow_circle: *Benchmark publish skipped* — ANTHROPIC_API_KEY missing on the capture box. Conversations are captured and pushed, but the board will stay stale until the key is set (\`fly secrets set ANTHROPIC_API_KEY=…\`)."
  exit 0
fi

# ── publishing under the "protect main" ruleset ───────────────────────────────
# Since 2026-09-16 the repo rules require a pull request and verified signatures on every branch, so
# this machine can no longer push to master, and cannot even add a second commit to a branch it just
# created. What it still can do: create ONE branch of signed commits and merge it through the API,
# where GitHub signs the squash commit itself. GIT_SIGNING_KEY is an SSH private key whose public
# half is registered as a signing key on the GitHub account behind GIT_TOKEN; without it the push is
# rejected and the night's work only survives in /data/unpushed.
# owner/name for the GitHub API. pipeline.sh points origin at https://x-access-token:<token>@github.com/…,
# so strip any credentials too (2026-09-28: the unstripped URL made the PR call hit a non-existent repo,
# and the night's data reached the site but not master). GIT_REPO, when set, wins.
REPO_SLUG="${REPO_SLUG:-${GIT_REPO:-$(git remote get-url origin 2>/dev/null | sed -E 's#^(git@github\.com:|https://([^@/]*@)?github\.com/)##; s#\.git$##')}}"

setup_signing() {
  [ -n "${GIT_SIGNING_KEY:-}" ] || return 1
  local f=/tmp/git-signing-key
  printf '%s\n' "$GIT_SIGNING_KEY" > "$f" && chmod 600 "$f" || return 1
  git config gpg.format ssh
  git config user.signingkey "$f"
  git config commit.gpgsign true
  # A signature only verifies when the commit's email is a verified address on the account that
  # registered the key, so the bot identity gives way to that address.
  git config user.email "${GIT_AUTHOR_EMAIL:-max.pruvost@gorgias.com}"
  git config user.name "${GIT_AUTHOR_NAME:-benchmark capture}"
}

gh_api() {                                   # gh_api <method> <path> [json body]
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$1" -H "Authorization: Bearer ${GIT_TOKEN:-}" -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$REPO_SLUG$2" -d "$body"
  else
    curl -sS -X "$1" -H "Authorization: Bearer ${GIT_TOKEN:-}" -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$REPO_SLUG$2"
  fi
}
json_field() {                               # json_field <key>  (reads stdin)
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch(e){process.stdout.write("")}})' "$1"
}

# A night that does not reach master is not a log line, it is an outage: from 2026-09-29 to 2026-10-04
# every run captured, judged and baked, pushed its pipeline/* branch, then got a 403 opening the pull
# request (the fine-grained GIT_TOKEN lacked "Pull requests: write"). The failure was only ever said()
# into /data/pipeline.log and the API's reason was thrown away by json_field, so six nights went
# unnoticed. Every way publish_head can fail now ends here: it names GitHub's own reason and pages.
api_reason() {                               # api_reason <response body> — GitHub's own explanation
  local m; m=$(printf '%s' "$1" | json_field message)
  printf '%s' "${m:-no response from the GitHub API (network, DNS or timeout)}"
}
publish_fail() {                             # publish_fail <reason> [branch]
  local why="${1%.}"                         # GitHub's messages often end in a period already
  say "nothing reached master — $why"
  slack ":red_circle: *Benchmark run NOT on GitHub* — $why.
The board may still deploy, but master did not move: the next run starts from the old master, and this night exists only ${2:+on \`$2\` and }in \`/data/unpushed\` until someone lands it."
  return 1
}

# Put HEAD on master: straight if the rules ever allow it again, otherwise through a fresh branch and
# a pull request merged by the API. Returns non-zero when master did not move.
publish_head() {                             # publish_head <commit/PR title>
  if git push origin HEAD:master >/dev/null 2>&1; then say "pushed to master"; return 0; fi
  [ -n "${GIT_TOKEN:-}" ] || { publish_fail "push to master rejected and GIT_TOKEN is missing"; return 1; }
  local br pr merged body base resp
  # The capture loop commits a checkpoint every 10 minutes and sourcing commits its additions, both
  # before signing is set up here, so the local history is full of unsigned commits. The signature
  # rule checks every commit pushed, so fold everything since origin/master into ONE signed commit.
  # The run rebased onto origin/master at its last pull, so the fold holds exactly the night's work.
  git fetch -q origin master >/dev/null 2>&1
  base=$(git merge-base HEAD origin/master 2>/dev/null)
  if [ -n "$base" ] && [ "$(git rev-list --count "$base"..HEAD 2>/dev/null)" -gt 1 ]; then
    git reset -q --soft "$base" && git commit -q -m "$1" \
      || { publish_fail "could not fold the night's commits into one signed commit"; return 1; }
    say "folded the night's commits into one signed commit"
  fi
  br="pipeline/$D-$(date -u +%H%M%S)"
  if ! git push origin "HEAD:refs/heads/$br" >/dev/null 2>&1; then
    publish_fail "push rejected on master and on $br — are the commits signed? (GIT_SIGNING_KEY)"
    return 1
  fi
  body=$(node -e 'process.stdout.write(JSON.stringify({title:"chore: "+process.argv[1].replace(/^./,(c)=>c.toLowerCase()),head:process.argv[2],base:"master",body:"Automated publish from the nightly capture machine. Repository rules block direct pushes, so the run publishes through this pull request."}))' "$1" "$br")
  resp=$(gh_api POST /pulls "$body")
  pr=$(printf '%s' "$resp" | json_field number)
  [ -n "$pr" ] || { publish_fail "branch pushed but the pull request could not be opened on ${REPO_SLUG%%@*}: $(api_reason "$resp")" "$br"; return 1; }
  body=$(node -e 'process.stdout.write(JSON.stringify({merge_method:"squash",commit_title:process.argv[1]+" (#"+process.argv[2]+")"}))' "$1" "$pr")
  resp=$(gh_api PUT "/pulls/$pr/merge" "$body")
  merged=$(printf '%s' "$resp" | json_field merged)
  [ "$merged" = "true" ] && { say "published through pull request #$pr ($br)"; return 0; }
  publish_fail "pull request #$pr is open but the merge did not go through: $(api_reason "$resp")" "$br"
  return 1
}

say "===== PUBLISH START ($D) ====="
git pull --rebase --autostash origin master >/dev/null 2>&1 || true
setup_signing && say "commits will be signed (publishing goes through a pull request)" \
  || say "GIT_SIGNING_KEY not set — commits are unsigned and the repo rules will reject them"
mkdir -p "$EB" || { say "cannot create $EB"; exit 1; }
keep captures "runner/results/$D/conv" && say "kept $(ls "runner/results/$D/conv" 2>/dev/null | wc -l | tr -d ' ') capture file(s) in $KEEP/captures.tar.gz"

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
keep scores runner/eval-scores.json runner/conversation-quarantine.json && say "kept the merged scores in $KEEP/scores.tar.gz"

if [ "$GATE_RC" -ne 0 ]; then
  say "QUALITY GATE FAILED — keeping the judging work, discarding the baked board, NOT deploying"
  # Scores cost real money to produce, so never throw them away. The baked artifacts, however, did
  # not pass the gate and must not enter the repo where a later run could push them.
  git checkout -- report.html report-archive.html takeaways.html takeaways-archive.html brand/howto.html conv-text.json 2>/dev/null
  git add runner/eval-scores.json runner/conversation-quarantine.json runner/driver-triage.json 2>/dev/null
  git commit -q -m "Judging $D — scores merged (board NOT published: quality gate failed)" 2>/dev/null \
    && publish_head "Judging $D — scores merged (board NOT published: quality gate failed)"
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
  git checkout -- report.html report-archive.html takeaways.html takeaways-archive.html brand/howto.html conv-text.json 2>/dev/null
  git add runner/eval-scores.json runner/conversation-quarantine.json 2>/dev/null
  git commit -q -m "Judging $D — scores merged (board NOT published: data-integrity block)" 2>/dev/null \
    && publish_head "Judging $D — scores merged (board NOT published: data-integrity block)"
  slack ":no_entry: *Benchmark board NOT published — the run's data is known-bad*
$REASONS
The gate passed, but publishing was blocked because these numbers would be wrong on the board. Live site unchanged."
  exit 1
fi

# ── 7. commit + push the board ────────────────────────────────────────────────
git add report.html report-archive.html takeaways.html takeaways-archive.html brand/howto.html conv-text.json board.json \
        runner/eval-scores.json runner/conversation-quarantine.json runner/driver-triage.json \
        "runner/results/$D/conv" 2>/dev/null
if git diff --cached --quiet; then
  say "nothing changed since the last publish — skipping deploy"
  exit 0
fi
SCORED=$(node -e 'process.stdout.write(String(Object.keys(require("./runner/eval-scores.json")).length))' 2>/dev/null || echo "?")
git commit -q -m "Daily board $D — judged + baked ($SCORED scored conversations)" 2>/dev/null
# A board that deploys without reaching master is still a failed run: the deploy goes ahead (the board
# is the deliverable), but every later exit reports non-zero so pipeline.sh logs "publish 1" instead of 0.
OFF_MASTER=0
publish_head "Daily board $D — judged + baked ($SCORED scored conversations)" \
  || { OFF_MASTER=1; say "deploying anyway — the board is the deliverable, and /data/unpushed keeps the work"; }

# ── 8. deploy ─────────────────────────────────────────────────────────────────
# On the server the token is the only way in. On a laptop the CLI is usually already logged in, and
# demanding a token there would make this script untestable outside the container — which is how
# deploy bugs reach production in the first place.
# The Vercel project moved from the personal maxpruvost-4441s-projects scope to the gorgias4 team on 2026-09-14.
# The project id is unchanged but the team id is new. A machine built before the move still has the old team id
# in its env, and `vercel deploy` then fails with "Project not found", so map it until the machine env is updated.
[ "${VERCEL_ORG_ID:-}" = "team_vYmSPwekFJOPhVoUuAGAMPGK" ] && export VERCEL_ORG_ID=team_gyas2ZRdwH5DtZtxarGNoQ2S
USE_TOKEN=0
if [ -n "${VERCEL_TOKEN:-}" ]; then
  USE_TOKEN=1
elif vercel whoami >/dev/null 2>&1; then
  say "no VERCEL_TOKEN, but the local Vercel CLI is authenticated — using that session"
else
  say "VERCEL_TOKEN not set and the Vercel CLI is not logged in — board is baked and pushed but NOT deployed."
  slack ":large_yellow_circle: *Benchmark board baked but not deployed* — \`VERCEL_TOKEN\` is missing on the capture box, so the live site still shows older data. Set it with \`fly secrets set VERCEL_TOKEN=…\`."
  exit "$OFF_MASTER"
fi
say "--- deploying to Vercel ---"
# Prefer the CLI baked into the image. Falling back to npx would work, but it puts an npm download
# on the critical path of an unattended 2am job — one registry hiccup and the board silently
# doesn't ship.
# A `.vercel/` directory is a project link the CLI prefers over VERCEL_ORG_ID/VERCEL_PROJECT_ID.
# It is gitignored precisely so this box links by env var, but a directory left behind by an
# earlier deploy survives on the volume and still names the OLD team. After the 2026-09-14 move to
# gorgias4 the CLI resolves that stale link to a project this token cannot see and fails with
# "Could not retrieve Project Settings" — which is what broke the 2026-09-15 nightly.
# Removed ONLY when it disagrees with the env, so a correctly linked laptop checkout is untouched.
if [ -f .vercel/project.json ] && [ -n "${VERCEL_ORG_ID:-}" ]; then
  LINKED_ORG=$(node -e 'try{process.stdout.write(require("./.vercel/project.json").orgId||"")}catch(e){}' 2>/dev/null)
  if [ -n "$LINKED_ORG" ] && [ "$LINKED_ORG" != "$VERCEL_ORG_ID" ]; then
    say "stale .vercel link (orgId $LINKED_ORG, env $VERCEL_ORG_ID) — removing so the env vars win"
    rm -rf .vercel
  fi
fi
if command -v vercel >/dev/null 2>&1; then VC="vercel"; else VC="npx --yes vercel@${VERCEL_CLI_VERSION:-53}"; say "vercel CLI not in image — falling back to npx"; fi
# Written as two plain invocations rather than an argument array on purpose: bash 3.2 (the macOS
# default) errors on an empty array under `set -u`, which would make this script impossible to test
# outside the container — and an untestable deploy path is how deploy bugs reach production.
# Capture the WHOLE output and search all of it for the URL. Tailing first and grepping the tail
# looks equivalent and is not: the CLI prints a JSON footer after the deployment URL, so a tail-5
# contains no URL at all and a successful deploy reads as a failure.
if [ "$USE_TOKEN" = "1" ]; then
  DEPLOY=$($VC deploy --prod --yes --token "$VERCEL_TOKEN" 2>&1)
else
  DEPLOY=$($VC deploy --prod --yes 2>&1)
fi
say "$(echo "$DEPLOY" | grep -E 'Production:|Aliased:|error|Error' | head -4)"
if ! echo "$DEPLOY" | grep -qE '"readyState": *"READY"|Aliased: *https://'; then
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
  exit "$OFF_MASTER"
elif [ "$VRC" -eq 2 ]; then
  say "deployed, but could not verify (no SITE_PASSWORD) — reporting as UNVERIFIED, not as success"
  slack ":large_yellow_circle: *Benchmark board deployed — $D (unverified)*
$VALID_TODAY new valid conversations · $SCORED scored. The deploy succeeded but the live page could not be read back because \`SITE_PASSWORD\` is not set on the capture box, so I cannot prove the site is serving the new data. Set it with \`fly secrets set SITE_PASSWORD=…\`."
  exit "$OFF_MASTER"
else
  say "deployed but live != local — the site is NOT serving what we baked"
  slack ":red_circle: *Benchmark deploy did not take effect — $D*
The board passed the gate and \`vercel deploy\` succeeded, but the live pages do not match what was baked locally. Someone should check the Vercel dashboard for a failed or superseded build.
\`\`\`$(echo "$VOUT" | tail -4)\`\`\`"
  exit 1
fi
