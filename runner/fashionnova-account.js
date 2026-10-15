// Fashion Nova test account: the in-house Nova AI agent only answers a SIGNED-IN customer.
// Signed out, the help-center flow ends on "Connecting you now" and nothing ever arrives
// (verified 2026-10-15; Gorgias colleagues saw the same hang on 2026-10-13).
//
// Fashion Nova signs in with a one-time code sent by email ("LOG IN / SIGN UP": the first code
// creates the account). The code goes to a throwaway mail.tm inbox that this module creates and
// reads through mail.tm's public API, so no real person's mailbox is involved (AGENTS.md rule 5).
// The inbox address and password live in runner/secrets/fashionnova-account.json and the signed-in
// browser session in runner/secrets/fashionnova-state.json; both are gitignored.
//
//   node tools/fashionnova-account.mjs create    # new inbox + account + saved session
//   node tools/fashionnova-account.mjs refresh   # sign the existing account in again
//
// WIDGETS.fashionnova (vendors.js) also signs in by itself when the saved session has expired.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAILTM = "https://api.mail.tm";
export const ACCOUNT_FILE = new URL("./secrets/fashionnova-account.json", import.meta.url).pathname;
export const STATE_FILE = new URL("./secrets/fashionnova-state.json", import.meta.url).pathname;
export const HELP_CENTER = "https://www.fashionnova.com/pages/help-center-v5";

export function loadAccount() {
  if (!existsSync(ACCOUNT_FILE)) return null;
  return JSON.parse(readFileSync(ACCOUNT_FILE, "utf8"));
}

export function saveAccount(acct) {
  mkdirSync(dirname(ACCOUNT_FILE), { recursive: true });
  writeFileSync(ACCOUNT_FILE, JSON.stringify(acct, null, 1) + "\n", { mode: 0o600 });
}

async function mailJson(path, init = {}) {
  const r = await fetch(`${MAILTM}${path}`, { ...init, headers: { "content-type": "application/json", accept: "application/json", ...(init.headers || {}) } });
  const body = await r.text();
  if (!r.ok) throw new Error(`mail.tm ${path} ${r.status}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

// mail.tm strips dots and other punctuation from the local part, so the address to sign in with is
// the one the API returns, not the one requested.
export async function createInbox(firstName, lastName) {
  const domains = await mailJson("/domains");
  const domain = (domains["hydra:member"] || domains)[0].domain;
  const local = `${firstName}${lastName}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`.toLowerCase();
  const password = `bench-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const made = await mailJson("/accounts", { method: "POST", body: JSON.stringify({ address: `${local}@${domain}`, password }) });
  return { email: made.address, password, firstName, lastName, createdAt: new Date().toISOString() };
}

// Newest 6-digit code that arrived after `since` (ms epoch).
export async function waitForCode(acct, { since, timeoutMs = 120000 } = {}) {
  const { token } = await mailJson("/token", { method: "POST", body: JSON.stringify({ address: acct.email, password: acct.password }) });
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const list = await mailJson("/messages", auth);
    const fresh = (list["hydra:member"] || list).filter((m) => new Date(m.createdAt).getTime() >= since - 2000)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    for (const m of fresh) {
      const full = await mailJson(`/messages/${m.id}`, auth);
      const code = (`${full.subject}\n${full.text || ""}`.match(/\b(\d{6})\b/) || [])[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`fashionnova: no sign-in code reached ${acct.email} within ${timeoutMs / 1000}s`);
}

// The help center greets a signed-in customer by first name and drops its "Sign In" card.
export async function isSignedIn(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const signInCard = [...main.querySelectorAll("button")].some((b) => (b.innerText || "").trim() === "Sign In");
    return !signInCard && /\bHi [^,\n]+, how can we help\?/.test(main.innerText || "");
  }).catch(() => false);
}

// A first sign-in asks for a first and last name ("Save & Continue"); the marketing opt-in is
// left unticked.
export async function completeProfile(page, acct) {
  const first = page.locator('[data-testid="complete-account-information-first-name-input"]');
  if (!(await first.isVisible().catch(() => false))) return false;
  await first.fill(acct.firstName);
  await page.locator('[data-testid="complete-account-information-last-name-input"]').fill(acct.lastName);
  await page.locator('[data-testid="complete-account-information-submit-button"]').click();
  await page.waitForTimeout(4000);
  return true;
}

// Full sign-in on an open page: email -> code page -> code typed -> back on the storefront.
export async function signIn(page, acct) {
  await page.goto(HELP_CENTER, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  if (await isSignedIn(page)) return true;
  await page.getByRole("button", { name: "Sign In", exact: true }).last().click({ timeout: 15000 });
  const since = Date.now();
  await page.locator("input#email").fill(acct.email, { timeout: 15000 });
  await page.getByRole("button", { name: "Continue" }).click();
  // The code page focuses the first of six digit boxes and advances as each digit is typed.
  await page.getByText("Enter Code").waitFor({ timeout: 30000 });
  const code = await waitForCode(acct, { since });
  await page.keyboard.type(code, { delay: 120 });
  await page.waitForURL((u) => /fashionnova\.com/.test(u.hostname) && !/account|login|authentication/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.goto(HELP_CENTER, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  await completeProfile(page, acct);
  return isSignedIn(page);
}

export async function saveState(context) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  await context.storageState({ path: STATE_FILE });
}
