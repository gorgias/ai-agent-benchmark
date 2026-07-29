import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RANK_WINDOW_DAYS, rankCutoff } from "./ranking-window.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(HERE, f), "utf8");

test("the ranking window is 90 days", () => {
  assert.equal(RANK_WINDOW_DAYS, 90);
});

test("the window is inclusive of both ends", () => {
  // A 90-day window ending 2026-07-29 starts 89 days earlier, and spans 90 dates.
  assert.equal(rankCutoff("2026-07-29"), "2026-05-01");
  assert.equal(rankCutoff("2026-07-29", 1), "2026-07-29");
  assert.equal(rankCutoff("2026-07-29", 14), "2026-07-16");
});

test("crosses month and year boundaries correctly", () => {
  assert.equal(rankCutoff("2026-01-05", 10), "2025-12-27");
  assert.equal(rankCutoff("2026-03-01", 2), "2026-02-28");
});

// The regression this file exists for: on 2026-07-29 gen.js ranked on 90 trailing days while
// scoreboard-preview.js defaulted to 14. The dry-run reported Gorgias falling out of #1 support
// on n=24; the published pipeline had n=123 and Gorgias #1. Both tools must ask one question.
test("the baker and the dry-run preview share one window definition", () => {
  for (const f of ["gen.js", "scoreboard-preview.js"]) {
    const src = read(f);
    assert.match(src, /from "\.\/ranking-window\.js"/, `${f} must import the shared window`);
    assert.doesNotMatch(
      src,
      /getUTCDate\(\)\s*-\s*89|DEFAULT_WINDOW_DAYS\s*=\s*\d+/,
      `${f} must not hardcode its own ranking window`,
    );
  }
});
