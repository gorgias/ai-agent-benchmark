// Create or refresh the Fashion Nova test account the fashionnova driver signs in with.
// See ../fashionnova-account.js for why the agent needs a signed-in customer.
//
//   node tools/fashionnova-account.mjs create    # throwaway inbox + new account + saved session
//   node tools/fashionnova-account.mjs refresh   # sign the existing account in again
//   node tools/fashionnova-account.mjs status    # is the saved session still signed in?
//
// BENCHMARK_BROWSER_PROXY=http://host:port routes the browser through a proxy (cloud sandboxes).

import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { loadAccount, saveAccount, createInbox, signIn, isSignedIn, saveState, STATE_FILE, HELP_CENTER } from "../fashionnova-account.js";

const cmd = process.argv[2] || "status";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const proxy = process.env.BENCHMARK_BROWSER_PROXY ? { server: process.env.BENCHMARK_BROWSER_PROXY } : undefined;

let acct = loadAccount();
if (cmd === "create") {
  if (acct) { console.error(`An account already exists (${acct.email}). Use "refresh", or delete secrets/fashionnova-account.json first.`); process.exit(1); }
  acct = await createInbox("Nora", "Bellin");
  saveAccount(acct);
  console.log(`Throwaway inbox: ${acct.email}`);
} else if (!acct) {
  console.error('No account yet: run "node tools/fashionnova-account.mjs create".');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, proxy, args: ["--disable-blink-features=AutomationControlled"] });
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 },
  storageState: cmd !== "create" && existsSync(STATE_FILE) ? STATE_FILE : undefined });
const page = await context.newPage();
try {
  if (cmd === "status") {
    await page.goto(HELP_CENTER, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    const ok = await isSignedIn(page);
    console.log(`${acct.email}: ${ok ? "signed in" : "signed out — run refresh"}`);
    process.exitCode = ok ? 0 : 2;
  } else {
    const ok = await signIn(page, acct);
    if (!ok) throw new Error("sign-in did not reach the signed-in help center");
    await saveState(context);
    console.log(`Signed in as ${acct.email}; session saved to ${STATE_FILE}`);
  }
} finally {
  await browser.close();
}
