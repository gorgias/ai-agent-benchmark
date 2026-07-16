// tools/probe-generic.mjs — generic widget probe with the runner's EXACT context.
// Usage: node tools/probe-generic.mjs <store-key> [question]
// Opens the store, runs widget.open + one send, dumps frames/inputs/buttons/body tail
// at each stage. Read-only; writes nothing to results/.
import pw from "../node_modules/playwright/index.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { STORES, WIDGETS } = require("../vendors.js");
const { chromium } = pw;
const site = STORES.find((s) => s.key === process.argv[2]);
if (!site) { console.error("unknown store", process.argv[2]); process.exit(1); }
const widget = WIDGETS[site.widget];
const Q = process.argv[3] || "Hi! Do you ship to the US and how long does delivery take?";
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};
  if (typeof window.chrome.runtime.sendMessage !== "function") window.chrome.runtime.sendMessage = () => Promise.resolve();
};
async function dump(page, label) {
  console.log(`\n===== [${label}] =====`);
  const frames = page.frames().map((fr) => ({ n: (fr.name() || "").slice(0, 40), u: (fr.url() || "").slice(0, 90) })).filter((x) => x.n || (x.u && x.u !== "about:blank"));
  console.log("frames:", JSON.stringify(frames.slice(0, 10)));
  for (const fr of page.frames()) {
    const st = await fr.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const inputs = [...document.querySelectorAll('textarea, input[type=text], [contenteditable="true"]')].filter(vis).map((e) => ({ tag: e.tagName, ph: e.getAttribute("placeholder") || e.getAttribute("aria-label") }));
      const btns = [...document.querySelectorAll('button, [role="button"]')].filter(vis).map((e) => (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 40)).filter(Boolean).slice(0, 10);
      return { inputs, btns, tail: document.body.innerText.replace(/\n+/g, " | ").slice(-260) };
    }).catch(() => null);
    if (st && (st.inputs.length || st.btns.length)) console.log(`frame[${(fr.name() || fr.url()).slice(0, 50)}]:`, JSON.stringify(st).slice(0, 700));
  }
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: site.locale || "en-US", timezoneId: "America/New_York", userAgent: REAL_UA, extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" } });
await ctx.addInitScript(STEALTH);
if (site.widget === "spiffy") await ctx.addInitScript(() => { try { localStorage.setItem("spiffy_on", "true"); } catch (e) {} });
const page = await ctx.newPage();
const url = (site.modeUrl && site.modeUrl.shopping) || site.url;
console.log("goto", url);
const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => (console.log("goto err:", String(e).slice(0, 100)), null));
console.log("status:", resp && resp.status(), "| title:", (await page.title().catch(() => "?")).slice(0, 70));
await page.waitForTimeout(6000);
await widget.open(page);
await dump(page, "after open");
await widget.send(page, Q);
console.log("\nsent:", Q);
await page.waitForTimeout(30000);
await dump(page, "30s after send");
await browser.close();
