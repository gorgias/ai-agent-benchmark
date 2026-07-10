// Unit tests for the LOGIN-WALL detection — the 2026-07-10 rule: when a logged-out harness
// triggers a login/verification wall and the AI then STOPS answering, stop the conversation
// (don't fabricate a run of empty "failures"). Critically, this must NOT fire when the AI
// keeps answering after a trailing "Verify order details" button (chrome, not a wall) — the
// exact false-positive that nuked 54 good convs earlier the same day.  Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOGIN_GATE, loginWallStop } from "./reply-clean.js";

// substance proxy for tests: an ai turn with a real complete_ms and non-trivial reply text
const substantive = (t) => t.by === "ai" && t.complete_ms != null && (t.replyText || "").length >= 80;
const A = (text, ms = 14000) => ({ by: "ai", complete_ms: ms, replyText: text });
const EMPTY = () => ({ by: "ai", complete_ms: null, replyText: "" });
const long = (s) => s.padEnd(90, " .");

// ---- the gate phrase matches real login-wall wording -----------------------------
test("LOGIN_GATE matches login/verification wall phrasings", () => {
  for (const s of ["Please log in so we can look up your order.", "Verify order details",
    "Once you're logged in, we can check the latest order details.", "Log in to view your order status"]) {
    assert.ok(LOGIN_GATE.test(s), `should match: ${s}`);
  }
});
test("LOGIN_GATE does not match ordinary answer prose", () => {
  for (const s of ["Our return window is 30 days from delivery.", "The Sport Skort is $68 in Orchid.",
    "I recommend the active dress for an easy one-and-done outfit."]) {
    assert.ok(!LOGIN_GATE.test(s), `should NOT match: ${s}`);
  }
});

// ---- WALL: gated, then answers stop → stop at the first empty turn ----------------
test("stops at first empty turn after a login wall (the Shoebacca case)", () => {
  const turns = [
    A(long("I'm sorry your item arrived damaged. Please log in so we can look up your order.")),
    A(long("Yes, a damaged item is handled differently. Once you log in we can review your order.")),
    A(long("I don't see a photo instruction. Please log in so we can review your order.")),
    EMPTY(), EMPTY(), EMPTY(),   // fake empties the runner used to record as failures
  ];
  assert.equal(loginWallStop(turns, substantive), 3, "should stop at the first empty turn (index 3)");
});

test("stops even when the very first turn gates and yields no answer", () => {
  const turns = [{ by: "ai", complete_ms: null, replyText: "Please log in to continue." }, EMPTY()];
  assert.equal(loginWallStop(turns, substantive), 0);
});

// ---- CHROME: gate button but the AI KEEPS answering → NOT a wall (never fires) -----
test("does NOT fire when the AI keeps answering after a trailing gate button (chrome)", () => {
  const turns = [
    A(long("For a damaged item the resolution is a refund or store credit. Verify order details")),
    A(long("No, you do not pay to return a damaged item. If you log in we can check your order.")),
    A(long("If it was purchased from us we review each affected item. Verify order details")),
  ];
  assert.equal(loginWallStop(turns, substantive), -1, "keep-answering convs must never be walled");
});

test("does NOT fire when there is no gate at all (ordinary unanswered trailing turn)", () => {
  const turns = [A(long("Our return window is 30 days.")), A(long("Shipping is 3-5 business days.")), EMPTY()];
  assert.equal(loginWallStop(turns, substantive), -1);
});

// ---- the Envive-KUT case: trailing gate BUTTON, then more answers, a lone stall, then a
// genuine handover. The gate arm must NOT be sticky, or we'd kill a conversation that
// recovered/handed over (a false wall). This is the regression guard for the run.js fix.
test("does NOT fire on a one-off gate button followed by clean answers + a later stall", () => {
  const turns = [
    A(long("Standard orders ship in 1-2 business days. Verify order details")), // trailing button (chrome)
    A(long("Weekend orders usually ship the following Monday.")),               // clean answers resume, no gate
    A(long("Shipments can be delayed by weather or other circumstances.")),
    A(long("If it already shipped you can start a return once it arrives.")),
    A(long("Send your order number and shipping address and we'll look into it.")),
    EMPTY(),                                                                     // lone stall, NOT gate-adjacent
    A(long("For order status please share the email used to place it.")),        // AI recovers
    { by: "human", complete_ms: 5000, replyText: long("Our team will respond as soon as they join."), handover: true },
  ];
  assert.equal(loginWallStop(turns, substantive), -1, "a non-sticky gate must not wall a recovered/handed-over conv");
});
