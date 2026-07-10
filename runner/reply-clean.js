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

// Messaging-widget chrome observed across vendors (Meta/Grove, DigitalGenius, Rufus…):
// delivery status, relative timestamps, composer placeholder, escalation buttons,
// widget headers, powered-by lines, bare clocks/locales.
const MSG_CHROME = /^(sent|delivered|seen|read|typing…?|just now|sent\s*[·•]\s*just now|type a message\.?|send us a message|talk to a human|chat with (a |an )?(human|agent)|speak to (a |an )?(human|agent)|new messages?|start over|end chat|restart)$/i;

function isNoiseLine(line, names) {
  const l = line.trim();
  if (!l) return true;
  if (CHROME.test(l)) return true;
  if (MSG_CHROME.test(l)) return true;
  if (/^\$\s?\d[\d.,]*$/.test(l)) return true;              // bare price  "$28"
  if (/^from\s*\$?\d/i.test(l) || /^from$/i.test(l)) return true; // "From" / "From $28"
  if (/^\(\d[\d,]*\)$/.test(l)) return true;                // review count "(4639)"
  if (/^\d(\.\d)?$/.test(l)) return true;                   // bare rating "4.7"
  if (/^\d+\s+products?$/i.test(l)) return true;            // "4 products"
  if (/^[★☆]+$/.test(l)) return true;                       // star glyphs
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(l)) return true;      // bare clock "00:14"
  if (/^\d{1,2}:\d{2}\s*(am|pm)$/i.test(l)) return true;    // bare clock "06:53 pm" (Kodif)
  if (/^\d+\s?(second|minute|hour|day)s?( ago)?$/i.test(l)) return true; // "14 seconds" / "2 minutes ago"
  // Kodif's rotating progress lines — frozen stall indicators, never prose
  if (/^(agent is thinking|getting the context|cooking up something( good)?|(got it\.?\s*)?popping the hood|crunching the numbers|connecting the dots|crafting a response( for you)?|putting the pieces together)[.…]*$/i.test(l)) return true;
  // Kodif's DOM role labels (raw node leaks alongside the rendered message)
  if (/^(user )?response:$/i.test(l)) return true;
  if (/^[•·▪◦‣*–—-]{1,3}$/.test(l)) return true;            // bare bullet/dash glyph line
  // generic bot sender labels leaking as bare lines ("AI Agent", "Virtual Assistant")
  if (/^(ai agent|ai assistant|virtual (assistant|agent)|chat assistant|assistant|agent|support bot)$/i.test(l)) return true;
  if (/^[a-z]{1,2}$/i.test(l)) return true;                 // bare locale/letter line "en" / "E"
  if (/^.{1,32}\ssays:$/i.test(l)) return true;             // sender label "Grove Guide Team says:"
  if (/^.{1,30}\schat$/i.test(l)) return true;              // widget header "Bloom & Wild Chat"
  if (/^(⚡\s*)?(powered\s)?by\s[\w .&'’-]{2,30}$/i.test(l)) return true; // "⚡ by DigitalGenius"
  // the widget's own bot/store/persona name as a bare label line ("Willow", "Grove Guide Team")
  if (names && names.some((n) => n && l.toLowerCase() === String(n).toLowerCase())) return true;
  // short suggested-reply chip: brief, and either a CTA opener or a brief trailing question
  if (l.length <= 48 && (CHIP_OPENER.test(l) || (l.endsWith("?") && l.length <= 44))) return true;
  return false;
}

// Inline (non-line) noise: ARIA status text glued to the prose + template artifacts.
// The status always starts with the BOT'S NAME (capitalized, 1-3 words) — anchoring on that
// keeps the strip from nibbling the preceding prose.
const GEN_STATUS = /\b[A-Z][\w'’-]{1,15}(?:\s[A-Z][\w'’-]{1,15}){0,2}\s(?:has\s(?:completed|finished)|is)\sgenerating\s(?:a|an|the)\s(?:response|answer)[.…]?\s*/g;
function stripInlineNoise(text) {
  return text
    .replace(GEN_STATUS, "")
    .replace(/\b(agent |user )?response:\s*/gi, "")         // Kodif's raw role-label prefixes
    .replace(/\s*\{\}\s*/g, "\n")                           // "{}" template artifacts → block break
    // Rufus feedback widget, flattened inline in old captures: "Your feedback has been
    // submitted! Select All That Apply (optional): This is inaccurate … Dismiss Submit"
    .replace(/your feedback has been submitted!?\s*/gi, "")
    .replace(/select all that apply\s*\(optional\):?\s*(?:this is (?:inaccurate|irrelevant|harmful\s*\/?\s*unsafe)\s*)*(?:something else\s*)?(?:dismiss\s*)?(?:submit\s*)?/gi, "");
}

