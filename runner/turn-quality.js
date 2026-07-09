// Deterministic per-turn quality signals.
//
// These do not replace the blind LLM judge. They make obvious message-level
// failures visible in the score cache so a conversation can be audited turn by
// turn instead of only through aggregate checks.

import { stripWidgetChrome } from "./reply-clean.js";

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from", "have",
  "how", "i", "if", "in", "is", "it", "me", "my", "of", "on", "or", "our", "the", "them", "this",
  "to", "we", "what", "when", "where", "who", "with", "you", "your",
]);

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}$€£%]+/gu, " ").replace(/\s+/g, " ").trim();
}

function tokens(s) {
  return norm(s).split(" ").filter((x) => x.length > 2 && !STOP.has(x));
}

function answerWindow(turn) {
  // shared cleaner: slices the echoed question and strips widget chrome / chips /
  // product-card fragments so keyword-coverage is measured on the real prose only.
  return stripWidgetChrome(turn.replyText || turn.replyTail, turn.q);
}

function lineStats(text) {
  const lines = String(text || "").split(/\r?\n| {2,}/).map((x) => x.trim()).filter(Boolean);
  const short = lines.filter((x) => x.length <= 44 && !/[.!?]/.test(x)).length;
  return { lines: lines.length, short, short_ratio: lines.length ? short / lines.length : 0 };
}

function keywordCoverage(q, answer) {
  const asked = [...new Set(tokens(q))].filter((t) => !["help", "please", "tell", "know"].includes(t));
  const a = new Set(tokens(answer));
  const matched = asked.filter((t) => a.has(t));
  const missing = asked.filter((t) => !a.has(t));
  return { asked, matched, missing, ratio: asked.length ? matched.length / asked.length : 1 };
}

function hasDuration(answer) {
  return /\b\d+\s*(?:-\s*\d+\s*)?(?:business\s*)?(?:day|days|week|weeks|hour|hours)\b/i.test(answer) ||
    /\b(?:same|next)\s+(?:business\s+)?day\b/i.test(answer);
}

function turnQuality(turn, mode = "") {
  const answer = answerWindow(turn);
  const coverage = keywordCoverage(turn.q, answer);
  const lines = lineStats(answer);
  const q = norm(turn.q);
  const a = norm(answer);
  const measured = turn.by === "ai" && turn.complete_ms != null;
  const flags = [];

  // CLARIFYING turn (2026-07-09): an assistant that answers a broad ask by qualifying the
  // need ("let me know your scent preferences and I can guide you!") is doing GOOD
  // discovery, not failing coverage — a few back-and-forths are fine, and the judge's
  // rubric rewards exactly this (d_clarify). Keyword coverage is meaningless on such
  // turns: suppress coverage/thin penalties and emit a neutral informative flag instead.
  // An invite phrase + needs-vocabulary counts even without a "?" — qualifying is often
  // imperative ("Please let me know your scent preferences and I can guide you!").
  const clarifying = measured &&
    /\b(let me know|tell me|could you (share|tell|let)|which|what (kind|type|sort)|do you (prefer|want|need|have)|are you (looking|hoping|after)|to (help|guide) (you|me)|help me (understand|recommend|narrow))\b/i.test(answer) &&
    (/\?/.test(answer) || /\b(preferences?|needs?|budget|size|style|goals?|looking for|kind of|type of|concerns?)\b/i.test(answer));

  if (turn.unsent) flags.push("not_sent_after_handover");
  if (turn.by === "ai" && !measured) flags.push("no_measured_answer");
  if (measured && answer.length < 80 && !clarifying) flags.push("thin_answer");
  if (!clarifying && coverage.asked.length >= 3 && coverage.ratio < 0.35) flags.push("low_question_coverage");
  if (clarifying) flags.push("clarifying_question");
  if (lines.lines >= 4 && lines.short_ratio >= 0.65) flags.push("likely_chip_menu");

  if (/\bwho\s+(?:covers|pays)|\bcovered\s+by\b|\bresponsible\b/.test(q) &&
      !/\b(?:customer|shopper|buyer|recipient|you|we|brand|merchant).{0,50}\b(?:pay|pays|cover|covers|responsible|included|charged)|\b(?:duties|customs|taxes).{0,50}\b(?:customer|shopper|buyer|recipient|you|responsible|pay|paid|charged|included|not included)\b/.test(a)) {
    flags.push("missing_responsible_party");
  }

  if (/\bhow\s+long\b|\bshipping\s+take\b|\bdelivery\s+take\b|\btime\s+window\b|\bwhen\b/.test(q) && !hasDuration(answer)) {
    flags.push("missing_timeframe");
  }

  if (/\bcontact\b|\bsupport team\b|\bcustomer support\b|\bwhere do i send\b|\bsend them\b/.test(q) &&
      !/\b(email|phone|chat|contact|support|ticket|form|portal|send|reach)\b/.test(a)) {
    flags.push("missing_contact_path");
  }

  if (/\badd\b.{0,30}\bcart\b|\btotal\b|\bcheckout\b/.test(q) &&
      !/\b(added|cart|checkout|total|subtotal|shipping|tax|proceed)\b/.test(a)) {
    flags.push("purchase_request_unfulfilled");
  }

  if (mode === "support" && /\bship|shipping|customs|duties|return|refund|payment|contact|support|order\b/.test(q) &&
      /\b(?:gift|popular items|something for myself|sales|best for travel|best sellers|explore|purchase something)\b/.test(a)) {
    flags.push("sales_prompt_on_support_ask");
  }

  const substantive = measured && answer.length >= 80 && !flags.includes("likely_chip_menu") && !flags.includes("thin_answer");
  return {
    turn: turn.turn,
    measured,
    by: turn.by || null,
    complete_ms: turn.complete_ms ?? null,
    answer_chars: answer.length,
    keyword_coverage: {
      asked: coverage.asked.length,
      matched: coverage.matched.length,
      ratio: Number(coverage.ratio.toFixed(2)),
      missing: coverage.missing.slice(0, 8),
    },
    substantive,
    flags,
  };
}

export function conversationTurnQuality(turns, mode = "") {
  const per_turn = (turns || []).map((t) => turnQuality(t, mode));
  const issue_turns = per_turn.filter((t) => t.flags.length).length;
  const measured = per_turn.filter((t) => t.measured).length;
  const substantive = per_turn.filter((t) => t.substantive).length;
  return {
    schema: 1,
    turns: per_turn,
    summary: {
      total_turns: per_turn.length,
      measured_turns: measured,
      substantive_turns: substantive,
      issue_turns,
      issue_rate: per_turn.length ? Number((issue_turns / per_turn.length).toFixed(2)) : 0,
    },
  };
}

