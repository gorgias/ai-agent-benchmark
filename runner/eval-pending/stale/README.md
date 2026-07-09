# Pending re-judge — timing-correction waves of 2026-07-09 (73 convs, 7 batches)

These conversations had bogus timings corrected (stall-as-answer + turn-boundary bleed —
see tools/fix-mistimed-stalls.mjs and tools/fix-boundary-bleed.mjs). Their QUALITY scores
in eval-scores.json are stale (judged on pre-correction text) until re-judged.
Judge quota on the operating account resets Sat Jul 12, 7pm Paris — or any other Claude
Code session can finish now:
1. For each batch-NNN.json: judge task from docs/OPERATOR-PROMPT.md §Judge → JSON ARRAY
   → scored-NNN.json in this directory (do NOT open map-*.json before judging).
2. cd runner && node eval-merge.js eval-pending/stale
3. node gen.js && node verify-data.js && node --test ./*.test.js
4. Commit bake outputs + delete this directory. PR → squash-merge → force Pages build.
