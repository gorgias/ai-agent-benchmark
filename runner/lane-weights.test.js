import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_W, speedScore, composite } from "./lane-weights.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(HERE, f), "utf8");

test("support weights automation above quality; shopping weights speed higher", () => {
  // Support reweighted 2026-09-03: quality 0.30 -> 0.40, speed 0.20 -> 0.10. Automation is
  // unchanged at 0.50 and still the largest single weight. See lane-weights.js for why.
  assert.deepEqual(LANE_W.support, { a: 0.5, q: 0.4, s: 0.1 });
  assert.deepEqual(LANE_W.shopping, { a: 0.4, q: 0.35, s: 0.25 });
  for (const lane of Object.keys(LANE_W)) {
    const w = LANE_W[lane];
    assert.equal(Math.round((w.a + w.q + w.s) * 100), 100, `${lane} weights must sum to 1`);
  }
});

test("speed score is clamped to 0..100 around the 22s gate", () => {
  assert.equal(speedScore(22), 0);
  assert.equal(speedScore(30), 0);
  assert.equal(speedScore(3), 100);
  assert.equal(speedScore(1), 100);
  assert.ok(Math.abs(speedScore(9.6) - 65.26) < 0.01);
});

// The regression this file was created for: reading a dry-run through flat 0.4/0.4/0.2 weights
// said "Gorgias #1 support" while the published report had Siena #1. Same inputs, different
// answer — because the preview re-implemented the arithmetic. That guard is the "neither the
// baker nor the preview re-declares its own weights" test below, and it is untouched.
test("the published support ranking is reproduced from its components", () => {
  const siena = composite({ a: 84, q: 54, l: 9.6 }, "support");
  const gorgias = composite({ a: 76, q: 76, l: 14.3 }, "support");
  assert.equal(siena, 70);
  assert.equal(gorgias, 72);
});

// RETIRED 2026-09-03, deliberately. This test used to assert `siena > gorgias` under the
// comment "a quality-strong, automation-weak vendor must not win support". The support
// reweight (quality 0.30 -> 0.40) reverses that ordering, and the reversal favours Gorgias —
// so it is recorded here rather than quietly deleted. Rationale in lane-weights.js; full
// per-vendor effect in notes/lane-weights-2026-09-03.md.
//
// What survives is the part that was actually load-bearing: automation still dominates the
// lane. Raising quality to 0.40 must not let a vendor buy support on answers alone while
// failing to contain anything.
test("automation still dominates support — quality alone cannot win the lane", () => {
  const sierra = composite({ a: 53, q: 81, l: 9.7 }, "support");   // best answers, weak containment
  const siena = composite({ a: 84, q: 54, l: 9.6 }, "support");    // weak answers, best containment
  const gorgias = composite({ a: 76, q: 76, l: 14.3 }, "support"); // strong on both
  assert.ok(sierra < siena, "the field's best answerer must not out-rank the best container");
  assert.ok(sierra < gorgias, "quality alone must not carry a vendor that hands off half its tickets");
  assert.ok(LANE_W.support.a > LANE_W.support.q, "automation must remain the heaviest support weight");
});

test("a lane must be named — no silent default", () => {
  assert.throws(() => composite({ a: 80, q: 80, l: 10 }), /unknown lane/);
  assert.throws(() => composite({ a: 80, q: 80, l: 10 }, "s"), /unknown lane/);
});

test("missing components renormalise instead of scoring zero", () => {
  // No judged quality: the vendor is scored on automation + speed only, not quality = 0.
  const withQ = composite({ a: 80, q: 80, l: 10 }, "support");
  const noQ = composite({ a: 80, q: null, l: 10 }, "support");
  assert.ok(noQ > 0);
  assert.notEqual(noQ, Math.round(0.5 * 80 + 0.2 * speedScore(10)));
  assert.ok(Math.abs(noQ - withQ) < 25);
});

test("neither the baker nor the preview re-declares its own weights", () => {
  for (const f of ["gen.js", "scoreboard-preview.js"]) {
    const src = read(f);
    assert.match(src, /from "\.\/lane-weights\.js"/, `${f} must import the shared weights`);
    assert.doesNotMatch(src, /LANE_W\s*=\s*\{/, `${f} must not define LANE_W`);
    assert.doesNotMatch(src, /\[0\.4,\s*m\.q\]/, `${f} must not carry the old flat weighting`);
  }
});

// The weights also ship as standalone browser copies inside the two HTML surfaces, which
// cannot import an ES module from runner/. They are the one duplication lane-weights.js cannot
// remove, so they are asserted instead — a report whose client-side re-rank disagrees with the
// baked composite is the same class of bug as the preview/baker split.
test("the browser copies in report.html and takeaways.html match the shared weights", () => {
  const { a, q, s } = LANE_W.support;
  assert.match(
    read("../report.html"),
    new RegExp(`support:\\{a:${a},q:${q},s:${s}\\}`),
    "report.html LANE_W drifted from lane-weights.js",
  );
  assert.match(
    read("../takeaways.html"),
    new RegExp(`p:\\{a:\\${String(a).replace(/^0/, "")},q:\\${String(q).replace(/^0/, "")},sp:\\${String(s).replace(/^0/, "")}\\}`),
    "takeaways.html LANE_W drifted from lane-weights.js",
  );
});

test("published prose describes the same weights as the code", () => {
  const pct = (w) => `${Math.round(w * 100)}%`;
  const label = (w) => `${pct(w.a)} automation + ${pct(w.q)} quality + ${pct(w.s)} speed`;
  for (const f of ["../report.html", "../takeaways.html", "../README.md"]) {
    const src = read(f);
    assert.ok(src.includes(label(LANE_W.shopping)), `${f} is stale on the shopping weights`);
    assert.ok(src.includes(label(LANE_W.support)), `${f} is stale on the support weights`);
    assert.ok(
      !/50% automation \+ 30% quality \+ 20% speed/.test(src),
      `${f} still describes the pre-2026-09-03 support weights`,
    );
  }
});
