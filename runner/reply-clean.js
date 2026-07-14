// reply-clean.js — isolate an AI's conversational answer from the raw widget DOM tail.
//
// Captured `replyTail` is a scrape of the last chunk of the chat widget's DOM. For
// rich widgets (notably Envive's "Ask Maggie" / Supergoop AI) it is contaminated with
// UI chrome ("Ask Maggie", "Give us feedback"), suggested-reply CHIPS ("Show me best
// sellers", "How does it feel on the skin?") and product-card fragments ("$28", "From",
// "4.7", "(4639)"). None of that is the assistant's prose.
//
// This matters in two places:
//   • DISPLAY  — the report was showing the tail verbatim, which for these widgets is
//                pure chip garbage even when the real answer was fine.
//   • JUDGING  — the blind judge saw the chips and could mis-credit them as discovery
//                questions / rich elements. Price/link/review SIGNALS are detected
//                separately (convoSignals), so stripping the prose here loses no signal.
//
// The function is conservative: it strips lines that match known chrome, bare
// price/rating/count fragments, and SHORT call-to-action chips — and keeps everything
// that reads like a real sentence (the answer). Used by gen.js (display), eval-pack.js
// (judge input) and turn-quality.js (per-turn coverage).

const CHROME = /^(ask maggie|give us feedback|shop with ai|customer care team|welcome to .*\bai\b|.+!\s*ai$|verified buyer|privacy|cancel|close|ai agent powered by.*|powered by.*|message from [^:]+:|thumbs up|thumbs down|copy|helpful\??|was this helpful\??|your feedback has been submitted!?|select all that apply.*|this is (irrelevant|inaccurate|harmful.*)|something else|dismiss|submit)$/i;

// A short line that opens with one of these reads as a suggested-reply chip, not prose.
const CHIP_OPENER = /^(show me\b|explore\b|browse\b|see\b|view\b|shop\b|looking for\b|i need\b|i'?m looking\b|do you have\b|what'?s\b|what if\b|what other\b|what makes\b|how do i\b|how does\b|why is\b|why should\b|can i\b|tell me\b|find\b|help me\b|get\b|start\b)/i;

function isNoiseLine(line) {
  const l = line.trim();
  if (!l) return true;
  if (CHROME.test(l)) return true;
  if (/^\$\s?\d[\d.,]*$/.test(l)) return true;              // bare price  "$28"
  if (/^from\s*\$?\d/i.test(l) || /^from$/i.test(l)) return true; // "From" / "From $28"
  if (/^\(\d[\d,]*\)$/.test(l)) return true;                // review count "(4639)"
  if (/^\d(\.\d)?$/.test(l)) return true;                   // bare rating "4.7"
  if (/^\d+\s+products?$/i.test(l)) return true;            // "4 products"
  if (/^[★☆]+$/.test(l)) return true;                       // star glyphs
  // short suggested-reply chip: brief, and either a CTA opener or a brief trailing question
  if (l.length <= 48 && (CHIP_OPENER.test(l) || (l.endsWith("?") && l.length <= 44))) return true;
  return false;
}

// rawReplyTail: the captured turn.replyText (full) or turn.replyTail (may contain newlines)
// userQuestion:  turn.q — echoed at the top of the tail by many widgets; sliced off.
// opts.breaks:   keep ONE newline between kept lines so paragraphs/bullets survive for
//                display (report renders with white-space:pre-line). Default stays a flat
//                single line — the judge input and existing regex consumers expect that.
export function stripWidgetChrome(rawReplyTail, userQuestion, opts = {}) {
  let text = String(rawReplyTail || "");
  if (!text) return "";
  const q = String(userQuestion || "").trim();
  if (q && q.length > 8) {
    const idx = text.toLowerCase().lastIndexOf(q.toLowerCase());
    if (idx >= 0) text = text.slice(idx + q.length);        // keep only what came AFTER the echoed question
  }
  const kept = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !isNoiseLine(s));
  if (opts.breaks) return kept.map((s) => s.replace(/[ \t]+/g, " ")).join("\n").trim();
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

// convenience: cleaned answer capped to `max` chars from the FRONT (so the report shows
// the START of the real answer, not the chip tail). Adds an ellipsis when truncated.
export function cleanAnswer(rawReplyTail, userQuestion, max = 220, opts = {}) {
  const a = stripWidgetChrome(rawReplyTail, userQuestion, opts);
  if (a.length <= max) return a;
  return a.slice(0, max).replace(/\s+\S*$/, "") + "…";
}
