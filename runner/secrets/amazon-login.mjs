// One-shot Amazon login → saves storageState (session cookies) to amazon-state.json.
// Reads creds from ../../.amazon-creds (gitignored). Headed real Chrome. Never logs the password.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const [EMAIL, PW] = readFileSync(new URL("../../.amazon-creds", import.meta.url), "utf8").trim().split("\n");
const OUT = new URL("./amazon-state.json", import.meta.url).pathname;
const b = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US", timezoneId: "America/New_York" });
await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
const page = await ctx.newPage();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
try {
  await page.goto("https://www.amazon.com/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.com%2F&openid.mode=checkid_setup&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0", { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch(async () => { await page.goto("https://www.amazon.com/", { waitUntil: "domcontentloaded" }); await page.click("#nav-link-accountList").catch(()=>{}); });
  await page.waitForTimeout(2500);
  // email
  const email = page.locator("#ap_email, input[type=email], input[name=email]").first();
  if (await email.count()) { await email.fill(EMAIL); log("email filled"); await page.locator("#continue, input#continue, span#continue input").first().click().catch(()=>{}); await page.waitForTimeout(2500); }
  // password
  const pw = page.locator("#ap_password, input[type=password]").first();
  if (await pw.count()) { await pw.fill(PW); log("password filled"); await page.locator("#signInSubmit, input#signInSubmit").first().click().catch(()=>{}); await page.waitForTimeout(5000); }
  // detect state
  const url = page.url();
  const title = await page.title();
  const otp = await page.locator("#auth-mfa-otpcode, input[name=otpCode], #cvf-input-code").count().catch(()=>0);
  const captcha = await page.locator("#auth-captcha-image, form[action*=validateCaptcha], #captchacharacters").count().catch(()=>0);
  const loggedIn = await page.locator("#nav-link-accountList-nav-line-1, #glow-ingress-line2").first().innerText().catch(()=>"");
  log("url:", url.slice(0, 70));
  log("title:", title.slice(0, 50));
  if (otp) { log("⚠️ OTP/2FA CHALLENGE — enter the code in the Chrome window; I'll wait up to 3 min"); await page.waitForTimeout(180000); }
  else if (captcha) { log("⚠️ CAPTCHA — solve it in the Chrome window; I'll wait up to 3 min"); await page.waitForTimeout(180000); }
  // save whatever session we have (re-check after any manual step)
  const finalGreeting = await page.locator("#nav-link-accountList-nav-line-1").first().innerText().catch(()=>"");
  await ctx.storageState({ path: OUT });
  const st = JSON.parse(readFileSync(OUT, "utf8"));
  const hasSession = st.cookies.some(c => /session-id|at-main|sess-at-main|x-main/.test(c.name));
  log("greeting:", finalGreeting || "(none)");
  log("cookies saved:", st.cookies.length, "| session cookie present:", hasSession);
  log(hasSession ? "✅ LOGIN OK — state saved" : "❌ no session cookie — login likely failed (2FA/captcha/rejected)");
} catch (e) { log("ERR:", e.message.slice(0, 150)); }
await b.close();
