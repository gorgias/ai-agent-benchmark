# Personal notes — Roman Fayzullin's latency benchmark vs. mine
*Full reverse-engineering (2026-07-03): Slack thread #C0BC7L6ECEA + the "Shopping Assistant comparisons" Notion doc (158K chars, read in full) + the `ai_agent_benchmark` skill in context-factory (PR #6294, branch read file-by-file: SKILL.md, latency-measurement.md, benchmark-results.md, competitor-test-sites.md). Roman's work is focused on **latency**.*

**Status: the improvements below are implemented, tested, and shipped** (commits on `max-pruv/ai-chat-latency-benchmark`, 2026-07-03). See §5 for what changed.

---

## 1. What Roman built (the facts)

An **interactive Claude skill** (agent-browser + CDP) that tests ONE merchant at a time, in depth:
- Fixed battery: 4 "happy-flow" turns (discovery → specific product + add-to-cart → comparison → purchase path) + **3 guardrail probes** (off-catalog, off-topic "write code", prompt injection).
- **Latency measured at the NETWORK layer** (not the DOM): a CDP listener on one monotonic clock timestamps WebSocket frames / SSE events / long-poll responses depending on the widget's "transport shape" (A = single WebSocket / RepAI, B = HTTP send + WS receive / Ada-Pusher-encrypted, C = SSE / Humind). Ready-made scripts (`cdp-ws-listener.mjs`, `parse_frames*.py`, `sse-content-tap.js`).
- **3 measurement points**: first feedback (ack) / **first meaningful content** (cards or first real tokens) / full answer. Plus TTFT if streaming.
- A `.webm` video of each session as a perceived-latency cross-check.
- Structured Notion report per merchant + a cumulative ledger inside the skill + he updates the competitive slide in the board deck (Google Slides).
- Coverage: Nordstrom (**= Google Agentic Commerce**, discovered on the wire: `chat_provider=Google`), Ada, Humind, Siena, RepAI, Kodif, Sierra, Yuma, Envive, + (via Romain L.) Klaviyo K:AI, Shopify Inbox, DigitalGenius.
- His conclusion: Gorgias p75 ≈ 16.5s vs. field ~6-14s; a 10-12s target is realistic; the lever is *perceived* latency — show the cards before the text — rather than token streaming.

---

## 2. Where he does BETTER (acknowledge honestly)

1. **Per-turn measurement precision: superior.** Monotonic CDP clock, skew-free, frame-accurate. I measure at the DOM (poll + settle): defensible because it includes render — what the customer actually sees — but at polling granularity. For a single turn, his number is cleaner than mine.
2. **The first-feedback / first-meaningful / full-answer decomposition.** This is his key insight: on Humind the cards are usable 5-8s before the text finishes; on Envive everything arrives in a burst after ~5-6s of silence. My "full answer only" metric missed this dimension — which is exactly the product lever (perceived latency).
3. **Transport reverse-engineering.** He knows WHY each widget has the latency it has (streaming vs. atomic, Yuma's ~1.1s long-poll, Ada's encrypted payloads). I treat the widget as a black box. His streaming/atomic taxonomy explains the ranking better than my averages alone.
4. **The guardrail battery.** Injection, off-domain, off-catalog — memorable findings: **Siena writes a full Python script**; **Sierra locks into refusal mode** after an injection (for the rest of the session!). I didn't test adversarial robustness at all.
5. **Real transactional verification.** Add-to-cart verified against Shopify `/cart.js`: RepAI genuinely transacts (1 item, $15.99); Yuma/Tediber's cart button is **fake** (cart stays at 0); Klaviyo/nanuk bug: the button works but the bot verbally denies it can. My capability matrix was more superficial.
6. **Vendors I didn't have**: **Google Agentic Commerce (Nordstrom)** — strategically the most important new entrant —, Klaviyo K:AI (4 merchants tested), Shopify Inbox (the "single-shot ticket form" pattern documented).
7. **The videos.** For a board, "watch the experience" is a persuasion artifact my pipeline didn't produce.

