# Personal notes — Roman Fayzullin's latency benchmark vs. mine
*Full reverse-engineering (2026-07-03, regenerated same day after integration): Slack threads #C0ABPDVBQUA + #C0BC7L6ECEA, the "Shopping Assistant comparisons" Notion doc (158K chars, read in full), and the `ai_agent_benchmark` skill in gorgias/context-factory (PR #6294, read file-by-file: SKILL.md, latency-measurement.md, benchmark-results.md, competitor-test-sites.md). Roman's work is focused on **latency**.*

**Status: every adoptable learning from Roman's system is implemented and shipped** (commits on `max-pruv/ai-chat-latency-benchmark`, 2026-07-03). §3 is the objective scoring grid; §6 is what we can claim about Gorgias performance, and with what confidence.

---

## 1. What Roman built (the facts)

An **interactive Claude skill** (agent-browser + CDP) that deep-dives ONE merchant at a time:
- Fixed battery: 4 happy-flow turns (discovery → specific product + add-to-cart → comparison → purchase path) + **3 guardrail probes** (off-catalog, off-topic "write code", prompt injection). Guardrail turns excluded from latency.
- **Latency measured at the NETWORK layer**: a CDP listener on one monotonic clock timestamps WebSocket frames / SSE events / long-poll responses, per widget "transport shape" (A = single WS / RepAI, B = HTTP send + WS receive / Ada-Pusher-encrypted, C = SSE / Humind). Ready scripts: `cdp-ws-listener.mjs`, `parse_frames*.py`, `sse-content-tap.js`.
- **3 measurement points**: first feedback (ack) / **first meaningful content** (cards or first real tokens) / full answer, + TTFT when streaming.
- `.webm` video per session as perceived-latency cross-check.
- Notion report per merchant + cumulative ledger in the skill + updates the H2 competitive board-deck slide.
- Coverage: Nordstrom (**= Google Agentic Commerce**, identified on the wire), Ada, Humind, Siena, RepAI, Kodif, Sierra, Yuma, Envive + (via Romain L.) Klaviyo K:AI, Shopify Inbox, DigitalGenius.
- His conclusion: Gorgias p75 ≈ 16.5s vs. field ~6-14s; 10-12s is a realistic target; the lever is *perceived* latency (show cards before text) rather than token streaming.

## 2. One-line verdict

**Roman built a microscope; I built a telescope.** His per-conversation wire measurement is finer than mine; my estimate of *platform-level* performance is stronger on every statistical and comparability dimension. The systems are complementary, not competing — and as of today, the telescope has absorbed the microscope's best lenses.

## 3. The objective scoring grid — system vs. system

Scored honestly, dimension by dimension. "Now" reflects the state after today's integration work.

