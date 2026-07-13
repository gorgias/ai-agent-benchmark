// BOILERPLATE AUDIT — automatically find recurring message chrome the cleaner misses.
//
// WHY (2026-07-13, Max): widget chrome keeps leaking into captured replies in NEW shapes
// ("Supergoop! AI…", "…Give us feedback", CSS, chips) and he was flagging them manually.
// The tell is statistical, not lexical: REAL prose varies turn to turn, CHROME repeats.
// So: for every store, look at all CLEANED replies (post reply-clean.js) and flag any
// prefix or suffix shared by a majority of them — that residue is boilerplate the cleaner
// doesn't know yet. Vendor-blind by construction: the same bar applies to every store,
// which keeps the evals equitable.
//
//   node boilerplate-audit.mjs             # audit all stores → boilerplate-audit.json + summary
//   node boilerplate-audit.mjs --min 0.4   # lower the share threshold
//
// Output feeds two loops:
//   • verify-data.js surfaces the flag count pre-deploy (a NEW leak blocks quietly shipping it)
//   • the patterns land in reply-clean.js (or its per-store opts) as explicit strips + tests
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { stripWidgetChrome } from "./reply-clean.js";
import { isQuarantinedConversation } from "./conversation-quarantine.js";

const MIN_SHARE = process.argv.includes("--min") ? Number(process.argv[process.argv.indexOf("--min") + 1]) : 0.5;
const MIN_REPLIES = 8;    // need a real sample before calling something "recurring"
const MIN_LEN = 8;        // ignore trivial shared openers ("The", "You ")

// longest common prefix/suffix of a cluster of strings
const lcp = (arr) => { let p = arr[0] || ""; for (const s of arr) { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); } return p; };
const rev = (s) => [...s].reverse().join("");

function recurring(replies, tail = false) {
  // cluster on the first/last 14 chars (normalized), then expand to the cluster's LCP
  const keyOf = (s) => (tail ? rev(s) : s).slice(0, 14).toLowerCase();
  const buckets = {};
  for (const r of replies) { if (r.length < MIN_LEN) continue; (buckets[keyOf(r)] = buckets[keyOf(r)] || []).push(tail ? rev(r) : r); }
  const [key, cluster] = Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)[0] || [null, []];
  if (!cluster.length || cluster.length / replies.length < MIN_SHARE) return null;
  let common = lcp(cluster);
  if (common.length < MIN_LEN) return null;
  if (tail) common = rev(common);
  return { pattern: common.trim().slice(0, 90), share: +(cluster.length / replies.length).toFixed(2), n: cluster.length };
}

const base = "results";
const byStore = {};
for (const d of readdirSync(base).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  const dir = `${base}/${d}/conv`;
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    if (isQuarantinedConversation(`${d}/${f}`)) continue;   // excluded convs don't define patterns
    let s; try { s = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")); } catch { continue; }
    if (!s.valid) continue;
    const store = f.split("-").slice(0, 2).join("-");
    for (const t of (s.turns || []).filter((x) => x.by === "ai")) {
      const clean = stripWidgetChrome(t.replyText || t.replyTail || "", t.q || "");
      if (clean) (byStore[store] = byStore[store] || []).push(clean);
    }
  }
}

const flags = [];
for (const [store, replies] of Object.entries(byStore)) {
  if (replies.length < MIN_REPLIES) continue;
  const pre = recurring(replies, false);
  const suf = recurring(replies, true);
  // a recurring SENTENCE opener isn't chrome ("You have 30 days…" varies after) — only flag
  // prefixes that are NOT the start of ordinary prose: contain no space before 8 chars is fine,
  // rely on human review of the report; we still report both, ranked by share.
  if (pre) flags.push({ store, kind: "prefix", ...pre, replies: replies.length });
  if (suf) flags.push({ store, kind: "suffix", ...suf, replies: replies.length });
}
flags.sort((a, b) => b.share - a.share);
// ALLOWLIST: patterns reviewed and judged genuine prose (boilerplate-allow.json) don't warn —
// the gate should only fire on NEW, unreviewed patterns.
let allowed = [];
try { allowed = JSON.parse(readFileSync("boilerplate-allow.json", "utf8")).allow || []; } catch {}
const isAllowed = (f) => allowed.some((a) => a.store === f.store && a.kind === f.kind && f.pattern.toLowerCase().startsWith(String(a.startsWith).slice(0, 40).toLowerCase()));
const active = flags.filter((f) => !isAllowed(f));
const suppressed = flags.length - active.length;
writeFileSync("boilerplate-audit.json", JSON.stringify({ minShare: MIN_SHARE, flags: active, suppressedAsGenuine: suppressed }, null, 2) + "\n");
console.log(`Boilerplate audit: ${Object.keys(byStore).length} stores scanned, ${active.length} pattern(s) flagged (share ≥ ${MIN_SHARE})${suppressed ? ` · ${suppressed} reviewed-genuine suppressed` : ""}`);
for (const f of active) console.log(`  ${f.store.padEnd(22)} ${f.kind.padEnd(6)} ${String(Math.round(f.share * 100)).padStart(3)}% of ${String(f.replies).padStart(3)} replies :: "${f.pattern}"`);
if (!active.length) console.log("  (clean — no unreviewed recurring residue)");
