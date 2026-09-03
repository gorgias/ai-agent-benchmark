// lane-weights.test.js — locks the composite weights and keeps the three copies in sync.
//
// WHY THIS EXISTS (2026-09-03). The lane weights live in three places — gen.js (the baker),
// report.html and takeaways.html (each ships its own browser-side copy for the client-side
// re-rank). They were kept in step only by a "must match" comment. That is the same failure
// mode ranking-window.js was written for: two surfaces, two numbers, one board that quietly
// disagrees with itself. A drifting weight is worse than a wrong one, because the published
// composite and the tooltip explaining it stop describing the same metric.
//
// Changing a weight here is a METHODOLOGY change. Per ranking-window.js, it must be validated
// across every vendor and must never be adopted because it favours Gorgias — publish the
// before/after for the whole field in notes/ before touching these numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(HERE, f), "utf8");

const SHOPPING = { a: 0.4, q: 0.35, s: 0.25 };
const SUPPORT = { a: 0.5, q: 0.4, s: 0.1 };

test("lane weights are the published values", () => {
  assert.deepEqual(SHOPPING, { a: 0.4, q: 0.35, s: 0.25 });
  assert.deepEqual(SUPPORT, { a: 0.5, q: 0.4, s: 0.1 });
});

test("each lane's weights sum to 1", () => {
  for (const [lane, w] of [["shopping", SHOPPING], ["support", SUPPORT]]) {
    const sum = w.a + w.q + w.s;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${lane} weights sum to ${sum}, not 1`);
  }
});

test("support weights automation highest and speed lowest", () => {
  // Containment is the job; a customer waiting on a policy answer is more patient than a
  // shopper mid-purchase. If this ever inverts, the tooltips and README prose are wrong too.
  assert.ok(SUPPORT.a > SUPPORT.q && SUPPORT.q > SUPPORT.s);
});

test("shopping weights speed higher than support does", () => {
  assert.ok(SHOPPING.s > SUPPORT.s, "shopping must weight latency more heavily than support");
});

test("gen.js carries exactly these weights", () => {
  const src = read("gen.js");
  assert.match(
    src,
    /const LANE_W = \{ shopping: \{ a: 0\.4, q: 0\.35, s: 0\.25 \}, support: \{ a: 0\.5, q: 0\.4, s: 0\.1 \} \};/,
    "gen.js LANE_W drifted from lane-weights.test.js",
  );
});

test("the browser copies in report.html and takeaways.html match the baker", () => {
  assert.match(
    read("../report.html"),
    /const LANE_W=\{shopping:\{a:0\.4,q:0\.35,s:0\.25\}, support:\{a:0\.5,q:0\.4,s:0\.1\}\};/,
    "report.html LANE_W drifted from gen.js",
  );
  assert.match(
    read("../takeaways.html"),
    /const LANE_W=\{s:\{a:\.4,q:\.35,sp:\.25\},p:\{a:\.5,q:\.4,sp:\.1\}\};/,
    "takeaways.html LANE_W drifted from gen.js",
  );
});

test("published prose describes the same weights as the code", () => {
  const shopLabel = "40% automation + 35% quality + 25% speed";
  const suppLabel = "50% automation + 40% quality + 10% speed";
  for (const f of ["../report.html", "../takeaways.html", "../README.md"]) {
    const src = read(f);
    assert.ok(src.includes(shopLabel), `${f} is missing/stale on the shopping weights`);
    assert.ok(src.includes(suppLabel), `${f} is missing/stale on the support weights`);
    assert.ok(
      !/\d+% automation \+ 30% quality \+ 20% speed/.test(src),
      `${f} still describes the pre-2026-09-03 support weights`,
    );
  }
});
