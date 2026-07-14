// Standalone probe: replay Max's flow on atmakitchenware.fr and dump the widget DOM
// at each step — widget → question → (email form appears) → fill → submit → reply?
import { chromium } from "playwright";

const SHOT = (n) => `/private/tmp/claude-501/-Users-maxpruvost/debf5451-9fa4-43c6-ae58-2237d4b02f87/scratchpad/atma-${n}.png`;
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STEALTH = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["fr-FR", "fr", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  const _noop = () => {};
  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {};
  if (typeof window.chrome.runtime.sendMessage !== "function") window.chrome.runtime.sendMessage = () => Promise.resolve();
  if (typeof window.chrome.runtime.connect !== "function") window.chrome.runtime.connect = () => ({ postMessage: _noop, onMessage: { addListener: _noop }, disconnect: _noop });
};

const yumaFrame = (page) => page.frames().find(f => (f.url() || "").includes("app.yuma.ai")) || null;

// Dump everything interactable + recent text inside the frame
async function dump(f, label) {
  const state = await f.evaluate(() => {
    const vis = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
    const inputs = [...document.querySelectorAll("input, textarea, [contenteditable='true']")].map(el => ({
      tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || null, id: el.id || null,
      placeholder: el.placeholder || null, aria: el.getAttribute("aria-label"), cls: (el.className || "").toString().slice(0, 80), visible: vis(el),
    }));
    const buttons = [...document.querySelectorAll("button, [role='button'], input[type='submit']")].map(el => ({
      text: (el.innerText || el.value || "").trim().slice(0, 60), aria: el.getAttribute("aria-label"),
      cls: (el.className || "").toString().slice(0, 80), disabled: el.disabled || null, visible: vis(el),
    })).filter(b => b.visible || b.text);
    const text = document.body.innerText.replace(/\s+/g, " ").slice(0, 900);
    return { inputs, buttons, text };
  }).catch(e => ({ err: String(e) }));
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(state, null, 1));
}

const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "fr-FR", timezoneId: "Europe/Paris", userAgent: REAL_UA, extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6" } });
await ctx.addInitScript(STEALTH);
const page = await ctx.newPage();

