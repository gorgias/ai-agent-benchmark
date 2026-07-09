# Pending re-judge — Kodif turn-boundary bleed (17 convs, 2 batches)

These Kodif conversations had late answers bleeding across turn boundaries (fixed
2026-07-09, see tools/fix-boundary-bleed.mjs). Timings corrected; their QUALITY scores
in eval-scores.json are stale (judged on bundled/mixed text) until re-judged.
Judge quota on the operating account resets Sat Jul 12, 7pm Paris — or any other
Claude Code session can do it now:
1. For each batch-NNN.json: judge task from docs/OPERATOR-PROMPT.md §Judge → JSON ARRAY
   → scored-NNN.json in this directory (do NOT open map-*.json before judging).
2. cd runner && node eval-merge.js eval-pending/bleed
3. node gen.js && node verify-data.js && node --test ./*.test.js
4. Commit bake outputs + delete this directory. PR → squash-merge → force Pages build.
