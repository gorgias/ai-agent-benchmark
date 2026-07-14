// rufus-30.mjs — 30 more Amazon Rufus shopping conversations for the 200-conv batch.
// Self-sources fresh product ASINs from Amazon's bestsellers page (logged-in), skips
// (theme × product) combos already captured on ANY run date, captures the FULL turn
// reply (replyText, head-preserved) alongside replyTail. Headed + logged-in only.
// Conversations are written to results/$RUN_DATE/conv/ and NEVER moved or archived.
import { chromium } from "playwright";
import { WIDGETS, STORES, readTranscript } from "../vendors.js";
import { convoValidity, detectHandover, isGen, isAck, isNoAnswer } from "../classify.js";
import { SHOPPING_THEMES } from "../pools.js";
import { writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const TARGET = Number(process.env.RUFUS_TARGET) || 30;
const store = STORES.find(s => s.key === "rufus-amazon");
const w = WIDGETS[store.widget];
const STATE = new URL("./amazon-state.json", import.meta.url).pathname;
const STAMP = process.env.RUN_DATE || "2026-07-08";
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

// (theme × product) combos already captured on ANY run date — never re-run one
async function usedComboKeys() {
  const used = new Set();
  for (const d of (await readdir("results")).filter(x => /^2026/.test(x))) {
    let fs; try { fs = await readdir(`results/${d}/conv`); } catch { continue; }
    for (const f of fs) { const m = f.match(/^rufus-amazon-shopping-(.+)\.json$/); if (m) used.add(m[1]); }
  }
  return used;
}

// Known products (suffix used in past filenames). The seed raspberries PDP used
// theme-only filenames and consumed all 5 core themes — excluded entirely.
const KNOWN = [["blinkcam","B08JHCVHTY"],["basics-sheets","B00Q7OAPM6"],["medicube-pads","B09V7Z4TJG"],["owala-bottle","B0BZYCJK89"],["fd-blueberries","B0DPGSZBGS"]];

const themes = SHOPPING_THEMES.filter(t => t.key !== "guardrails");
const b = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] });

// --- Step 1: source fresh ASINs from the bestsellers page (logged-in session) ---
async function scrapeBestsellerAsins(n) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US", timezoneId: "America/New_York", userAgent: REAL_UA, extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }, storageState: STATE });
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  const page = await ctx.newPage();
  const asins = [];
  try {
    await page.goto("https://www.amazon.com/gp/bestsellers/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(3000);
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href*="/dp/"]')].map(a => a.href));
    const known = new Set(KNOWN.map(([, a]) => a).concat(["B0DX391LXK"]));
    const seen = new Set();
    for (const h of hrefs) {
      const m = h.match(/\/dp\/([A-Z0-9]{10})/);
      if (m && !known.has(m[1]) && !seen.has(m[1])) { seen.add(m[1]); asins.push(m[1]); }
      if (asins.length >= n) break;
    }
  } catch (e) { L("bestsellers scrape failed: " + String(e).slice(0, 120)); }
  await ctx.close();
  return asins;
}

const fresh = await scrapeBestsellerAsins(8);
L(`sourced ${fresh.length} fresh bestseller ASINs: ${fresh.join(",")}`);
const PRODUCTS = KNOWN.concat(fresh.map((a, i) => [`bs${i + 1}-${a.toLowerCase()}`, a]));

// --- Step 2: build the (theme × product) queue, skipping captured combos ---
const used = await usedComboKeys();
const queue = [];
for (const [pname, asin] of PRODUCTS) for (const theme of themes) {
  const key = `${theme.key}-${pname}`;
  if (!used.has(key)) queue.push({ theme, pname, asin, key });
}
L(`queue: ${queue.length} free combos (target ${TARGET})`);

let done = 0;
for (const { theme, pname, asin, key } of queue) {
  if (done >= TARGET) break;
  const url = `https://www.amazon.com/dp/${asin}`;
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US", timezoneId: "America/New_York", userAgent: REAL_UA, extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }, storageState: STATE });
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  const page = await ctx.newPage();
  const out = { key: store.key, vendor: store.vendor, store: store.store, url, us: !!store.us, widget: store.widget,
    mode: "shopping", theme: key, themeLabel: (theme.label || theme.key) + " · " + pname, date: STAMP, capturedAt: new Date().toISOString(),
    capture: { origin: "claude", loggedIn: true, product: asin }, turns: [] };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(3500);
    await w.open(page);
    let handedOver = false;
    for (let i = 0; i < theme.turns.length; i++) {
      const q = theme.turns[i];
      if (handedOver) { out.turns.push({ turn: i + 1, q, by: "human", ttft_ms: null, complete_ms: null, ai_latency_ms: null, handover: false, handover_hit: null, unsent: true, replyTail: "(not sent)" }); continue; }
      const beforeText = (await readTranscript(page, w.scope)).text;
      const r = await timeTurn(page, w.scope, () => w.send(page, q), q).catch(e => ({ ttft_ms: null, complete_ms: null, error: String(e).slice(0, 80) }));
      const afterText = (await readTranscript(page, w.scope)).text;
      const tail = afterText.slice(-700);
      // FULL turn reply, head preserved (inner container grows monotonically → prefix delta)
      let p = 0; const mm = Math.min(beforeText.length, afterText.length);
      while (p < mm && beforeText[p] === afterText[p]) p++;
      let replyFull = (p >= beforeText.length * 0.7 ? afterText.slice(p) : afterText).trim();
      replyFull = replyFull.length > 4000 ? replyFull.slice(0, 4000) + "…" : replyFull;
      const hv = detectHandover(tail, w.handover, [store.store, store.vendor, ...(store.personas || [])]);
      if (hv) handedOver = true;
      const by = handedOver ? "human" : "ai";
      out.turns.push({ turn: i + 1, q, by, ...r, ai_latency_ms: by === "ai" ? r.complete_ms : null, handover: !!hv, handover_hit: hv, replyTail: tail.slice(-500), replyText: replyFull });
      await sleep(SETTLE);
    }
  } catch (e) { out.error = String(e).slice(0, 200); L(`[${key}] FAILED ${out.error}`); }
  await ctx.close();
  const aiV = out.turns.filter(t => t.by === "ai").map(t => t.complete_ms).filter(x => x != null);
  const ans = out.turns.filter(t => t.by === "ai" && t.complete_ms != null).length;
  const fh = out.turns.find(t => t.handover);
  const v = convoValidity(out.turns);
  out.valid = v.valid; out.invalid_reason = v.reason;
  out.stats = { turns: out.turns.length, answered_no_handover: ans, success_rate: out.turns.length ? Math.round(ans / out.turns.length * 100) : null,
    avg_ms: aiV.length ? Math.round(aiV.reduce((a, x) => a + x, 0) / aiV.length) : null, min_ms: aiV.length ? Math.min(...aiV) : null, max_ms: aiV.length ? Math.max(...aiV) : null,
    latency_basis: "AI turns only", handover_turn: fh ? fh.turn : null, valid: v.valid, timed_turns: v.timed };
  await writeFile(`results/${STAMP}/conv/rufus-amazon-shopping-${key}.json`, JSON.stringify(out));
  if (v.valid) done++;
  L(`[${done}/${TARGET} ${key}] ${v.valid ? "VALID" : "invalid(" + v.reason + ")"} timed=${v.timed} avg=${out.stats.avg_ms}ms`);
}
await b.close();
L(`RUFUS-30 DONE (${done}/${TARGET} valid)`);
