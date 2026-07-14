import { chromium } from "playwright";
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); };
const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "fr-FR", timezoneId: "Europe/Paris", userAgent: REAL_UA });
await ctx.addInitScript(STEALTH);
const page = await ctx.newPage();
await page.goto("https://atmakitchenware.fr/", { waitUntil: "load", timeout: 60000 });
await page.mouse.wheel(0, 300); await page.waitForTimeout(6000);

const diag = await page.evaluate(() => {
  const out = {};
  // 1. yuma-ish globals
  out.globals = Object.getOwnPropertyNames(window).filter(k => /yuma|chat|widget/i.test(k)).slice(0, 30);
  // 2. yuma script tags
  out.scripts = [...document.querySelectorAll("script[src]")].map(s => s.src).filter(s => /yuma/i.test(s));
  // 3. shadow-root scan for fixed bottom-right clickables
  out.shadowCands = [];
  const walk = (root, path) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        for (const inner of el.shadowRoot.querySelectorAll("*")) {
          const s = getComputedStyle(inner);
          if ((s.position === "fixed") && inner.getClientRects().length) {
            const r = inner.getBoundingClientRect();
            if (r.width >= 30 && r.width <= 220 && r.bottom > innerHeight - 260 && r.right > innerWidth - 260)
              out.shadowCands.push({ host: el.tagName.toLowerCase(), tag: inner.tagName.toLowerCase(), cls: (inner.className||"").toString().slice(0,60), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) });
          }
        }
        walk(el.shadowRoot, path + ">" + el.tagName);
      }
    }
  };
  walk(document, "doc");
  // 4. the yuma-widget iframe's inline style (is it 1x1 by design, expanded by postMessage?)
  const ifr = document.getElementById("yuma-widget");
  out.yumaIframeStyle = ifr ? (ifr.getAttribute("style") || "").slice(0, 200) : null;
  // 5. elements with yuma in id/class anywhere
  out.yumaEls = [...document.querySelectorAll('[id*="yuma" i], [class*="yuma" i]')].map(el => ({ tag: el.tagName.toLowerCase(), id: el.id, cls: (el.className||"").toString().slice(0,60), rect: (r=>({w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)}))(el.getBoundingClientRect()) }));
  return out;
});
console.log(JSON.stringify(diag, null, 1));
await browser.close();
