import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { substantiveTurnCount, isHollowCapture } from "./integrity.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const conv = (turns) => ({ turns });
const ai = (replyText, q = "") => ({ by: "ai", replyText, q, complete_ms: 5000 });

const SCRAPE =
  "Accessibility Screen-Reader Guide Skip to content " +
  "Shop All About Contact Cart All rights reserved ".repeat(60);

test("a storefront scrape is not a substantive turn", () => {
  assert.equal(substantiveTurnCount(conv([ai(SCRAPE)])), 0);
  assert.equal(isHollowCapture(conv([ai(SCRAPE), ai(SCRAPE)])), true);
});

test("bare widget furniture is not a substantive turn", () => {
  for (const junk of ["Settings", "End Chat", "Sent…", "Today", "   ", "•"]) {
    assert.equal(substantiveTurnCount(conv([ai(junk)])), 0, junk);
  }
});

test("a real answer prefixed by the user's own message still counts", () => {
  // The ECHO_USER_MESSAGE false-positive class: transcripts prefix the reply with the question.
  const q = "My order arrived and one item is damaged, what do I do?";
  const turn = ai(`${q} Horizn Studios KI Agent says: We're very sorry your item arrived damaged — send a photo within 14 days and we ship a replacement free of charge.`, q);
  assert.equal(substantiveTurnCount(conv([turn])), 1);
  assert.equal(isHollowCapture(conv([turn])), false);
});

test("a real answer prefixed by widget chrome still counts", () => {
  // The CHROME_ONLY_REPLY false-positive class.
  const turn = ai("Settings Aura Minimize Chat End Chat Aura Need help? Message from Aura: Hey, I'm Aura! To pick the right Loop, who are they for — adult, teen, or child?");
  assert.equal(substantiveTurnCount(conv([turn])), 1);
});

test("one misread turn does not make the whole capture hollow", () => {
  // The regression this file exists for: quarantining on ANY high-severity turn discarded
  // nine good turns along with the one bad one.
  const c = conv([
    ai("Standard shipping is 5-7 business days once your order ships."),
    ai("Returns are free within 30 days using the portal link in your confirmation email."),
    ai(SCRAPE),
  ]);
  assert.equal(substantiveTurnCount(c), 2);
  assert.equal(isHollowCapture(c), false);
});

test("a capture with no AI turns at all is not reported as hollow", () => {
  assert.equal(isHollowCapture(conv([{ by: "user", text: "hi" }])), false);
});

// Ground truth: conversations read turn-by-turn on 2026-07-29. The five HappyWax/K9 captures
// are genuinely empty (every turn is the ~2.4k-char storefront scrape); the Ada/Loop and
// Siena/FIGS captures carry real agent prose and were wrongly quarantined by the old rule.
const GROUND_TRUTH = [
  ["2026-07-28/klaviyo-happywax-support-damaged.json", true],
  ["2026-07-28/klaviyo-happywax-support-returns.json", true],
  ["2026-07-28/klaviyo-happywax-support-tracking.json", true],
  ["2026-07-28/klaviyo-k9ballistics-shopping-gift.json", true],
  ["2026-07-28/ada-loop-shopping-gift.json", false],
  ["2026-07-28/siena-figs-shopping-problem-solver.json", false],
];

for (const [rel, expectedHollow] of GROUND_TRUTH) {
  const file = path.join(HERE, "results", rel.replace("/", "/conv/"));
  test(`ground truth: ${rel} ${expectedHollow ? "is" : "is not"} hollow`, { skip: !existsSync(file) && "capture not in this checkout" }, () => {
    const c = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(isHollowCapture(c), expectedHollow, `substantive turns: ${substantiveTurnCount(c)}`);
  });
}
