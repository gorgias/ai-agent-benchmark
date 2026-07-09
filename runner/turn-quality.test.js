import test from "node:test";
import assert from "node:assert/strict";
import { conversationTurnQuality } from "./turn-quality.js";

test("support policy turn flags missing duties owner and sales prompt", () => {
  const q = "Do you ship internationally, and who covers customs or duties?";
  const replyTail = `${q}
Ask Maggie
Yes, we do ship internationally worldwide. However, customs rules and regulations vary by country, so please be aware of these when ordering.
Are you looking to purchase something specific for yourself or as a gift?
Looking for a gift
Show me popular items
I need something for myself
Do you have any sales?
What's best for travel?
Give us feedback`;
  const quality = conversationTurnQuality([{ turn: 2, q, by: "ai", complete_ms: 5818, replyTail }], "support");
  const t = quality.turns[0];
  assert.equal(t.measured, true);
  assert.equal(t.substantive, true);
  assert.ok(t.flags.includes("missing_responsible_party"));
  assert.ok(t.flags.includes("sales_prompt_on_support_ask"));
});

test("support policy turn accepts a concrete customs responsibility answer", () => {
  const q = "Do you ship internationally, and who covers customs or duties?";
  const replyTail = `${q}
Yes, we ship internationally. Customers are responsible for any customs duties, import taxes, or brokerage fees charged by their destination country.`;
  const quality = conversationTurnQuality([{ turn: 2, q, by: "ai", complete_ms: 5000, replyTail }], "support");
  assert.deepEqual(quality.turns[0].flags, []);
});

test("shipping ETA asks require a timeframe", () => {
  const q = "How long does standard shipping take once an order is placed?";
  const replyTail = `${q}
Would you like to know about expedited shipping options?
I'm good with standard shipping
Tell me about expedited shipping`;
  const quality = conversationTurnQuality([{ turn: 3, q, by: "ai", complete_ms: 6834, replyTail }], "support");
  assert.ok(quality.turns[0].flags.includes("missing_timeframe"));
});


// ---- clarifying turns are discovery, not failure (2026-07-09) -------------------
import { conversationTurnQuality as ctq } from "./turn-quality.js";
test("a qualifying question suppresses coverage/thin penalties and marks clarifying", () => {
  const turns = [{ turn: 1, by: "ai", complete_ms: 5000, q: "Hi! I'm shopping but not sure what's right for me, can you help me choose?",
    replyText: "We offer a subscription-based service with a variety of sophisticated car fragrances. Please let me know your scent preferences or any specific needs, and I can guide you!" }];
  const r = ctq(turns, "shopping").turns[0];
  assert.ok(r.flags.includes("clarifying_question"));
  assert.ok(!r.flags.includes("low_question_coverage"));
  assert.ok(!r.flags.includes("thin_answer"));
});
test("a non-clarifying thin reply still gets penalized", () => {
  const turns = [{ turn: 1, by: "ai", complete_ms: 5000, q: "What is your return policy for damaged items and refunds?",
    replyText: "We have a returns page." }];
  const r = ctq(turns, "support").turns[0];
  assert.ok(r.flags.includes("thin_answer"));
});
