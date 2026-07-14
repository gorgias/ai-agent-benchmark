// Unit tests for conversation-integrity detectors.  Run:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isUserEcho, isChromeOnly, isImplausiblyFast, isPageDump, scanConversation, integrityVerdict } from "./integrity.js";

const ai = (o) => ({ by: "ai", complete_ms: 4000, ai_latency_ms: 4000, ...o });

test("isUserEcho: explicit 'You say:' echo chrome is flagged", () => {
  assert.equal(isUserEcho(ai({ q: "What is your return policy?", replyText: "You say: What is your return policy? Sent · Just now Grove Guide Team" })), true);
});
test("isUserEcho: reply dominated by the echoed question is flagged", () => {
  assert.equal(isUserEcho(ai({ q: "How many days do I have to return something?", replyText: "How many days do I have to return something?" })), true);
});
test("isUserEcho: a real answer that repeats a few question words is NOT flagged", () => {
  assert.equal(isUserEcho(ai({ q: "What is your return policy?", replyText: "Our return policy gives you 30 days from delivery to send unworn items back for a full refund via our portal at brand.com/returns." })), false);
});

test("isChromeOnly: a reply that is only KB/nav chrome is flagged", () => {
  assert.equal(isChromeOnly(ai({ q: "My order arrived damaged.", replyText: "View article  Next item  Was this helpful?  Related articles" })), true);
  assert.equal(isChromeOnly(ai({ q: "hi", replyText: "Sent · Just now" })), true);
});
test("isChromeOnly: a substantive answer is NOT flagged", () => {
  assert.equal(isChromeOnly(ai({ q: "damaged?", replyText: "So sorry! Send a photo of the damage within 30 days and we'll ship a free replacement right away." })), false);
});
test("isChromeOnly: an un-timed turn (no answer counted) is not flagged", () => {
  assert.equal(isChromeOnly({ by: "ai", complete_ms: null, ai_latency_ms: null, replyText: "View article" }), false);
});

test("isImplausiblyFast: sub-700ms answer with content is flagged; a normal-latency answer is not", () => {
  assert.equal(isImplausiblyFast(ai({ ai_latency_ms: 350, replyText: "Yes we ship to Canada." })), true);
  assert.equal(isImplausiblyFast(ai({ ai_latency_ms: 5200, replyText: "Yes we ship to Canada." })), false);
});

test("scanConversation: the Grove echo/deflection conversation is HIGH severity", () => {
  const conv = { vendor: "Meta AI", store: "Grove", turns: [
    { by: "user", q: "What is your return policy?" },
    ai({ turn: 2, q: "What is your return policy?", replyText: "You say: What is your return policy? Sent · Just now Grove Guide Team" }),
    ai({ turn: 3, q: "How many days?", replyText: "You say: How many days? Sent · Just now Grove Guide Team" }),
  ] };
  const v = integrityVerdict(conv);
  assert.equal(v.flagged, true);
  assert.equal(v.severity, "high");
});

test("scanConversation: a clean Gorgias answer conversation produces NO flags", () => {
  const conv = { vendor: "Gorgias", store: "Beekman", turns: [
    ai({ turn: 1, q: "return policy?", replyText: "You have 30 days from delivery to return unworn items for a full refund. Start at beekman1802.com/returns and we'll email a prepaid label." }),
    ai({ turn: 2, q: "damaged item?", replyText: "So sorry about that — send a photo within 14 days and we'll ship a free replacement, no need to return the damaged one." }),
    ai({ turn: 3, q: "expedite?", replyText: "Yes! Choose expedited shipping at checkout for delivery in 2 business days; orders before 2pm ET ship same day." }),
  ] };
  assert.equal(scanConversation(conv).length, 0);
});

test("scanConversation: ≥3 identical replies flags REPEATED (low, review)", () => {
  const same = "If you'd like to be transferred to a guide, please select talk to a human below and we will help.";
  const conv = { turns: [ ai({ turn: 1, replyText: same }), ai({ turn: 2, replyText: same }), ai({ turn: 3, replyText: same }) ] };
  const codes = scanConversation(conv).map((f) => f.code);
  assert.ok(codes.includes("REPEATED_IDENTICAL_REPLY"));
});

// ---- PAGE DUMP (2026-07-14, klaviyo-nanuk): reader captured the storefront instead of the chat ----
test("isPageDump: country-selector/homepage dump captured as a reply is flagged", () => {
  assert.equal(isPageDump("Please select your shipping country. Please select your shipping country. Buy from the country of your choice. CASES BAGS ACCESSORIES injection-molded pro"), true);
});
test("isPageDump: a real answer that merely mentions shipping countries is NOT flagged", () => {
  assert.equal(isPageDump("We ship to 40+ countries. Once you pick your shipping country at checkout, duties are calculated automatically and delivery takes 5-7 business days."), false);
});
test("scanConversation: a nanuk-style dump conversation is HIGH severity", () => {
  const conv = { turns: [
    { by: "ai", complete_ms: 9000, ai_latency_ms: 9000, turn: 1, replyText: "To get started, our small cases fit cameras and drones; tell me what you carry." },
    { by: "ai", complete_ms: 21000, ai_latency_ms: 21000, turn: 2, replyText: "Please select your shipping country. Please select your shipping country. Buy from the country of your choice. CASES BAGS" },
  ] };
  const v = integrityVerdict(conv);
  assert.equal(v.severity, "high");
  assert.ok(v.flags.some(f => f.code === "PAGE_DUMP_REPLY"));
});
