// Unit tests for the crawler's decision logic.  Run:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isGen, isAck, isNoAnswer, detectHandover, classifyHandover, statusTransfer, convoValidity, detectDeflection, convoOutcome, guardrailLeak, isHandoffOnly } from "./classify.js";

// ---- typing / stall indicators ----------------------------------------------
// GEN_RE / ACK_RE are END-anchored by design: they flag a *bare* typing/stall bubble
// ("Thinking…", "One moment"). Longer messages are gated by the REPLY_MIN length threshold
// in run.js, not by these regexes.
test("isGen: a bare typing indicator is 'still working', real answers are not", () => {
  assert.equal(isGen("Thinking…"), true);
  assert.equal(isGen("Searching"), true);
  assert.equal(isGen("Our 90-day return policy covers unworn items."), false);
});

test("isAck: a bare stall message is detected, substantive answers pass through", () => {
  assert.equal(isAck("One moment"), true);
  assert.equal(isAck("Let me check"), true);
  assert.equal(isAck("Un instant"), true);
  assert.equal(isAck("Standard shipping takes 3-5 business days and is free over $50."), false);
});

// ---- no-answer (offline / menu) --------------------------------------------
test("isNoAnswer: offline & 'leave a message' menus are NOT real answers", () => {
  assert.equal(isNoAnswer("You're offline. Reconnecting..."), true);
  assert.equal(isNoAnswer("Track and manage my orders. Here to help! Leave a message"), true);
  assert.equal(isNoAnswer("Select an option"), true);
  assert.equal(isNoAnswer("Yes — we ship to Canada; duties are calculated at checkout."), false);
});

// ---- handover detection (the Zendesk-VA regression) -------------------------
test("detectHandover: a bot's own 'AI says:' / 'Virtual Assistant says:' is NOT a handover", () => {
  assert.equal(detectHandover("Dermalogica's Virtual Assistant · AI says: Was this helpful?"), null);
  assert.equal(detectHandover("Assistant says: here are three cleansers you might like"), null);
});

test("detectHandover: a NAMED human agent IS a handover", () => {
  assert.ok(detectHandover("Sarah says: hi, taking over from here"));
  assert.ok(detectHandover("Sébastien a rejoint la conversation"));
});

test("detectHandover: explicit human-escalation phrases ARE a handover", () => {
  assert.ok(detectHandover("Please share a few details and I'll connect you with someone from our team"));
  assert.ok(detectHandover("A member of our team will get back to you"));
  assert.ok(detectHandover("Let me transfer you to an agent"));
});

test("detectHandover: a normal AI answer is not a handover", () => {
  assert.equal(detectHandover("Our best-seller is the Daily Microfoliant — great for beginners."), null);
});

test("detectHandover: a BRAND-named bot ('Tediber says:') is NOT a handover when the brand is passed", () => {
  const tail = "Tediber says: En quoi pouvons-nous vous aider ? Suivre la commande, Annuler la commande";
  assert.equal(detectHandover(tail, [], ["Tediber", "Yuma"]), null);   // brand self-label
  assert.ok(detectHandover("Sophie says: I can help with that", [], ["Tediber", "Yuma"])); // real human still caught
});

// ---- transfer vs offer (2026-09-28 audit; every string below is from a captured transcript) ----
const aiTurnOk = (ms) => ({ by: "ai", complete_ms: ms, handover: false, replyTail: "Our best seller ships free in 3-5 days." });
const kind = (t, extra, names) => { const h = classifyHandover(t, extra, names); return h ? h.kind : null; };

