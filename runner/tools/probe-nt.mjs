// probe-nt.mjs — Ninja Transfers: what widget actually mounts, and does anything drive?
import pw from "./node_modules/playwright/index.js";
const { chromium } = pw;
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};
  if (typeof window.chrome.runtime.sendMessage !== "function") window.chrome.runtime.sendMessage = () => Promise.resolve();
};
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US", timezoneId: "America/New_York", userAgent: REAL_UA });
await ctx.addInitScript(STEALTH);
const page = await ctx.newPage();
await page.goto("https://ninjatransfers.com/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => console.log("goto err", String(e).slice(0, 80)));
await page.waitForTimeout(8000);
console.log("globals:", await page.evaluate(() => ({
  klaviyo: typeof window.klaviyo, Intercom: typeof window.Intercom, zE: typeof window.zE, gorgias: typeof window.GorgiasChat,
})));
console.log("frames:", (page.frames()).map((f) => ({ n: (f.name() || "").slice(0, 36), u: (f.url() || "").slice(0, 90) })).filter((x) => x.u !== "about:blank" || x.n));
// visible chat launchers?
console.log("launchers:", await page.evaluate(() => [...document.querySelectorAll('[aria-label*="chat" i], [class*="chat" i][role="button"], [id*="chat" i][role="button"], button[class*="launcher" i], [class*="kai" i]')].map((e) => ({ t: e.tagName, id: e.id.slice(0, 30), cls: String(e.className).slice(0, 40), label: (e.getAttribute("aria-label") || e.innerText || "").slice(0, 40) })).slice(0, 8)));
await browser.close();
