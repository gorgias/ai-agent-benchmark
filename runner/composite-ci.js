// composite-ci.js — how much of a lane composite is measurement noise.
//
// WHY THIS EXISTS (2026-09-03). The support lane separates Siena (70.0), Yuma (69) and Gorgias
// (68.3) by about a point and a half. Published as bare ranks, that reads as a settled order.
// It may not be one, and the report should say which gaps it can actually resolve.
//
// CLUSTERING IS THE WHOLE POINT. Conversations are NOT independent draws: ten conversations
// against one storefront share a knowledge base, a configuration and a catalogue, so they
// succeed and fail together. Treating them as n independent samples would shrink the interval
// by roughly sqrt(conversations per store) and manufacture confidence we do not have. So the
// unit of replication here is the STORE, not the conversation: compute the composite for each
// store, then take the spread across stores. A vendor measured on many stores earns a tight
// interval; one measured on three does not, however many conversations it ran.
//
// The interval is a 95% t-interval on the store-level mean. It answers: if we tested a
// different sample of this vendor's storefronts, how much would its composite move?

import { LANE_W, speedScore } from "./lane-weights.js";

// Two-sided 95% t critical values by degrees of freedom; beyond 30 the normal value is close
// enough. Small-sample vendors need the wider t value, which is exactly when it matters.
const T95 = [12.71, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
const tCrit = (df) => (df < 1 ? null : df <= 30 ? T95[df - 1] : 1.96);

/**
 * @param {Array<{automated:number, engaged:number, quality:number[], latencies:number[]}>} stores
 *        one entry per storefront, already filtered to the lane and window
 * @param {"shopping"|"support"} lane
 * @returns {{comp:number, ci:number|null, stores:number}|null}
 *          `ci` is the ± half-width; null when too few stores to say anything.
 */
export function compositeCI(stores, lane) {
  const w = LANE_W[lane];
  if (!w) throw new Error(`compositeCI(): unknown lane "${lane}"`);
  const per = [];
  let A = 0, E = 0, Q = [], L = [];
  for (const s of stores) {
    if (!s.engaged) continue;
    A += s.automated; E += s.engaged;
    Q.push(...(s.quality || []));
    L.push(...(s.latencies || []));
    // A store contributes a point estimate only if it can produce all three components;
    // otherwise its composite is not comparable to the others.
    if (!(s.quality || []).length || !(s.latencies || []).length) continue;
    const a = (100 * s.automated) / s.engaged;
    const q = mean(s.quality);
    const l = mean(s.latencies) / 1000;
    per.push(w.a * a + w.q * q + w.s * speedScore(l));
  }
  if (!E || !Q.length || !L.length) return null;
  // The headline stays the pooled figure — the same number the scoreboard has always shown.
  const comp = w.a * ((100 * A) / E) + w.q * mean(Q) + w.s * speedScore(mean(L) / 1000);
  const n = per.length;
  if (n < 3) return { comp, ci: null, stores: n };   // two stores cannot bound anything
  const m = mean(per);
  const sd = Math.sqrt(per.reduce((acc, x) => acc + (x - m) ** 2, 0) / (n - 1));
  const t = tCrit(n - 1);
  return { comp, ci: (t * sd) / Math.sqrt(n), stores: n };
}

/** Do two vendors' intervals overlap? Overlapping intervals are not a resolved ranking. */
export function separated(a, b) {
  if (!a || !b || a.ci == null || b.ci == null) return null;
  return Math.abs(a.comp - b.comp) > a.ci + b.ci;
}

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