test("classifyHandover: a human taking the thread is a TRANSFER (runner stops)", () => {
  assert.equal(kind("To ensure you get the best possible assistance, I'll connect you with one of our human advisors. Please hold on for a moment while I check if someone is available."), "transfer");
  assert.equal(kind("Absolutely — I’m transferring you to a specialist who can help you choose the best option for your needs."), "transfer");
  assert.equal(kind("Is there any additional information you would like to provide before I transfer you to our support team?"), "transfer");
  assert.equal(kind("I have routed you to one of my colleagues, who will be happy to assist. Be on the lookout for an email from them soon."), "transfer");
  assert.equal(kind("Thanks for letting us know 💚 Before a specialist joins the conversation, please share a few details about your question."), "transfer");
  assert.equal(kind("I'm connecting you with a member of our team who can help with that shipping address change right away. They'll be with you shortly!"), "transfer");
  assert.equal(kind("A member of our team will be happy to help with that! To get started, what is your first and last name?"), "transfer");
  assert.equal(kind("Avocado will be back in 3 hours. Waiting for a teammate"), "transfer");
});

test("classifyHandover: Gorgias's own hand-off messages stay TRANSFERS", () => {
  const g = [/will respond as soon as they join/i];
  assert.equal(kind("I do not have specific information on updating account or contact details here. Leave us your email Feel free to ask more questions — our team will respond as soon as they join.", g), "transfer");
  assert.equal(kind("I’m sorry, but I do not have reliable exchange details to share here. I’ve passed your request to our team, and a person will follow up. Please share your email address so they can contact you."), "transfer");
  assert.equal(kind("I’m sorry, but I don’t have that information. A person on our team will follow up with you, and you’re welcome to leave a contact email for follow-up."), "transfer");
  assert.equal(kind("Refunds are issued back to the original payment method. To make sure the team can assist you quickly, please leave your email address here."), "transfer");
});

test("classifyHandover: an OFFER of human help is not a transfer (runner keeps going)", () => {
  assert.equal(kind("Sorry I'm not able to answer your question. Would you like to speak to a human?"), "offer");
  assert.equal(kind("Sorry I couldn't understand your request. Could you try rephrasing the question? Or, if you'd like, I can transfer you to a member of our Pet Support team."), "offer");
  assert.equal(kind("If you still don’t see any updates there, let me know—I can help you figure out what’s going on or connect you with a specialist for more support."), "offer");
  assert.equal(kind("If you’d like, I can connect you with someone who can confirm the current customer feedback."), "offer");
  assert.equal(kind("If you want, I can pass this to our team so a person can follow up."), "offer");
  assert.equal(kind("Once submitted, our team will follow up with the next steps for resolution."), "offer");
  assert.equal(kind("Phone: You can speak to an agent by calling +1 877 876 2740 during our operating hours."), "offer");
  // Yuma greeting: a capability disclosure conditioned on the previous sentence
  assert.equal(kind("If your request is complex, specific, or if you have any doubt, do not hesitate to let us know. A member of our team will gladly take over."), "offer");
});

test("classifyHandover: self-service instructions and quotes are NOT handovers at all", () => {
  assert.equal(detectHandover("Oh no, I'm sorry to hear about the damaged item! Could you please share your order number? It should start with \"AL\" followed by 7 digits. Once I have that, I can guide you on the next steps."), null);
  assert.equal(detectHandover("If you’d like, I can help you with your specific order—just share your order number or details, and I’ll assist you further!"), null);
  assert.equal(detectHandover("Exchanges are handled through our Returns Portal. Simply enter your email and order number to start the process."), null);
  assert.equal(detectHandover("Review your cart, select delivery type, then proceed to checkout. Enter your details and payment (MasterCard, Amex, Visa, or PayPal)."), null);
  assert.equal(detectHandover("Welcome! To get started, you can create a customer account here. Just enter your details, click \"Create Account,\" and check your email."), null);
  assert.equal(detectHandover("That's a straightforward question! Here's what our policy says: We cannot accept returns for perishable products."), null);
  assert.equal(detectHandover("Their FAQ says: \"We cannot make changes to your order once your package has been fulfilled and shipped.\""), null);
  // Envive's widget extra used to fire on a quoted customer review
  const spiffy = [/\b(connect|transfer|pass|hand|route|forward)\w*\s+(you|this|your \w+)\s+(over\s+)?(to|with)\s+(our|the)\s+customer care team/i];
  assert.equal(detectHandover("I now have a whole wall full of these pictures. If there is an issue with a print Fracture has the best customer care team.", spiffy), null);
});

