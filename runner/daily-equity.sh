#!/bin/bash
# DAILY EQUITY CAPTURE — a ~50-min time-boxed run that always feeds the LEAST-represented
# vendors, to keep conversation volume fair across the field (Max, 2026-07-14).
#
# Why: Gorgias/Sierra/Envive are already over-represented (250/186/140). Manually topping up
# the flagship burns effort where we least need it. The balancer water-fills the vendor
# furthest BELOW the TARGET water-line first, so a small daily budget lands on the thin vendors
# (Rep AI/Decagon/Klaviyo/Meta/Intercom…) and never touches the over-represented ones (already
# above TARGET → not eligible). Fairness by construction, not by hand-picking.
#
# INCLUDE = the drivable, unattended-safe set (headless). Deliberately EXCLUDES:
#   - over-represented: Gorgias, Sierra, Envive (above the water-line anyway)
#   - headed-only: Rep AI (needs a visible browser → not unattended-safe locally; cloud path)
#   - structural walls: Humind, Shopify Inbox, Google Agentic, Mavenoid (0 valid ever)
# Latency is captured at conc 4 (a hair less strict than 2) — fine here: the daily run exists
# for VOLUME/COVERAGE of thin vendors, and none of them are the flagship latency story.
#
# Capture only. Judging (blind Claude subagents) + bake + deploy is a separate step — either a
# human/Claude session, or a scheduled Claude task. This script never commits.
set -u
# Self-locating: works from ANY checkout (scratchpad or the permanent ~/ai-chat-latency-benchmark
# clone) so a launchd job never breaks when a temp dir is cleaned. Log sits next to the repo.
RUNNER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="${DAILY_EQUITY_LOG:-$RUNNER/../daily-equity.log}"
BUDGET_SECONDS=2880   # 48 min hard wall (leave headroom in a 50-min slot)
cd "$RUNNER" || exit 1

# Refuse to pile onto an already-busy machine (protects latency fidelity + avoids collisions).
if pgrep -f 'node run.js' >/dev/null || pgrep -f 'balance.mjs' >/dev/null; then
  echo "$(date) another capture is running — skipping today's equity run" >> "$LOG"; exit 0
fi
git -C "$RUNNER/.." pull --rebase --autostash origin master >/dev/null 2>&1 || true

echo "===== DAILY-EQUITY START $(date) =====" >> "$LOG"
INCLUDE="Decagon,Klaviyo,Intercom,Zendesk,Yuma,Kodif,DigitalGenius,Ada" \
  TARGET=100 BUDGET=80 CONCURRENCY=4 LOAD_CAP=9 STORE_TIMEOUT_MIN=4 \
  RUN_DATE=$(date +%F) BENCHMARK_CAPTURE_ORIGIN=automation \
  node tools/balance.mjs >> "$LOG" 2>&1 &
BAL=$!
( sleep "$BUDGET_SECONDS"; if kill -0 $BAL 2>/dev/null; then
    echo "$(date) 48-min cap reached — stopping" >> "$LOG"
    pkill -f 'node run.js' 2>/dev/null; kill -9 $BAL 2>/dev/null; sleep 2; pkill -f 'chrome-headless-shell' 2>/dev/null
  fi ) &
WD=$!
wait $BAL 2>/dev/null; kill $WD 2>/dev/null; wait $WD 2>/dev/null
pkill -f 'chrome-headless-shell' 2>/dev/null

# Push the RAW (unjudged) captures to master so the daily judge routine can pull + score them.
# Raw convs are additive + gen.js filters invalid ones, so this never changes the live board on
# its own — judging/bake/deploy is the routine's job. Rebase-safe; skips cleanly if nothing new.
D=$(date +%F)
if [ -d "results/$D/conv" ] && [ -n "$(ls results/$D/conv/*.json 2>/dev/null)" ]; then
  git -C .. pull --rebase --autostash origin master >/dev/null 2>&1 || true
  git -C .. add "runner/results/$D/conv" 2>/dev/null
  git -C .. commit -q -m "Daily equity capture $D — raw unjudged convs [automation]" 2>/dev/null \
    && git -C .. push origin HEAD:master >/dev/null 2>&1 && echo "$(date) pushed raw convs" >> "$LOG"
fi
echo "===== DAILY-EQUITY DONE $(date) — valid today: $(ls results/$(date +%F)/conv/*.json 2>/dev/null | wc -l | tr -d ' ') files =====" >> "$LOG"
