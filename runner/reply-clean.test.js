// Unit tests for reply-clean.js — the layer that isolates an AI's prose from raw
// widget-DOM scrape before DISPLAY (report) and JUDGING (eval-pack).  Run:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripWidgetChrome, cleanAnswer } from "./reply-clean.js";

// ---- echoed question removal -------------------------------------------------
test("strips everything up to and including the echoed user question", () => {
  const raw = "Some earlier turn\nCan I cancel an order after placing it?\nYes — orders can be cancelled within 30 minutes of purchase.";
  const out = stripWidgetChrome(raw, "Can I cancel an order after placing it?");
  assert.equal(out, "Yes — orders can be cancelled within 30 minutes of purchase.");
});

test("short questions (≤8 chars) are never used for echo-slicing", () => {
  const raw = "Hi\nWelcome! How can I help you today with your order?";
  assert.ok(stripWidgetChrome(raw, "Hi").includes("Welcome!"));
});

// ---- widget chrome / feedback-UI junk -----------------------------------------
test("feedback-widget chrome lines are stripped (Rufus 'Select All That Apply' block)", () => {
  const raw = ["Great pick for sensitive skin!", "Your feedback has been submitted!", "Select All That Apply (optional):",
    "This is irrelevant", "This is inaccurate", "This is harmful / unsafe", "Something else", "Dismiss", "Submit"].join("\n");
  assert.equal(stripWidgetChrome(raw, ""), "Great pick for sensitive skin!");
});

test("powered-by / rating / price-fragment / star chrome is stripped", () => {
  const raw = ["The Everyday Mug is our bestseller.", "powered by DigitalGenius", "$28", "From", "4.7", "(4639)", "★★★★☆"].join("\n");
  assert.equal(stripWidgetChrome(raw, ""), "The Everyday Mug is our bestseller.");
});

test("suggested-reply chips (short CTA openers) are stripped, real prose survives", () => {
  const raw = ["Show me best sellers", "Browse new arrivals", "Our best seller for beginners is the Starter Kit — it includes everything you need."].join("\n");
  const out = stripWidgetChrome(raw, "");
  assert.equal(out.includes("Show me best sellers"), false);
  assert.ok(out.includes("Starter Kit"));
});

// ---- breaks mode (display) vs flat mode (judge) --------------------------------
// NOTE the chip trade-off: a SHORT trailing question line (≤44 chars ending in "?")
// is treated as a suggested-reply chip and stripped — that is what chips look like.
// Real assistant discovery questions are longer ("Who is the gift for? (e.g., partner,
// family member, coworker)") and survive. Documented, deliberate.
test("default output is a single flat line (judge/regex consumers)", () => {
  const raw = "Who is the gift for? (e.g., partner, family member, coworker)\n• Any interests or hobbies you know of? (e.g., skincare)\nEven a rough idea helps!";
  assert.equal(stripWidgetChrome(raw, "").includes("\n"), false);
});

test("breaks:true keeps one newline per kept line so paragraphs/bullets render", () => {
  const raw = "Who is the gift for? (e.g., partner, family member, coworker)\n• Any interests or hobbies you know of? (e.g., skincare)\nEven a rough idea helps!";
  const out = stripWidgetChrome(raw, "", { breaks: true });
  assert.deepEqual(out.split("\n"), ["Who is the gift for? (e.g., partner, family member, coworker)", "• Any interests or hobbies you know of? (e.g., skincare)", "Even a rough idea helps!"]);
});

test("a short bare question line is treated as a suggested-reply chip and stripped", () => {
  assert.equal(stripWidgetChrome("Who is the gift for?\nThe Starter Kit is the safest first pick — it covers every basic.", ""),
    "The Starter Kit is the safest first pick — it covers every basic.");
});

// ---- cleanAnswer: front-cap with ellipsis --------------------------------------
test("cleanAnswer keeps the START of the answer and appends an ellipsis when capped", () => {
  const long = "The beginning of the answer matters most. " + "word ".repeat(200);
  const out = cleanAnswer(long, "", 80);
  assert.ok(out.startsWith("The beginning of the answer"));
  assert.ok(out.endsWith("…"));
  assert.ok(out.length <= 81);
});

test("cleanAnswer under the cap is returned unchanged (no ellipsis)", () => {
  assert.equal(cleanAnswer("Short and complete.", "", 220), "Short and complete.");
});
