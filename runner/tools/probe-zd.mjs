// probe-zd.mjs — why does Cotton On (Zendesk) yield 0 valid? Mirror run.js context.
import pw from "./node_modules/playwright/index.js";
// vendors.js is an ES module (package.json declares "type": "module"). Importing it through
// createRequire worked on the Node 22.22 laptop, where require(esm) is unflagged, and threw
// ERR_REQUIRE_ESM on the Node 22.11 capture server — so every auto-probe silently failed in
// production while passing locally. Import it directly; that works on every version.
import { STORES, WIDGETS } from "../vendors.js";
const { chromium } = pw;
const site = STORES.find((s) => s.key === (process.argv[2] || "meta-cottonon"));
const widget = WIDGETS[site.widget];
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};
  if (typeof window.chrome.runtime.sendMessage !== "function") window.chrome.runtime.sendMessage = () => Promise.resolve();
};
const frameOf = (page) => page.frames().find((fr) => (fr.name() || "").includes("Messaging window") || /messaging/i.test(fr.url() || ""));
async function dump(page, label) {
  const frames = page.frames().map((fr) => ({ name: (fr.name() || "").slice(0, 40), url: (fr.url() || "").slice(0, 80) }));
  const f = frameOf(page);
  console.log(`\n===== [${label}] =====`);
  console.log("frames:", JSON.stringify(frames.filter((x) => x.name || x.url !== "about:blank").slice(0, 8)));
  if (!f) { console.log("NO messaging frame"); return; }
  const st = await f.evaluate(() => ({
    inputs: [...document.querySelectorAll("textarea, input, [contenteditable=true]")].map((e) => ({ tag: e.tagName, ph: e.getAttribute("placeholder") || e.getAttribute("aria-label"), dis: e.disabled ?? null })),
    tail: document.body.innerText.replace(/\n+/g, " | ").slice(-320),
  })).catch((e) => ({ err: String(e).slice(0, 100) }));
  console.log(JSON.stringify(st, null, 1).slice(0, 900));
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "en-US", timezoneId: "America/New_York", userAgent: REAL_UA, extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" } });
await ctx.addInitScript(STEALTH);
const page = await ctx.newPage();
console.log("goto", site.url);
const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => (console.log("goto err", String(e).slice(0, 100)), null));
console.log("http status:", resp && resp.status(), "| title:", (await page.title().catch(() => "?")).slice(0, 60));
await page.waitForTimeout(5000);
console.log("zE present:", await page.evaluate(() => typeof window.zE).catch(() => "?"));
await widget.open(page);
await dump(page, "after open");
await widget.send(page, "Hi! Do you ship to the US and how long does it take?");
await page.waitForTimeout(30000);
await dump(page, "30s after T1");
await browser.close();
