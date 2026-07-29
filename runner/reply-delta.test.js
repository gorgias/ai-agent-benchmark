import { test } from "node:test";
import assert from "node:assert/strict";
import { novelLines } from "./reply-delta.js";

// The defect this guards against: a re-rendered widget makes the prefix scan fail and the
// whole transcript — storefront chrome included — gets stored as one turn's reply.
const PAGE = [
  "Accessibility Screen-Reader Guide",
  "Skip to content",
  "Shop All",
  "About",
  "Cart",
  "All rights reserved",
].join("\n");

test("drops page chrome that was already on screen before the turn", () => {
  const before = `${PAGE}\nYou: Where is my order?`;
  const after = `${PAGE}\nYou: Where is my order?\nAgent: It shipped Tuesday and arrives Friday.`;
  assert.equal(novelLines(before, after), "Agent: It shipped Tuesday and arrives Friday.");
});

test("survives a reshuffled container (the case the prefix scan cannot handle)", () => {
  // Same content, reordered — a virtualized list dropping and re-adding nodes.
  const before = `${PAGE}\nAgent: Hi! How can I help?`;
  const after = ["Agent: Hi! How can I help?", PAGE, "Agent: Returns are free within 30 days."].join("\n");
  assert.equal(novelLines(before, after), "Agent: Returns are free within 30 days.");
});

test("keeps the head of a long answer, not just its tail", () => {
  const before = PAGE;
  const after = `${PAGE}\nAgent: First, open the returns portal.\nThen pick your order.\nA label is emailed to you.`;
  const got = novelLines(before, after);
  assert.ok(got.startsWith("Agent: First, open the returns portal."), got.slice(0, 60));
  assert.ok(got.includes("A label is emailed to you."));
});

test("a turn that adds nothing yields empty, never the whole page", () => {
  const got = novelLines(PAGE, PAGE);
  assert.equal(got, "");
  assert.ok(!got.includes("Skip to content"));
});

test("ignores indentation churn from a re-render", () => {
  const before = "Agent: Hello\n  Shop All";
  const after = "Agent: Hello\n\t\tShop All\nAgent: Free shipping over $75.";
  assert.equal(novelLines(before, after), "Agent: Free shipping over $75.");
});

test("does not repeat a line duplicated inside the same turn", () => {
  const before = "You: hi";
  const after = "You: hi\nAgent: Anything else?\nAgent: Anything else?";
  assert.equal(novelLines(before, after), "Agent: Anything else?");
});

test("handles null/undefined without throwing", () => {
  assert.equal(novelLines(undefined, undefined), "");
  assert.equal(novelLines(null, "Agent: hi"), "Agent: hi");
});
