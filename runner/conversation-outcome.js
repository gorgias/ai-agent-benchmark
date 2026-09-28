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
import { convoOutcome, isHandoffOnly, classifyHandover, statusTransfer } from "./classify.js";
import { stripWidgetChrome } from "./reply-clean.js";
import { WIDGETS, STORES } from "./vendors.js";

const STORE_BY_KEY = Object.fromEntries(STORES.map((s) => [s.key, s]));

/**
 * Re-derive the hand-off of an ALREADY-CAPTURED conversation with the CURRENT classifier, the same
 * one run.js applies at capture (classify.js classifyHandover + statusTransfer), for every vendor.
 *
 * WHY (2026-09-28). The capture-time detector was rewritten: offers of human help no longer end the
 * conversation, regex false positives were removed, and hand-offs the old patterns missed are now
 * caught — widget status lines ("Routed to human agent", "An agent is joining", a "Live Agent"
 * sender) and phrasings like "I've passed your request to our team, and a person will follow up".
 * Stored conversations carry the OLD verdicts. Correcting only one direction would be lopsided (the
 * missed transfers were spread across Siena, DigitalGenius, Ada, Decagon AND Gorgias), so the baker
 * re-applies the current rules to everything it reads:
 *   - the first turn that reads as a TRANSFER becomes the handover turn, and every later AI turn is
 *     re-attributed to the human (by:"human", no latency) — a human's reply is never timed or scored
 *     as the AI's (dg-dreamcloudslee: "Eloise H • Live Agent" answered turns that were timed);
 *   - a stored handover that now reads as an OFFER becomes an offer (still counted against
 *     automation, as a deflection) and its reply is the AI's again;
 *   - a stored handover that now reads as NOTHING (a regex false positive) is cleared.
 * Turns the runner never sent stay unsent: a conversation cut short by a false positive cannot be
 * un-truncated, only re-labelled. Idempotent; mutates in place. Returns a short summary.
 */
export function rederiveHandover(conv) {
  const turns = conv.turns || [];
  const st = STORE_BY_KEY[conv.key] || {};
  const extra = (WIDGETS[conv.widget] || {}).handover || [];
  const names = [st.store || conv.store, conv.vendor, ...(st.personas || [])];
  const changes = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.unsent) continue;
    // After a (stored) transfer every later turn is the human's; nothing further to classify.
    if (t.by !== "ai" && !t.handover) continue;
    const raw = t.replyText || t.replyTail || "";
    const status = statusTransfer(raw);
    const hv = status ? { hit: status, kind: "transfer" } : classifyHandover(stripWidgetChrome(raw, t.q || ""), extra, names);
    if (hv && hv.kind === "transfer") {
      if (!t.handover) { t.handover = true; t.handover_hit = hv.hit; t.handover_rederived = "transfer"; delete t.handover_offer; changes.push(`T${t.turn || i + 1}:transfer`); }
      if (t.by === "ai") { t.by = "human"; t.ai_latency_ms = null; }
      for (const later of turns.slice(i + 1)) {
        if (later.unsent || later.by !== "ai") continue;
        later.by = "human"; later.after_rederived_handover = true;
        later.complete_ms = null; later.ai_latency_ms = null;
      }
      return changes;
    }
    if (t.handover) {
      // stored transfer that the current rules read as an offer, or as nothing at all
      t.handover = false; t.handover_rederived = hv ? "offer" : "none";
      if (hv) { t.handover_offer = true; t.handover_hit = hv.hit; } else { delete t.handover_offer; }
      t.by = "ai"; t.ai_latency_ms = t.complete_ms != null ? t.complete_ms : null;
      changes.push(`T${t.turn || i + 1}:${t.handover_rederived}`);
      continue;
    }
    if (hv && hv.kind === "offer" && !t.handover_offer) { t.handover_offer = true; t.handover_hit = hv.hit; }
  }
  return changes;
}

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
  // Hand-offs are re-derived with the current classifier first (see rederiveHandover above), so a
  // conversation captured under older rules is counted exactly as a new capture would be.
  rederiveHandover(conv);
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
