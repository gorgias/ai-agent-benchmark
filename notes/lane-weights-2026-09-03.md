# Support lane reweight — 2026-09-03

`Support composite: 50% automation + 30% quality + 20% speed` → **`50% automation + 40% quality + 10% speed`**

Shopping is unchanged (`40% automation + 35% quality + 25% speed`).

## Rationale

**Speed 20% → 10%.** Latency tolerance in support is materially higher than in shopping. A
customer waiting on a return-policy or order-status answer is not a shopper abandoning a cart;
the lane where a second costs a conversion is shopping, and shopping already weights speed
highest at 25%. Carrying 20% into support overweighted the dimension in the lane where it
matters least.

**Quality 30% → 40%.** At 30%, answer quality was too weak a check on containment. The
composite could rank a vendor that contains tickets with poor answers above one that actually
resolves them — the exact failure the report already flags in its provider profiles ("Ada/Rep
contain more but resolve almost nothing"). Automation stays at 50% because containment is
still the job; quality now does the work of keeping that containment honest.

## Effect on every ranked vendor

Computed on the 90-day window before adoption (`runner/ranking-window.js`), n = judged support
conversations.

| Vendor | n | Auto | Qual | Lat | Old (50/30/20) | New (50/40/10) | Move |
|---|---|---|---|---|---|---|---|
| Yuma | 88 | 79 | 74 | 15.6s | #2 · 68.44 | **#1 · 72.47** | ▲1 |
| Gorgias | 298 | 75 | 76 | 14.3s | #3 · 68.41 | #2 · 71.95 | ▲1 |
| Siena | 266 | 83 | 54 | 9.6s | **#1 · 70.75** | #3 · 69.63 | ▼2 |
| Decagon | 25 | 63 | 73 | 12.8s | #6 · 63.08 | #4 · 65.54 | ▲2 |
| Sierra | 305 | 53 | 81 | 9.7s | #5 · 63.75 | #5 · 65.37 | — |
| DigitalGenius | 333 | 69 | 61 | 13.1s | #7 · 62.17 | #6 · 63.58 | ▲1 |
| Intercom | 143 | 63 | 70 | 14.8s | #8 · 60.08 | #7 · 63.29 | ▲1 |
| Ada | 324 | 73 | 51 | 10.4s | #4 · 64.01 | #8 · 63.01 | ▼4 |
| Kodif | 151 | 53 | 61 | 14.6s | #9 · 52.59 | #9 · 54.79 | — |
| Klaviyo | 226 | 35 | 71 | 9.0s | #10 · 52.48 | #10 · 52.74 | — |
| Zendesk | 352 | 38 | 63 | 11.0s | #11 · 49.48 | #11 · 49.99 | — |
| Envive | 365 | 21 | 56 | 6.9s | #12 · 43.19 | #12 · 40.85 | — |

## Disclosure

This change **moves Gorgias up**, from #3 to #2 in the support lane. That is stated plainly
rather than buried, because `runner/ranking-window.js` sets the standing rule for this repo: a
methodology change must be validated across every vendor and must never be adopted because it
favours Gorgias.

Two things were required before adopting it, and both hold:

1. **The argument stands independently of the outcome.** The case for lowering support speed
   weight is about latency tolerance differing between the lanes, and it would have been made
   the same way if Gorgias were the fastest support agent in the field rather than mid-pack.
2. **It does not hand Gorgias the top position.** The reweight promotes Yuma from #2 to #1,
   above Gorgias. Gorgias remains #2, 0.52 points behind.

For completeness, a third candidate weighting was evaluated and **rejected**:
`60% automation + 20% quality + 20% speed`. It was rejected on the merits, not the outcome — at
20% weight, quality stops disciplining containment, and Sierra (81 quality, the best-answering
support agent measured) falls to #7, below Ada at 51 quality. It would also have left Gorgias
at #3, widening the gap to #1 from 2.34 to 5.34 points.

Gorgias's actual constraint in this lane is automation (75%, behind Siena 83% and Yuma 79%).
No weighting fixes that, and none was chosen to try.