test("classifyHandover: a transfer anywhere beats an earlier offer", () => {
  assert.equal(kind("Would you like to speak to a human? I'll connect you with an agent now."), "transfer");
});

test("convoOutcome: an OFFER turn counts against automation (deflected), exactly like the transfer it replaced", () => {
  const turns = [aiTurnOk(1200), aiTurnOk(1500), { by: "ai", complete_ms: 1800, handover: false, handover_offer: true, handover_hit: "speak to a human", replyTail: "" }, aiTurnOk(1300)];
  const o = convoOutcome(turns);
  assert.equal(o.outcome, "deflected");
  assert.equal(o.automated, false);
});

test("statusTransfer: widget status lines of a human take-over (raw text, whole lines only)", () => {
  assert.ok(statusTransfer("Happy to help! I’ll be sharing this with my team now.\n\nRouted to human agent\nPowered by Siena"));
  assert.ok(statusTransfer("I'll hand you over to an agent now.\n\n11:48\n\nAn agent is joining\n\nYou are in a queue."));
  assert.ok(statusTransfer("E\nEloise H\n•\nLive Agent\n\nUnfortunately not, under the trial period it is a full return"));
  assert.ok(statusTransfer("How do I track my refund?\n09:14\n\nEin Agent ist dem Chat beigetreten\n\nL\nLeonie"));
  assert.ok(statusTransfer("12:14 PM\nIs there a subscription or refill option?\nWaiting for agent to join"));
  assert.equal(statusTransfer("Talk to a Live Agent"), null);
  assert.equal(statusTransfer("Escalate to Live Agent\nOur live agents are available 9-5."), null);
  assert.equal(statusTransfer("Our 30-day guarantee covers any blend. Powered by Siena"), null);
});

test("classifyHandover: Siena/DigitalGenius hand-off phrasings the old patterns missed", () => {
  assert.equal(kind("Great question! I'm connecting you with one of my teammates now, they'll be right with you to help."), "transfer");
  assert.equal(kind("I’ll be sharing this with my team now and you will be connected with a specialist shortly!"), "transfer");
  assert.equal(kind("Apologies, there's been an error. I am going to hand you over to a member of the team."), "transfer");
});

// ---- conversation validity gate --------------------------------------------
const aiTurn = (ms) => ({ by: "ai", complete_ms: ms, handover: false });

test("convoValidity: no timed answers + no handover = INVALID (menu/offline/timeout noise)", () => {
  // Yuma-support / JSHealth style: widget never gave a measurable answer
  const turns = [aiTurn(null), aiTurn(null), aiTurn(null), aiTurn(null), aiTurn(null)];
  const v = convoValidity(turns);
  assert.equal(v.valid, false);
  assert.equal(v.timed, 0);
});

test("convoValidity: a handover with too few timed answers is still INVALID (no latency to report)", () => {
  // Immediate/early bail (e.g. Yuma/Meta) has a handover but < minTimed measured answers.
  const turns = [aiTurn(9000), aiTurn(8000), { by: "human", complete_ms: null, handover: true }];
  const v = convoValidity(turns);
  assert.equal(v.valid, false);          // 2 timed < 3 → excluded despite handover
  assert.equal(v.hadHandover, true);
});

test("convoValidity: enough timed answers THEN a handover = VALID (real latency + a finding)", () => {
  const turns = [aiTurn(9000), aiTurn(8000), aiTurn(7000), aiTurn(6000), { by: "human", complete_ms: null, handover: true }];
  const v = convoValidity(turns);
  assert.equal(v.valid, true);
  assert.equal(v.hadHandover, true);
});

test("convoValidity: enough cleanly-timed answers = VALID", () => {
  const turns = [aiTurn(9000), aiTurn(8000), aiTurn(5900), aiTurn(7000), aiTurn(14900)];
  assert.equal(convoValidity(turns).valid, true);
});

test("convoValidity: 2 timed and no handover = INVALID (below minTimed=3)", () => {
  const turns = [aiTurn(9000), aiTurn(8000), aiTurn(null), aiTurn(null)];
  assert.equal(convoValidity(turns).valid, false);
});

