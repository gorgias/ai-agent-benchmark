// eval-signals.js — deterministic rich-element signal detection, shared by eval-pack.js,
// eval-merge.js and eval-audit.js. Kept in its own module so importing it has NO side
// effects (eval-pack.js is a script whose top level runs the packer).
import { detectDeflection } from "./classify.js";
import { stripWidgetChrome } from "./reply-clean.js";
export const SIGNALS = {
  has_price: (t) => /(?:[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|AUD|CAD))/.test(t),
  has_link: (t) => /(?:https?:\/\/|\/products\/|\/collections\/|view product|product card|add to cart|tap the product)/i.test(t),
  has_reviews: (t) => /(?:\d(?:\.\d)?\s?\/\s?5|\d(?:\.\d)?\s?stars?|★|\d[\d,]*\+?\s?reviews?)/i.test(t),
  has_options: (t) => /(?:option\s?[12]|1[.)]\s.+2[.)]\s|first option|second option|either|both of these|a few (?:options|picks))/i.test(t),
};
export function convoSignals(turns) {
  const text = (turns || []).map((t) => t.replyTail || t.reply || "").join("\n");
  const sig = Object.fromEntries(Object.entries(SIGNALS).map(([k, fn]) => [k, fn(text)]));
  // no_deflect: the AI resolved IN-CHANNEL and did NOT punt the customer out of channel
  // (email / contact form / call us / "contact support") when the ask was answerable in-chat.
  // Penalize ONLY a genuine directive punt — detectDeflection's guards already spare an
  // OPTIONAL aside ("if you prefer, you can also email…") and an IN-CHANNEL offer ("contact us
  // here in the chat"). Detection runs on the CHROME-STRIPPED reply per AI turn (raw replyTail
  // interleaves timestamps/chips that split the framing from the phrase). Gates s_no_deflect /
  // s_answered / s_outcome in eval-score.js. Vendor-blind. (2026-07-17, Max — "penalize only
  // when it asks to move to email/contact form and chat resolution is impossible".)
  const ai = (turns || []).filter((t) => t.by === "ai" && !t.unsent);
  const deflectN = ai.filter((t) => {
    const clean = t.replyClean != null ? t.replyClean : stripWidgetChrome(t.replyTail || t.reply || "", t.q || "");
    return !!detectDeflection(clean);
  }).length;
  // "chat resolution is impossible" = the MAJORITY (≥50%) of the AI's substantive replies
  // punted the customer out of channel. A lone "or email us" aside after in-chat answers
  // (fraction < 0.5) is NOT penalized — the bot did resolve in-chat.
  sig.no_deflect = !(ai.length > 0 && deflectN / ai.length >= 0.5);
  return sig;
}
