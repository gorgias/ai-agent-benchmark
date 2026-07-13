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
  const raw = turn.replyText || turn.replyTail || "";
  if (/\byou say:|\bvous dites?:/i.test(raw)) return true;      // explicit echo chrome
  const q = (turn.q || "").trim();
  if (q.length < 12) return false;
  const qHead = q.toLowerCase().slice(0, Math.min(q.length, 60));
  if (!raw.toLowerCase().includes(qHead)) return false;
  // reply CONTAINS the question — flag only if little substantive text is left after removing
  // chrome + the echoed question (i.e. the reply WAS the echo, not an answer quoting it back).
  const remainder = raw.replace(new RegExp(UI_CHROME_RE.source, "gi"), " ")
    .toLowerCase().split(qHead).join(" ").replace(/[^a-z0-9]+/g, " ").trim();
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
