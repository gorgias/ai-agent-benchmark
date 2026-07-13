// PROVIDER AUDIT — verify each store still runs the chat provider we attribute it to.
//
// WHY: vendors.js maps site → provider statically, but merchants switch providers constantly
// (nanit moved to Mavenoid; Grove is a human desk; Spanx dropped its widget). If we don't
// detect the drift we attribute conversations to the WRONG vendor — a data-integrity bug that
// silently poisons a competitor's (or our own) score. This sweeps stores, detects the ACTUAL
// provider by DOM/script/global signature, and flags every mismatch.
//
//   node provider-audit.mjs                 # audit ALL stores
//   node provider-audit.mjs --vendor Envive # audit one vendor's stores
//   node provider-audit.mjs --store envive-nanit envive-fracture
// Writes provider-audit.json (per store: expected, detected[], verdict) + prints a summary.
import pw from "./node_modules/playwright/index.js";
import { createRequire } from "module";
import { writeFileSync } from "fs";
const require = createRequire(import.meta.url);
const { STORES } = require("./vendors.js");
const { chromium } = pw;

// Signature registry — strongest signal first (script host), then distinctive element/shadow
// host id, then window global. A provider matches if ANY of its signatures is present.
const SIGNATURES = {
  "Gorgias":       { scripts: [/gorgias\.chat|config\.gorgias|gorgias\.io/i], ids: [/^gorgias-chat/i], hosts: [/gorgias/i], globals: ["GorgiasChat"] },
  "Envive":        { scripts: [/cdn\.spiffy\.ai|envive-injection|envive\.ai/i], ids: [/^(envive|spiffy)-ai|spiffy-modal-container/i], hosts: [/^(envive|spiffy)-ai-floating/i], globals: ["Envive", "spiffy"] },
  "Siena":         { scripts: [/siena\.cx|siena\.chat|assets\.siena/i], ids: [/siena/i], hosts: [/siena/i], globals: ["Siena", "SienaChat"] },
  "Ada":           { scripts: [/ada\.support|static\.ada|adacdn/i], ids: [/^ada-(entry|button|embed|frame)/i], hosts: [/^ada-/i], globals: ["adaEmbed", "adaSettings"] },
  "Sierra":        { scripts: [/sierra\.chat/i], hosts: [/sierra/i], globals: ["openSierraChat", "sierra"] },
  "Kodif":         { scripts: [/kodif/i], ids: [/kodif/i], hosts: [/kodif/i] },
  "Intercom":      { scripts: [/widget\.intercom\.io|intercomcdn\.com/i], ids: [/^intercom-(container|frame)/i], globals: ["Intercom"] },
  "Zendesk":       { scripts: [/static\.zdassets\.com|zendesk\.com|zopim/i], ids: [/launcher|webWidget/i], globals: ["zE", "zESettings", "$zopim"] },
  "DigitalGenius": { scripts: [/digitalgenius|chat\.digitalgenius/i], hosts: [/digitalgenius/i] },
  "Mavenoid":      { scripts: [/mavenoid\.com|mavenoid\.io/i], ids: [/mavenoid/i], hosts: [/mavenoid/i], globals: ["Mavenoid"] },
  "Klaviyo":       { scripts: [/klaviyo\.com|static\.klaviyo/i], globals: ["klaviyo", "_klOnsite"] },
  "Decagon":       { scripts: [/decagon\.ai|decagon/i], ids: [/decagon/i], hosts: [/decagon/i], globals: ["Decagon"] },
  "Rep AI":        { scripts: [/hirep\.ai|getrep\.ai|rep-?ai|initrep/i], ids: [/rep-?ai/i], globals: ["initRep", "RepChat"] },
  "Yuma":          { scripts: [/yuma\.ai|getyuma/i], hosts: [/yuma/i], globals: ["Yuma"] },
  "Humind":        { scripts: [/humind/i], hosts: [/humind/i] },
  "Shopify Inbox": { scripts: [/shopify.*chat|shop_chat|shopifychat/i], ids: [/shopify-chat/i] },
  "Gladly":        { scripts: [/gladly\.com/i], globals: ["Gladly"] },
  "Tidio":         { scripts: [/tidio\.co/i], globals: ["tidioChatApi"] },
  "Zowie":         { scripts: [/zowie\.ai/i], globals: ["Zowie"] },
};

