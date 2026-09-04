// Tests for composite-ci.js — the ± shown beside every lane composite.
//
// This module was written on 2026-09-03 but nothing imported it until the scoreboard started
// rendering intervals. It is load-bearing on the published board now, so the claim it makes has
// to be tested: that the STOREFRONT is the unit of replication, not the conversation. If that
// ever silently flips, every interval on the board narrows by roughly sqrt(convs per store) and
// the page starts asserting confidence the data does not support.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compositeCI, separated } from "./composite-ci.js";
import { LANE_W, speedScore } from "./lane-weights.js";

// One storefront: `q` judged scores and `l` second latencies, `rate`% of conversations automated.
const store = (q, l, automated = 8, engaged = 10) => ({
  automated, engaged,
  quality: Array.isArray(q) ? q : [q],
  latencies: (Array.isArray(l) ? l : [l]).map((sec) => sec * 1000),
});

test("the pooled composite matches the lane formula", () => {
  const r = compositeCI([store(80, 10), store(80, 10), store(80, 10)], "support");
  const w = LANE_W.support;
  assert.equal(r.comp, w.a * 80 + w.q * 80 + w.s * speedScore(10));
  assert.equal(r.stores, 3);
});

test("identical storefronts have no spread", () => {
  const r = compositeCI([store(80, 10), store(80, 10), store(80, 10)], "support");
  assert.equal(r.ci, 0);
});

test("fewer than three storefronts cannot bound anything", () => {
  for (const n of [1, 2]) {
    const r = compositeCI(Array.from({ length: n }, () => store(80, 10)), "support");
    assert.equal(r.ci, null, `${n} store(s) must not produce an interval`);
    assert.equal(r.stores, n);
  }
});

// THE LOAD-BEARING CLAIM. Ten conversations against one storefront share a knowledge base and a
// config; they are not ten independent draws. Adding more of them must not narrow the interval.
test("conversations within a store do not shrink the interval", () => {
  const one = compositeCI([store(60, 10), store(80, 10), store(100, 10)], "support");
  const many = compositeCI([
    store([60, 60, 60, 60], [10, 10, 10, 10], 32, 40),
    store([80, 80, 80, 80], [10, 10, 10, 10], 32, 40),
    store([100, 100, 100, 100], [10, 10, 10, 10], 32, 40),
  ], "support");
  assert.equal(many.stores, 3, "four conversations per store is still three stores");
  assert.ok(Math.abs(many.ci - one.ci) < 1e-9, "4x the conversations must not change the interval");
  assert.ok(Math.abs(many.comp - one.comp) < 1e-9);
});

// ...but spreading the SAME conversations across more storefronts legitimately does.
test("more storefronts at the same spread narrow the interval", () => {
  const three = compositeCI([store(60, 10), store(80, 10), store(100, 10)], "support");
  const six = compositeCI([
    store(60, 10), store(60, 10), store(80, 10),
    store(80, 10), store(100, 10), store(100, 10),
  ], "support");
  assert.equal(six.stores, 6);
  assert.ok(six.ci < three.ci, `six stores (${six.ci}) must beat three (${three.ci})`);
});

test("a storefront missing a dimension contributes no point estimate", () => {
  const r = compositeCI([
    store(80, 10), store(80, 10), store(80, 10),
    { automated: 5, engaged: 10, quality: [], latencies: [9000] },   // unjudged → not comparable
  ], "support");
  assert.equal(r.stores, 3, "the unjudged store must not count toward the interval");
});

test("nothing measurable returns null rather than a fabricated zero", () => {
  assert.equal(compositeCI([], "support"), null);
  assert.equal(compositeCI([{ automated: 0, engaged: 0, quality: [], latencies: [] }], "support"), null);
});

test("an unknown lane throws instead of silently picking one", () => {
  assert.throws(() => compositeCI([store(80, 10)], "suport"), /unknown lane/);
});

test("overlapping intervals are reported as an unresolved ranking", () => {
  const tight = { comp: 72, ci: 1 };
  const wide = { comp: 74, ci: 9 };
  assert.equal(separated(tight, wide), false, "72±1 vs 74±9 overlap — not separated");
  assert.equal(separated({ comp: 72, ci: 0.5 }, { comp: 80, ci: 0.5 }), true);
  assert.equal(separated(tight, { comp: 74, ci: null }), null, "no interval → no verdict");
});
