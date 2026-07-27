// tools/probe-shopify-agent.mjs — inspect Shopify's native storefront assistant
// (cdn.shopify.com/storefront/web-components/agent.js + <shopify-chat>), which matches no
// existing vendor signature. Dumps the shadow-DOM tree, launcher, composer and transport so a
// driver can be written against real structure instead of guesswork.
//
// Usage: node tools/probe-shopify-agent.mjs <url> [--headed]
import pw from "../node_modules/playwright/index.js";
const { chromium } = pw;
const url = process.argv[2] || "https://www.chessnutech.com/";
const HEADED = process.argv.includes("--headed");
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const browser = await chromium.launch({ headless: !HEADED, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({ userAgent: REAL_UA, locale: "en-US", extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" } });
await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
const page = await ctx.newPage();
const ws = [], api = [];
page.on("websocket", (s) => ws.push(s.url().slice(0, 160)));
page.on("response", (r) => { const u = r.url(); if (/agent|chat|conversation|message|inbox/i.test(u) && /shopify|myshopify/i.test(u)) api.push(`${r.request().method()} ${r.status()} ${u.slice(0, 130)}`); });

await page.goto(url, { waitUntil: "commit", timeout: 60000 });
await page.waitForTimeout(9000);

const dump = async (label) => {
  const r = await page.evaluate(() => {
    const res = { found: [], launcher: null, inputs: [], text: "" };
    const seen = new Set();
    const walk = (root, path) => {
      for (const el of (root.querySelectorAll ? root.querySelectorAll("*") : [])) {
        const tag = el.tagName.toLowerCase();
        if (/shopify-(chat|agent|assistant)|agent-/.test(tag) && !seen.has(tag)) { seen.add(tag); res.found.push(`${path}${tag}`); }
        if (el.shadowRoot) walk(el.shadowRoot, `${path}${tag} > #shadow > `);
      }
      for (const b of (root.querySelectorAll ? root.querySelectorAll("button,[role=button]") : [])) {
        const t = (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 50);
        if (t && !res.launcher && /chat|ask|help|assistant|support|message/i.test(t)) res.launcher = `${path}button "${t}"`;
      }
      for (const i of (root.querySelectorAll ? root.querySelectorAll("input,textarea,[contenteditable=true]") : [])) {
        const ph = i.getAttribute("placeholder") || i.getAttribute("aria-label") || "";
        if (ph) res.inputs.push(`${path}${i.tagName.toLowerCase()} "${ph.slice(0, 60)}"`);
      }
      const host = root.host;
      if (host && /shopify-chat/.test(host.tagName?.toLowerCase() || "")) res.text = (root.textContent || "").replace(/\s+/g, " ").slice(0, 400);
    };
    walk(document, "");
    return res;
  });
  console.log(`\n===== ${label} =====`);
  console.log("assistant elements :", r.found.join("  |  ") || "(none)");
  console.log("launcher candidate :", r.launcher || "(none)");
  console.log("inputs             :", r.inputs.join("  |  ") || "(none)");
  if (r.text) console.log("shopify-chat text  :", r.text);
};

await dump("initial load");

// try to open it the way a shopper would
const opened = await page.evaluate(() => {
  const hit = (root) => {
    for (const el of (root.querySelectorAll ? root.querySelectorAll("*") : [])) {
      const tag = el.tagName.toLowerCase();
      if (tag === "shopify-chat") {
        const b = el.shadowRoot && el.shadowRoot.querySelector("button,[role=button]");
        if (b) { b.click(); return "clicked shopify-chat shadow button"; }
        el.click(); return "clicked shopify-chat host";
      }
      if (el.shadowRoot) { const r = hit(el.shadowRoot); if (r) return r; }
    }
    return null;
  };
  return hit(document);
});
console.log(`\nopen attempt: ${opened || "no shopify-chat element found"}`);
await page.waitForTimeout(6000);
await dump("after open attempt");

console.log(`\n--- WebSockets ---\n  ${ws.join("\n  ") || "(none)"}`);
console.log(`--- shopify chat/agent API calls ---\n  ${[...new Set(api)].slice(0, 15).join("\n  ") || "(none)"}`);
await browser.close();