async function collectSignals(page) {
  return page.evaluate(() => {
    const out = { scripts: [], ids: [], hosts: [], globals: [] };
    for (const s of document.querySelectorAll("script[src]")) out.scripts.push(s.src);
    for (const el of document.querySelectorAll("[id]")) if (el.id) out.ids.push(el.id);
    const walk = (n) => { for (const el of (n.querySelectorAll ? n.querySelectorAll("*") : [])) if (el.shadowRoot) { out.hosts.push(el.id || el.tagName.toLowerCase()); walk(el.shadowRoot); } };
    walk(document);
    for (const g of ["GorgiasChat", "Envive", "spiffy", "Siena", "SienaChat", "adaEmbed", "adaSettings", "openSierraChat", "sierra", "Intercom", "zE", "zESettings", "$zopim", "Mavenoid", "klaviyo", "_klOnsite", "Decagon", "initRep", "RepChat", "Yuma", "Gladly", "tidioChatApi", "Zowie"]) { try { if (window[g] !== undefined) out.globals.push(g); } catch {} }
    return out;
  });
}

function detect(sig) {
  const hits = [];
  for (const [prov, s] of Object.entries(SIGNATURES)) {
    const scriptHit = (s.scripts || []).some((re) => sig.scripts.some((u) => re.test(u)));
    const idHit = (s.ids || []).some((re) => sig.ids.some((i) => re.test(i)));
    const hostHit = (s.hosts || []).some((re) => sig.hosts.some((h) => re.test(h)));
    const globalHit = (s.globals || []).some((g) => sig.globals.includes(g));
    const strength = (scriptHit ? 2 : 0) + (idHit || hostHit ? 1 : 0) + (globalHit ? 1 : 0);
    if (strength > 0) hits.push({ prov, strength, via: [scriptHit && "script", (idHit || hostHit) && "dom", globalHit && "global"].filter(Boolean).join("+") });
  }
  return hits.sort((a, b) => b.strength - a.strength);
}

const args = process.argv.slice(2);
const vFilter = args.includes("--vendor") ? args[args.indexOf("--vendor") + 1] : null;
const sFilter = args.includes("--store") ? args.slice(args.indexOf("--store") + 1).filter((x) => !x.startsWith("--")) : null;
let targets = STORES;
if (vFilter) targets = targets.filter((s) => s.vendor.toLowerCase() === vFilter.toLowerCase());
if (sFilter) targets = targets.filter((s) => sFilter.includes(s.key));

const browser = await chromium.launch({ headless: true });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const report = [];
const CONC = 3;
for (let i = 0; i < targets.length; i += CONC) {
  await Promise.all(targets.slice(i, i + CONC).map(async (store) => {
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    let entry = { key: store.key, site: store.url, expected: store.vendor, detected: [], verdict: "" };
    try {
      await page.goto(store.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(9000);
      const hits = detect(await collectSignals(page));
      entry.detected = hits.map((h) => `${h.prov}(${h.via})`);
      const top = hits.map((h) => h.prov);
      if (!top.length) entry.verdict = "NONE_DETECTED";
      else if (top.includes(store.vendor)) entry.verdict = "OK";
      else entry.verdict = "MISMATCH→" + top[0];
    } catch (e) { entry.verdict = "ERROR"; entry.detected = [String(e).slice(0, 50)]; }
    report.push(entry);
    await ctx.close();
  }));
  process.stderr.write(`  audited ${Math.min(i + CONC, targets.length)}/${targets.length}\n`);
}
await browser.close();
report.sort((a, b) => a.expected.localeCompare(b.expected) || a.key.localeCompare(b.key));
writeFileSync("provider-audit.json", JSON.stringify(report, null, 2) + "\n");
const mism = report.filter((r) => r.verdict.startsWith("MISMATCH"));
const none = report.filter((r) => r.verdict === "NONE_DETECTED");
console.log(`\n=== PROVIDER AUDIT: ${report.length} stores ===`);
console.log(`OK: ${report.filter((r) => r.verdict === "OK").length} · MISMATCH: ${mism.length} · NONE_DETECTED: ${none.length} · ERROR: ${report.filter((r) => r.verdict === "ERROR").length}`);
if (mism.length) { console.log("\n⚠ MISMATCHES (site changed provider — data mis-attributed):"); for (const r of mism) console.log(`  ${r.key.padEnd(22)} expected ${r.expected} → detected ${r.detected.join(", ")}`); }
if (none.length) { console.log("\n· NONE DETECTED (widget removed / lazy-loads / bot-walled):"); for (const r of none) console.log(`  ${r.key.padEnd(22)} (${r.expected})`); }
