// probe-fin2.mjs — diagnose why Fin-for-Ecommerce stores answer T1 then go silent on T2+.
// Replicates the driver flow (same open/send as vendors.js WIDGETS.intercom) with DOM dumps
// between steps. Read-only diagnostic; writes nothing to results/.
import pw from "./node_modules/playwright/index.js";
// vendors.js is an ES module (package.json declares "type": "module"). Importing it through
// createRequire worked on the Node 22.22 laptop, where require(esm) is unflagged, and threw
// ERR_REQUIRE_ESM on the Node 22.11 capture server — so every auto-probe silently failed in
// production while passing locally. Import it directly; that works on every version.
import { STORES, WIDGETS } from "../vendors.js";
const { chromium } = pw;

const storeKey = process.argv[2] || "intercom-solarisjapan";
const site = STORES.find((s) => s.key === storeKey);
if (!site) { console.error("unknown store", storeKey); process.exit(1); }
const widget = WIDGETS[site.widget];

const frameOf = async (page) => page.frames().find((fr) => /intercom-messenger-frame/.test(fr.name() || "") || /intercom-messenger-frame/.test(fr.url() || ""));

async function dump(page, label) {
  const f = await frameOf(page);
  if (!f) { console.log(`[${label}] NO FRAME`); return; }
  const state = await f.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const composers = [...document.querySelectorAll('textarea, [contenteditable="true"]')].map((el) => ({
      tag: el.tagName, vis: vis(el), disabled: el.disabled ?? null, ariaLabel: el.getAttribute("aria-label"),
      placeholder: el.getAttribute("placeholder") || el.getAttribute("data-placeholder"), text: (el.value ?? el.innerText ?? "").slice(0, 40),
    }));
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(vis).map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 44)).filter(Boolean).slice(0, 14);
    const bodyTail = document.body.innerText.replace(/\n+/g, " | ").slice(-360);
    return { composers, buttons, bodyTail };
  }).catch((e) => ({ err: String(e).slice(0, 120) }));
  console.log(`\n===== [${label}] =====`);
  console.log("composers:", JSON.stringify(state.composers ?? state.err));
  console.log("visible buttons:", JSON.stringify(state.buttons));
  console.log("body tail:", state.bodyTail);
}

// Mirror run.js's context exactly — the widget refuses to boot for the default headless UA.
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  const _noop = () => {};
  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {};
  if (typeof window.chrome.runtime.sendMessage !== "function") window.chrome.runtime.sendMessage = () => Promise.resolve();
  if (typeof window.chrome.runtime.connect !== "function") window.chrome.runtime.connect = () => ({ postMessage: _noop, onMessage: { addListener: _noop }, disconnect: _noop });
};
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US", timezoneId: "America/New_York", userAgent: REAL_UA, extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" } });
await ctx.addInitScript(STEALTH);
const page = await ctx.newPage();
console.log("goto", site.url);
await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => console.log("goto err", String(e).slice(0, 80)));
await page.waitForTimeout(4000);

await widget.open(page);
await dump(page, "after open");

const q1 = "Hi! I'm looking for a gift for a friend, any suggestions?";
await widget.send(page, q1);
console.log("\nsent T1:", q1);
await page.waitForTimeout(30000);
await dump(page, "30s after T1");

const q2 = "Can you suggest something under $50?";
await widget.send(page, q2);
console.log("\nsent T2:", q2);
await page.waitForTimeout(8000);
await dump(page, "8s after T2 send");
// did T2 even appear in the thread?
const f = await frameOf(page);
const hasQ2 = f ? await f.evaluate((q) => document.body.innerText.includes(q), q2).catch(() => "?") : "no frame";
console.log("\nT2 text visible in thread:", hasQ2);
await page.waitForTimeout(25000);
await dump(page, "33s after T2");

await browser.close();
