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
// handing off to a human, is the point. Quality stays 0.30 in support, 0.35 in shopping.

/** Composite weights per lane. a = automation rate, q = judge quality, s = speed score. */
export const LANE_W = {
  shopping: { a: 0.4, q: 0.35, s: 0.25 },
  support: { a: 0.5, q: 0.3, s: 0.2 },
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
