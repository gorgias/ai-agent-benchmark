// tools/probe-net.mjs — diagnose a NET-transport widget whose replies are not being captured.
//
// The net transport (Rep AI, Humind) times a turn off backend responses, not the DOM:
// run.js buffers every response whose URL matches WIDGETS[w].net.match, parsed by .net.parse.
// If the vendor moves its endpoint or changes the payload shape, match/parse silently yield
// nothing, complete_ms stays null, and every conversation is dropped as "no measurable latency"
// even though the widget answered perfectly. This probe shows which of the two broke.
//
// Usage: node tools/probe-net.mjs <store-key> [--headed] [question]
// Read-only: writes nothing to results/.
import pw from "../node_modules/playwright/index.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { STORES, WIDGETS } = require("../vendors.js");
const { chromium } = pw;

const key = process.argv[2];
const HEADED = process.argv.includes("--headed");
const site = STORES.find((s) => s.key === key);
if (!site) { console.error("unknown store", key); process.exit(1); }
const w = WIDGETS[site.widget];
const Q = process.argv.slice(3).find((a) => !a.startsWith("--")) || "Hi! Do you ship to the US and how long does delivery take?";
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};
};

console.log(`store=${key}  widget=${site.widget}  transport=${w.transport || "dom"}`);
console.log(`configured match: ${w.net ? String(w.net.match) : "(none — DOM transport)"}`);

const browser = await chromium.launch({ headless: !HEADED, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({ userAgent: REAL_UA, locale: site.locale || "en-US" });
await ctx.addInitScript(STEALTH);
const page = await ctx.newPage();

// WebSocket capture. run.js's net transport listens on page.on("response") only, so a widget
// that pushes replies over a socket is invisible to it no matter how good match/parse are.
const wsFrames = [];
page.on("websocket", (ws) => {
  console.log(`   [ws opened] ${ws.url().slice(0, 120)}`);
  ws.on("framereceived", (f) => {
    const d = typeof f.payload === "string" ? f.payload : `(binary ${f.payload?.length || 0}b)`;
    wsFrames.push({ dir: "recv", t: Date.now(), url: ws.url(), d });
  });
  ws.on("framesent", (f) => {
    const d = typeof f.payload === "string" ? f.payload : `(binary ${f.payload?.length || 0}b)`;
    wsFrames.push({ dir: "sent", t: Date.now(), url: ws.url(), d });
  });
});

const all = [];           // every response with a body worth looking at
let matched = 0, parsedOut = 0;
page.on("response", async (resp) => {
  const url = resp.url();
  if (/\.(png|jpe?g|gif|svg|webp|woff2?|ttf|css|ico|mp4)(\?|$)/i.test(url)) return;
  const isMatch = w.net ? w.net.match.test(url) : false;
  if (isMatch) matched++;
  // keep POST/XHR-ish traffic and anything the matcher hit
  const m = resp.request().method();
  if (!isMatch && m === "GET" && !/api|chat|message|event|stream|conversation|agent|bot|reply/i.test(url)) return;
  let body = "";
  try { body = (await resp.text()).slice(0, 4000); } catch { body = "(unreadable)"; }
  if (isMatch && w.net) {
    try { const out = w.net.parse(body, url) || []; parsedOut += out.length; } catch {}
  }
  all.push({ url, m, status: resp.status(), isMatch, len: body.length, body });
});

await page.goto(site.url, { waitUntil: "commit", timeout: 60000 });
await page.waitForTimeout(3000);
try { await w.open(page); } catch (e) { console.log("open() threw:", String(e).slice(0, 120)); }
await page.waitForTimeout(3000);
const beforeSend = all.length; const sentAt = Date.now();
try { await w.send(page, Q); console.log(`\nsent: ${Q}`); } catch (e) { console.log("send() threw:", String(e).slice(0, 160)); }
await page.waitForTimeout(25000);

console.log(`\n=== responses seen after send: ${all.length - beforeSend} ===`);
console.log(`configured matcher hit ${matched} response(s); parse() yielded ${parsedOut} reply string(s)`);
if (matched === 0) console.log("!! the configured match NEVER fired — the endpoint moved, or the widget never sent");
else if (parsedOut === 0) console.log("!! matcher fired but parse() returned nothing — the PAYLOAD SHAPE changed");

// Always show what the configured matcher actually caught — these are usually SMALL and would
// otherwise be buried under analytics/bundle traffic in a size-ranked list.
const hits = all.filter((r) => r.isMatch);
console.log(`\n--- every response the configured matcher caught (${hits.length}) ---`);
for (const r of hits) {
  let out = [];
  try { out = w.net.parse(r.body, r.url) || []; } catch {}
  console.log(`\n${r.m} ${r.status} ${r.len}b  ${r.url.slice(0, 100)}`);
  console.log(`   parse() -> ${out.length} string(s)${out.length ? ": " + JSON.stringify(out.map((s) => s.slice(0, 90))) : ""}`);
  if (!out.length) console.log(`   raw: ${r.body.replace(/\s+/g, " ").slice(0, 300)}`);
}

const wsAfter = wsFrames.filter((f) => f.t >= sentAt);
console.log(`\n--- WebSocket frames after send: ${wsAfter.length} (total ${wsFrames.length}) ---`);
if (!wsFrames.length) console.log("  (no WebSocket traffic at all)");
for (const f of wsAfter.filter((f) => f.d.length > 60).slice(0, 10)) {
  console.log(`\n  [${f.dir}] +${((f.t - sentAt) / 1000).toFixed(1)}s  ${f.url.slice(0, 80)}`);
  console.log(`     ${f.d.replace(/\s+/g, " ").slice(0, 400)}`);
}

console.log(`\n--- other candidate reply-bearing responses after send (ranked by body size) ---`);
const after = all.slice(beforeSend).filter((r) => r.len > 40 && !r.isMatch).sort((a, b) => b.len - a.len).slice(0, 8);
for (const r of after) {
  console.log(`\n[${r.isMatch ? "MATCH" : "     "}] ${r.m} ${r.status} ${r.len}b  ${r.url.slice(0, 110)}`);
  console.log(`         ${r.body.replace(/\s+/g, " ").slice(0, 240)}`);
}
await browser.close();
