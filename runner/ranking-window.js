// ranking-window.js — the single definition of the trailing window used to RANK vendors.
//
// WHY THIS EXISTS (2026-07-29). gen.js baked the published report on a trailing 90 days while
// scoreboard-preview.js defaulted to 14. Reading a dry-run through the 14-day default made
// Gorgias look like it had collapsed from #1 support to 4th on n=24 — when the published
// pipeline saw n=123 and Gorgias comfortably #1. The two numbers disagreed because they were
// two numbers; the diagnostic tool has to answer the same question the baker answers.
//
// 90 days is a deliberate choice, not an accident of history: a vendor's lane sample has to
// clear the stat-sig floor (MIN_RANK_CONVS) built from several stores, and a short window
// makes the ranking hostage to WHICH STORES happened to be captured that week rather than to
// vendor quality. Measured on 2026-07-29: over 14 days Gorgias's sample was 4 stores (mean
// 76.3); over 90 it was 18 stores (mean 87.2). Same agent, same rubric — different answer,
// purely from store composition.
//
// If this ever needs to change: validate the new value across EVERY vendor and adopt it at a
// moment when it does not happen to favour Gorgias. Widening a window because the flagship is
// losing is how a benchmark loses its credibility.

/** Trailing window, in days, for every ranking surface (report, scoreboard, preview). */
export const RANK_WINDOW_DAYS = 90;

/**
 * Inclusive ISO cutoff date for the ranking window ending at `latest`.
 * Inclusive means a window of N days spans `latest - (N-1)` .. `latest`.
 * ISO date strings compare lexically, so a string cutoff is enough for filtering.
 */
export function rankCutoff(latest, windowDays = RANK_WINDOW_DAYS) {
  const d = new Date(`${latest}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (windowDays - 1));
  return d.toISOString().slice(0, 10);
}
