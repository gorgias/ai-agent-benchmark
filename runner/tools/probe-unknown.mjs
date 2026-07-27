// tools/probe-unknown.mjs — identify the chat/assistant stack on a site that matches NO known
// vendor signature. Dumps the evidence needed to write a new driver: chat-ish scripts, iframes,
// shadow-DOM hosts, suggestive window globals, custom elements, and WebSocket endpoints.
//
// Usage: node tools/probe-unknown.mjs <url> [--headed]
// Read-only.
import pw from "../node_modules/playwright/index.js";
const { chromium } = pw;

const url = process.argv[2];
if (!url) { console.error("usage: node tools/probe-unknown.mjs <url> [--headed]"); process.exit(1); }
const HEADED = process.argv.includes("--headed");
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CHATISH = /chat|assistant|agent|messeng|inbox|concierge|copilot|support|bot|conversation|shop-?ai|sidekick/i;

const browser = await chromium.launch({ headless: !HEADED, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({ userAgent: REAL_UA, locale: "en-US" });
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};
});
const page = await ctx.newPage();

const scripts = new Set(), wsUrls = new Set(), xhr = new Set();
page.on("response", (r) => { const u = r.url(); if (CHATISH.test(u)) xhr.add(`${r.request().method()} ${u.slice(0, 120)}`); });
page.on("websocket", (ws) => wsUrls.add(ws.url().slice(0, 140)));
page.on("request", (r) => { if (r.resourceType() === "script") scripts.add(r.url()); });

await page.goto(url, { waitUntil: "commit", timeout: 60000 });
await page.waitForTimeout(9000);
try { await page.mouse.move(400, 400); await page.waitForTimeout(2500); } catch {}

console.log(`URL: ${page.url()}`);
console.log(`title: ${await page.title()}`);

console.log(`\n--- chat-ish SCRIPT hosts ---`);
const hosts = {};
for (const s of scripts) { try { const h = new URL(s).hostname; if (CHATISH.test(s)) (hosts[h] = hosts[h] || []).push(s.slice(0, 110)); } catch {} }
for (const [h, list] of Object.entries(hosts)) console.log(`  ${h}\n     ${list.slice(0, 3).join("\n     ")}`);
if (!Object.keys(hosts).length) console.log("  (none)");

const dom = await page.evaluate((re) => {
  const R = new RegExp(re, "i");
  const out = { iframes: [], shadowHosts: [], customEls: [], globals: [], buttons: [] };
  for (const f of document.querySelectorAll("iframe")) out.iframes.push({ id: f.id, cls: (f.className || "").slice(0, 60), src: (f.src || "").slice(0, 120) });
  const walk = (n, d) => { for (const el of (n.querySelectorAll ? n.querySelectorAll("*") : [])) { if (el.shadowRoot) { out.shadowHosts.push({ tag: el.tagName.toLowerCase(), id: el.id, depth: d }); walk(el.shadowRoot, d + 1); } } };
  walk(document, 0);
  for (const el of document.querySelectorAll("*")) if (el.tagName.includes("-")) out.customEls.push(el.tagName.toLowerCase());
  for (const k of Object.keys(window)) if (R.test(k)) out.globals.push(k);
  for (const b of document.querySelectorAll('button,[role="button"],a')) {
    const t = (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 40);
    if (t && R.test(t)) out.buttons.push(t);
  }
  out.customEls = [...new Set(out.customEls)];
  out.buttons = [...new Set(out.buttons)].slice(0, 12);
  return out;
}, CHATISH.source);

console.log(`\n--- iframes (${dom.iframes.length}) ---`);
for (const f of dom.iframes) console.log(`  id=${f.id || "-"} class=${f.cls || "-"}\n     src=${f.src || "(none)"}`);
console.log(`\n--- shadow-DOM hosts (${dom.shadowHosts.length}) ---`);
for (const h of dom.shadowHosts.slice(0, 20)) console.log(`  ${"  ".repeat(h.depth)}<${h.tag}> id=${h.id || "-"}`);
console.log(`\n--- custom elements ---\n  ${dom.customEls.join(", ") || "(none)"}`);
console.log(`\n--- chat-ish window globals ---\n  ${dom.globals.join(", ") || "(none)"}`);
console.log(`\n--- chat-ish launcher labels ---\n  ${dom.buttons.join(" | ") || "(none)"}`);
console.log(`\n--- WebSockets opened ---\n  ${[...wsUrls].join("\n  ") || "(none)"}`);
console.log(`\n--- chat-ish network calls ---\n  ${[...xhr].slice(0, 12).join("\n  ") || "(none)"}`);
await browser.close();
