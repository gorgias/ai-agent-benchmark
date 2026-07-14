import { chromium } from "playwright";
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); };
const SHOT = n => `/private/tmp/claude-501/-Users-maxpruvost/debf5451-9fa4-43c6-ae58-2237d4b02f87/scratchpad/atma4-${n}.png`;
const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "fr-FR", timezoneId: "Europe/Paris", userAgent: REAL_UA });
await ctx.addInitScript(STEALTH);
const page = await ctx.newPage();
await page.goto("https://atmakitchenware.fr/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2000);
await page.waitForFunction(() => typeof window.GorgiasChat !== "undefined", null, { timeout: 30000 }).catch(() => console.log("GorgiasChat never appeared"));
await page.evaluate(async () => { const isOpen = () => { try { return !!window.GorgiasChat.isOpen(); } catch { return false; } }; for (let i = 0; i < 10 && !isOpen(); i++) { try { window.GorgiasChat.open(); } catch {} await new Promise(r => setTimeout(r, 800)); } });
await page.waitForTimeout(3000);
const f = page.frames().find(fr => (fr.name() || "").includes("chat-window") || (fr.url() || "").includes("chat-window"));
if (!f) { console.log("no chat-window frame; frames:", page.frames().map(x => x.name() + "|" + x.url().slice(0, 60))); await browser.close(); process.exit(1); }
console.log("chat-window frame OK");
await page.screenshot({ path: SHOT("1-open") });
const dump = async (label) => {
  const st = await f.evaluate(() => ({
    inputs: [...document.querySelectorAll("input,textarea,[contenteditable='true']")].map(i => ({ tag: i.tagName.toLowerCase(), t: i.type || null, ph: i.placeholder || null, aria: i.getAttribute("aria-label"), vis: !!i.getClientRects().length })),
    buttons: [...document.querySelectorAll("button,[role='button']")].map(b => ({ txt: (b.innerText || "").trim().slice(0, 40), aria: b.getAttribute("aria-label"), dis: b.disabled || null })).filter(b => b.txt || b.aria),
    text: document.body.innerText.replace(/\s+/g, " ").slice(-600),
  })).catch(e => ({ err: String(e) }));
  console.log(`===== ${label} =====\n` + JSON.stringify(st, null, 1));
};
await dump("A: gorgias chat open");
// type the question
const inp = f.locator("textarea, [contenteditable='true'], input[type='text']").first();
await inp.click({ timeout: 6000 }).catch(e => console.log("composer click fail", String(e).slice(0, 80)));
await page.keyboard.type("Bonjour ! Je cherche une poêle de bonne qualité pour un usage quotidien — que me conseillez-vous ?", { delay: 15 });
await page.keyboard.press("Enter");
console.log("question sent @", new Date().toISOString());
await page.waitForTimeout(5000);
await page.screenshot({ path: SHOT("2-question") });
await dump("B: after question (email form?)");
// fill email if a gate appeared
const em = f.locator('input[type="email"], input[placeholder*="@"], input[placeholder*="mail" i], input[aria-label*="mail" i]').first();
if ((await em.count().catch(() => 0)) && (await em.isVisible().catch(() => false))) {
  console.log("EMAIL FORM FOUND — filling");
  await em.click(); await page.keyboard.type("camille.fournier84@gmail.com", { delay: 14 });
  const sb = f.locator('button[type="submit"], button:has-text("Valider"), button:has-text("Envoyer"), button:has-text("Continuer"), button:has-text("Commencer")').first();
  if (await sb.count().catch(() => 0)) await sb.click({ timeout: 3000 }).catch(() => {}); else await page.keyboard.press("Enter");
  await page.waitForTimeout(1500); await page.screenshot({ path: SHOT("3-email") });
  await dump("C: after email submit");
}
console.log("waiting 300s for AI reply…");
const t0 = Date.now(); let last = "";
while (Date.now() - t0 < 300000) {
  await page.waitForTimeout(4000);
  const txt = await f.evaluate(() => document.body.innerText.replace(/\s+/g, " ")).catch(() => "");
  if (txt !== last) { console.log(`t+${Math.round((Date.now() - t0) / 1000)}s tail: …${txt.slice(-260)}`); last = txt; }
}
await page.screenshot({ path: SHOT("4-final") });
await browser.close(); console.log("done");