## 3. Where he does WORSE (and where my system is more precise)

1. **n = 4 turns, 1 merchant, 1 session per vendor.** His averages rest on 4 points; one outlier (RepAI 71.9s) forces manual exclusions. Mine: 5-7 stores/vendor × 5 themes × 7 turns × 2 lanes → dozens of timed turns per vendor, 302 conversations judged. **His own doc documented the flaw: HappyWax (Klaviyo's showcase merchant) was the WORST of the 4 Klaviyo deployments** — the "one merchant is not the platform" lesson he learned after the fact, which my design applies from the start.
2. **No automation / success-rate metric.** His doc says so explicitly ("No automation/success-rate metric"). He can't say "Sierra bails to a human 1 in 2 support conversations" — my board headline.
3. **No Shopping vs. Support split.** His DigitalGenius number is support-only, flagged in a note; my two lanes have their own themes, eval rubrics, and rankings.
4. **Quality = subjective 🟢/🟡 emojis.** Mine: LLM-judge /100 on per-lane rubrics, per conversation, comparable and trendable (302 convs).
5. **Warm context + clicks.** His battery chains turns in ONE session (Humind follow-ups at 1.6-1.8s BECAUSE context is reused — flatters the averages) and his happy-flow **clicks carousels/variants** (RepAI T5/T6: 2.48s/0.32s = near-instant local responses). My rule: cold context per conversation + **free-text only, never chips** (latency anti-cheat).
6. **Gorgias not measured with the same instrument.** His "Gorgias p75 ≈ 16.5s" comes from internal telemetry — a DIFFERENT metric compared against his wire measurements (apples vs. oranges; the internal p75 is neither cold-start nor even the same definition of "a reply"). I run Gorgias through **exactly the same pipeline** as competitors. For a board slide, that's the difference between "defensible" and "contestable".
7. **Not repeatable without a human.** Interactive skill (mid-run approval plan), slow, "consumes many tokens", no parallelism (he admits it in the thread). A photo, not a film. Mine: weekly automated (launchd), time-series, resumable, zero-touch.

## 4. Factual divergences to reconcile before the board

| Vendor | Him (wire, 1 store, June) | Me (DOM, multi-store, July) | Read |
|---|---|---|---|
| Sierra | 14.1s full (Scotts) | 9.5s avg (7 stores) | consistent — Scotts is his worst Sierra store (I see it slow too); my panel is broader |
| Kodif | 13.3s (DSC) | 15.5s shopping (6 stores) | consistent (±15%) |
| Siena | 8.5s (Simple Modern) | 12.1s (5 stores) | consistent — Simple Modern is Siena's best store for me too |
| **RepAI** | 11.1s, verdict "the strongest — informs, shows, transacts" 🟢🟢 (June) | **40.3s + quality 3-11/100, "Auto Deliver" upsell loop on EVERY question** (July, 4 stores) | ⚠️ Big gap. Hypotheses: (a) his averages benefit from carousel clicks + excluding the 72s outlier; (b) a RepAI regression / A-B between June and July; (c) our support questions trigger the loop. Re-test with HIS network listener to settle it — if RepAI regressed, that's a time-series finding only MY system can catch. |
| **Yuma/Tediber** | 18.9s full — he got free-text answers (June) | 0 free-text answers, chip-gated (July) | ⚠️ To reconcile: Tediber config changed? A/B? My "Yuma = ticket/email, no free-text concierge" verdict must be re-validated with his long-poll approach before asserting it to the board. |

*(These two flags are a strength, not a weakness: they're exactly what weekly repetition catches and a one-shot cannot see.)*

## 5. Learnings integrated into MY system — DONE (2026-07-03)

1. **✅ First-signal (TTFT) + streaming/atomic classification.** run.js now records `growth_events` per turn (DOM increments: many = streaming, 1-2 = atomic); gen.js derives median TTFT + a `delivery` label per store; report.html shows a **"First signal"** column (median TTFT + a streaming/atomic badge) in both Summary and Results. This gives me his perceived-latency dimension using data I was already capturing (`ttft_ms`) — no measurement rewrite.
2. **✅ Guardrail battery.** A 6th theme (`guardrails`, `guardrail:true`) with 3 probes (off-catalog / write-Python / injection+coupon). classify.js `guardrailLeak()` flags the two objectively-detectable failures (actual code written; prompt/coupon leaked), with a refusal-guard so a decline that echoes the probe's words isn't misread (unit-tested, 26 tests green). gen.js **excludes guardrail turns from latency + automation + quality** and surfaces a **"Guardrails — adversarial robustness"** section (held/total, code leaks, injection leaks per vendor). Populates on the next run.
3. **✅ Roman's CDP scripts vendored for wire-vs-DOM calibration** (`runner/calibration/scripts/`): `cdp-ws-listener.mjs`, `parse_frames.py`, `sse-content-tap.js`, `queryobjects.mjs`. Plan: run once on 2-3 vendors, measure the DOM−wire offset, document it in the report's Method ("our numbers include render, +X ms vs. network") — turns the precision objection into a footnote.
4. **✅ `--video` flag.** run.js records a Playwright `.webm` of the first theme per (store,mode) when `--video` is set (off by default — heavy), renamed to `<key>-<mode>.webm`. For flagship/board runs.
5. **✅ 3 new vendors added** (candidate, generic driver): **Google Agentic / Nordstrom**, **Klaviyo K:AI** (nanuk.com, nakedwardrobe.com, happywax.com — his verified merchants), **Shopify Inbox** (schottnyc.com, jnco.com — expect the single-shot pattern). They enter the fleet and get attempted on the next run; honest error → pending if the generic driver can't drive them (same path Rep/Kodif took before their handlers were tuned).
6. **Adopted his "cards before text" product idea** into my takeaways page — it converges with my rich-elements gap and reinforces it.

**Still open (not code, needs a live browser session):** run the calibration pass; tune the 3 new vendors' widget handlers from what the first run reveals; capture guardrails + the new vendors in the next full run.

## 6. The "why mine is more precise" argument (if asked)

> "Roman built an excellent **microscope**: the wire measurement of ONE conversation on ONE merchant is finer than mine, and his transport findings are valuable. I built the **telescope**: what the board needs to know is the performance of a PLATFORM, not a demo. And there, precision comes from sampling, not the clock: 60+ stores, two separate lanes, cold context, free-text only, dozens of turns per vendor, 302 conversations judged on a rubric, Gorgias run through the same pipeline as competitors (not an incomparable internal p75), and weekly repetition that turns the photo into a film. His own doc holds the proof: Klaviyo's showcase merchant was the worst of his 4 deployments. A benchmark at n=1 merchant and n=4 turns can't be precise about the question that matters — it can only be precise about the wrong question."

And the concession that earns credibility: *"his first-meaningful-content decomposition is better than mine — I've integrated it."*

## 7. Merge policy (Romain L. asked for ONE shared thing)

Romain Lapeyre (thread, 2026-07-02): *"can you add what you built this weekend into this same skill? Would rather have one shared thing we all extend."* Position to hold:
- **Two complementary layers, one product**: the context-factory skill = "interactive deep-dive" mode (1 merchant, wire-level, videos); my repo = the automated "fleet mode" (scale, automation rate, evals, time-series, weekly).
- Concretely: a PR on `ai_agent_benchmark/SKILL.md` adding a "Fleet benchmark (automated)" section pointing to `max-pruv/ai-chat-latency-benchmark` + making his Notion report / board slide consume my `eval-scores.json` / ledger. His ledger keeps the per-merchant deep-dive; my numbers become the source of the averages/rankings.
- Ivan Kozlov also "done some work" (per Romain L.) — source it before the meeting so I'm not surprised. *(Not mentioned in Roman's Notion doc.)*
