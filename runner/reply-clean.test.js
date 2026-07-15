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

// ---- Kodif stall/chrome (2026-07-09) -------------------------------------------
test("Kodif stall lines, am/pm clocks and 'Agent response:' prefix are stripped", () => {
  const raw = "06:53 pm\nAgent is thinking...\nGetting the context...\nCooking up something good...\nAgent response: Our Executive razor is the best pick for sensitive skin.";
  assert.equal(stripWidgetChrome(raw, ""), "Our Executive razor is the best pick for sensitive skin.");
});

test("a stall-only capture strips to (almost) nothing — the mistimed-turn detector's signal", () => {
  const raw = "06:53 pm\nAgent is thinking...\nGot it. Popping the hood...";
  assert.ok(stripWidgetChrome(raw, "").length <= 25);
});

// ---- Kodif turn-boundary bundle (2026-07-09 #2): raw+rendered dedupe + role labels ----
test("a raw jammed duplicate line is dropped when the rendered version follows", () => {
  const raw = [
    "response: I understand you're looking for a quality gift! All our products are crafted with quality in mind, and their utility comes from addressing specific daily needs.To help me recommend the perfect gum, could you tell me which benefit matters most?",
    "I understand you're looking for a quality gift! All our products are crafted with quality in mind, and their utility comes from addressing specific daily needs.",
    "To help me recommend the perfect gum, could you tell me which benefit matters most?",
  ].join("\n");
  const out = stripWidgetChrome(raw, "", { breaks: true });
  assert.equal(out.split("\n").length, 2);
  assert.ok(!/response:/i.test(out));
});

test("bare 'User response:' / 'response:' role-label lines are stripped", () => {
  const raw = "User response:\nWhat are my best options?\nresponse:\nOur Calm & Clarity Mints start from $24.99 and are perfect for everyday use.";
  const out = stripWidgetChrome(raw, "What are my best options?");
  assert.ok(out.startsWith("Our Calm & Clarity Mints"));
});

