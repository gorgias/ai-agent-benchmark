// lane-weights.js — the single definition of how a lane composite is scored.
//
// WHY THIS EXISTS (2026-09-03). gen.js ranked the published report with LANE-SPECIFIC weights
// while scoreboard-preview.js used a flat 0.40 automation / 0.40 quality / 0.20 speed for both
// lanes. In SUPPORT the published weights are 0.50/0.30/0.20, so the dry-run over-weighted
// quality by 10 points and under-weighted automation by 10 — which systematically favoured
// whichever vendor is quality-strong and automation-weak. Reading the dry-run therefore said
// "Gorgias #1 support" for weeks while the published report said #3, and the discrepancy was
// invisible because both tools printed a column called "Support".
//
// This is the SECOND time the same shape of bug landed in one day: earlier it was the trailing
// window (preview defaulted to 14 days, the baker used 90 — see ranking-window.js). Both had
// one cause: the diagnostic re-implemented the baker's arithmetic instead of importing it. A
// tool that answers a different question than the pipeline is worse than no tool, because it
// is trusted.
//
// LANE RATIONALE (2026-07-10, Max): SHOPPING weights speed higher — latency is critical to
// conversion, a shopper will not wait. SUPPORT weights automation higher — containment, not
// handing off to a human, is the point. Quality was 0.30 in support, 0.35 in shopping.
//
// SUPPORT REWEIGHT (2026-09-03): support goes 0.50/0.30/0.20 -> 0.50/0.40/0.10. Automation is
// untouched and still the largest single weight; shopping is untouched entirely.
//   - Speed 0.20 -> 0.10. Latency tolerance in support is materially higher than in shopping:
//     a customer waiting on a return-policy answer is not a shopper abandoning a cart. Shopping
//     already carries speed at 0.25; 0.20 overweighted it in the lane where it matters least.
//   - Quality 0.30 -> 0.40. At 0.30 quality was too weak a check on containment — the composite
//     could rank a vendor that contains tickets with poor answers above one that resolves them,
//     the failure the provider profiles already flag ("Ada/Rep contain more but resolve almost
//     nothing").
//
// THIS RETIRES AN INVARIANT, DELIBERATELY. The test above these weights used to assert
// `siena > gorgias` under the comment "a quality-strong, automation-weak vendor must not win
// support". That rule was written hours earlier in the same day (#215) while fixing a genuine
// bug: scoreboard-preview.js scored a FLAT 0.40/0.40/0.20 across both lanes, under-weighting
// support automation by 10 points, and the dry-run consequently read "Gorgias #1 support" for
// weeks against a published #3. That bug is NOT this change: it under-weighted automation, and
// automation here stays at 0.50. But the two pull the same lever in the same direction, so the
// distinction is recorded rather than glossed:
//   - The bug was preview/baker DIVERGENCE. That guard is intact and untouched — the baker and
//     the preview still import these weights instead of declaring their own.
//   - The retired assertion was about ORDERING, not divergence. Under 0.50/0.40/0.10 Gorgias
//     (a 74, q 77) does out-rank Siena (a 82, q 55) in support. That is the intended effect of
//     valuing resolution more, and it is the effect that benefits Gorgias.
// What replaces it: automation must still dominate. A vendor far weaker on containment cannot
// buy the lane with quality alone — Sierra (a 53, q 81) still loses to both. That is asserted.
//
// DISCLOSURE: this moves Gorgias #3 -> #2 in support. Yuma takes #1; Gorgias does not reach the
// top. Effect on all 12 ranked vendors, and the rejected 0.60/0.20/0.20 candidate, in
// notes/lane-weights-2026-09-03.md. Per ranking-window.js, a methodology change must be
// validated across every vendor and must never be adopted because it favours Gorgias — the
// argument here is latency tolerance, and it would read the same if Gorgias were the fastest
// support agent in the field rather than mid-pack. Adopted by Max, 2026-09-03.

/** Composite weights per lane. a = automation rate, q = judge quality, s = speed score. */
export const LANE_W = {
  shopping: { a: 0.4, q: 0.35, s: 0.25 },
  support: { a: 0.5, q: 0.4, s: 0.1 },
};

/**
 * Latency (seconds) → 0..100 speed score. 22s scores 0, 3s scores 100; clamped at both ends.
 * The 22s ceiling is the same constant the latency gate uses, so a vendor at the gate's edge
 * scores zero on speed rather than going negative.
 */
export const speedScore = (lat) => Math.max(0, Math.min(100, ((22 - lat) / 19) * 100));

/**
 * Lane composite from {a, q, l}. Missing components are dropped and the remaining weights are
 * renormalised, so a vendor with no judged quality is not silently scored as quality zero.
 * Returns null when nothing is measurable.
 */
export function composite(m, lane) {
  if (!m) return null;
  const w = LANE_W[lane];
  if (!w) throw new Error(`composite(): unknown lane "${lane}" — expected ${Object.keys(LANE_W).join(" | ")}`);
  const parts = [
    [w.a, m.a],
    [w.q, m.q],
    [w.s, m.l != null ? speedScore(m.l) : null],
  ].filter((p) => p[1] != null);
  const tw = parts.reduce((a, p) => a + p[0], 0);
  return tw ? Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / tw) : null;
}
