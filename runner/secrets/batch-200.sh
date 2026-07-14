#!/bin/bash
# batch-200.sh — 170 non-Amazon conversations of the 200-conv batch (Rufus-30 runs separately).
# Allocation equalizes per-vendor totals; low-vol vendors capped at their known-working sites.
# HARD RULE: conversations are written to results/$RUN_DATE/conv/ and are NEVER moved,
# renamed away, or archived — valid AND invalid stay in place (gen.js filters invalids).
set -u
export RUN_DATE="${RUN_DATE:-2026-07-08}"
export BENCHMARK_CAPTURE_ORIGIN=claude
cd "$(dirname "$0")/.." || exit 1
mkdir -p "results/$RUN_DATE/conv"
LOG=/tmp/batch-200.log
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

say "=== BATCH-200 start (RUN_DATE=$RUN_DATE) ==="

# P1 — both lanes, headless, 13 stores x 2 modes x 5 themes = 130 convs
say "P1: 13 stores, both lanes (130 convs)"
node run.js --store siena-mudwtr yuma-atma yuma-tumble spiffy-supergoop envive-tushbaby \
  dg-organicbasics dg-abbottlyon dg-blakely meta-butcherbox meta-dermalogica meta-grove \
  klaviyo-nanuk klaviyo-naked --themes 5 --concurrency 3 || say "P1 exited nonzero (continuing)"

# P2 — shopping only, headless, 3 stores x 5 = 15 convs
say "P2: yuma-tediber envive-nanit decagon-oura shopping (15 convs)"
node run.js --store yuma-tediber envive-nanit decagon-oura --mode shopping --themes 5 \
  --concurrency 3 || say "P2 exited nonzero (continuing)"

# P3 — Rep AI needs headed capture: 2 stores x 2 modes x 5 = 20, + vibae shopping = 5
say "P3: Rep AI headed (25 convs)"
node run.js --store repai-bikesonline repai-gosun --themes 5 --headed --concurrency 2 \
  || say "P3 exited nonzero (continuing)"
node run.js --store repai-vibae --mode shopping --themes 5 --headed \
  || say "P3b exited nonzero (continuing)"

say "=== BATCH-200 done. Captured today: $(ls results/$RUN_DATE/conv/*.json 2>/dev/null | wc -l | tr -d ' ') convs in results/$RUN_DATE/conv/ (nothing moved/archived) ==="
