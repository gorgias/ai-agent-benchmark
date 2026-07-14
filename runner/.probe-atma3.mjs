import { chromium } from "playwright";
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); };
const SHOT = n => `/private/tmp/claude-501/-Users-maxpruvost/debf5451-9fa4-43c6-ae58-2237d4b02f87/scratchpad/atma3-${n}.png`;
const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "fr-FR", timezoneId: "Europe/Paris", userAgent: REAL_UA });
await ctx.addInitScript(STEALTH);
const page = await ctx.newPage();
await page.goto("https://atmakitchenware.fr/", { waitUntil: "load", timeout: 60000 });
await page.mouse.wheel(0, 300); await page.waitForTimeout(5000);

// what does $yuma expose?
const api = await page.evaluate(() => { const y = window.$yuma; return y ? { type: typeof y, keys: Object.keys(y), proto: Object.getOwnPropertyNames(Object.getPrototypeOf(y) || {}) } : null; });
console.log("$yuma API:", JSON.stringify(api));

// try open()
const opened = await page.evaluate(() => { try { window.$yuma.push(["open"]); return 'push([open])'; } catch (e) { return "err " + e.message; } });
console.log("open attempt:", opened);
await page.waitForTimeout(2500);
const bb = await page.evaluate(() => { const i = document.getElementById("yuma-widget"); const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
console.log("iframe bbox after $yuma.open():", JSON.stringify(bb));
if (bb.w < 100) { console.log("did not expand — abort"); await browser.close(); process.exit(1); }
await page.screenshot({ path: SHOT("1-opened") });

const f = page.frames().find(fr => (fr.url() || "").includes("app.yuma.ai"));
// type the question with REAL keystrokes, then click the submit button
const inp = f.locator(".chatPage__textarea").first();
await inp.click({ timeout: 6000 });
await page.keyboard.type("Bonjour ! Je cherche une poêle de bonne qualité pour un usage quotidien — que me conseillez-vous ?", { delay: 15 });
await page.waitForTimeout(400);
const sub = f.locator(".chatPage__submitBtn").first();
console.log("submitBtn disabled after typing?", await sub.isDisabled().catch(() => "?"));
if (!(await sub.isDisabled().catch(() => true))) await sub.click(); else await page.keyboard.press("Enter");
console.log("question sent @", new Date().toISOString());
await page.waitForTimeout(4000);
await page.screenshot({ path: SHOT("2-question") });
const afterQ = await f.evaluate(() => ({ text: document.body.innerText.replace(/\s+/g, " ").slice(-500), inputs: [...document.querySelectorAll("input")].map(i => ({ t: i.type, ph: i.placeholder, aria: i.getAttribute("aria-label"), vis: !!i.getClientRects().length })) }));
console.log("AFTER QUESTION:", JSON.stringify(afterQ, null, 1));

// email form (Max: appears after the question) — fill + submit
const em = f.locator('input[type="email"], input[placeholder*="@"], input[placeholder*="mail" i], input[aria-label*="mail" i], input[name*="mail" i]').first();
if (await em.count().catch(() => 0)) {
  await em.click({ timeout: 4000 }).catch(() => {});
  await page.keyboard.type("camille.fournier84@gmail.com", { delay: 15 });
  await page.waitForTimeout(400);
  const sb = f.locator('button[type="submit"], button:has-text("Valider"), button:has-text("Envoyer"), button:has-text("Continuer"), button:has-text("Commencer"), button:has-text("Démarrer"), [aria-label="Send message"]').first();
  if (await sb.count().catch(() => 0)) { console.log("email submit — clicking"); await sb.click({ timeout: 4000 }).catch(() => {}); } else { console.log("email submit — Enter"); await page.keyboard.press("Enter"); }
  await page.screenshot({ path: SHOT("3-email") });
} else console.log("no email input visible yet");

// wait for a real AI answer (body text growth beyond echo)
console.log("waiting up to 90s for AI reply…");
const t0 = Date.now(); let last = "";
while (Date.now() - t0 < 90000) {
  await page.waitForTimeout(3500);
  const txt = await f.evaluate(() => document.body.innerText.replace(/\s+/g, " ")).catch(() => "");
  if (txt !== last) { console.log(`t+${Math.round((Date.now() - t0) / 1000)}s Δtext tail: …${txt.slice(-220)}`); last = txt; }
}
await page.screenshot({ path: SHOT("4-final") });
await browser.close();
console.log("done");