console.log("goto…");
await page.goto("https://atmakitchenware.fr/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);
// consent best-effort
for (const t of ["Accepter", "Tout accepter", "Accept", "OK"]) {
  const b = page.locator(`button:has-text("${t}")`).first();
  if (await b.count().catch(() => 0)) { await b.click({ timeout: 1500 }).catch(() => {}); break; }
}
// lazy-load gate
await page.mouse.move(280, 320).catch(() => {});
await page.mouse.wheel(0, 260).catch(() => {});
await page.keyboard.press("Tab").catch(() => {});
for (let i = 0; i < 22 && !yumaFrame(page); i++) await page.waitForTimeout(900);
const f = yumaFrame(page);
if (!f) { console.log("NO app.yuma.ai IFRAME"); await browser.close(); process.exit(1); }
console.log("iframe:", f.url());

// --- diagnose the closed-widget hypothesis: iframe bbox + every labeled control
const bbox = await page.evaluate(() => {
  const ifr = [...document.querySelectorAll("iframe")].find(i => (i.src || "").includes("app.yuma.ai"));
  if (!ifr) return null; const r = ifr.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
});
console.log("iframe bbox BEFORE open:", JSON.stringify(bbox));
const labels = await f.evaluate(() => [...document.querySelectorAll("[aria-label], button, [role='button']")].map(el => ({
  aria: el.getAttribute("aria-label"), cls: (el.className || "").toString().slice(0, 50), txt: (el.innerText || "").trim().slice(0, 40),
})));
console.log("ALL controls in iframe:", JSON.stringify(labels));
// The 1×1 iframe means the launcher lives in the PARENT page. Find it there.
const parentCands = await page.evaluate(() => {
  const out = { iframes: [], fixed: [] };
  for (const i of document.querySelectorAll("iframe")) { const r = i.getBoundingClientRect(); out.iframes.push({ src: (i.src || "").slice(0, 90), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), id: i.id || null, cls: (i.className || "").toString().slice(0, 60) }); }
  // fixed/absolute elements parked bottom-right = chat bubble candidates
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if ((s.position === "fixed" || s.position === "absolute") && el.getClientRects().length) {
      const r = el.getBoundingClientRect();
      if (r.width >= 30 && r.width <= 160 && r.height >= 30 && r.height <= 160 && r.right > innerWidth - 220 && r.bottom > innerHeight - 220) {
        out.fixed.push({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: (el.className || "").toString().slice(0, 70), aria: el.getAttribute("aria-label"), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) });
      }
    }
  }
  return out;
});
console.log("PARENT iframes:", JSON.stringify(parentCands.iframes, null, 1));
console.log("PARENT bottom-right fixed candidates:", JSON.stringify(parentCands.fixed, null, 1));
// click the most bubble-ish parent candidate (or the widget.yuma trigger iframe if present)
let clicked = false;
const trigIfr = parentCands.iframes.find(i => i.w > 30 && i.w < 200 && i.src.includes("yuma"));
if (trigIfr) { console.log("clicking trigger IFRAME at", trigIfr.x, trigIfr.y); await page.mouse.click(trigIfr.x + trigIfr.w / 2, trigIfr.y + trigIfr.h / 2); clicked = true; }
else if (parentCands.fixed.length) { const c = parentCands.fixed[parentCands.fixed.length - 1]; console.log("clicking parent bubble", JSON.stringify(c)); await page.mouse.click(c.x + c.w / 2, c.y + c.h / 2); clicked = true; }
else console.log("NO parent launcher candidate found");
await page.waitForTimeout(2500);
const bbox2 = await page.evaluate(() => {
  const ifr = [...document.querySelectorAll("iframe")].find(i => (i.src || "").includes("app.yuma.ai"));
  if (!ifr) return null; const r = ifr.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
console.log("iframe bbox AFTER parent-launcher click:", JSON.stringify(bbox2), clicked ? "(clicked)" : "(nothing clicked)");
await page.screenshot({ path: SHOT("1-open") }).catch(() => {});
await dump(f, "A: after widget open");

// home screen? click through any message-ish button
const start = f.locator('button:has-text("Envoyer un message"), button:has-text("Envoyez-nous un message"), button:has-text("Send us a message"), button:has-text("Poser une question"), button:has-text("Nouvelle conversation"), button:has-text("message")').first();
if (await start.count().catch(() => 0)) { console.log("clicking start button…"); await start.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1200); await dump(f, "A2: after start click"); }

// ---- STEP: ask the question in the composer
// KEY FINDING pass 1: the send button (.chatPage__submitBtn) stays disabled after
// Playwright fill() — React-controlled textarea ignores programmatic value. Type real
// keystrokes, verify the button enables, then CLICK the button (Enter did nothing).
const COMPOSER = '.chatPage__textarea, [aria-label="Ask your question"], textarea';
const inp = f.locator(COMPOSER).first();
await inp.waitFor({ state: "visible", timeout: 12000 }).catch(() => console.log("composer never visible"));
await inp.click({ timeout: 5000 }).catch(() => {});
await page.keyboard.type("Bonjour ! Je cherche une poêle de bonne qualité pour tous les jours — que me conseillez-vous ?", { delay: 18 });
await page.waitForTimeout(500);
const subBtn = f.locator(".chatPage__submitBtn").first();
console.log("submitBtn disabled after typing?", await subBtn.isDisabled().catch(() => "?"));
if (await subBtn.isDisabled().catch(() => true)) {
  console.log("still disabled — trying Enter keypress");
  await page.keyboard.press("Enter");
} else {
  await subBtn.click({ timeout: 4000 }).catch(e => console.log("submit click failed", String(e).slice(0, 100)));
}
console.log("question sent — waiting for user bubble + email form…");
await page.waitForTimeout(4500);
await page.screenshot({ path: SHOT("2-after-question") }).catch(() => {});
await dump(f, "B: after first question (email form should be here)");

// ---- STEP: fill whatever email-ish input appeared, realistic identity
const who = { name: "Camille Fournier", email: "camille.fournier84@gmail.com" };
const emailSel = 'input[type="email"], input[placeholder*="@"], input[placeholder*="mail" i], input[name*="mail" i], input[aria-label*="mail" i], input[id*="mail" i]';
const em = f.locator(emailSel).first();
if (await em.count().catch(() => 0)) {
  console.log("email input FOUND — filling", who.email);
  const nameI = f.locator('input[name*="name" i], input[placeholder*="nom" i], input[placeholder*="name" i], input[aria-label*="name" i]').first();
  if ((await nameI.count().catch(() => 0)) && (await nameI.isVisible().catch(() => false))) await nameI.fill(who.name).catch(() => {});
  await em.click({ timeout: 3000 }).catch(() => {});
  await em.fill(who.email).catch(async () => { await em.type(who.email, { delay: 15 }).catch(() => {}); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOT("3-filled") }).catch(() => {});
  await dump(f, "C: after filling email (look for the submit button state)");
  // try every plausible submit
  const sub = f.locator('button[type="submit"], button:has-text("Valider"), button:has-text("Envoyer"), button:has-text("Continuer"), button:has-text("Commencer"), button:has-text("Démarrer"), button:has-text("C\'est parti"), button:has-text("Submit"), button:has-text("Start"), [aria-label="Send message"]').first();
  if (await sub.count().catch(() => 0)) { console.log("submit button found — clicking"); await sub.click({ timeout: 4000 }).catch(e => console.log("submit click failed", String(e).slice(0, 100))); }
  else { console.log("no submit button matched — pressing Enter in email field"); await em.press("Enter").catch(() => {}); }
} else {
  console.log("NO email input matched after question — dumping ALL frames' inputs");
  for (const fr of page.frames()) {
    if (fr === page.mainFrame()) continue;
    const ins = await fr.evaluate(() => [...document.querySelectorAll("input,textarea")].map(i => ({ t: i.type, ph: i.placeholder, aria: i.getAttribute("aria-label") }))).catch(() => null);
    if (ins && ins.length) console.log(fr.url().slice(0, 80), JSON.stringify(ins));
  }
}

// ---- STEP: wait for the AI to actually answer
console.log("waiting up to 75s for an AI reply…");
const t0 = Date.now();
let lastLen = 0;
while (Date.now() - t0 < 75000) {
  await page.waitForTimeout(3000);
  const txt = await f.evaluate(() => document.body.innerText).catch(() => "");
  if (txt.length !== lastLen) { console.log(`t+${Math.round((Date.now() - t0) / 1000)}s bodyText ${lastLen}→${txt.length}`); lastLen = txt.length; }
}
await page.screenshot({ path: SHOT("4-final") }).catch(() => {});
await dump(f, "D: FINAL — did the AI answer?");
await browser.close();
console.log("probe done");
