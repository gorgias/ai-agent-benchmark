// Unit tests for the bake-time hand-off re-derivation.  Run:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { rederiveHandover, deriveOutcome } from "./conversation-outcome.js";

const conv = (turns) => ({ key: "fx-store", vendor: "Fx", store: "Fx", widget: "none", turns });

test("rederiveHandover: a missed human take-over becomes the handover; later replies are the human's", () => {
  const c = conv([
    { turn: 1, by: "ai", complete_ms: 9000, handover: false, q: "Refund time?", replyText: "Refunds take 5 business days once we receive the item back at our warehouse." },
    { turn: 2, by: "ai", complete_ms: 23000, handover: false, q: "Exchange?", replyText: "I'll hand you over to an agent now.\nAn agent is joining\nYou are in a queue." },
    { turn: 3, by: "ai", complete_ms: 35000, handover: false, q: "Final sale?", replyText: "Eloise H\n•\nLive Agent\nUnfortunately not." },
  ]);
  const o = deriveOutcome(c);
  assert.equal(o.outcome, "handover");
  assert.equal(c.turns[1].handover, true);
  assert.equal(c.turns[2].by, "human");
  assert.equal(c.turns[2].complete_ms, null);
  assert.deepEqual(rederiveHandover(c), []);   // idempotent
});

test("rederiveHandover: a stored 'handover' that was only an offer is the AI's reply again (still not automated)", () => {
  const c = conv([
    { turn: 1, by: "ai", complete_ms: 8000, handover: false, q: "Hi", replyText: "Happy to help! Our best seller is the Classic Tee at $28, soft cotton, true to size." },
    { turn: 2, by: "human", complete_ms: 6000, ai_latency_ms: null, handover: true, handover_hit: "connect you with", q: "Warranty?", replyText: "I don't have warranty details for that item. If you'd like, I can connect you with someone who can confirm." },
    { turn: 3, by: "human", unsent: true, q: "Total?", replyTail: "(not sent — conversation was handed to a human)" },
  ]);
  const o = deriveOutcome(c);
  assert.equal(c.turns[1].handover, false);
  assert.equal(c.turns[1].handover_offer, true);
  assert.equal(c.turns[1].by, "ai");
  assert.equal(c.turns[1].ai_latency_ms, 6000);
  assert.equal(o.outcome, "deflected");
  assert.equal(c.turns[2].unsent, true);        // a truncated conversation is re-labelled, never re-extended
});

test("rederiveHandover: a stored regex false positive is cleared", () => {
  const c = conv([
    { turn: 1, by: "human", complete_ms: 7000, handover: true, handover_hit: "share your order number? It should start with \"AL\" follow", q: "Damaged item?", replyText: "I'm sorry to hear that! Could you please share your order number? It should start with \"AL\" followed by 7 digits. Once I have that, I can guide you on the next steps." },
  ]);
  const o = deriveOutcome(c);
  assert.equal(c.turns[0].handover, false);
  assert.equal(c.turns[0].handover_rederived, "none");
  assert.equal(o.outcome, "automated");
});
