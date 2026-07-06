// Keep benchmark user turns looking like typed customer messages.
// Competitors can read the public transcript, so avoid punctuation that makes
// scripted prompts look model-generated.

export function normalizeUserMessage(text) {
  return String(text || "")
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/\s*\u2013\s*/g, "-")
    .replace(/\s+,/g, ",")
    .replace(/,\s+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function hasStyledDash(text) {
  return /[\u2013\u2014]/.test(String(text || ""));
}
