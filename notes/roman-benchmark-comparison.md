# Roman's latency benchmark vs. Max's fleet benchmark
*Reverse-engineered 2026-07-03 from Slack (#C0ABPDVBQUA, #C0BC7L6ECEA), Roman's "Shopping Assistant comparisons" Notion doc (read in full), and the `ai_agent_benchmark` skill in context-factory (PR #6294).*

## TL;DR — why Max's analysis is stronger

**Roman built a microscope; Max built a telescope — and the question that matters (how do platforms perform, is Gorgias winning) is a telescope question.** Max's analysis is stronger because:

1. **Scale**: dozens of timed turns per vendor across 5-7 stores × 2 lanes × weekly runs, vs. Roman's 4 turns on 1 merchant in 1 session. Roman's own Klaviyo run proved why this matters: the showcase merchant was the *worst* of 4 deployments.
2. **Comparability**: Gorgias is measured with the exact same harness, themes and judge as competitors. Roman compares his wire measurements to an internal Gorgias p75 — a different instrument and definition.
3. **Anti-flattery discipline**: cold session per conversation, free-text only, never chips. Roman's warm sessions and carousel clicks flatter vendors (RepAI looks mid-pack with clicks, catastrophic without).
4. **The metrics that matter**: automation rate (containment) and LLM-judged quality /100 — Roman measures neither (his doc says so). Latency alone crowns Meta AI, which scores 7/100 on quality.
5. **Repetition**: weekly time-series catches regressions and config changes a one-shot snapshot can't (see the RepAI and Yuma divergences below).

Roman's genuine edges — per-turn wire precision, first-meaningful-content decomposition, guardrail probes, videos, 3 extra vendors — **were all absorbed into Max's pipeline on 2026-07-03**, except wire-level instrumentation, which stays a deep-dive tool (his scripts are vendored in `runner/tools/`).

## What Roman built

An interactive Claude skill (agent-browser + CDP), one merchant at a time: 4 happy-flow turns + 3 guardrail probes; latency measured at the network layer (WS/SSE/long-poll, monotonic clock) in 3 points (first feedback / first meaningful content / full answer); `.webm` videos; Notion report + board-deck slide updates. Coverage included Nordstrom (= Google Agentic Commerce, found on the wire), Klaviyo and Shopify Inbox. His conclusion: Gorgias p75 ≈ 16.5s vs. field 6-14s; 10-12s is realistic; the lever is perceived latency (show cards before text).

## Scoring grid

| Dimension | Advantage | Why |
|---|---|---|
| Per-turn timing precision | **Roman** | Wire-level, frame-accurate; Max measures at the DOM (render included, poll granularity). Calibration run pending to quantify the offset. |
| Transactional ground truth | **Roman** | Add-to-cart verified via `/cart.js`: RepAI real, Yuma's button fake, Klaviyo's bot denies its own working button. Backlog for Max. |
| Transport reverse-engineering | **Roman** | Knows WHY latency is what it is (atomic vs streaming, Yuma's 1.1s poll). Scripts now vendored. |
| Sample size & structure | **Max** | n=dozens per vendor vs n=4; multi-store by design. |
| Cold-start / no-chips discipline | **Max** | Changes conclusions (RepAI, Humind follow-up times). |
| Gorgias comparability | **Max** | Same instrument both sides — the defensibility test for any board claim. |
| Automation rate | **Max** | Roman has none; it's the metric the product is hired for. |
| Quality measurement | **Max** | LLM-judge /100 on rubrics, 302 convs vs. subjective emojis. |
| Lane separation | **Max** | Sierra: shopping 41 vs support 64 — one number hides both stories. |
| Repeatability / trends | **Max** | Weekly automated vs. one-shot interactive. |
| Data integrity | **Max** | Unit-tested classifiers + re-runnable corpus audit (`clean-data.js`; corrected Sierra support 55→63%). |
| First-meaningful decomposition | Roman → **parity** | His best insight; now shipped as first-signal + streaming/atomic in the report. |
| Guardrails | Roman → **parity** | His 3 probes adopted as a 6th theme, excluded from latency/automation stats. |
| Vendor breadth | Roman → **parity** | His 3 vendors (Google Agentic, Klaviyo, Shopify Inbox) added with his verified merchants. |
| Videos | Roman → **parity** | `--video` flag shipped. |

## Who to trust for what

- **Max's numbers**: rankings, automation, quality, trends, any Gorgias-vs-competitor claim.
- **Roman's numbers**: anatomy of one vendor's latency, transport internals, transactional verification.
- **Neither alone**: absolute latency (his excludes render → reads fast; Max's includes it → reads slow; Max's *relative* comparisons hold because the bias is uniform).

## Divergences to reconcile before the board

- **RepAI**: Roman (June) 11.1s, "the strongest"; Max (July, 4 stores) 40.3s + quality 3-11/100, upsell loop on every question. Clicks/outlier-exclusion vs. real regression — re-test with his wire listener. Either way it argues for weekly runs.
- **Yuma/Tediber**: Roman got free-text answers in June (18.9s); Max found it chip-gated in July. Re-validate before asserting "Yuma has no free-text concierge" as final.
- Sierra, Kodif, Siena: consistent across both systems (±15%).

## What Max can claim about Gorgias, and how hard

- **Full confidence**: #1 automation rate in market (98% shopping / 100% support; field 38-93%); zero out-of-channel deflections; top-4 shopping quality (62/100).
- **With stated caveats**: 8th of 9 on latency (~18.3s — experienced time, render included, uniformly biased so comparable; 10-12s target corroborated); support quality 49/100 is a config artifact (Baby Bee 15/100 costs ~13 points) — which is itself the industry finding: config variance dwarfs model variance.
- **Not yet**: final Yuma verdict; RepAI June-vs-July; guardrail rankings and the 3 new vendors (first fleet capture in progress).

---
*Implemented 2026-07-03: guardrail battery + leak classifier (26 tests) · first-signal + delivery classification · `--video` · +3 vendors · CDP scripts vendored · corpus audit (3 quarantined) · LLM-judge-only quality · one containment dimension (automation rate).*
