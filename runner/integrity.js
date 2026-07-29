// Conversation INTEGRITY checks — catch captures where the runner likely MISREAD the chat UI
// and credited non-answers as real AI replies (the Grove/Meta cases Max found): user-message
// echoes, knowledge-base navigation chrome ("View article / Next item"), empty-after-chrome
// replies counted as timed answers, implausibly-fast replies, and stuck/repeated replies.
//
// Philosophy: these are REVIEW signals, not auto-verdicts. A flagged conversation is surfaced
// (integrity-report.json + a badge in the report) for a human/Claude to confirm before it is
// trusted — we never silently delete. High-severity = almost certainly a misread; medium =
// likely; low = worth a look. Applied vendor-blind and symmetrically to every capture.
import { stripWidgetChrome } from "./reply-clean.js";

// Widget chrome / knowledge-base navigation that is NOT an answer. If a "reply" is dominated by
// these, we scraped the UI, not the bot's prose.
export const UI_CHROME_RE = /(you say:|vous dites?:|view article|next item|previous item|was this helpful|related articles?|helpful\?|start a (new )?conversation|choose (an|a) (option|topic)|main menu|powered by|sent\s*·\s*just now|see more|show more|read more)/i;

// A turn's cleaned reply text (chrome-stripped). Small helper so callers/tests share one path.
export function cleanedReply(turn) {
  return stripWidgetChrome(turn.replyText || turn.replyTail || "", turn.q || "").trim();
}