// rawReplyTail: the captured turn.replyText (full) or turn.replyTail (may contain newlines)
// userQuestion:  turn.q — echoed at the top of the tail by many widgets; sliced off.
// opts.breaks:   keep ONE newline between kept lines so paragraphs/bullets survive for
//                display (report renders with white-space:pre-line). Default stays a flat
//                single line — the judge input and existing regex consumers expect that.
// opts.names:    store/vendor/bot-persona names — a bare line equal to one of these is a
//                sender label ("Willow", "Grove Guide Team"), not prose.
export function stripWidgetChrome(rawReplyTail, userQuestion, opts = {}) {
  let text = stripInlineNoise(String(rawReplyTail || ""));
  if (!text) return "";
  const q = String(userQuestion || "").trim();
  if (q && q.length > 8) {
    const idx = text.toLowerCase().lastIndexOf(q.toLowerCase());
    if (idx >= 0) text = text.slice(idx + q.length);        // keep only what came AFTER the echoed question
  }
  let kept = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !isNoiseLine(s, opts.names));
  // RAW+RENDERED dedupe (Kodif): the widget's DOM can leak the raw message node (one long
  // jammed line) alongside the rendered multi-line version of the SAME text. If a long
  // line's normalized content is fully contained in the normalized concatenation of the
  // lines that follow it, it is the jammed duplicate — keep the structured version.
  if (kept.length > 1) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    kept = kept.filter((line, i) => {
      if (line.length < 150) return true;
      const rest = norm(kept.slice(i + 1).join(""));
      const n = norm(line);
      return !(n.length > 100 && rest.includes(n));
    });
  }
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

// LOGIN / VERIFICATION WALL — the agent tells the (logged-out) shopper to authenticate to
// proceed. A cold harness can't satisfy it, so once the AI is gated AND then stops producing
// substantive answers, further scripted questions land in a widget stuck on the login modal
// and record FAKE empty turns. This is the INVERSE of a trailing "Verify order details"
// BUTTON that appears after a full answer while the AI keeps answering — that is chrome, not
// a wall (see the 2026-07-10 false-gate revert). The wall is only real when answers STOP.
export const LOGIN_GATE = /\b(please (?:log|sign) in\b|log in so (?:we|i) can|once you.?re logged in|verify order details|(?:log|sign) in to (?:view|access|see|check|look up|confirm|continue|proceed))/i;

// Index of the turn where a logged-out harness is stuck on the wall: the first AI turn with
// no substantive answer AFTER a login gate has appeared. -1 if the AI keeps answering (gate
// is chrome) or no gate appears. `substantive(turn)` is supplied by the caller because
// substance depends on stripWidgetChrome + the turn's own question.
export function loginWallStop(turns, substantive) {
  let gateSeen = false;
  for (let i = 0; i < (turns || []).length; i++) {
    const t = turns[i];
    if (LOGIN_GATE.test(t.replyText || t.replyTail || "")) gateSeen = true;
    if (gateSeen && t.by === "ai" && !t.handover && !substantive(t)) return i;
  }
  return -1;
}
