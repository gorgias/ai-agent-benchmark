#!/usr/bin/env node
// server/source-merchants.mjs — independent daily sourcing service.
//
// GOAL: add up to N verified new storefronts per vendor per day (default 2), so every vendor's
// score keeps widening across real merchants instead of deepening on the same few.
//
// THE TRAP THIS IS BUILT AROUND: a vendor's marketing page, a case study, or even a script
// signature in the HTML does NOT mean there is a drivable chat widget. A previous sourcing pass
// turned 38 marketing-claimed customers into 7 signature hits and 0 drivable widgets — the
// vendor was installed for email/tickets, or behind an incumbent widget, or the brand churned.
// So nothing here is accepted on a claim: a candidate is only written to vendors.js after a
// real browser loads the storefront and BOTH the vendor's widget host loads AND a launcher or
// composer actually mounts on a cold anonymous visit.
//
// Candidate feed is pluggable, deliberately: sourcing needs a tech-detection dataset, not an
// LLM. Order of preference:
//   1. STORELEADS_API_KEY  → query merchants by detected chat technology (the right source)
//   2. server/candidates.json  → { "Vendor": ["https://store.com", ...] } manual/exported seed
// Either way the VERIFIER is the same, so a bad feed cannot pollute the board.
//
//   node server/source-merchants.mjs --dry            # verify + report, write nothing
//   PER_VENDOR=2 node server/source-merchants.mjs     # verify, append to vendors.js, commit
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const RUNNER = path.join(ROOT, "runner");
const require = createRequire(path.join(RUNNER, "package.json"));
// vendors.js is an ES module. require()-ing ESM only works on Node >= 22.12, and the container
// runs 22.11 — so this threw ERR_REQUIRE_ESM on the server while working fine on a newer local
// Node. Use a dynamic import so the version of Node stops mattering.
const { STORES } = await import(pathToFileURL(path.join(RUNNER, "vendors.js")).href);

const DRY = process.argv.includes("--dry");
const PER_VENDOR = Number(process.env.PER_VENDOR || 2);
const WIDGET_OF = { Gorgias: "gorgias", Envive: "envive", Siena: "siena", Ada: "ada", Sierra: "sierra",
  Kodif: "kodif", Intercom: "intercom", Zendesk: "zendesk", DigitalGenius: "dg", Klaviyo: "klaviyo",
  Decagon: "decagon", "Rep AI": "repai", Yuma: "yuma" };

// Host/mount fingerprints used for VERIFICATION (not discovery). Kept here rather than imported
// so a signature tuned for detection-on-a-captured-page can't silently loosen sourcing.
const VERIFY = {
  Gorgias:       { host: /gorgias\.chat|config\.gorgias/i,          mount: '[id^="gorgias-chat"],#gorgias-chat-container' },
  Envive:        { host: /cdn\.spiffy\.ai|envive/i,                  mount: '#envive-ai-container,#envive-ai-floating-chat,#spiffy-ai-floating-button' },
  Siena:         { host: /siena\.cx|chat\.siena/i,                   mount: '[class*="siena"],[id*="siena"]' },
  Ada:           { host: /ada\.support|static\.ada/i,                mount: '[id^="ada-"]' },
  Sierra:        { host: /sierra\.chat/i,                            mount: '[data-sierra-chat-launcher],#sierra-chat-launcher' },
  Kodif:         { host: /kodif\.(io|ai)/i,                          mount: '#kodif-chat-widget,#kodif-chat-trigger' },
  Intercom:      { host: /widget\.intercom\.io|intercomcdn/i,        mount: '#intercom-frame,.intercom-lightweight-app' },
  Zendesk:       { host: /zdassets\.com/i,                           mount: 'iframe[title*="messaging"],#launcher' },
  DigitalGenius: { host: /chat\.digitalgenius\.com/i,                mount: '#dg-chat-widget-launcher,#dg-chat' },
  Klaviyo:       { host: /customerHubRoot|kServiceStyles/i,          mount: '[id^="k-hub"],[class*="customer-hub"]' },
  Decagon:       { host: /decagon\.ai/i,                             mount: '[id*="decagon"]' },
  Yuma:          { host: /yuma\.ai/i,                                mount: '#yuma-widget,iframe#yuma-widget' },
};

