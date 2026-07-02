#!/bin/bash
# Fast report regenerator — rebuilds report.html from whatever conversations are on disk
# every 40s (atomic write). Combined with report.html's 20s auto-reload, the localhost
# table updates within ~1 min of each new conversation. Runs ~5h then exits.
cd /Users/maxpruvost/ai-chat-latency-benchmark/runner
for i in $(seq 1 450); do
  node gen.js --date 2026-07-01 >/dev/null 2>&1 || true
  sleep 40
done
