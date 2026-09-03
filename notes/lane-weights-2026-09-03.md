# Support lane reweight — 2026-09-03

`Support composite: 50% automation + 30% quality + 20% speed` → **`50% automation + 40% quality + 10% speed`**

Automation is unchanged and still the largest single weight. Shopping is unchanged entirely
(`40% automation + 35% quality + 25% speed`).

## Rationale

**Speed 20% → 10%.** Latency tolerance in support is materially higher than in shopping. A
customer waiting on a return-policy or order-status answer is not a shopper abandoning a cart;
the lane where a second costs a conversion is shopping, and shopping already weights speed
highest at 25%. Carrying 20% into support overweighted the dimension in the lane where it
matters least.

**Quality 30% → 40%.** At 30%, answer quality was too weak a check on containment. The
composite could rank a vendor that contains tickets with poor answers above one that actually
resolves them — the failure the provider profiles already flag ("Ada/Rep contain more but
resolve almost nothing"). Automation stays at 50% because containment is still the job; quality
now does the work of keeping that containment honest.

## Effect on every ranked vendor

90-day window (`runner/ranking-window.js`), computed before adoption. n = judged support
conversations.

| Vendor | n | Auto | Qual | Lat | Old (50/30/20) | New (50/40/10) | Move |
|---|---|---|---|---|---|---|---|
| Yuma | 103 | 82 | 74 | 16s | #2 · 70 | **#1 · 74** | ▲1 |
| Gorgias | 351 | 74 | 77 | 14.2s | #3 · 68 | #2 · 72 | ▲1 |
| Siena | 280 | 82 | 55 | 9.7s | **#1 · 70** | #3 · 69 | ▼2 |
| Decagon | 25 | 63 | 73 | 12.8s | #6 · 63 | #4 · 66 | ▲2 |
| Sierra | 317 | 53 | 81 | 9.7s | #4 · 64 | #5 · 65 | ▼1 |
| DigitalGenius | 349 | 69 | 62 | 13.1s | #7 · 62 | #6 · 64 | ▲1 |
| Ada | 335 | 73 | 52 | 10.4s | #5 · 64 | #7 · 63 | ▼2 |
| Intercom | 151 | 62 | 71 | 14.8s | #8 · 60 | #8 · 63 | — |
| Kodif | 151 | 53 | 61 | 14.6s | #9 · 53 | #9 · 55 | — |
| Klaviyo | 235 | 34 | 72 | 9s | #10 · 52 | #10 · 53 | — |
| Zendesk | 366 | 39 | 63 | 11s | #11 · 50 | #11 · 50 | — |
| Envive | 382 | 20 | 56 | 6.7s | #12 · 43 | #12 · 40 | — |

## Disclosure

This change **moves Gorgias up**, from #3 to #2 in the support lane. That is stated plainly
rather than buried, because `runner/ranking-window.js` sets the standing rule for this repo: a
methodology change must be validated across every vendor and must never be adopted because it
favours Gorgias.

Two conditions were required, and both hold:

1. **The argument stands independently of the outcome.** The case for lowering support speed
   weight is about latency tolerance differing between the lanes. It would have been made the
   same way if Gorgias were the fastest support agent in the field rather than mid-pack.
2. **It does not hand Gorgias the top position.** The reweight promotes Yuma from #2 to #1,
   above Gorgias, which lands at #2.

### It retires an invariant, deliberately

`runner/lane-weights.test.js` previously asserted `siena > gorgias` under the comment *"a
quality-strong, automation-weak vendor must not win support"*. Under the new weights Gorgias
(automation 74, quality 77) does out-rank Siena (automation 82, quality 55). The assertion was
rewritten, not deleted quietly, and this is the record of why.

That rule was written earlier the same day, in [#215](https://github.com/gorgias/ai-agent-benchmark/pull/215),
while fixing a real bug: `scoreboard-preview.js` scored a flat 0.40/0.40/0.20 across both lanes,
under-weighting support automation by 10 points, so the dry-run read "Gorgias #1 support" for
weeks against a published #3.

**That bug is not this change**, and the distinction matters:

- The bug was **divergence** — the preview re-implementing the baker's arithmetic. That guard is
  intact and untouched: both still import `lane-weights.js` rather than declaring their own
  weights, and the test enforcing it is unchanged.
- The bug **under-weighted automation** to 0.40. This change leaves automation at 0.50.
- The retired assertion was about **ordering**, not divergence. The ordering flip is the intended
  consequence of valuing resolution more — and it is the consequence that benefits Gorgias.

**What replaces it:** automation must still dominate the lane. A vendor far weaker on containment
cannot buy support with quality alone. Sierra — the best-answering support agent measured, at 81
quality on 53% automation — still loses to both Siena and Gorgias, and that is now asserted
directly, along with `LANE_W.support.a > LANE_W.support.q`.

### Rejected candidate

`60% automation + 20% quality + 20% speed` was evaluated and **rejected on the merits**. At 20%
weight quality stops disciplining containment: Sierra falls to #7, below Ada at 52 quality. It
would also have left Gorgias at #3 behind Siena, so it was not rejected for being unfavourable —
it was rejected for breaking the check the reweight exists to strengthen.

Gorgias's actual constraint in this lane is automation: 74%, against Siena and Yuma at 82%. No
weighting fixes that, and none was chosen to try.
