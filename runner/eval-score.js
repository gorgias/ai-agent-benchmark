// eval-score.js — the fixed check→points scoring table, deterministic signal gates, and
// deriveScores(). Side-effect-free (no top-level execution) so it can be imported by
// eval-merge.js (live merge) AND tools/rederive-scores.mjs (retroactive re-derivation) from
// a SINGLE source of truth. Mirrors eval-rubric.md.

// ---- the fixed check → points mapping (mirrors eval-rubric.md; the single source of scoring) ----
export const CHECKS = {
  shopping: {
    answer: { a_direct: 14, a_consistent: 9, a_no_ignored: 7 },
    discovery: { d_clarify: 8, d_progressive: 7, d_not_dump: 5 },   // v2.2 — PMF core
    recommendation: { r_named: 9, r_fit: 8, r_plausible: 5 },
    rich: { e_price: 6, e_link: 7, e_reviews: 3, e_options: 2 },
    close: { c_cta: 5, c_cart: 3, c_clean: 2 },
  },
  support: {
    resolution: { s_answered: 18, s_outcome: 12, s_no_deflect: 10 },
    accuracy: { g_specific: 13, g_consistent: 5, g_grounded: 7 },   // v2.1: g_consistent split (calibration)
    actionability: { t_steps: 12, t_complete: 8 },
    close: { k_expectations: 8, k_clean: 7 },
  },
};

// signal gates: check → signal that must be TRUE in the transcript for the check to pass.
// A signal-gated check cannot pass without its deterministic signal, regardless of the judge.
//   e_* → rich-element signals (price/link/reviews/options actually rendered).
//   s_no_deflect / s_answered / s_outcome → `no_deflect`: the conversation was NOT classified
//   as a channel deflection (a "contact us via email/phone/another channel" punt). A reply
//   that pushes the customer out of channel did NOT resolve or answer IN-CHANNEL, so it cannot
//   earn the in-channel resolution credit — no matter how the LLM judge scored it. Vendor-
//   blind: reuses the exact convoOutcome the automation-rate metric uses (2026-07-17, Max —
//   "a request to switch channels didn't help the customer and must be penalized").
export const SIGNAL_GATE = {
  e_price: "has_price", e_link: "has_link", e_reviews: "has_reviews", e_options: "has_options",
  s_no_deflect: "no_deflect", s_answered: "no_deflect", s_outcome: "no_deflect",
};

export const RESOLUTION_CLASSES = ["resolved", "partial", "deflected", "failed"];

export function deriveScores(mode, checks, signals) {
  const dims = CHECKS[mode]; if (!dims) return null;
  const rubric = {}, gated = [];
  let total = 0;
  for (const [dim, defs] of Object.entries(dims)) {
    let s = 0;
    for (const [cid, pts] of Object.entries(defs)) {
      const c = checks[cid];
      if (!c || typeof c.pass !== "boolean") return null;                    // every check must be present
      let pass = c.pass;
      if (pass && !(typeof c.evidence === "string" && c.evidence.trim().length >= 3)) pass = false;  // no quote → no credit
      if (pass && SIGNAL_GATE[cid] && !signals[SIGNAL_GATE[cid]]) { pass = false; gated.push(cid); } // deterministic cap
      if (pass) s += pts;
    }
    rubric[dim] = s; total += s;
  }
  return { rubric, total, gated };
}
