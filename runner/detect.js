// detect.js — verify which vendor's chat/AI widget a storefront actually runs.
//
// Loads each URL in a fresh headless context, records every network request +
// checks page globals/DOM for each vendor's signature. The widget UI may be
// bot-blocked headless, but its SCRIPT/network calls to the vendor domain still
// fire — so network signatures verify the vendor reliably.
//
//   node detect.js https://site1.com https://site2.com
//   node detect.js --file candidates.json     # [{url, expect?}]
//
// Output: per URL, the matched vendor(s) + how (network / global / dom).

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// vendor → { net: RegExp (request url), globals: [js], dom: [selector] }
const SIG = {
  gorgias:  { net: /gorgias\.chat|gorgias-convert|config\.gorgias/i, globals: ["GorgiasChat"], dom: ['iframe[id*="gorgias" i]','#gorgias-chat-container','#chat-button'] },
  spiffy:   { net: /spiffy\.ai|getspiffy|spiffycommerce/i, globals: ["Spiffy"], dom: ['#spiffy-modal-container','[id*="spiffy" i]'] },
  envive:   { net: /envive\.ai|enviveai/i, globals: ["Envive"], dom: ['[id*="envive" i]','[class*="envive" i]'] },
  sierra:   { net: /sierra\.ai/i, globals: ["sierraConfig","Sierra"], dom: ['[class*="sierra" i]','[id*="sierra" i]'] },
  siena:    { net: /siena\.cx|siena\.ai/i, globals: ["Siena"], dom: ['iframe[src*="siena" i]','[id*="siena" i]'] },
  yuma:     { net: /\byuma\.ai\b/i, globals: ["Yuma"], dom: ['[class*="yuma" i]'] },
  dg:       { net: /digitalgenius|dgenius/i, globals: ["DigitalGenius"], dom: ['#dg-chat-widget-iframe','[id*="digitalgenius" i]','[class*="dg-" i]'] },
  zendesk:  { net: /zdassets\.com|zendesk\.com|zopim|zd-svc/i, globals: ["zE","$zopim"], dom: ['#launcher','iframe[title*="Messaging" i]','iframe[id*="zendesk" i]'] },
  ada:      { net: /ada\.support|ada\.cx/i, globals: ["adaEmbed"], dom: ['#ada-button-frame','iframe[title*="Ada" i]','[id*="ada-" i]'] },
  repai:    { net: /myrepai\.com|hellorep|getrep|\brep\.ai\b/i, globals: ["initRep","Rep"], dom: ['#ads-agent-host','[id*="rep-" i]'] },
  kodif:    { net: /kodif\.ai/i, globals: ["Kodif"], dom: ['#kodif-chat-widget','[id*="kodif" i]'] },
  humind:   { net: /thehumind\.com|\bhumind\b/i, globals: ["Humind"], dom: ['humind-gift-finder','[class*="humind" i]'] },
  klaviyo:  { net: /klaviyo-onsite|customer-hub-data|klaviyo\.com/i, globals: ["customerHub"], dom: ['[id*="klaviyo" i]','[class*="klaviyo" i]'] },
  decagon:  { net: /decagon\.ai\/loaders|decagon/i, globals: [], dom: ['#decagon-iframe','#decagon-embed-container','[data-decagon-open]'] },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function detect(browser, url) {
  const ctx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1366, height: 900 }, locale: "en-US" });
  const page = await ctx.newPage();
  const reqs = new Set();
  page.on("request", (r) => { try { reqs.add(r.url()); } catch {} });
  page.on("response", (r) => { try { reqs.add(r.url()); } catch {} });
  let ok = true, err = null;
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); }
  catch (e) { ok = false; err = String(e).slice(0, 80); }
  // give lazy widgets time to inject + call home; nudge scroll to trigger lazy loaders
  await sleep(3000);
  try { await page.mouse.move(700, 400); await page.evaluate(() => window.scrollTo(0, 1200)); } catch {}
  await sleep(9000);

  const reqList = [...reqs];
  const hits = {};
  for (const [v, s] of Object.entries(SIG)) {
    const why = [];
    if (reqList.some(u => s.net.test(u))) why.push("network");
    try { const g = await page.evaluate((gs) => gs.filter(name => { try { return typeof window[name] !== "undefined"; } catch { return false; } }), s.globals); if (g.length) why.push("global:" + g.join("/")); } catch {}
    for (const sel of s.dom) { try { if (await page.locator(sel).count()) { why.push("dom:" + sel.slice(0, 24)); break; } } catch {} }
    if (why.length) hits[v] = why;
  }
  await ctx.close();
  return { url, ok, err, hits };
}

(async () => {
  const args = process.argv.slice(2);
  let items = [];
  const fi = args.indexOf("--file");
  if (fi >= 0) { items = JSON.parse(await readFile(args[fi + 1], "utf8")); }
  else { items = args.filter(a => /^https?:\/\//.test(a)).map(u => ({ url: u })); }
  if (!items.length) { console.log("usage: node detect.js <url...> | --file candidates.json"); process.exit(1); }

  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  // modest concurrency
  const CONC = 4; let next = 0; const out = [];
  async function worker() { while (true) { const it = items[next++]; if (!it) break; const r = await detect(browser, it.url).catch(e => ({ url: it.url, ok: false, err: String(e).slice(0, 80), hits: {} })); r.expect = it.expect || null; out.push(r); const got = Object.keys(r.hits); console.log(`${r.ok ? "·" : "✗"} ${r.url}\n    → ${got.length ? got.map(v => v + " (" + r.hits[v].join(",") + ")").join("  ") : (r.ok ? "no known vendor signature" : "LOAD FAIL: " + r.err)}${it.expect ? "   [expected " + it.expect + (got.includes(it.expect) ? " ✓]" : " ✗]") : ""}`); } }
  await Promise.all(Array.from({ length: Math.min(CONC, items.length) }, worker));
  await browser.close();

  console.log("\n===== SUMMARY =====");
  for (const r of out) { const got = Object.keys(r.hits); console.log(`${(r.expect || "?").padEnd(9)} ${got.join(",") || (r.ok ? "—" : "FAIL")}  ${r.url}`); }
})();
