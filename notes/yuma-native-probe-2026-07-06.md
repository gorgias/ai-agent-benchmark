# Yuma native-widget probe — 2026-07-06

Goal: react faster when a Yuma target is technically present but not drivable in the cold free-text
harness. A site must produce at least 3 timed AI answers in a conversation to become rankable.

## What happened

- A Claude-origin headed run started with `yuma-rouje` before reaching stronger candidates.
- `yuma-rouje` produced 5 Shopping captures (`everyday-value`, `gift`, `compare-budget`,
  `problem-solver`, `guardrails`), all invalid: 0 timed AI answers. The widget repeatedly returned
  the same French greeting instead of answering the shopper's typed questions.
- That run was stopped gracefully with SIGINT after Rouje proved non-rankable, to avoid burning the
  slot on the next low-confidence French target.
- Codex then ran bounded probes:
  - `yuma-cabaia`, stopped after T3 because T1-T3 were all `--ms`.
  - `yuma-meshki-au`, stopped after T3 because T1-T3 were all `--ms`.
- No valid new Yuma conversations were merged into the report or scoreboard.

## Signature check

Raw served HTML with a desktop user-agent confirmed native Yuma front-end signatures on:

- `cabaia.com`: `yuma-widget`, `app.yuma.ai/w/26d426e8-81f9-4828-bf3f-becac21a7f0f`, `js.yuma.ai/widget.js`.
- `www.meshki.com.au`: `yuma-widget`, `app.yuma.ai/w/df03b930-b20c-4376-ae62-738537f5035b`, `js.yuma.ai/widget.js`.
- `meshki.co.uk`: `yuma-widget`, `app.yuma.ai/w/5d646ace-7d54-4676-ad61-aee257a96ef6`, `js.yuma.ai/widget.js`.

Most public Yuma case-study brands checked in this pass showed Gorgias/Klaviyo signatures but no
native Yuma front-end in served HTML. They may still use Yuma server-side, but driving those as
"Yuma" would attribute the Gorgias or another helpdesk front-end to Yuma, so they should not be
added as clean Yuma Shopping Assistant targets.

## Next run rule

Do not run a full 5-theme Yuma batch on a new target first. Use the bounded probe:

```bash
RUN_DATE=$(date +%F) BENCHMARK_CAPTURE_ORIGIN=codex runner/priority-yuma-probe-run.sh
```

Default targets are `yuma-meshki-au yuma-meshki-uk`, with 1 Shopping theme, serial execution, and a
25s turn timeout. Expand only a target that produces at least 3 timed AI answers in the probe.

## Current recommendation

- Deprioritize `yuma-rouje` and `yuma-ledomaine` for the scoreboard until a manual browser check
  shows that their Yuma iframe can answer free-typed shopper questions.
- Keep `yuma-cabaia` and `yuma-meshki-*` as native-widget evidence, but treat them as drivability
  probes rather than guaranteed rankable data.
- For near-term Yuma scoreboard stability, rely on existing valid EvryJewels/Tediber data and do
  not count native-widget no-answer probes against Yuma unless they become engaged/timed.

## 2026-07-06 Codex follow-up

- `yuma-bombayhair` was probed after the email-gate fix and still produced `--ms` for T1-T3 on
  `shopping/everyday-value`; the probe was stopped gracefully to avoid burning the headed slot.
- `yuma-tumble` was captured with `BENCHMARK_CAPTURE_ORIGIN=codex` on `shopping/everyday-value` and
  produced a valid conversation: 9/10 timed turns, 29.1s mean complete latency, quality 67/100.
- Tumble is therefore rankable, but it is slow and has purchase-mechanics gaps: it names products
  and cites prices/reviews/options, but does not add to cart and asks for email/manager escalation
  for warranty/discount questions.

## 2026-07-06 Claude import scored by Codex

After pulling latest, Codex imported four valid, non-duplicate Claude-origin Yuma Shopping
captures and judged them with `BENCHMARK_EVAL_ORIGIN=codex`:

- `yuma-evryjewels-shopping-beginner.json`: 10/10 timed, 17.5s mean latency, quality 83/100.
- `yuma-tediber-shopping-beginner.json`: 10/10 timed, 21.2s mean latency, quality 65/100.
- `yuma-tumble-shopping-compare-budget.json`: 8/10 timed, 23.8s mean latency, quality 29/100.
- `yuma-tumble-shopping-gift.json`: 9/10 timed, 23.1s mean latency, quality 27/100.

Impact on Yuma Shopping after regeneration:

- Sample size: 15 -> 19 conversations.
- Automation: 93% -> 95%.
- Quality: 81 -> 73.
- Mean latency: 20.8s -> 20.1s.
- Quality ranking among Shopping vendors: #2 -> #4.

Interpretation: these conversations are mixed for Yuma. EvryJewels is positive and Tediber is
usable, but the two additional Tumble runs expose a real Shopping Assistant quality gap: repeated
clarification and escalation, no named value/gift recommendation, and unfulfilled cart or total
requests. The import increases sample coverage and makes the Yuma score less favorable but more
representative.