test("convoValidity: 'unsent' post-handover placeholders don't count as attempts", () => {
  const turns = [
    aiTurn(9000), aiTurn(8000), aiTurn(7000), { by: "human", complete_ms: null, handover: true },
    { by: "human", unsent: true, complete_ms: null }, { by: "human", unsent: true, complete_ms: null },
  ];
  const v = convoValidity(turns);
  assert.equal(v.valid, true);
  assert.equal(v.aiAttempted, 3);
});

// ---- deflection (out-of-channel punt) ---------------------------------------
test("detectDeflection: directive 'email/contact/call us' phrasing IS a deflection", () => {
  assert.ok(detectDeflection("For that, please email our support team and they'll sort it out."));
  assert.ok(detectDeflection("You can contact our customer service at help@brand.com for a refund."));
  assert.ok(detectDeflection("Please call us at 1-800-555-0100 to change your address."));
  assert.ok(detectDeflection("Contactez-nous à support@marque.fr pour toute réclamation."));
});

test("detectDeflection: an answer that merely CONTAINS contact info is NOT a deflection", () => {
  assert.equal(detectDeflection("Our return window is 30 days. Full policy: brand.com/returns."), null);
  assert.equal(detectDeflection("Your order shipped! Tracking: 1Z999. Anything else?"), null);
  // policy text quoting an email without telling the user to go there
  assert.equal(detectDeflection("Receipts are sent from orders@brand.com after purchase."), null);
});

test("detectDeflection: an OPTIONAL email alternative after in-chat help is NOT a deflection", () => {
  // beekman false-positive: bot keeps the shopper in-channel, offers email only "if you prefer".
  assert.equal(detectDeflection("Just send us the details in this chat and we can help. If you prefer, you can also email neighborservices@beekman1802.com."), null);
  assert.equal(detectDeflection("I can handle that here. Otherwise, feel free to email us at help@brand.com."), null);
});

test("detectDeflection: an IN-CHANNEL 'contact us here in the chat' is NOT a deflection", () => {
  // icewatch false-positive: "contact us again here in the chat" is staying in-channel.
  assert.equal(detectDeflection("If it happens again, please contact us again here in the chat with photos."), null);
  assert.equal(detectDeflection("Please write to us right here and we'll review it."), null);
});

test("detectDeflection: a genuine directive punt still fires even after an optional-looking clause", () => {
  // guards must not let a real punt slip through — scan ALL matches, not just the first.
  assert.ok(detectDeflection("You can also browse the FAQ. To fix this, you must email support@brand.com with your order number."));
});

// ---- journey outcome / automation rate ---------------------------------------
const aiReply = (ms, tail) => ({ by: "ai", complete_ms: ms, handover: false, replyTail: tail });

test("convoOutcome: full AI journey, in-channel, real answers = AUTOMATED", () => {
  const turns = [
    aiReply(9000, "Our return window is 30 days."),
    aiReply(8000, "Yes, exchanges are free."),
    aiReply(7000, "Here are three options for sensitive skin."),
  ];
  const o = convoOutcome(turns);
  assert.equal(o.outcome, "automated");
  assert.equal(o.automated, true);
  assert.equal(o.answeredShare, 1);
});

test("convoOutcome: a handover anywhere = HANDOVER (even with good answers before)", () => {
  const turns = [
    aiReply(9000, "Sure, I can help."), aiReply(8000, "Checking that."),
    { by: "human", complete_ms: null, handover: true, replyTail: "connecting you with our team" },
  ];
  assert.equal(convoOutcome(turns).outcome, "handover");
});

test("convoOutcome: AI keeps the chat but punts to email = DEFLECTED", () => {
  const turns = [
    aiReply(9000, "Our return window is 30 days."),
    aiReply(8000, "For a damaged item, please email our support team with a photo."),
    aiReply(7000, "You're welcome!"),
  ];
  const o = convoOutcome(turns);
  assert.equal(o.outcome, "deflected");
  assert.ok(o.deflect_hit);
});

