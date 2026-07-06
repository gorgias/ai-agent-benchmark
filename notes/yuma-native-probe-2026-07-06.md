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