| # | Dimension | Roman's system | My system | Advantage | Why it matters |
|---|---|---|---|---|---|
| 1 | Per-turn timing precision | Wire-level (CDP monotonic clock, frame-accurate) | DOM polling (includes render; poll granularity) | **Roman** | For a single turn his number is cleaner. Mitigated: his scripts are vendored in `runner/tools/`; a one-shot wire-vs-DOM calibration will quantify our offset as a Method footnote. *(Run still pending.)* |
| 2 | What the latency number represents | Network+server time (excludes render — runs HIGHER than what the shopper sees; his own docs note it) | What the customer actually experiences on screen | **Mine (for the board), his (for engineering)** | A board latency claim should be the experienced one; a latency-program engineering target should be the wire one. Use each accordingly. |
| 3 | Perceived-latency decomposition | first feedback / **first meaningful content** / full answer | Was full-answer only → **now first-signal (TTFT) + streaming-vs-atomic classification shipped in the report** | **Roman → parity** | His single best insight (cards usable 5-8s before text ends). Adopted at DOM level; wire-level card-timing remains his edge on instrumented deep-dives. |
| 4 | Sample size per vendor | n = 4 turns, 1 merchant, 1 session | Dozens of timed turns: 5-7 stores × 5 themes × 7 turns × 2 lanes | **Mine, decisively** | One outlier (his RepAI 71.9s) forces manual judgment at n=4. His own Klaviyo run proved the flaw: the showcase merchant (HappyWax) was the WORST of 4 deployments — "one merchant is not the platform" is a lesson my design applies structurally. |
| 5 | Cold-start & anti-flattery discipline | One warm session (context reuse flatters follow-ups: Humind 1.6-1.8s), happy-flow clicks carousels (near-instant local replies in averages) | Cold incognito context per conversation, free-text only, never chips; stall/ack anti-cheat | **Mine** | These rules exist precisely because they change conclusions (RepAI looks mid-pack with clicks, catastrophic without). |
| 6 | Gorgias measured comparably | Internal telemetry p75 (≈16.5s) vs. his wire numbers — different instrument, different definition | Same harness, same themes, same judge as competitors | **Mine, decisively** | This is the defensibility test for any board slide. An internal p75 compared to wire measurements is apples vs. oranges. |
| 7 | Automation / containment metric | None (his doc says so explicitly) | Automation rate on the engaged denominator (automated/handover/deflected), unit-tested | **Mine** | The metric the product is hired for. Post-cleanup figures: Gorgias 98/100%, field 38-93%. |
| 8 | Answer-quality measurement | Subjective 🟢/🟡 emojis per merchant | LLM-judge /100, per-lane rubrics, 302 conversations, trendable | **Mine** | Comparable, repeatable, and it caught what emojis can't (15-point spreads within one vendor). |
| 9 | Lane separation (Shopping vs Support) | Mixed; DG number is support-only flagged in a note | Two first-class lanes with own themes, rubrics, rankings | **Mine** | Sierra proves why: 41 shopping quality vs 64 support — one number would hide both stories. |
| 10 | Adversarial robustness (guardrails) | 3-probe battery; found Siena writing Python, Sierra post-injection lockout | Had none → **now shipped**: same 3 probes as a 6th theme + `guardrailLeak` classifier, excluded from latency/automation stats | **Roman → parity** | Adopted wholesale — with a methodological upgrade he lacks: guardrail turns can't inflate our automation rate (a refusal-escalation is GOOD behavior). |
| 11 | Transactional verification | Add-to-cart verified against Shopify `/cart.js` (RepAI real; Yuma's button FAKE; Klaviyo bot denies its own working button) | Shallower capability matrix | **Roman** | Still his edge. Backlog: wire `/cart.js` verification into the capabilities pass. |
| 12 | Transport reverse-engineering | Full taxonomy (WS/split/SSE/long-poll), per-vendor protocol maps | Black-box DOM | **Roman** | Explains WHY latency is what it is (Yuma's 1.1s poll quantization, atomic vs streaming). His scripts now vendored for when we need that depth. |
| 13 | Vendor breadth | +Google Agentic (Nordstrom), Klaviyo, Shopify Inbox | Was 11 vendors → **now 14**: his 3 added with his verified merchants (nordstrom.com; nanuk/nakedwardrobe/happywax; schottnyc/jnco) | **Roman → parity** | Google entering our market is the strategic one. First fleet capture of the new 3 in progress. |
| 14 | Demo/persuasion artifacts | `.webm` video per session | Had none → **now `--video` flag** (one clip per store+mode for flagship runs) | **Roman → parity** | "Watch the experience" lands at a board like numbers can't. |
| 15 | Repeatability & trend detection | One-shot snapshot, interactive approval mid-run, no parallelism (his own words: slow, token-heavy) | Weekly automated (launchd), resumable, time-series charts, zero-touch | **Mine, decisively** | A photo vs. a film. The RepAI and Yuma divergences (§5) are exactly what only the film can catch. |
| 16 | Data integrity pipeline | Manual (archived "IGNORE" blocks in Notion for bad runs) | Validity gates, unit-tested classifiers (26 tests), re-runnable corpus audit (`clean-data.js`) that quarantines bug-tainted conversations | **Mine** | Today's audit quarantined 3 bug-truncated convs and corrected Sierra support automation 55%→63% — the system self-corrects and documents it. |

**Net:** Roman wins 3 dimensions outright (per-turn wire precision, transactional verification, transport RE), I win 7, and 4 of his former advantages were adopted into my pipeline today. The remaining 3 are deep-dive tools, not fleet metrics — which is exactly the complementarity argument for the merge Romain L. asked for.

## 4. Where each system should be trusted

- **Trust MY numbers for:** vendor rankings, automation rate, quality scores, lane comparisons, trends over time, and any Gorgias-vs-competitor claim (same instrument on both sides).
- **Trust ROMAN's numbers for:** the anatomy of a single vendor's latency (ack vs cards vs full text), transport internals, and transactional ground truth (his `/cart.js` checks).
- **Trust NEITHER alone for:** absolute latency truth — his excludes render (reads fast), mine includes render + polling (reads slow). The calibration run will bound the gap; until then, cross-vendor *relative* comparisons (mine) are robust because the bias is uniform.

## 5. Factual divergences still to reconcile

| Vendor | Him (wire, 1 store, June) | Me (DOM, multi-store, July) | Read |
|---|---|---|---|
| Sierra | 14.1s full (Scotts) | 9.5s avg (7 stores) | Consistent — Scotts is the worst Sierra store in both systems; my panel is broader. |
| Kodif | 13.3s (DSC) | 15.5s shopping (6 stores) | Consistent (±15%). |
| Siena | 8.5s (Simple Modern) | 12.1s (5 stores) | Consistent — Simple Modern is Siena's best store for me too. |
| **RepAI** | 11.1s, "the strongest — informs, shows, transacts" 🟢🟢 (June) | **40.3s + quality 3-11/100, "Auto Deliver" upsell loop on every question** (July, 4 stores) | ⚠️ Big gap. Hypotheses: (a) his averages benefit from carousel clicks + the excluded 72s outlier; (b) genuine RepAI regression/AB between June and July; (c) persona-triggered. Re-test with his wire listener. If it's (b), it's a time-series finding only my system can catch — either way the divergence itself is evidence for weekly runs. |
| **Yuma/Tediber** | 18.9s full — he got free-text answers (June) | 0 free-text answers, chip-gated (July) | ⚠️ Config change or A/B at Tediber? My "Yuma = ticket/email, no free-text concierge" verdict should be re-validated with his long-poll method before the board hears it as final. |

## 6. The objective reading grid for OUR performance (what to claim, and how hard)

**Claim with full confidence (large n, same instrument both sides, survives the data audit):**
- Gorgias has the **highest automation rate in the market**: 98% Shopping / 100% Support on the engaged denominator; the field spans 38-93%. *(This is the metric the product is hired for, and no competitor benchmark — including Roman's — even measures it.)*
- Gorgias **never deflects out of channel** (0 measured; Kodif 4, Siena 3 in support).
- Gorgias shopping quality is **top-4** (62/100) and its sales behavior (comparisons, promos, nudges) is judged among the best.

**Claim with stated caveats:**
- Latency: we are **8th of 9** on full-answer time (~18.3s shopping). Caveat to state proactively: our numbers include render (experienced time) and are cross-vendor comparable because the bias is uniform; the wire-level offset is being calibrated. The 10-12s target (Roman's conclusion) is corroborated by our data: quality leaders answer in 9-13s.
- Support quality 49/100: real, but demonstrably a **configuration artifact** (Baby Bee at 15/100 costs ~13 points) — which is itself the finding (config variance dwarfs model variance across ALL vendors).

**Do not claim yet (pending reconciliation or first data):**
- The Yuma "no free-text concierge" verdict as final (§5).
- Anything about RepAI's June-vs-July behavior without the wire re-test (§5).
- Guardrail robustness rankings and the 3 new vendors (Google Agentic, Klaviyo, Shopify Inbox) — first fleet capture in progress today.

## 7. Merge politics (Romain L. asked for ONE shared thing)

Position: **two complementary layers, one product.** The context-factory skill = interactive deep-dive microscope (one merchant, wire-level, videos, transactional ground truth); my repo = the automated fleet telescope (scale, automation rate, LLM-judge quality, time series, weekly). Concrete proposal: a PR on `ai_agent_benchmark/SKILL.md` adding a "Fleet benchmark (automated)" section pointing at `max-pruv/ai-chat-latency-benchmark`, with my ledger/eval-scores feeding his Notion report and the board-deck slide. His per-merchant deep-dives stay canonical for anatomy; my numbers become canonical for averages and rankings. Also: source what Ivan Kozlov built (mentioned by Romain L. in the thread, absent from Roman's doc) before the meeting.

---
*Implementation log (2026-07-03): guardrail battery + `guardrailLeak` (26 tests green) · first-signal TTFT + streaming/atomic in report · `--video` flag · +3 vendors with verified merchants · Roman's CDP scripts vendored in `runner/tools/` · corpus audit `clean-data.js` (3 quarantined; Sierra support 55→63%) · legacy hand-curated quality scores removed (LLM-judge only) · containment consolidated to ONE dimension (automation rate; per-turn success dropped from tables).*