// Did the reply just echo the user's own question back (widget rendered our message as the
// "answer")? True when, after removing the question text and chrome, almost nothing remains.
export function isUserEcho(turn) {
  // Work on the RAW reply: stripWidgetChrome already deletes echoed user text, so the echo
  // signature only survives before cleaning.
  //
  // FALSE-POSITIVE FIX 2026-07-16: "You say:" must NOT short-circuit to true — Zendesk's
  // transcript DOM legitimately labels the user's message with "You say: <q>" as CHROME
  // before the bot's real answer, so an unconditional match quarantined 62 perfectly valid
  // Zendesk convs (incl. 100%-success ones) in one pass. An echo label is only a REAL echo
  // when nothing substantive remains after stripping chrome + the quoted question.
  const raw = turn.replyText || turn.replyTail || "";
  const q = (turn.q || "").trim();
  const hasEchoLabel = /\byou say:|\bvous dites?:/i.test(raw);
  const qHead = q.toLowerCase().slice(0, Math.min(q.length, 60));
  if (!hasEchoLabel) {
    if (q.length < 12) return false;
    if (!raw.toLowerCase().includes(qHead)) return false;
  }
  // reply carries echo chrome and/or the question — flag only if little substantive text is
  // left after removing chrome + the echoed question (i.e. the reply WAS the echo, not an
  // answer that the transcript happens to prefix with the user's own message).
  let remainder = raw.replace(new RegExp(UI_CHROME_RE.source, "gi"), " ").toLowerCase();
  if (qHead.length >= 12) remainder = remainder.split(qHead).join(" ");
  remainder = remainder.replace(/\byou say:|\bvous dites?:/gi, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return remainder.length < 30;
}

// Reply is only widget chrome / navigation — no substantive prose — yet was timed as an answer.
export function isChromeOnly(turn) {
  if (turn.complete_ms == null && turn.ai_latency_ms == null) return false; // wasn't counted as an answer
  const clean = cleanedReply(turn);
  if (clean.length < 8) return true;                            // essentially empty after chrome
  // dominated by KB/nav chrome: strip ALL chrome tokens (global), see if anything is left
  const hasChrome = UI_CHROME_RE.test(clean);
  const stripped = clean.replace(new RegExp(UI_CHROME_RE.source, "gi"), " ").replace(/[^a-zA-Z0-9]+/g, " ").trim();
  return hasChrome && stripped.length < 12;
}

// PAGE DUMP — the reader lost the chat transcript and captured storefront page text instead
// (2026-07-14, klaviyo-nanuk: after T2 every "reply" was the country-selector overlay +
// homepage nav, timed at 17-21s as if the AI answered). Signature: cleaned reply dominated
// by shipping-country/consent/nav boilerplate rather than conversational prose.
export const PAGE_DUMP_RE = /(please select your (shipping )?country|buy from the country of your choice|skip to (main )?content|add to cart\s+add to cart|newsletter sign.?up|©\s?20\d\d|free shipping on orders over[^.]*\.\s*shop now)/i;
export function isPageDump(cleanedReply) {
  const t = (cleanedReply || "").trim();
  if (t.length < 40) return false;
  if (!PAGE_DUMP_RE.test(t)) return false;
  // dominated: the boilerplate appears in the first third, or repeats
  const idx = t.search(PAGE_DUMP_RE);
  const hits = (t.match(new RegExp(PAGE_DUMP_RE.source, "gi")) || []).length;
  return idx < t.length / 3 || hits >= 2;
}

// Storefront furniture that a lost transcript reader scrapes instead of the chat. Broader than
// PAGE_DUMP_RE, which targets the specific country-selector signature; this one recognises a
// generic page scrape by its landmarks.
export const STOREFRONT_RE = /(accessibility screen-reader|skip to (main )?content|all rights reserved|shopping cart|main menu|previous\s+next|please select your (shipping )?country)/i;

// Widget furniture that is not an answer even when it is short ("Settings", "End Chat", "Sent…").
const FURNITURE_ONLY_RE = /^(settings|minimize chat|end chat|today|sent…?|typing…?|[\s•·|]*)$/i;

/**
 * How many of a conversation's AI turns carry REAL assistant prose?
 *
 * A turn is substantive when, after collapsing whitespace and removing a leading echo of the
 * user's own question, what remains is neither a storefront scrape nor bare widget furniture.
 *
 * WHY THIS EXISTS (2026-07-29). The per-turn flags above are review signals, exactly as this
 * file's header promises. `integrity-check --quarantine` nonetheless discarded a WHOLE
 * conversation as soon as ANY single turn was flagged — so one misread turn threw away the
 * other nine, which are valid data. Re-reading the 64 conversations quarantined on 2026-07-28
 * showed 56 of them still carried genuine vendor prose: Ada's Aura running real discovery,
 * Sierra's FloraAgent asking qualifying questions, Zendesk's Horizn agent answering a damage
 * claim. Two whole rule classes (CHROME_ONLY_REPLY, ECHO_USER_MESSAGE) were firing on the
 * PREFIX of a reply whose real answer followed immediately after.
 *
 * Discarding those conversations is not a neutral act: removing Siena's handoff loop deletes a
 * genuine product weakness and flatters the vendor. So the remedy has to be proportional —
 * discard a capture only when there is nothing in it, not when part of it was misread.
 */
export function substantiveTurnCount(conv) {
  const turns = conv.turns || [];
  let n = 0;
  for (const t of turns) {
    if (t.by !== "ai" || t.unsent) continue;
    let s = String(t.replyText || t.replyTail || "").replace(/\s+/g, " ").trim();
    const q = String(t.q || "").replace(/\s+/g, " ").trim();
    // Transcripts commonly prefix a turn's reply with the user's own message. That prefix is
    // chrome, not the answer — judge what comes AFTER it.
    if (q.length >= 12 && s.toLowerCase().startsWith(q.toLowerCase().slice(0, 60))) {
      s = s.slice(q.length).trim();
    }
    if (s.length > 1500 && STOREFRONT_RE.test(s)) continue; // page scrape, not a reply
    if (s.length >= 40 && !FURNITURE_ONLY_RE.test(s)) n++;
  }
  return n;
}

/**
 * A capture is HOLLOW when not one AI turn carries real assistant prose — the runner recorded
 * something, but none of it came from the agent. Only these are safe to drop wholesale;
 * anything else keeps data the report legitimately needs.
 */
export function isHollowCapture(conv) {
  const ai = (conv.turns || []).filter((t) => t.by === "ai" && !t.unsent);
  return ai.length > 0 && substantiveTurnCount(conv) === 0;
}

// Implausibly fast to be a generated answer — likely a cached/echoed/chrome element.
export function isImplausiblyFast(turn, floorMs = 700) {
  const ms = turn.ai_latency_ms != null ? turn.ai_latency_ms : turn.complete_ms;
  return ms != null && ms < floorMs && cleanedReply(turn).length > 0;
}

// Scan ONE conversation → array of {code, severity, turn, evidence}. Empty array = clean.
// severity: "high" (almost certainly a misread) | "medium" | "low" (review).
export function scanConversation(conv) {
  const flags = [];
  const ai = (conv.turns || []).filter((t) => t.by === "ai" && !t.unsent);
  const reps = {};
  for (let i = 0; i < ai.length; i++) {
    const t = ai[i];
    const clean = cleanedReply(t);
    const ev = (t.replyText || t.replyTail || "").replace(/\s+/g, " ").slice(0, 90);
    if (isUserEcho(t)) flags.push({ code: "ECHO_USER_MESSAGE", severity: "high", turn: t.turn, evidence: ev });
    else if (isPageDump(clean)) flags.push({ code: "PAGE_DUMP_REPLY", severity: "high", turn: t.turn, evidence: ev });
    else if (isChromeOnly(t)) flags.push({ code: "CHROME_ONLY_REPLY", severity: "high", turn: t.turn, evidence: ev });
    if (isImplausiblyFast(t)) flags.push({ code: "IMPLAUSIBLY_FAST", severity: "low", turn: t.turn, evidence: `${t.ai_latency_ms ?? t.complete_ms}ms · ${ev}` });
    if (clean.length >= 12) reps[clean] = (reps[clean] || 0) + 1;
  }
  // ≥3 identical substantive replies across turns → widget stuck or misread (review only).
  const maxRep = Math.max(0, ...Object.values(reps));
  if (maxRep >= 3 && ai.length >= 3) {
    const [text] = Object.entries(reps).find(([, n]) => n === maxRep) || [""];
    flags.push({ code: "REPEATED_IDENTICAL_REPLY", severity: "low", turn: null, evidence: `${maxRep}× "${text.slice(0, 60)}"` });
  }
  return flags;
}

// Conversation-level verdict: worst severity present, and whether it should block trust.
export function integrityVerdict(conv) {
  const flags = scanConversation(conv);
  const rank = { high: 3, medium: 2, low: 1 };
  const severity = flags.reduce((s, f) => (rank[f.severity] > (rank[s] || 0) ? f.severity : s), null);
  return { flagged: flags.length > 0, severity, flags };
}