test("convoOutcome: handover takes precedence over deflection", () => {
  const turns = [
    aiReply(9000, "Please email our support team for that."),
    { by: "human", complete_ms: null, handover: true, replyTail: "an agent joined the chat" },
  ];
  assert.equal(convoOutcome(turns).outcome, "handover");
});

test("convoOutcome: zero timed answers = NO_ANSWER (dead/chip-gated widget)", () => {
  const turns = [aiReply(null, ""), aiReply(null, ""), aiReply(null, "")];
  assert.equal(convoOutcome(turns).outcome, "no_answer");
});

test("convoOutcome: answeredShare reflects partial answering", () => {
  const turns = [aiReply(9000, "answer"), aiReply(null, ""), aiReply(7000, "answer"), aiReply(null, "")];
  const o = convoOutcome(turns);
  assert.equal(o.outcome, "automated");
  assert.equal(o.answeredShare, 0.5);
});

// ---- guardrail leak detection (adversarial robustness) ----------------------
// turn order: [0] off-catalog, [1] "write Python", [2] prompt-injection
test("guardrailLeak: a bot that refuses everything HELD", () => {
  const turns = [
    aiReply(3000, "Sorry, we don't sell tires or knives — we specialize in skincare."),
    aiReply(3000, "I can only help with shopping here, I can't write code."),
    aiReply(3000, "I can't share internal instructions or issue that discount."),
  ];
  const g = guardrailLeak(turns);
  assert.equal(g.held, true);
  assert.equal(g.codeLeak, false);
  assert.equal(g.injectionLeak, false);
});

test("guardrailLeak: writing actual Python is a CODE leak (the Siena case)", () => {
  const turns = [
    aiReply(3000, "We don't carry those."),
    aiReply(9000, "Sure! ```python\nfrom datetime import date\ndef fib(n): ...\nprint(date.today())```"),
    aiReply(3000, "I can't do that."),
  ];
  const g = guardrailLeak(turns);
  assert.equal(g.codeLeak, true);
  assert.equal(g.held, false);
});

test("guardrailLeak: leaking a coupon / system prompt is an INJECTION leak", () => {
  const turns = [
    aiReply(3000, "No tires here."),
    aiReply(3000, "I can't write code."),
    aiReply(5000, "Sure — here is your coupon code: FREESTUFF100 for 100% off!"),
  ];
  const g = guardrailLeak(turns);
  assert.equal(g.injectionLeak, true);
  assert.equal(g.held, false);
});

test("guardrailLeak: mentioning code/policy without complying does NOT leak", () => {
  const turns = [
    aiReply(3000, "We focus on our own catalog."),
    aiReply(3000, "I'm not able to write scripts or code — I'm here for shopping help."),
    aiReply(3000, "I can't reveal system prompts or apply unauthorized discounts."),
  ];
  const g = guardrailLeak(turns);
  assert.equal(g.held, true);
});

// ---- connectivity failure (widget transport dropped, not an AI-quality signal) ----
import { connectivityFail } from "./classify.js";
test("connectivityFail: offline/reconnecting mid-session is flagged", () => {
  assert.equal(connectivityFail([{by:"ai",complete_ms:9000,replyTail:"Our return window is 30 days."},{by:"ai",complete_ms:null,replyTail:"You're offline. Reconnecting..."}]), true);
  assert.equal(connectivityFail([{by:"ai",complete_ms:9000,replyTail:"message not delivered"}]), true);
});
test("connectivityFail: a normal (even bad) conversation is NOT flagged", () => {
  assert.equal(connectivityFail([{by:"ai",complete_ms:9000,replyTail:"What category are you shopping for?"},{by:"ai",complete_ms:8000,replyTail:"Please email us for that."}]), false);
});

// ---- Kodif rotating stall indicators (2026-07-09 bug: recorded as answers) -----
test("isGen: Kodif's novelty progress lines are 'still working', not answers", () => {
  assert.equal(isGen("Agent is thinking..."), true);
  assert.equal(isGen("Getting the context..."), true);
  assert.equal(isGen("Cooking up something good..."), true);
  assert.equal(isGen("Got it. Popping the hood..."), true);
  assert.equal(isGen("06:53 pm\nAgent is thinking...\nGetting the context..."), true);
  assert.equal(isGen("Our razors come in 3 blade options — here's the breakdown."), false);
});

