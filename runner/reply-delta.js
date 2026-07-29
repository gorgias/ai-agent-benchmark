// reply-delta.js — recover "what did the widget actually say on THIS turn?" when the
// common-prefix scan in run.js cannot.
//
// WHY THIS EXISTS (2026-07-28). run.js isolates a turn's reply by diffing the transcript
// against its pre-send snapshot, keeping the delta only when the common prefix covers >=70%
// of the old text. When a widget re-renders or virtualizes its message list the prefix
// collapses, the gate fails, and the old code fell back to storing THE WHOLE TRANSCRIPT as
// that turn's reply. The stored "reply" then contained the entire storefront page plus every
// earlier message — the ~2.4k-char homepage scrape that eight independent blind judges
// flagged in one night ("raw scrollback dumps", "hollow captures", "these conversations are
// under-scoring their vendor").
//
// The bias only runs one way: a page dump reads to a judge as a non-answer, so the defect
// SUPPRESSES the measured quality of whichever vendor it hits. It is a scoring-integrity bug,
// not a cosmetic one.
//
// The fix: fall back to a LINE-LEVEL difference instead of the whole transcript. Page chrome,
// nav links and earlier messages were all present before the turn, so they are not new; only
// genuinely new lines survive. This is robust to reshuffling and virtualization, which is
// exactly the case where the prefix scan gives up.

/**
 * Lines present in `after` that were not already present in `before`, in their original order.
 *
 * Comparison is on trimmed lines so that indentation churn from a re-render does not make an
 * unchanged line look new. Blank lines are dropped. If nothing is new, the result is "" —
 * that is the honest reading (the turn added no visible content), and it is far better than
 * the old behaviour of attributing the entire page to the turn.
 */
export function novelLines(before, after) {
  const seen = new Set(
    String(before || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const out = [];
  for (const raw of String(after || "").split("\n")) {
    const line = raw.trim();
    if (!line || seen.has(line)) continue;
    out.push(line);
    // A line repeated within the same turn is still only new once; keeping the duplicate
    // would re-inflate the very dumps this function exists to prevent.
    seen.add(line);
  }
  return out.join("\n").trim();
}
