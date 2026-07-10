# RESUME — AI-agent benchmark (paused 2026-07-10, laptop closing)

## Where things stand
- **Captures STOPPED cleanly** (0 chromium/balancer/caffeinate — no zombies before sleep).
- **952 valid convs**; eval of the last **40 unjudged** kicked off (4 blind judge batches in
  `scratchpad/eval-close/`, subagents writing `scored-00N.json`).
- **Live site UNCHANGED**: `origin/master` still 40/40/20, Gorgias #1 overall. NOTHING new deployed.

## Uncommitted work in this worktree (compound branch) — approved, HELD for deploy
1. **Lane-specific composite weights** (Max approved): Shopping = 40% auto / 30% quality / 30% speed;
   Support = 50% auto / 30% quality / 20% speed. Implemented + syntax-verified in:
   `runner/gen.js` (LANE_W + laneRank), `takeaways.html` (comp(m,lane)), `report.html`
   (composite(r,lane), aggVendors(...,lane), compositeTrendSeries(...,lane), renderBestPanel lane).
2. **"How it works" methodology updated** (report.html modal): per-lane weighting + rationale,
   ≥15-conv statistical-significance floor, login-wall exclusion + chrome-vs-wall, handover
   treatment (penalized on automation, not double-penalized on quality).
3. **6+5 new intl Gorgias sites** already committed+merged (vendors.js, PR #127/#128).

## Expected outcome once deployed on COMPLETE data
Gorgias **#1 support**, **#2 shopping** (slow: ~18.5s vs Envive 11.1s), **#2 overall** behind Envive.
NOTE: a mid-burst bake showed Gorgias #4 shopping because the new intl sites were captured-but-
UNJUDGED (counted for latency, not quality). Once judged, shopping firms up (~#2). That's WHY we held.

## TO RESUME (do in order)
1. `cd runner` — check judges done: `ls ../../eval-close/scored-*.json` (want 4).
   Merge: `node eval-merge.js /…/scratchpad/eval-close`
2. Re-judge anything still unjudged if a subagent died (re-pack: `node eval-pack.js <dir> 12`).
3. (Optional) Resume captures toward parity — new sites + competitors. Balancer:
   `INCLUDE="Ada,Envive,Siena" TARGET=125 … node tools/balance.mjs` (≤3 parallel, LOAD_CAP=9,
   kill by PID + verify 0 chromium; NEVER >3 streams — zombie chromium inflates latency).
   Capture clones must run the FIXED run.js (login-wall STOP + non-sticky detector).
4. Bake + gate: `node gen.js && node verify-data.js && node --test` (expect 76 tests pass, 0 markers).
5. Confirm scoreboard with Max (Gorgias #2 overall is the approved, honest result), then deploy:
   commit → PR → squash-merge → `gh api -X POST repos/gorgias/ai-agent-benchmark/pages/builds`.

## Guardrails (standing)
- Never move/delete conv JSONs out of results/<date>/conv/. Corrections in place with audit fields.
- ≤3 parallel capture streams; kill by PID, verify 0 chromium (sleep + broad-kill leave zombies).
- Klaviyo support = 5 valid (deflector) → stays thin/unranked, not stat-sig. Correct outcome.
