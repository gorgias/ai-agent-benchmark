// tools/reprobe-dormant.mjs — cheaply re-test stores that are registered but have never
// produced a valid conversation (including ones marked `wall: true`).
//
// WHY: dead-site inventories go stale. On 2026-07-27 `ada-sodastream` — previously 0 valid out
// of 10 with no replies at all — captured 10/10 timed turns at 8.5 s average. A wall verdict is
// a point-in-time observation, not a permanent property, and the store-capacity ceiling (10
// conversations per store per run-date) makes each resurrected store worth ~10 convs/day.
//
// This does ONE open + ONE question per store and classifies the outcome, so it costs ~1 min
// per store instead of the ~5 min a real capture would. It writes nothing to results/ and
// changes no vendor row — it only produces a report for a human to act on.
//
// Usage: node tools/reprobe-dormant.mjs <store-key> [more keys...] [--headed] [--out FILE]
import pw from "../node_modules/playwright/index.js";
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const { STORES, WIDGETS } = require("../vendors.js");
const { chromium } = pw;

const args = process.argv.slice(2);
const HEADED = args.includes("--headed");
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;
const keys = args.filter((a, i) => !a.startsWith("--") && (outIdx < 0 || i !== outIdx + 1));
if (!keys.length) { console.error("usage: node tools/reprobe-dormant.mjs <store-key>... [--headed] [--out f]"); process.exit(1); }

const Q = "Hi! Do you ship to the US and how long does delivery take?";
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};
};
// page chrome that must NOT be mistaken for an answer (the 2026-07-27 page-scrape defect)
const CHROME_RE = /cookie|accept all|skip to content|privacy policy|newsletter|shopping cart|main menu|all rights reserved/i;

const browser = await chromium.launch({ headless: !HEADED, args: ["--disable-blink-features=AutomationControlled"] });
const results = [];
for (const key of keys) {
  const site = STORES.find((s) => s.key === key);
  if (!site) { results.push({ key, verdict: "UNKNOWN-KEY" }); continue; }
  const w = WIDGETS[site.widget];
  const ctx = await browser.newContext({ userAgent: REAL_UA, locale: site.locale || "en-US" });
  await ctx.addInitScript(STEALTH);
  const page = await ctx.newPage();
  let verdict = "SILENT", detail = "";
  try {
    await page.goto(site.url, { waitUntil: "commit", timeout: 45000 });
    await page.waitForTimeout(3500);
    const before = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
    try { await Promise.race([w.open(page), new Promise((_, r) => setTimeout(() => r(new Error("open-timeout")), 60000))]); }
    catch (e) { verdict = "NO-WIDGET"; detail = String(e).slice(0, 60); }
    if (verdict !== "NO-WIDGET") {
      await page.waitForTimeout(2500);
      try { await w.send(page, Q); } catch (e) { verdict = "SEND-FAILED"; detail = String(e).slice(0, 70); }
      if (verdict === "SILENT") {
        // poll for new substantive text
        let grew = 0, best = "";
        for (let i = 0; i < 14; i++) {
          await page.waitForTimeout(2200);
          const t = await page.evaluate(() => document.body.innerText).catch(() => "");
          grew = t.length - before;
          const tail = t.slice(-1200);
          if (grew > 120 && !CHROME_RE.test(tail.slice(-400))) { best = tail; break; }
        }
        if (best) { verdict = "ANSWERED"; detail = best.replace(/\s+/g, " ").slice(-140); }
        else if (grew > 120) { verdict = "PAGE-TEXT-ONLY"; detail = `grew ${grew} chars but reads as page chrome`; }
        else detail = `transcript grew ${grew} chars`;
      }
    }
  } catch (e) { verdict = "LOAD-FAIL"; detail = String(e).slice(0, 70); }
  await ctx.close();
  const line = `${verdict.padEnd(15)} ${key.padEnd(26)} ${site.vendor.padEnd(14)} ${detail.slice(0, 90)}`;
  console.log(line);
  results.push({ key, vendor: site.vendor, url: site.url, wall: !!site.wall, verdict, detail });
}
await browser.close();
const answered = results.filter((r) => r.verdict === "ANSWERED");
console.log(`\n=== ${answered.length} of ${results.length} dormant stores ANSWERED — candidates for un-walling ===`);
for (const r of answered) console.log(`   ${r.vendor.padEnd(14)} ${r.key.padEnd(26)} ${r.url}`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