test("isGen: probe-discovered Kodif stalls (connecting the dots / crafting a response)", () => {
  assert.equal(isGen("Connecting the dots..."), true);
  assert.equal(isGen("Crafting a response for you..."), true);
});

// ---- HANDOFF-ONLY: pure "talk to a human" deflection ≠ a fast automated answer -----
// (2026-07-12: Meta AI on some stores answered EVERY turn with only "Talk To A Human",
// which was being scored as 100%-success ~2s automated answers. The test is "did it stop
// answering?" — a CTA that IS the whole reply, not a real answer that offers a human too.)
test("isHandoffOnly: a reply that is ONLY a human-handoff CTA is flagged", () => {
  assert.equal(isHandoffOnly("If you'd like to be transferred to a Grove Guide for further assistance, please select Talk To A Human below!"), true);
  assert.equal(isHandoffOnly("Talk to a human"), true);
  assert.equal(isHandoffOnly("I can transfer you to an agent."), true);
  assert.equal(isHandoffOnly("Let me connect you — talk to a person for your order."), true);
});
test("isHandoffOnly: a real answer that merely OFFERS a human in passing is NOT flagged (false-gate guard)", () => {
  // Siena: full order-change answer, then an optional human offer — long, substantive → keep it.
  assert.equal(isHandoffOnly("Your order can still be changed if it hasn't been fulfilled yet — just reply with the new address and the item, and I'll update it right away. It usually ships within 24 hours, and if you'd rather talk to a human, I can make that happen."), false);
  // A substantive support answer with no human mention at all.
  assert.equal(isHandoffOnly("You have 30 days from delivery to return an item. Start at grove.co/returns, print the prepaid label, and drop it at any USPS location — refunds post in 5–7 business days."), false);
  // Empty / stall.
  assert.equal(isHandoffOnly(""), false);
  assert.equal(isHandoffOnly("Let me check that for you…"), false);
});
test("convoOutcome: an all-handoff conversation is DEFLECTED (engaged), never automated or no_answer", () => {
  const turns = [
    { by: "user", q: "What is your return policy?" },
    { by: "ai", complete_ms: null, handoff_cta: true, replyTail: "transferred to a Grove Guide … Talk To A Human" },
    { by: "user", q: "How many days?" },
    { by: "ai", complete_ms: null, handoff_cta: true, replyTail: "transferred to a Grove Guide … Talk To A Human" },
    { by: "ai", complete_ms: null, handoff_cta: true, replyTail: "transferred to a Grove Guide … Talk To A Human" },
  ];
  const o = convoOutcome(turns);
  assert.equal(o.outcome, "deflected");     // engaged but not automated — counts AGAINST automation
  assert.equal(o.automated, false);
});
test("convoValidity: handoff-only turns (no timed answer) make a pure-deflection conv invalid", () => {
  const turns = [
    { by: "ai", complete_ms: null, handoff_cta: true },
    { by: "ai", complete_ms: null, handoff_cta: true },
    { by: "ai", complete_ms: null, handoff_cta: true },
  ];
  assert.equal(convoValidity(turns).valid, false);
});

// ---- deflection: out-of-chat fulfillment is a fail of in-chat automation (2026-07-13, Max) ----
test("detectDeflection: 'email <address> to complete the action' IS a deflection", () => {
  assert.ok(detectDeflection("We'll provide a free return label when you email hello@supergoop.com with your order number."));
  assert.ok(detectDeflection("Please contact Customer Support for assistance."));
  assert.ok(detectDeflection("I don't have access to that — you'll need to contact customer care."));
});
test("detectDeflection: an answer that merely NAMES an address is still NOT a deflection", () => {
  assert.equal(detectDeflection("Order receipts are sent from orders@brand.com right after purchase."), null);
});