const known = new Set(STORES.map((s) => (s.url || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")).filter(Boolean));
const norm = (u) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

// ── candidate feed ─────────────────────────────────────────────────────────────
async function candidates() {
  const out = {};
  if (process.env.STORELEADS_API_KEY) {
    // StoreLeads indexes detected storefront technology, which is exactly the signal we want:
    // merchants where the vendor's chat app is INSTALLED, rather than merchants a vendor
    // mentions in marketing. Still only a candidate list — every hit goes through the verifier.
    for (const vendor of Object.keys(VERIFY)) {
      const app = ({ Gorgias: "gorgias-chat", Intercom: "intercom", Zendesk: "zendesk", Klaviyo: "klaviyo",
        Siena: "siena", Kodif: "kodif", Yuma: "yuma", Ada: "ada" })[vendor] || vendor.toLowerCase();
      try {
        const r = await fetch(`https://storeleads.app/json/api/v1/all/domain?app=${encodeURIComponent(app)}&limit=40`,
          { headers: { Authorization: `Bearer ${process.env.STORELEADS_API_KEY}` } });
        const j = await r.json();
        out[vendor] = (j?.domains || []).map((d) => `https://${d.name || d.domain}`).filter(Boolean);
      } catch (e) { console.error(`storeleads ${vendor}: ${e}`); }
    }
    return out;
  }
  const seed = path.join(ROOT, "server", "candidates.json");
  if (existsSync(seed)) return JSON.parse(readFileSync(seed, "utf8"));
  console.error("No candidate feed: set STORELEADS_API_KEY or create server/candidates.json");
  return out;
}

// ── verifier: a real browser, a cold context, host + mount both required ───────
async function verify(browser, vendor, url) {
  const sig = VERIFY[vendor];
  if (!sig) return { ok: false, why: "no verification fingerprint for this vendor" };
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  let hostSeen = false;
  page.on("request", (r) => { if (sig.host.test(r.url())) hostSeen = true; });
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch { }
  await page.waitForTimeout(12000);                       // widgets load late and lazily
  const mount = await page.evaluate((sel) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const els = [...document.querySelectorAll(sel)];
    return { found: els.length, visible: els.filter(vis).length };
  }, sig.mount).catch(() => ({ found: 0, visible: 0 }));
  // Also record OTHER chat vendors on the page: a second widget means attribution is ambiguous
  // and the store would score one vendor's behaviour as another's. Reject rather than guess.
  const others = await page.evaluate(() => {
    const hits = [];
    const probes = { Gorgias: "gorgias", Intercom: "intercom", Zendesk: "zdassets", Gladly: "gladly", Ada: "ada-", Tidio: "tidio" };
    const html = document.documentElement.innerHTML;
    for (const [n, t] of Object.entries(probes)) if (html.includes(t)) hits.push(n);
    return hits;
  }).catch(() => []);
  await ctx.close();
  const competing = others.filter((o) => o !== vendor);
  if (!hostSeen) return { ok: false, why: "vendor host never loaded (installed for email/tickets, or churned)" };
  if (!mount.found) return { ok: false, why: "host loaded but no widget element mounted" };
  // VISIBLE, not merely present. Some vendors ship a non-chat bundle (Envive's search build) that
  // mounts hidden 0x0 containers with no chat API — supergoop.com passes a found>0 test yet has no
  // openChat at all, and its conversations were being scored as Envive chat. Requiring a visible
  // launcher is what separates a drivable widget from an installed-but-inert one.
  if (!mount.visible) return { ok: false, why: "widget present but nothing visible — inert/search-only bundle or consent-gated launcher" };
  return { ok: true, visible: mount.visible, competing,
    note: competing.length ? `also on page: ${competing.join(", ")} — driver must target the ${vendor} launcher` : "" };
}

// ── run ───────────────────────────────────────────────────────────────────────
const feed = await candidates();
const pw = require("playwright");
const browser = await pw.chromium.launch({ headless: true });
const accepted = [], rejected = [];

for (const [vendor, urls] of Object.entries(feed)) {
  let taken = 0;
  for (const url of urls) {
    if (taken >= PER_VENDOR) break;
    if (known.has(norm(url))) continue;                   // already in the benchmark
    const v = await verify(browser, vendor, url);
    if (v.ok) { accepted.push({ vendor, url, ...v }); taken++; }
    else rejected.push({ vendor, url, why: v.why });
  }
}
await browser.close();

// ── write verified stores into vendors.js ─────────────────────────────────────
const slug = (u) => norm(u).split(".")[0].replace(/[^a-z0-9]/gi, "").slice(0, 14).toLowerCase();
if (accepted.length && !DRY) {
  const vp = path.join(RUNNER, "vendors.js");
  let src = readFileSync(vp, "utf8");
  const stamp = new Date().toISOString().slice(0, 10);
  const rows = accepted.map((a) => {
    const key = `${WIDGET_OF[a.vendor] || a.vendor.toLowerCase()}-${slug(a.url)}`;
    const todo = a.competing.length ? `, todo: "${a.note}"` : "";
    return `  { key: "${key}", vendor: "${a.vendor}", store: "${slug(a.url)}", url: "${a.url}", widget: "${WIDGET_OF[a.vendor]}", candidate: true${todo} }, // auto-sourced ${stamp}: host loaded + widget mounted on a cold visit`;
  });
  const block = `\n  // ── Auto-sourced ${stamp} by server/source-merchants.mjs. Each row was verified in a\n`
    + `  // real browser: the vendor's widget host loaded AND a launcher/container mounted on a cold\n`
    + `  // anonymous visit. candidate:true until a capture proves it drivable end-to-end.\n`
    + rows.join("\n") + "\n";
  // Insert before STORES's OWN closing "];", not end-of-file: vendors.js has ~90 lines of helper
  // functions (findFrame, readTranscript, …) AFTER the array, so a `$`-anchored end-of-file regex
  // never matches and .replace() silently no-ops — the write looks like it worked (require() still
  // parses the UNCHANGED file fine) but nothing is actually added, and the following `git commit`
  // then fails on "nothing to commit" every single time. (Found 2026-08-18: two verification runs
  // each reported N verified stores and then failed to commit, twice in a row, with vendors.js
  // never actually gaining a byte.) Anchor on the STORES declaration itself and take the first
  // standalone "];" after it — the only one in that span (checked: exactly one bare "];" line
  // between "export const STORES = [" and the next export).
  const storesAt = src.indexOf("export const STORES = [");
  if (storesAt === -1) throw new Error("could not find `export const STORES = [` in vendors.js — insertion point missing");
  const closeAt = src.indexOf("\n];", storesAt);
  if (closeAt === -1) throw new Error("could not find STORES's closing `];` in vendors.js");
  src = src.slice(0, closeAt) + block + "];" + src.slice(closeAt + 3);
  writeFileSync(vp, src);
  try { execFileSync("node", ["-e", `require("${vp}")`], { stdio: "pipe" }); }
  catch (e) { console.error("vendors.js broke — reverting"); execFileSync("git", ["checkout", "--", vp], { cwd: ROOT }); process.exit(1); }
}

// ── report (Slack if configured) ──────────────────────────────────────────────
const byVendor = {};
for (const a of accepted) byVendor[a.vendor] = (byVendor[a.vendor] || 0) + 1;
const missed = Object.keys(VERIFY).filter((v) => !byVendor[v]);
const lines = [
  `${accepted.length ? ":shopping_trolley:" : ":large_yellow_circle:"} *Merchant sourcing — ${new Date().toISOString().slice(0, 10)}*`,
  `*${accepted.length} verified* / ${accepted.length + rejected.length} candidates checked` + (DRY ? " _(dry run)_" : ""),
  ...Object.entries(byVendor).map(([v, n]) => `• ${v}: +${n}`),
  missed.length ? `_no new verified store for: ${missed.join(", ")}_` : "",
  rejected.length ? `_rejected ${rejected.length}: ${[...new Set(rejected.map((r) => r.why))].slice(0, 3).join(" · ")}_` : "",
].filter(Boolean);
const text = lines.join("\n");

if (DRY || !process.env.SLACK_WEBHOOK_URL) console.log(text);
else await fetch(process.env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, mrkdwn: true }) }).catch((e) => console.error(e));

if (accepted.length && !DRY) {
  try {
    execFileSync("git", ["add", "runner/vendors.js"], { cwd: ROOT });
    execFileSync("git", ["commit", "-q", "-m", `Sourcing: +${accepted.length} verified storefronts (host loaded + widget mounted)`], { cwd: ROOT });
    execFileSync("git", ["pull", "--rebase", "--autostash", "-X", "theirs", "origin", "master"], { cwd: ROOT, stdio: "pipe" });
    execFileSync("git", ["push", "origin", "HEAD:master"], { cwd: ROOT, stdio: "pipe" });
    console.log("pushed");
  } catch (e) { console.error("git step failed:", String(e).slice(0, 200)); }
}
