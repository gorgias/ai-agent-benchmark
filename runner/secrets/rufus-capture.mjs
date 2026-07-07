// Dedicated Amazon Rufus capture — proven DOM path (run.js's timeTurn had an unreproducible
// 67s-open nuance under waitUntil:"commit"; this uses domcontentloaded, which opens the panel
// reliably in ~4-7s). Emits the EXACT conv schema run.js writes → flows through eval-pack/gen.
import { chromium } from "playwright";
import { WIDGETS, STORES, readTranscript } from "../vendors.js";
import { convoValidity, detectHandover, isGen, isAck, isNoAnswer } from "../classify.js";
import { SHOPPING_THEMES } from "../pools.js";
import { writeFile } from "node:fs/promises";

const store = STORES.find(s => s.key === "rufus-amazon");
const w = WIDGETS[store.widget];
const STATE = new URL("./amazon-state.json", import.meta.url).pathname;
const STAMP = process.env.RUN_DATE || "2026-07-07";
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const POLL = 250, STABLE = 5000, SETTLE = 2500, TURN_TIMEOUT = Number(process.env.TURN_TIMEOUT_MS) || 45000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const L = (...a) => console.log(new Date().toISOString() + " " + a.join(" "));

// run.js timeTurn (DOM), verbatim behavior
async function timeTurn(page, scope, sendFn, q) {
  const before = (await readTranscript(page, scope)).len;
  const echoApprox = (q ? q.length : 80) + 70, REPLY_MIN = echoApprox + 40;
  const t0 = Date.now(); await sendFn();
  let lastLen = before, lastChange = t0, ttft = null, sawGen = false, grownReply = false, complete = null, growthEvents = 0, trough = before;
  const deadline = t0 + TURN_TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(POLL);
    const { len, text } = await readTranscript(page, scope);
    if (len !== lastLen) { lastChange = Date.now(); if (len > lastLen) growthEvents++; lastLen = len; }
    if (len < trough) trough = len;
    if (isGen(text)) sawGen = true;
    if (len > trough + REPLY_MIN) { grownReply = true; if (ttft == null) ttft = Date.now() - t0; }
    const shortSoFar = (len - trough) < 240;
    const working = isGen(text) || (isAck(text) && shortSoFar);
    const settled = Date.now() - lastChange > STABLE;
    const realAnswer = (grownReply || (sawGen && len > trough + 40)) && !isNoAnswer(text);
    if (settled && !working && realAnswer) { complete = lastChange - t0; break; }
  }
  return { ttft_ms: ttft, complete_ms: complete, grew: lastLen - before, growth_events: growthEvents };
}

const themes = SHOPPING_THEMES.filter(t => t.key !== "guardrails");   // 5 core shopping themes
const b = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] });
for (const theme of themes) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US", timezoneId: "America/New_York", userAgent: REAL_UA, extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }, storageState: STATE });
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  const page = await ctx.newPage();
  const out = { key: store.key, vendor: store.vendor, store: store.store, url: store.url, us: !!store.us, widget: store.widget,
    mode: "shopping", theme: theme.key, themeLabel: theme.label || theme.key, date: STAMP, capturedAt: new Date().toISOString(),
    capture: { origin: "claude", loggedIn: true }, turns: [] };
  try {
    await page.goto(store.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(3500);
    await w.open(page);
    L(`[rufus/${theme.key}] open, composer=${await page.locator("#rufus-text-area").count()}`);
    let handedOver = false;
    for (let i = 0; i < theme.turns.length; i++) {
      const q = theme.turns[i];
      if (handedOver) { out.turns.push({ turn: i + 1, q, by: "human", ttft_ms: null, complete_ms: null, ai_latency_ms: null, handover: false, handover_hit: null, unsent: true, replyTail: "(not sent — handed to human)" }); continue; }
      const r = await timeTurn(page, w.scope, () => w.send(page, q), q).catch(e => ({ ttft_ms: null, complete_ms: null, error: String(e).slice(0, 100) }));
      const tail = (await readTranscript(page, w.scope)).text.slice(-700);
      const handover = detectHandover(tail, w.handover, [store.store, store.vendor, ...(store.personas || [])]);
      if (handover) handedOver = true;
      const by = handedOver ? "human" : "ai";
      out.turns.push({ turn: i + 1, q, by, ...r, ai_latency_ms: by === "ai" ? r.complete_ms : null, handover: !!handover, handover_hit: handover, replyTail: tail.slice(-500) });
      L(`[rufus/${theme.key}] T${i + 1} ${by === "ai" ? (r.complete_ms ?? "—") + "ms" : "(human)"}${handover ? " ⛔ " + handover : ""}`);
      await sleep(SETTLE);
    }
  } catch (e) { out.error = String(e).slice(0, 200); L(`[rufus/${theme.key}] FAILED ${out.error}`); }
  await ctx.close();
  const aiValid = out.turns.filter(t => t.by === "ai").map(t => t.complete_ms).filter(x => x != null);
  const answered = out.turns.filter(t => t.by === "ai" && t.complete_ms != null).length;
  const fh = out.turns.find(t => t.handover);
  const v = convoValidity(out.turns);
  out.valid = v.valid; out.invalid_reason = v.reason;
  out.stats = { turns: out.turns.length, answered_no_handover: answered, success_rate: out.turns.length ? Math.round(answered / out.turns.length * 100) : null,
    avg_ms: aiValid.length ? Math.round(aiValid.reduce((a, b) => a + b, 0) / aiValid.length) : null, min_ms: aiValid.length ? Math.min(...aiValid) : null, max_ms: aiValid.length ? Math.max(...aiValid) : null,
    latency_basis: "AI turns only", handover_turn: fh ? fh.turn : null, valid: v.valid, timed_turns: v.timed };
  const f = `results/${STAMP}/conv/rufus-amazon-shopping-${theme.key}.json`;
  await writeFile(f, JSON.stringify(out));
  L(`[rufus/${theme.key}] ${v.valid ? "VALID" : "INVALID"} timed=${v.timed} avg=${out.stats.avg_ms}ms → ${f}`);
}
await b.close();
L("RUFUS CAPTURE DONE");
