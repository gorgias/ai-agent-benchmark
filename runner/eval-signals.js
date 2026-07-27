// eval-signals.js — deterministic rich-element signal detection, shared by eval-pack.js,
// eval-merge.js and eval-audit.js. Kept in its own module so importing it has NO side
// effects (eval-pack.js is a script whose top level runs the packer).
import { detectDeflection } from "./classify.js";
import { stripWidgetChrome } from "./reply-clean.js";
export const SIGNALS = {
  // Trailing-symbol form ("85,00 €", "19,99€") is the European convention and was a silent
  // false negative until 2026-07-27 — only the leading form ("€85,00") matched, so EU-locale
  // stores lost e_price. Vendor-blind: it hit whichever vendor happened to run an EU storefront.
  has_price: (t) => /(?:[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?[$£€]|\d[\d,.]*\s?(?:USD|EUR|GBP|AUD|CAD))/.test(t),
  has_link: (t) => /(?:https?:\/\/|\/products\/|\/collections\/|view product|product card|add to cart|tap the product)/i.test(t),
  has_reviews: (t) => /(?:\d(?:\.\d)?\s?\/\s?5|\d(?:\.\d)?\s?stars?|★|\d[\d,]*\+?\s?reviews?)/i.test(t),
  has_options: (t) => /(?:option\s?[12]|1[.)]\s.+2[.)]\s|first option|second option|either|both of these|a few (?:options|picks))/i.test(t),
};
export function convoSignals(turns) {
  // Scan the FULL per-turn reply. run.js:508 stores two fields: `replyTail` is deliberately
  // capped at the LAST 500 chars, while `replyText` is the complete reply for that turn.
  // Reading replyTail first meant any price/link/review stated early in a long reply fell
  // outside the window and the rich-element check was hard-failed at merge even when the judge
  // had quoted it verbatim (2026-07-27 audit: 483 such false-negative signals across 2004 convs
  // — has_link 168, has_options 114, has_reviews 103, has_price 98). The gate is a CAP, not a
  // grant, so the score impact was small (21 convs, +0.04 mean, no ranking change) — but the
  // miss was systematic and correlated with reply LENGTH, i.e. it penalized verbose engines.
  const text = (turns || []).map((t) => t.replyText || t.replyTail || t.reply || "").join("\n");
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
