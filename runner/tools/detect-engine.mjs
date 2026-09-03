// tools/detect-engine.mjs — identify which AI ENGINE actually answers on a storefront, by
// watching network traffic while the chat is used. Read-only: writes nothing to results/.
//
// WHY THIS EXISTS (2026-09-03). Static source detection finds the WIDGET, not the engine. Yuma
// is mostly sold as an AI layer on top of someone else's helpdesk: a Yuma-powered store loads
// Gorgias's or Zendesk's widget and nothing in its HTML says "Yuma" at all. Scanning twelve
// publicly self-declared Yuma merchants for `js.yuma.ai` returned zero hits, while three of
// them plainly load Gorgias — so a source scan would have concluded, wrongly, that Yuma has
// almost no measurable footprint.
//
// The engine does reveal itself the moment the widget is used: the reply is fetched from the
// engine's own API. Open the chat, send one question, and read the hostnames.
//
// Usage: node tools/detect-engine.mjs <url> [more urls...] [--headed] [--q "question"]
import pw from "../node_modules/playwright/index.js";
import { WIDGETS } from "../vendors.js";

const { chromium } = pw;
const args = process.argv.slice(2);
const HEADED = args.includes("--headed");
const qi = args.indexOf("--q");
const Q = qi >= 0 ? args[qi + 1] : "Hi! Do you ship internationally and how long does delivery take?";
const urls = args.filter((a, i) => !a.startsWith("--") && (qi < 0 || i !== qi + 1));
if (!urls.length) { console.error('usage: node tools/detect-engine.mjs <url>... [--headed] [--q "…"]'); process.exit(1); }

// An engine is identified by the host its ANSWERS come from, not by the widget on the page.
const ENGINES = [
  ["Yuma", /(^|\.)yuma\.ai$/i],
  ["Gorgias", /(^|\.)gorgias\.(chat|com|io)$/i],
  ["Siena", /(^|\.)siena\.(cx|chat)$/i],
  ["Ada", /(^|\.)ada\.support$/i],
  ["Intercom", /(^|\.)intercom\.(io|com)$/i],
  ["Zendesk", /(^|\.)(zendesk|zdassets)\.com$/i],
  ["Envive", /(^|\.)(envive|spiffy)\.ai$/i],
  ["Sierra", /(^|\.)sierra\.chat$/i],
  ["Kodif", /(^|\.)kodif\.(ai|io)$/i],
  ["Decagon", /(^|\.)decagon\.ai$/i],
  ["Klaviyo", /(^|\.)klaviyo\.com$/i],
  ["Gladly", /(^|\.)gladly\.com$/i],
];
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const browser = await chromium.launch({ headless: !HEADED, args: ["--disable-blink-features=AutomationControlled"] });
const rows = [];
for (const url of urls) {
  const ctx = await browser.newContext({ userAgent: REAL_UA });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();
  const hosts = new Map();   // host → request count, so a busy engine outranks a stray beacon
  page.on("request", (r) => {
    try { const h = new URL(r.url()).hostname; hosts.set(h, (hosts.get(h) || 0) + 1); } catch {}
  });
  let note = "";
  try {
    await page.goto(url, { waitUntil: "commit", timeout: 45000 });
    await page.waitForTimeout(4000);
    // Try every registered widget opener: we do not know which one this store uses, and an
    // engine only answers once its widget is actually open.
    let opened = false;
    for (const w of Object.values(WIDGETS)) {
      try {
        await Promise.race([w.open(page), new Promise((_, r) => setTimeout(() => r(new Error("t")), 12000))]);
        opened = true; break;
      } catch {}
    }
    if (!opened) note = "widget never opened";
    else {
      await page.waitForTimeout(2000);
      for (const w of Object.values(WIDGETS)) { try { await w.send(page, Q); break; } catch {} }
      await page.waitForTimeout(12000);   // let the engine answer — that is the request we want
    }
  } catch (e) { note = String(e).slice(0, 60); }
  await ctx.close();

  const found = [];
  for (const [name, re] of ENGINES) {
    let n = 0;
    for (const [h, c] of hosts) if (re.test(h)) n += c;
    if (n) found.push({ name, n });
  }
  found.sort((a, b) => b.n - a.n);
  rows.push({ url, engines: found, note });
  const label = found.length ? found.map((f) => `${f.name}(${f.n})`).join(" ") : "—";
  console.log(`${(found[0]?.name || "NONE").padEnd(11)} ${url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").padEnd(30)} ${label}${note ? "  · " + note : ""}`);
}
await browser.close();
const yuma = rows.filter((r) => r.engines.some((e) => e.name === "Yuma"));
console.log(`\n=== ${yuma.length} of ${rows.length} answer from a Yuma endpoint ===`);
for (const r of yuma) console.log("   " + r.url);
