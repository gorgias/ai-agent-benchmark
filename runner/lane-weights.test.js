import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_W, speedScore, composite } from "./lane-weights.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(HERE, f), "utf8");

test("support weights automation above quality; shopping weights speed higher", () => {
  assert.deepEqual(LANE_W.support, { a: 0.5, q: 0.3, s: 0.2 });
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

// The regression: reading a dry-run through flat 0.4/0.4/0.2 weights said "Gorgias #1 support"
// while the published report, on 0.5/0.3/0.2, had Siena #1. Same inputs, different answer.
test("the published support ranking is reproduced from its components", () => {
  const siena = composite({ a: 84, q: 54, l: 9.6 }, "support");
  const gorgias = composite({ a: 76, q: 76, l: 14.3 }, "support");
  assert.equal(siena, 71);
  assert.equal(gorgias, 69);
  assert.ok(siena > gorgias, "a quality-strong, automation-weak vendor must not win support");
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
