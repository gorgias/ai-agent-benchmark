// eval-signals.js — deterministic rich-element signal detection, shared by eval-pack.js,
// eval-merge.js and eval-audit.js. Kept in its own module so importing it has NO side
// effects (eval-pack.js is a script whose top level runs the packer).
export const SIGNALS = {
  has_price: (t) => /(?:[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|AUD|CAD))/.test(t),
  has_link: (t) => /(?:https?:\/\/|\/products\/|\/collections\/|view product|product card|add to cart|tap the product)/i.test(t),
  has_reviews: (t) => /(?:\d(?:\.\d)?\s?\/\s?5|\d(?:\.\d)?\s?stars?|★|\d[\d,]*\+?\s?reviews?)/i.test(t),
  has_options: (t) => /(?:option\s?[12]|1[.)]\s.+2[.)]\s|first option|second option|either|both of these|a few (?:options|picks))/i.test(t),
};
export function convoSignals(turns) {
  const text = (turns || []).map((t) => t.replyTail || t.reply || "").join("\n");
  return Object.fromEntries(Object.entries(SIGNALS).map(([k, fn]) => [k, fn(text)]));
}