// ---- Envive new-shadow-DOM contamination (2026-07-13): inline CSS, glued name prefix, chips ----
test("stripWidgetChrome: Envive inline SVG-icon CSS is removed, prose kept", () => {
  const raw = "Tushbaby Shopping AssistantI don't have access to specific details about changing shipping addresses for orders. Please contact Customer Support #widget-icon--re- path, #widget-icon--re- rect { fill: var(--envive-colors-text-link) !important; } for assistance.Is there anything else I can help you with?Track my order statusHelp with order trackingGive us feedback";
  const out = stripWidgetChrome(raw, "Can I change the shipping address on an order I just placed?");
  assert.ok(!/widget-icon|var\(|!important|\{/.test(out), "CSS not stripped: " + out);
  assert.ok(!/Shopping Assistant/.test(out), "name prefix not stripped: " + out);
  assert.ok(!/Track my order status|Give us feedback|anything else I can help/i.test(out), "chips not stripped: " + out);
  assert.ok(/don't have access to specific details about changing shipping addresses/.test(out), "prose lost: " + out);
});

test("stripWidgetChrome: glued name prefix 'Supergoop! AINo…' + trailing chips cleaned", () => {
  const raw = "Do I have to pay anything to return the damaged item?Supergoop! AINo, you don't have to pay anything to return the damaged item. We'll provide you with a free return shipping label when you email hello@supergoop.com with your order number.How do I track my order?What's the best SPF for sensitive skin?Give us feedback";
  const out = stripWidgetChrome(raw, "Do I have to pay anything to return the damaged item?");
  assert.ok(out.startsWith("No, you don't have to pay"), "prefix/lead wrong: " + out);
  assert.ok(!/How do I track my order|best SPF|Give us feedback/i.test(out), "chips not stripped: " + out);
  assert.ok(/email hello@supergoop\.com with your order number/.test(out), "answer prose lost: " + out);
});

test("stripWidgetChrome: a real answer with a spaced trailing question is NOT eaten (safety)", () => {
  const out = stripWidgetChrome("You have 30 days from delivery to return unworn items for a full refund. Want me to start a return?", "");
  assert.equal(out, "You have 30 days from delivery to return unworn items for a full refund. Want me to start a return?");
});

// ---- boilerplate-audit findings (2026-07-13): sender labels, disclaimers, nav chrome ----
test("stripWidgetChrome: audit-found sender-label prefixes are stripped (ButcherBot/KAI/Dermalogica)", () => {
  assert.equal(stripWidgetChrome("ButcherBot · AI Your box ships every 4 weeks and you can skip any month.", ""), "Your box ships every 4 weeks and you can skip any month.");
  assert.equal(stripWidgetChrome("KAI • AI ASSISTANT We restock most sizes within 2 weeks.", ""), "We restock most sizes within 2 weeks.");
  assert.ok(!/Virtual Assistant/.test(stripWidgetChrome("Dermalogica's Virtual Assistant · AI says: Use the Daily Microfoliant once a day.", "")));
});
test("stripWidgetChrome: audit-found trailing persona label is stripped (Evry Customer Specialist)", () => {
  const out = stripWidgetChrome("Your ring size can be found using our online guide. Evry Customer Specialist", "");
  assert.equal(out, "Your ring size can be found using our online guide.");
});
test("stripWidgetChrome: audit-found privacy disclaimer is stripped (Oura)", () => {
  const out = stripWidgetChrome("Your ring should arrive in 3-5 business days. By using Oura's virtual assistant, you agree to your data being processed by third parties per our policy.", "");
  assert.ok(/3-5 business days/.test(out) && !/you agree/.test(out), out);
});
test("stripWidgetChrome: Klaviyo nav bar + 'Routed to human agent' lines are noise", () => {
  assert.ok(!/FOR YOU|PROFILE/.test(stripWidgetChrome("We ship worldwide from our LA warehouse.\nFOR YOU ORDERS CHAT PROFILE", "")));
  assert.ok(!/routed to human/i.test(stripWidgetChrome("Let me check that for you.\nRouted to human agent", "")));
});
test("stripWidgetChrome: genuine repeated prose is NOT stripped (equity — a habitual sign-off stays)", () => {
  const out = stripWidgetChrome("Returns are free within 30 days via our portal. Hope that helps!", "");
  assert.equal(out, "Returns are free within 30 days via our portal. Hope that helps!");
});

// ---- Intercom Messenger chrome (Max screenshot 2026-07-15): receipts, team strip, bot labels ----
test("stripWidgetChrome: Intercom read receipts + team strip + bot name are noise", () => {
  const raw = "AvoBot\n\nThe team can also help\n\nWelcome to Avocado Green brands! We can discuss product details.";
  const out = stripWidgetChrome(raw, "", { names: ["AvoBot"] });
  assert.equal(out, "Welcome to Avocado Green brands! We can discuss product details.");
});
test("stripWidgetChrome: 'Seen • Just now' variants + echoed question are stripped (Intercom)", () => {
  const raw = "Seen • Just now\nCan you explain the main options in simple terms?\n• Just now\nSeen • Just now\nHere's a simple breakdown of the main mattress options.";
  const out = stripWidgetChrome(raw, "Can you explain the main options in simple terms?", {});
  assert.equal(out, "Here's a simple breakdown of the main mattress options.");
});
test("stripWidgetChrome: Title-case Bot/AI Agent labels are noise, lowercase prose is kept", () => {
  assert.equal(stripWidgetChrome("Gymshark Bot\nOur Flex leggings are squat-proof and come in 12 colors.", ""), "Our Flex leggings are squat-proof and come in 12 colors.");
  assert.equal(stripWidgetChrome("Tess AI Agent\nYou can pause your plan anytime from settings.", ""), "You can pause your plan anytime from settings.");
  assert.ok(/i am a bot/i.test(stripWidgetChrome("Well, I am a bot", "")));
});
test("stripWidgetChrome: COOKIE CONSENT banner line is noise (Klaviyo)", () => {
  assert.ok(!/cookie/i.test(stripWidgetChrome("COOKIE CONSENT\nWe ship worldwide from our LA warehouse.", "")));
});
