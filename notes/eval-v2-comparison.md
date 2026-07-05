# Judge spec v1 → v2.1 — before/after on a pinned cohort

**Setup.** The same 72 conversations (6 vendors × 2 lanes × 6, stratified) were scored under
both judge specs. v1: a judge emitted scalar sub-scores directly, vendor names visible.
v2/v2.1 (see `runner/eval-rubric.md`): **blind batches** (vendor/store identity stripped),
**binary evidence-forced checks** (a passing check must quote the transcript), scores
**derived** from the checks by a fixed mapping, deterministic signal gates on rich-element
checks, and an **adversarial audit** of sampled verdicts (97.8% agreement, TRUSTED; 6
verdicts flipped). After the first pass showed five support checks passing at 83–100%
(non-discriminating bars), they were tightened in v2.1 and the support half of the cohort
re-judged; support check pass-rates now spread 50–94%.

## Results (mean /100 per vendor × lane, same conversations)

| vendor | shopping v1 → v2.1 | Δ | support v1 → v2.1 | Δ |
|---|---|---|---|---|
| Ada | 35.3 → 44.5 | +9.2 | 35.3 → 43.3 | +8.0 |
| Envive | 58.0 → 66.5 | +8.5 | 58.7 → 50.7 | **−8.0** |
| Gorgias | 69.2 → 69.8 | +0.6 | 65.3 → 91.5 | +26.2 |
| Siena | 46.7 → 63.3 | +16.6 | 68.2 → 82.3 | +14.1 |
| Sierra | 59.0 → 73.7 | +14.7 | 70.0 → 94.0 | +24.0 |
| Yuma | 70.2 → 77.5 | +7.3 | 52.2 → 76.0 | +23.8 |

**Quality rank, shopping:** v1 `yuma > gorgias > sierra > envive > siena > ada` → v2.1
`yuma > sierra > gorgias > envive > siena > ada` (one swap: Sierra passes Gorgias).
**Quality rank, support:** v1 `sierra > siena > gorgias > envive > yuma > ada` → v2.1
`sierra > gorgias > siena > yuma > envive > ada`.

## Reading

- **The process moves scores in both directions.** Envive support drops 8 under
  evidence-forced checks (v1 credited warm but unspecific replies — the politeness-inflation
  trap); Sierra/Gorgias/Yuma support rise because their answers carry concrete, quotable
  specifics (timeframes, named policies, executable steps) that binary checks reward.
- **Judging is blind**, so none of these movements can come from brand priors: batches carry
  opaque keys and masked text; the audit confirmed verdicts at 97.8% agreement.
- **Scales differ between specs** (v2.1 reads ~+13 higher on this cohort). v1 and v2.1
  scores must never be mixed in one aggregate — the report keeps using v1 aggregates until
  the full corpus (311 remaining conversations) is re-judged under v2.1, after which
  `gen.js` bakes v2.1-only numbers.
- Small cells (n=6 per vendor×lane) — the cohort measures the *process*, not final
  standings; the full re-judge is the authoritative pass.

## Provenance

Baseline snapshot: `eval-baseline-before.json` / `cohort-v1-snapshot.json` (scratchpad,
2026-07-05). v2.1 spec + point mappings: `runner/eval-rubric.md`, `runner/eval-merge.js`.
Audit summary: `runner/eval-audit.json`. Judge-trap catalog: `notes/judge-traps.md`.
