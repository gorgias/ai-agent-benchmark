# Methodology

How the benchmark measures latency and answer quality, why it splits into two modes, the cold-session problem (and what does / doesn't work), and how human handover is detected and flagged.

## Contents
- [Two modes](#two-modes)
- [The question pools](#the-question-pools)
- [Latency measurement (per transport)](#latency-measurement)
- [Answer-quality eval (blind judge panel)](#answer-quality-eval)
- [Handover = red flag](#handover--red-flag)
- [Cold sessions](#cold-sessions)
- [Two ways the benchmark is run](#two-ways-the-benchmark-is-run)
- [Threats to validity](#threats-to-validity)

---

## Two modes

A storefront AI assistant does two distinct jobs, and they have very different latency/quality profiles, so we measure them separately:

- **Shopping Assistant** — sales discovery that should end in a *real product recommendation* (and ideally add-to-cart / checkout). This is the hard, revenue-relevant job.
- **Support** — shipping, delivery, returns, policy. Table-stakes deflection.

The report has a top toggle to view either mode. Mixing them into one average is misleading: product-recommendation turns are ~2–3× slower than FAQs, and several assistants do support fine but won't sell at all.

## The question pools

Defined in [`runner/pools.js`](../runner/pools.js). Both pools are **standardized** (same shape for every vendor — the "similar pool across all sites" rule) and deliberately **complex**: compound, multi-constraint turns that build on prior answers, with objections and edge cases — a demanding shopper, not one-line FAQs.

- **Support (10 turns, shared):** a late order, expedited-before-Saturday, missed delivery, address change mid-transit, partial return of a multi-item order, split gift-card+card refund, damaged item, price-match, a discount code that won't apply, cancellation window.
- **Shopping (10 turns, adapted per store catalog):** open-ended ask → rich needs+context → budget/constraint → compare two specific products → objection/doubt → secondary need → bundle value → social proof / best-seller → add to cart → total + promo.

**Design rule:** *no turn ever asks for a human.* So any handover the assistant initiates is unprompted and attributable to a capability gap (see [Handover](#handover--red-flag)).

## Latency measurement

Metric = wall-clock from **message sent** to the **full response available**. The signal used depends on the vendor's transport (details per vendor in [VENDORS.md](VENDORS.md)):

| Transport | Vendors | How latency is captured |
|---|---|---|
| REST request/poll | Siena | `POST /v1/live_chat/messages` then poll `GET /v1/live_chat/message` until the bot reply appears (atomic delivery) |
| SSE token stream | Sierra | intercept `sierra.chat/-/api/chat`; first-byte + stream-close timestamps (throttle-immune) |
| WebSocket | Gorgias, Yuma | timestamp the first `fromAgent` message frame on the chat socket |
| Same-origin iframe DOM | DigitalGenius, Meta AI, Gorgias (alt) | poll the transcript iframe's `innerText`; reply = text grows past a threshold then **stays stable ≥3.5s** |
| Shadow-DOM (in-page) | Sierra (alt) | same growth+stability check on the widget's shadow root |

The **headless runner** uses the DOM growth+stability method uniformly (Playwright can read cross-origin iframes), because it's vendor-agnostic and reliable when not throttled.

**Why "grows then stable ≥3.5s"?** Streaming/replies arrive in chunks; we treat the response as complete when the transcript stops changing for 3.5s after it has grown beyond the user echo. We record the timestamp of the *last* change (not the stability-wait), so the 3.5s window isn't counted in the latency. First-token (TTFT) is also recorded where available.

## Answer-quality eval

Latency only matters if the answer is good. Every valid conversation is scored `/100` by an
LLM judge under the **versioned in-repo spec [`runner/eval-rubric.md`](../runner/eval-rubric.md)** (v2):

- **Blind batches:** `eval-pack.js` strips vendor & store identity (opaque keys, masked
  transcript text) before judging — judges score behavior, not brands. The key→id map is
  merge-side only.
- **Binary, evidence-forced checks:** each lane dimension (Shopping: answer 35 /
  recommendation 25 / rich 25 / close 15 · Support: resolution 40 / accuracy 25 /
  actionability 20 / close 15) decomposes into pass/fail checks; a passing check must quote
  the transcript. The judge never emits a number — `eval-merge.js` derives sub-scores and
  the /100 total from the booleans via a fixed point mapping.
- **Deterministic signal gates:** price/link/review/option presence is regex-detected from
  the stored transcript and enforced at merge — a rich-element check cannot pass without
  its signal.
- **Outcome correctness:** a justified, well-executed handover scores as correct support
  behavior; containment is measured separately by automation rate (never double-penalized).
- **Adversarial audit loop:** `eval-audit.js` re-examines sampled verdicts against the
  judge-trap catalog ([`notes/judge-traps.md`](../notes/judge-traps.md)), flips
  FALSE_POSITIVE / FALSE_NEGATIVE verdicts, re-derives scores, and reports the run's
  judge-agreement rate (trusted at ≥90%, `eval-audit.json`).

*(An earlier iteration used a 3-judge panel over hand-picked answers relabeled Store A–F —
superseded by the per-conversation pipeline above; legacy scores were removed from the
report on 2026-07-03.)*

## Handover = red flag

Because no pool turn asks for a human, an assistant that **initiates a handover** has failed to do its job (in Shopping, it failed to complete the sale). The runner ([`run.js`](../runner/run.js)) detects this and marks `handover: true` on the turn and `red_flag: true` on the vendor.

Detected signals (regex, case-insensitive) include:
- "(I'll) connect you with/to …", "transfer you to …", "speak to a/our agent/team/representative"
- "submit / raise / create / open a (support) ticket"
- "our team will get back / follow up / reach out / be in touch"
- "a member of our team", "all of our agents are unavailable"
- lead-capture forms: "enter your details", "fill in/out the form"
- soft handoff: "share your email / order number … so the team can confirm"

Validated against real captured replies: it flags DigitalGenius, Meta AI, and Siena's soft deflection, and does **not** flag genuine answers (e.g. a blunt no-returns policy or a real product recommendation).

## Cold sessions

These widgets persist a conversation in their **own cross-origin storage** (`gorgias.chat`, `siena.cx`, `ada.support`, `chat.digitalgenius.com`, Zendesk). This caused warm-session bias in early manual runs. Verified facts (2026-06-30):

- ❌ Clearing the **parent page's** cookies + localStorage + sessionStorage + IndexedDB + caches does **not** reset these chats — the session lives in the widget's partitioned cross-origin storage. (On Glamnetic the Gorgias widget surfaced a months-old prior conversation — handled by a human agent and auto-closed — the moment it opened, despite a clean parent page.)
- ❌ A browser-extension automation **cannot drive a true incognito window** even with "Allow in incognito" enabled — the incognito window never appears to the automation.
- ⚠️ Warm/re-used sessions **inflate latency** — measured: DigitalGenius next-day answer **12.7s cold vs 14.3s warm**.
- ✅ Only **DigitalGenius** stores its session in the parent origin, so it alone is resettable from page scripts.

**The fix:** a fresh browser **profile/container per run**. It has zero storage for any origin (including the widgets'), so every vendor starts cold by construction. That is exactly what the headless runner + monthly CI provides — and why "test in private browsing" is solved by infra, not by the extension.

## Two ways the benchmark is run

1. **Manual / reverse-engineering pass** (how the recorded `data_*.json` and the report were produced): drive each widget live, reverse-engineer its transport, measure with the best per-vendor signal. Higher fidelity per vendor, but warm sessions and (for background tabs) timer throttling limit conversation depth and reliability.
2. **Headless runner** ([`runner/`](../runner)): Playwright, **fresh context per vendor+mode** (cold), **headless** (no tab throttling → reliable timing at 10-turn depth), reads cross-origin frames directly, runs both pools, flags handover, writes JSON. This is the engine for the **monthly** automated run.

## Threats to validity

- **Different stores/domains** — judged in each store's own context; cross-vendor latency is directional.
- **Gorgias on Glamnetic** — a live production storefront (real catalog + guardrails), not a sales-tuned demo. Fairer/tougher, and the session was warm (shopping turns 1–3 untimed).
- **Recorded-answer scoring** — the quality eval scores the captured texts (some paraphrased from live runs).
- **Widget drift** — vendors change DOM/SDK; the runner's `vendors.js` selectors are the maintenance surface and each vendor fails soft (records `null` + `error`).
- **Single test windows** — 2026-06-29/30; the monthly run builds a trend over time.
