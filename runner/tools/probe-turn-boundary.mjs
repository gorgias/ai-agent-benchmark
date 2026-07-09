// tools/probe-turn-boundary.mjs — instrumented probe for the turn-boundary bleed bug.
//
// Sends a few themed questions to ONE store and logs a full TIMELINE of transcript
// growth (elapsed, delta, tail) with a LONG per-turn window, so we can measure:
//   (a) how long the vendor's real answers actually take (vs TURN_TIMEOUT=45s),
//   (b) whether an unanswered turn's reply arrives during the NEXT turn's window,
//   (c) what pre-send quiescence window would have prevented the bleed.
// Read-only diagnostics: writes probe-<store>.log lines to stdout, no conv files.
//
//   node tools/probe-turn-boundary.mjs kodif-neuro shopping 4     # from runner/
import { chromium } from "playwright";
import { WIDGETS, STORES, readTranscript } from "../vendors.js";
import { isGen, isAck } from "../classify.js";
import { SHOPPING_THEMES, SUPPORT_THEMES } from "../pools.js";

const [key = "kodif-neuro", mode = "shopping", nTurns = "4"] = process.argv.slice(2);
const store = STORES.find((s) => s.key === key);
if (!store) { console.error("unknown store " + key); process.exit(1); }
const w = WIDGETS[store.widget];
const theme = (mode === "support" ? SUPPORT_THEMES : SHOPPING_THEMES)[0];
const WINDOW_MS = 120000, POLL = 250;
const t00 = Date.now();
const L = (...a) => console.log(((Date.now() - t00) / 1000).toFixed(1).padStart(7) + "s " + a.join(" "));

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US" });
const page = await ctx.newPage();
await page.goto(store.url, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
await w.open(page);
L("widget open");

for (let i = 0; i < Math.min(Number(nTurns), theme.turns.length); i++) {
  const q = theme.turns[i];
  const before = await readTranscript(page, w.scope);
  L(`T${i + 1} SEND (baseline len=${before.len}) q="${q.slice(0, 60)}"`);
  const t0 = Date.now();
  await w.send(page, q);
  let last = before.len, lastChange = t0, settledLogged = false;
  while (Date.now() - t0 < WINDOW_MS) {
    await new Promise((r) => setTimeout(r, POLL));
    const { len, text } = await readTranscript(page, w.scope);
    if (len !== last) {
      const el = ((Date.now() - t0) / 1000).toFixed(1);
      L(`T${i + 1} +${len - last} (len=${len}) @${el}s gen=${isGen(text)} ack=${isAck(text)} tail="${text.slice(-90).replace(/\n/g, "⏎")}"`);
      last = len; lastChange = Date.now(); settledLogged = false;
    } else if (!settledLogged && Date.now() - lastChange > 6000 && !isGen(text)) {
      L(`T${i + 1} SETTLED for 6s at len=${len} (answer complete @${((lastChange - t0) / 1000).toFixed(1)}s)`);
      settledLogged = true;
      // keep watching a bit to catch late extra growth, then move on after 15s quiet
      if (Date.now() - lastChange > 15000) break;
    } else if (settledLogged && Date.now() - lastChange > 15000) break;
  }
  L(`T${i + 1} WINDOW END (last growth @${((lastChange - t0) / 1000).toFixed(1)}s after send)`);
}
await b.close();
L("PROBE DONE");
