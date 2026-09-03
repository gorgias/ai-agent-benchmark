// conversation-outcome.js — the single path from a captured conversation to its OUTCOME
// (automated | handover | deflected | no_answer), which is what the automation rate counts.
//
// WHY THIS EXISTS (2026-09-03). Deriving the outcome is not just calling convoOutcome(): the
// baker first re-derives HANDOFF-ONLY replies. A reply whose entire substance is a "talk to a
// human" button is a deflection, not a fast automated answer, and convoOutcome only sees that
// if `replyClean` has been stamped on each turn first. gen.js did this; scoreboard-preview.js
// did not — so the dry-run counted those replies as automated and reported Gorgias support
// automation at 76% while the published report, correctly, showed 74%. Two points, which is
// the whole distance between #2 and #3 in that lane.
//
// That is the THIRD divergence of this shape found in one day (trailing window, lane weights,
// and now outcome derivation), all with one cause: the diagnostic re-implementing the baker.
// Anything that needs an outcome imports this.
import { convoOutcome, isHandoffOnly } from "./classify.js";
import { stripWidgetChrome } from "./reply-clean.js";

/**
 * Stamp `replyClean` on every AI turn and re-derive handoff-only replies IN PLACE, then return
 * the conversation's outcome.
 *
 * The mutation is deliberate and matches the baker: downstream consumers read `replyClean`
 * (deflection detection on the agent's prose, not on surviving suggested-reply chips) and rely
 * on a handoff-only turn having had its latency cleared, so it cannot be counted as a fast
 * answer for validity or for the latency mean.
 */
export function deriveOutcome(conv) {
  for (const t of conv.turns || []) {
    if (t.by !== "ai") continue;
    const clean = stripWidgetChrome(t.replyText || t.replyTail || "", t.q || "");
    t.replyClean = clean;
    if (!t.handover && isHandoffOnly(clean)) {
      t.handoff_cta = true;
      t.complete_ms = null;
      t.ai_latency_ms = null;
    }
  }
  return convoOutcome(conv.turns || []);
}
