// Per-STORE harness for the cold headless runner.
//
// We test 2–3 live storefronts per vendor. Stores of the same vendor share a
// widget technology, so harness logic lives in WIDGETS (keyed by widget type)
// and STORES just maps each storefront to a widget + URL.
//
// Playwright can reach into cross-origin iframes (unlike a page script), so for
// iframe widgets we read the reply text straight out of the chat frame; for
// shadow-DOM widgets (Spiffy, Sierra) we read the shadow root.
//
// Each widget exposes:
//   scope          {kind:'frame', match} | {kind:'shadow', match} | {kind:'shadowId', sel}
//   open(page)     open the chat widget (+ dismiss modals / prechat)
//   send(page,txt) post a user message
//   handover       extra handover regexes specific to this widget (optional)

import { randomBytes } from "node:crypto";

// Realistic throwaway identities for pre-chat email gates. @example.com gets rejected by
// stricter validators (verified on Tumble), so we use real consumer domains. The address is
// only typed to unlock the chat and is never sent to; uncommon surname + digits make a real
// inbox collision vanishingly unlikely. Dummy PII, not a real person.
const DUMMY_FIRST_NAMES = ["John", "Maya", "Nora", "Evan", "Lina", "Adam", "Sofia", "Noah"];
const DUMMY_LAST_NAMES = ["Minser", "Carrow", "Bellin", "Harper", "Linton", "Rossi", "Parker", "Madden"];
const DUMMY_EMAIL_HOSTS = ["gmail.com", "gmail.com", "gmail.com", "outlook.com", "icloud.com", "hotmail.com"];

function pickDummy(xs) {
  return xs[randomBytes(1)[0] % xs.length];
}

function makeDummyIdentity() {
  const firstName = pickDummy(DUMMY_FIRST_NAMES);
  const lastName = pickDummy(DUMMY_LAST_NAMES);
  const num = (randomBytes(1)[0] % 90) + 10;                 // 2-digit — realistic + unique enough
  const sep = randomBytes(1)[0] % 2 ? "." : "";
  return {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    email: `${firstName}${sep}${lastName}${num}`.toLowerCase() + `@${pickDummy(DUMMY_EMAIL_HOSTS)}`,
  };
}

async function dismiss(page) {
  for (const sel of [
    'button:has-text("Reject")', 'button:has-text("Decline")', 'button:has-text("No thanks")',
    'button:has-text("Refuser")', 'button:has-text("Tout refuser")', 'button:has-text("Continuer sans accepter")',
    'button:has-text("Accept")', '[aria-label="Close"]', 'button:has-text("Close")',
    // HubSpot's EU cookie banner (#hs-eu-cookie-confirmation) uses "Dismiss", not
    // Accept/Reject/Close — missing this left the banner's invisible-overlay hit-testing
    // silently swallowing every click into the widget underneath it (ninety.io/Intercom: the
    // composer accepted fill()/press("Enter") without throwing, since those act on the element
    // directly, but the widget's own click-to-send path never fired).
    'button:has-text("Dismiss")', '[aria-label="Dismiss"]', "#hs-eu-confirmation-button",
  ]) {
    try { const b = page.locator(sel).first(); if (await b.isVisible({ timeout: 400 })) await b.click({ timeout: 600 }); } catch {}
  }
}

// Drive a composer that lives inside an OPEN shadow root (headed Chrome). Pierces
// nested shadow roots under `hostSel`, finds the first text input, types, hits Enter.
async function shadowSend(page, hostSel, text) {
  const handle = await page.evaluateHandle((sel) => {
    const host = document.querySelector(sel) || document.getElementsByTagName(sel)[0];
    if (!host) return null;
    let inp = null;
    const walk = (n) => {
      if (!n || inp) return;
      if (n.shadowRoot) walk(n.shadowRoot);
      for (const k of (n.children || [])) walk(k);
      if (!inp && n.nodeType === 1 && (n.tagName === "TEXTAREA" || (n.tagName === "INPUT" && /text|search/i.test(n.type || "text")) || n.getAttribute?.("contenteditable") === "true")) inp = n;
    };
    walk(host); return inp;
  }, hostSel);
  const el = handle.asElement(); if (!el) return false;
  await el.click({ timeout: 4000 }).catch(() => {});
  let ok = false; try { await el.fill(text); ok = true; } catch {}
  if (!ok) { try { await el.type(text, { delay: 10 }); } catch {} }
  await page.keyboard.press("Enter");
  return true;
}

// Click the first button/launcher inside an open shadow host (headed Chrome).
async function shadowClickLauncher(page, hostSel) {
  await page.evaluate((sel) => {
    const host = document.querySelector(sel) || document.getElementsByTagName(sel)[0];
    if (!host) return;
    let btn = null;
    const walk = (n) => {
      if (!n || btn) return;
      if (n.shadowRoot) walk(n.shadowRoot);
      for (const k of (n.children || [])) walk(k);
      if (!btn && n.nodeType === 1 && (n.tagName === "BUTTON" || n.getAttribute?.("role") === "button")) btn = n;
    };
    walk(host); btn && btn.click();
  }, hostSel).catch(() => {});
}

async function fillVisibleInput(frame, selector, value, timeout = 3000) {
  const input = frame.locator(selector).first();
  if (!(await input.count().catch(() => 0))) return false;
  if (!(await input.isVisible().catch(() => false))) return false;
  await input.click({ timeout }).catch(() => {});
  await input.fill(value).catch(async () => { await input.type(value, { delay: 12 }).catch(() => {}); });
  return true;
}

// Some chats gate behind a pre-chat identity form. Fill a fresh dummy identity
// from reserved example.com and submit so the conversation can start.
async function fillEmailGate(page, frame) {
  try {
    const emailSel = 'input[type="email"], input[placeholder*="@"], input[placeholder*="mail" i], input[name*="mail" i], input[aria-label*="mail" i]';
    const email = frame.locator(emailSel).first();
    if (!(await email.count().catch(() => 0))) return false;
    if (!(await email.isVisible().catch(() => false))) return false;

    const identity = makeDummyIdentity();
    await fillVisibleInput(frame, 'input[placeholder*="first" i], input[name*="first" i], input[aria-label*="first" i]', identity.firstName);
    await fillVisibleInput(frame, 'input[placeholder*="last" i], input[name*="last" i], input[aria-label*="last" i]', identity.lastName);
    await fillVisibleInput(frame, 'input[placeholder*="name" i], input[name*="name" i], input[aria-label*="name" i]', identity.name);
    await fillVisibleInput(frame, emailSel, identity.email);

    const btn = frame.locator([
      'button:has-text("Start chat")',
      'button:has-text("Start Chat")',
      'button:has-text("Start conversation")',
      'button:has-text("Start")',
      'button:has-text("Submit")',
      'button:has-text("Continue")',
      'button:has-text("Chat")',
      'button:has-text("Send")',
      'button:has-text("Commencer")',
      'button:has-text("Demarrer")',
      'button:has-text("Démarrer")',
      'button:has-text("Continuer")',
      'button:has-text("Envoyer")',
      'button[type="submit"]',
      'input[type="submit"]',
      'button[aria-label*="Submit" i]',   // Gorgias in-chat email gate: icon button, aria "Submit …"
    ].join(", ")).first();
    let submitted = false;
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      submitted = true;
    }
    if (!submitted) {
      submitted = await frame.evaluate(() => {
        const rx = /start|submit|continue|chat|send|commencer|démarrer|demarrer|continuer|envoyer/i;
        const buttons = [...document.querySelectorAll('button,[role="button"],input[type="submit"]')];
        const btn = buttons.find((el) => rx.test(el.innerText || el.value || el.getAttribute("aria-label") || ""));
        if (btn) { btn.click(); return true; }
        return false;
      }).catch(() => false);
    }
    if (!submitted) await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(2500);
    return true;
  } catch { return false; }
}

async function fillAnyChatEmailGate(page) {
  let filled = false;
  for (const frame of page.frames()) {
    try {
      if (frame === page.mainFrame()) continue;
      const meta = `${frame.name()} ${frame.url()}`;
      const body = await frame.locator("body").innerText({ timeout: 700 }).catch(() => "");
      const haystack = `${meta} ${body}`;
      if (!/chat|message|support|help|assistant|conversation|inbox|siena|gorgias|yuma|dg-chat|shopify/i.test(haystack)) continue;
      if (/newsletter|subscribe|discount|coupon/i.test(body) && !/chat|message|support|assistant|conversation/i.test(body)) continue;
      if (await fillEmailGate(page, frame)) filled = true;
    } catch {}
  }
  return filled;
}

// ---------------------------------------------------------------------------
// Widget harnesses
// ---------------------------------------------------------------------------
export const WIDGETS = {
  // Gorgias Chat — same-origin chat-window iframe; programmatic open + sendMessage.
  gorgias: {
    scope: { kind: "frame", match: "chat-window" },
    handover: [/joined the chat/i, /a rejoint (la )?(conversation|discussion|chat)/i,
               /conseiller humain/i, /transf[eè]re(r|z)?\b.*(humain|conseiller|agent|ticket)/i, /laissez(\-| )?(nous|moi)?\s*(votre)?\s*(e-?mail|adresse)/i,
               // silent escalation banner (2026-07-09: missed "joinING" → dead turns were
               // recorded as empty AI failures instead of an honest handover)
               /(is |agent )joining the (chat|conversation)/i, /will respond as soon as they join/i,
               // hard login WALL only — the AI genuinely refuses to proceed unattended.
               // NB: "verify order details" and "if you log in we can check…" are NOT gates —
               // they are a trailing UI button / optional-help phrasing that Gorgias appends
               // AFTER a complete automated answer; matching them wrongly nuked 54 good convs
               // (2026-07-10 regression → reverted). Only the imperative continue-gate stays.
               /please (log|sign) in to (continue|proceed|verify)/i],
    async open(page) {
      await dismiss(page);
      // widget bundle loads a couple seconds after a real-UA 'load'; wait for it
      await page.waitForFunction(() => typeof window.GorgiasChat !== "undefined", null, { timeout: 30000 }).catch(() => {});
      await page.evaluate(async () => {
        const isOpen = () => { try { return !!window.GorgiasChat.isOpen(); } catch (e) { return false; } };
        for (let i = 0; i < 14 && !isOpen(); i++) { try { window.GorgiasChat.open(); } catch (e) {} await new Promise(r => setTimeout(r, 900)); }
      });
      await page.waitForTimeout(3500);
      // If the conversation window didn't open, click the launcher button.
      if (!(await findFrame(page, "chat-window"))) {
        const fb = await findFrame(page, "chat-button");
        if (fb) { try { await fb.locator('button, [role="button"], div').first().click({ timeout: 3000 }); } catch (e) {} }
        await page.evaluate(() => { try { document.querySelector('#chat-button, [aria-label*="chat" i]')?.click?.(); } catch (e) {} });
        await page.waitForTimeout(3500);
      }
      const f = await findFrame(page, "chat-window");
      if (f) await fillEmailGate(page, f);   // dummy email if the chat gates on one
    },
    async send(page, text) {
      // The message box is the "Ask anything" textarea INSIDE the chat-window
      // iframe; typing + Enter posts (GorgiasChat.sendMessage no-ops on the home
      // screen in a cold context). Avoid the email-capture input if present.
      const f = await findFrame(page, "chat-window");
      if (!f) { try { await page.evaluate(t => window.GorgiasChat.sendMessage(t), text); } catch (e) {} return; }
      // Some Gorgias shells (Atma/Yuma) pop an in-chat email-capture AFTER the first
      // message — the AI won't reply until it's satisfied. No-op when absent.
      await fillEmailGate(page, f).catch(() => {});
      let inp = f.locator('textarea').first();
      if (!(await inp.count().catch(() => 0))) inp = f.locator('[contenteditable="true"], input[type="text"], input:not([type="email"])').first();
      await inp.click({ timeout: 5000 }).catch(() => {});
      await inp.fill(text).catch(async () => { await inp.type(text).catch(() => {}); });
      await page.keyboard.press("Enter");
    },
  },

  // Envive (formerly Spiffy.ai) — shadow-DOM chat. TWO embeddings coexist during the rebrand,
  // so the driver is embedding-agnostic (scope.match finds whichever shadow root holds the
  // composer, like the Sierra driver):
  //   legacy Spiffy:  #spiffy-modal-container shadow · input[placeholder*="Ask"] · send button
  //   new Envive:     #envive-ai-floating-chat shadow · textarea[placeholder="Ask me anything…"] · Enter
  // (2026-07-13: the old #spiffy-modal-container-only driver saw 8/11 stores as "0 replies" —
  // they had silently migrated to the #envive-ai-* build. Retargeted to cover both.)
  spiffy: {
    scope: { kind: "shadow", match: 'textarea[placeholder*="Ask" i], input[placeholder*="Ask" i], [data-testid="spiffy-chat-reply-input"]' },
    handover: [/customer care team/i, /human (agent|representative)/i, /connect you (with|to)/i, /talk to (a|an|our) (human|agent|person)/i],
    async open(page) {
      await page.waitForTimeout(2500); await dismiss(page);
      const sel = WIDGETS.spiffy.scope.match;
      let pdpTried = false;
      for (let i = 0; i < 30; i++) {
        const st = await page.evaluate((sel) => {
          let composer = false;
          const walk = (n) => { for (const el of (n.querySelectorAll ? n.querySelectorAll('*') : [])) { if (el.shadowRoot) { if (el.shadowRoot.querySelector(sel)) { composer = true; return; } walk(el.shadowRoot); } } };
          walk(document);
          const host = document.querySelector('#envive-ai-floating-chat') || document.querySelector('#spiffy-ai-floating-button') || document.querySelector('#envive-ai-container') || document.querySelector('#spiffy-ai-container');
          return { composer, host: !!host };
        }, sel);
        if (st.composer) break;
        // Some Envive stores mount the chat ONLY on a product page (e.g. Fracture) — if no
        // composer has appeared and we aren't already on a PDP, navigate to the first product
        // link once, then keep polling. (The legacy driver's "open via a PDP" note, generalized.)
        if (!st.composer && !pdpTried && i >= 2 && !/\/products\//.test(page.url())) {
          pdpTried = true;
          const href = await page.evaluate(() => { const a = document.querySelector('a[href*="/products/"]'); return a ? a.href : null; }).catch(() => null);
          if (href) { try { await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 }); await page.waitForTimeout(4000); await dismiss(page); } catch {} continue; }
        }
        if (st.host) await page.evaluate(() => {
          const host = document.querySelector('#envive-ai-floating-chat') || document.querySelector('#spiffy-ai-floating-button') || document.querySelector('#envive-ai-container') || document.querySelector('#spiffy-ai-container');
          const r = host && (host.shadowRoot || host); const btn = r && r.querySelector('button,[role=button]'); btn && btn.click();
        }).catch(() => {});
        await page.waitForTimeout(800);
      }
      await page.waitForTimeout(1000);
    },
    async send(page, text) {
      await page.evaluate((t) => {
        let inp = null;
        const walk = (n) => { for (const el of (n.querySelectorAll ? n.querySelectorAll('*') : [])) { if (inp) return; if (el.shadowRoot) { const c = el.shadowRoot.querySelector('[data-testid="spiffy-chat-reply-input"], textarea[placeholder*="Ask" i], input[placeholder*="Ask" i], textarea'); if (c) { inp = c; return; } walk(el.shadowRoot); } } };
        walk(document);
        if (!inp) return;
        const proto = inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        inp.focus(); setter.call(inp, t); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
        const root = inp.getRootNode();
        setTimeout(() => {
          const btn = (root.querySelector && (root.querySelector('[data-testid="spiffy-chat-reply-input-send-button"]') || [...root.querySelectorAll('button')].find(b => /send/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-testid') || ''))))) || null;
          if (btn && !btn.disabled) btn.click(); else inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }, 150);
      }, text);
    },
  },

  // Mavenoid — product-troubleshooting assistant (nanit). It drives users through GUIDED
  // decision-tree troubleshooting, not a free-text chat, so our free-text conversation pools
  // can't meaningfully drive it. Documented as a structural non-driver (like Humind / Shopify
  // Inbox); captured convs come back invalid (no free-text answer) — the honest finding. Added
  // 2026-07-13 when nanit was found mis-attributed to Envive.
  mavenoid: {
    scope: { kind: "shadow", match: 'textarea, input[type="text"], [contenteditable]' },
    handover: [],
    async open(page) { await page.waitForTimeout(3000); await dismiss(page); },
    async send() { /* decision-tree UI — no free-text composer to drive */ },
  },

  // Sierra — shadow-DOM widget, SSE streaming. HEADED-ONLY (headless echoes the user but
  // the backend returns NO assistant reply — bot wall). Two SDK builds: hosted embed
  // (Casper) window.openSierraChat() + <textarea aria-label="Add new message">; self-hosted
  // (BARK) window.sierra.openChatModal() + contenteditable [aria-label="Message Input"].
  // scope.match = the composer selector; the shared reader finds the shadow root by it.
  sierra: {
    scope: { kind: "shadow", match: 'textarea[aria-label*="message" i], [contenteditable][aria-label*="message" i], [role="textbox"][aria-label*="message" i]' },
    handover: [/recorded by .* service provider/i],
    async open(page) {
      await page.waitForTimeout(3500); await dismiss(page);
      await page.evaluate(() => { const hit = (root) => { for (const b of (root.querySelectorAll ? root.querySelectorAll('button,[role="button"]') : [])) { const t = (b.getAttribute("aria-label") || b.textContent || "").trim(); if (/^(accept all|accept|reject all|i agree|got it|ok)$/i.test(t)) { try { b.click(); return true; } catch (e) {} } } return false; }; const walk = (n) => { if (hit(n)) return true; for (const el of (n.querySelectorAll ? n.querySelectorAll("*") : [])) if (el.shadowRoot && walk(el.shadowRoot)) return true; return false; }; walk(document); }).catch(() => {});
      await page.waitForTimeout(800);
      const composerSel = WIDGETS.sierra.scope.match;
      const has = () => page.evaluate((sel) => !!(window.__sierraRoot && window.__sierraRoot(sel)), composerSel);
      const panelOpen = () => page.evaluate(() => { let open = false; const walk = (n) => { if (open) return; for (const el of (n.querySelectorAll ? n.querySelectorAll("*") : [])) if (el.shadowRoot) { if (/chat (sessions? )?(are|is) recorded|record your chat|virtual agent|i'?m .{0,20}(ai|assistant)/i.test(el.shadowRoot.textContent || "")) { open = true; return; } walk(el.shadowRoot); } }; walk(document); return open; });
      for (let i = 0; i < 14; i++) {
        if (await has()) break;
        if (!(await panelOpen())) {
          await page.evaluate(() => { try { if (typeof window.openSierraChat === "function") window.openSierraChat(); } catch (e) {} try { if (window.sierra && typeof window.sierra.openChatModal === "function") window.sierra.openChatModal(); } catch (e) {} }).catch(() => {});
          if (!(await panelOpen())) { for (const sel of ["#sierra-chat-button", "#sierra-chat-launcher"]) { try { const l = page.locator(sel).first(); if (await l.count()) { await l.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {}); await l.click({ timeout: 2500, force: true }); break; } } catch {} } }
        }
        await page.waitForTimeout(1600);
      }
      await page.waitForTimeout(2000);
    },
    async send(page, text) {
      const composerSel = WIDGETS.sierra.scope.match;
      const handle = await page.evaluateHandle((sel) => { const r = window.__sierraRoot && window.__sierraRoot(sel); return r ? r.querySelector(sel) : null; }, composerSel);
      const el = handle.asElement(); if (!el) return;
      await el.click({ timeout: 4000 }).catch(() => {});
      const isTextarea = await el.evaluate(n => n.tagName === "TEXTAREA").catch(() => false);
      if (isTextarea) { await el.evaluate((n, t) => { const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set; setter.call(n, t); n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); }, text).catch(() => {}); }
      else { await el.evaluate(n => { n.focus(); n.textContent = ""; }).catch(() => {}); await page.keyboard.type(text, { delay: 8 }).catch(() => {}); await el.evaluate(n => n.dispatchEvent(new Event("input", { bubbles: true }))).catch(() => {}); }
      await page.waitForTimeout(300);
      const clicked = await page.evaluate((sel) => { const r = window.__sierraRoot && window.__sierraRoot(sel); if (!r) return false; const btn = [...r.querySelectorAll('button,[role="button"]')].find(b => /send\s*message|^send$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim())); if (btn && !btn.disabled) { btn.click(); return true; } return false; }, composerSel);
      if (!clicked) await el.press("Enter").catch(async () => { await page.keyboard.press("Enter").catch(() => {}); });
    },
  },

  // Siena — iframe (chat.siena.cx). Loader fires on window 'load' (can miss under
  // automation) → force it; launcher is the #SIENA_CHAT_IFRAME bubble (must click);
  // pre-chat gate = name+email OR email-only. NEVER a quick-reply chip. (HEADED path.)
  siena: {
    scope: { kind: "frame", match: "siena.cx" },
    async open(page) {
      await page.waitForTimeout(1500); await dismiss(page);
      const sframe = () => page.frames().find(fr => fr.url().includes("siena.cx"));
      const hasIframe = async () => page.evaluate(() => !!document.querySelector('#SIENA_CHAT_IFRAME, iframe[src*="siena.cx" i]')).catch(() => false);
      for (let i = 0; i < 6 && !(await hasIframe()); i++) { if (i === 2) await page.evaluate(() => { try { window.dispatchEvent(new Event("load")); } catch (e) {} }).catch(() => {}); await page.waitForTimeout(1000); }
      if (!(await hasIframe())) {
        const loaderUrl = await page.evaluate(() => { const m = document.documentElement.innerHTML.match(/https?:\/\/chat\.siena\.cx\/dist\/webchat\.js[^"'\s]*/); return m ? m[0] : null; }).catch(() => null);
        if (loaderUrl) await page.evaluate((src) => { const s = document.createElement("script"); s.async = true; s.src = src; document.body.appendChild(s); }, loaderUrl).catch(() => {});
      }
      for (let i = 0; i < 20 && !sframe(); i++) await page.waitForTimeout(800);
      await page.evaluate(() => { try { window.SienaLaunchChat && window.SienaLaunchChat(); } catch (e) {} }).catch(() => {});
      await page.waitForTimeout(800);
      for (let i = 0; i < 6; i++) {
        const f = sframe();
        if (f) { const ready = await f.evaluate(() => !!document.querySelector('textarea,[contenteditable="true"]') || /enter your name|start the chat|start chat/i.test(document.body.innerText || "")).catch(() => false); if (ready) break; }
        await page.locator('#SIENA_CHAT_IFRAME, iframe[src*="siena.cx" i]').first().click({ timeout: 3000, force: true }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      const f = sframe();
      if (f) {
        const composerReady = () => f.evaluate(() => !!document.querySelector('textarea,[contenteditable="true"]')).catch(() => false);
        for (let attempt = 0; attempt < 4 && !(await composerReady()); attempt++) {
          const identity = makeDummyIdentity();
          const nameI = f.locator('input[placeholder*="name" i], input[aria-label*="name" i]').first();
          if (await nameI.count().catch(() => 0)) { await nameI.click({ timeout: 2000 }).catch(() => {}); await nameI.fill(identity.name).catch(() => {}); }
          const mailI = f.locator('input[type="email"], input[placeholder*="@" i], input[placeholder*="mail" i], input[aria-label*="mail" i]').first();
          if (await mailI.count().catch(() => 0)) { await mailI.click({ timeout: 2000 }).catch(() => {}); await mailI.fill(identity.email).catch(async () => { await mailI.type(identity.email, { delay: 15 }).catch(() => {}); }); }
          const startBtn = f.locator('button:has-text("Start chat"), button:has-text("Start"), button:has-text("Continue")').first();
          if (await startBtn.count().catch(() => 0)) await startBtn.click({ timeout: 3000 }).catch(() => {});
          else { const skip = f.locator('button:has-text("Skip for now"), button:has-text("Skip")').first(); if (await skip.count().catch(() => 0)) await skip.click({ timeout: 3000 }).catch(() => {}); else await page.keyboard.press("Enter").catch(() => {}); }
          for (let i = 0; i < 8 && !(await composerReady()); i++) await page.waitForTimeout(700);
        }
      }
    },
    async send(page, text) {
      const f = page.frames().find(fr => fr.url().includes("siena.cx")); if (!f) return;
      let inp = f.locator('textarea').first();
      if (!(await inp.count().catch(() => 0))) inp = f.locator('[contenteditable="true"], input[type="text"]:not([placeholder*="name" i])').first();
      await inp.click({ timeout: 5000 }).catch(() => {});
      await inp.fill(text).catch(async () => { await inp.type(text, { delay: 8 }).catch(() => {}); });
      await page.keyboard.press("Enter");
    },
  },

  // DigitalGenius — Sunshine Conversations iframe, gated by a prechat lead form.
  // DigitalGenius — DG bundle loads late; launchWidget() only mounts the launcher bubble
  // (dg-chat-widget-launcher-iframe); the conversation panel (dg-chat-widget-iframe) mounts
  // only after that bubble is clicked. Some stores gate on a name+email pre-chat form
  // (Bloom & Wild); others go straight to the composer (G-Star). Composer mounts only after
  // the greeting renders. HEADED-ONLY (headless stalls at "Bot is typing").
  dg: {
    scope: { kind: "frame", match: "dg-chat-widget-iframe" },
    handover: [/connect you (with|to) (one of )?(our|an?) (agent|team|advisor|colleague)/i, /transfer(ring)? you (to|over)/i, /someone available to help/i, /a member of our team/i, /reply to you via email/i, /in the queue/i,
               // email-escalation button menu: AI stops answering free text past this point (2026-07-09)
               /submit an email and we.?ll (come|get) back/i,
               // sentinel-learned silent escalations (2026-07-10): Siena routes to a human/email without an explicit 'agent joined' banner
               /routed to (a )?human agent/i, /we.?ll (follow up|reach out to you)( shortly)?( with more information)?( via e-?mail)?/i],
    async open(page) {
      await page.waitForTimeout(3000); await dismiss(page);
      await page.waitForFunction(() => !!(window.dgchat && window.dgchat.methods && window.dgchat.methods.launchWidget), null, { timeout: 30000 }).catch(() => {});
      await page.evaluate(() => { try { window.dgchat.methods.launchWidget(); } catch (e) {} }).catch(() => {});
      let launcher = null;
      for (let i = 0; i < 40 && !launcher; i++) { launcher = await findFrame(page, "dg-chat-widget-launcher-iframe"); if (!launcher) await page.waitForTimeout(500); }
      if (launcher) { const btn = launcher.locator('button.dg-chat-launcher, button[aria-label*="open chat" i], button[aria-label*="chat" i], button').first(); await btn.click({ timeout: 6000 }).catch(() => {}); }
      let wf = null;
      for (let i = 0; i < 40 && !wf; i++) { wf = await findFrame(page, "dg-chat-widget-iframe"); if (!wf) await page.waitForTimeout(500); }
      if (!wf) return;
      await page.waitForTimeout(1000);
      const identity = makeDummyIdentity();
      const nameI = wf.locator('input[placeholder*="name" i], input[name="name"], input[aria-label*="name" i]').first();
      const mailI = wf.locator('input[type="email"], input[placeholder*="email" i], input[name*="email" i], input[aria-label*="email" i]').first();
      if (await nameI.count().catch(() => 0)) { await nameI.click({ timeout: 3000 }).catch(() => {}); await nameI.fill(identity.name).catch(async () => { await nameI.type(identity.name, { delay: 15 }).catch(() => {}); }); }
      if (await mailI.count().catch(() => 0)) { await mailI.click({ timeout: 3000 }).catch(() => {}); await mailI.fill(identity.email).catch(async () => { await mailI.type(identity.email, { delay: 15 }).catch(() => {}); }); }
      const start = wf.locator('button:has-text("Start Chat"), button:has-text("Start chat"), button[type="submit"]').first();
      if (await start.count().catch(() => 0)) await start.click({ timeout: 6000 }).catch(() => {});
      const composer = wf.locator('textarea[aria-label*="message" i], textarea[placeholder*="message" i], textarea[placeholder*="type" i], [contenteditable="true"]').first();
      await composer.waitFor({ state: "visible", timeout: 40000 }).catch(() => {});
      await page.waitForTimeout(1000);
    },
    async send(page, text) {
      const f = await findFrame(page, "dg-chat-widget-iframe"); if (!f) return;
      let inp = f.locator('textarea[aria-label*="message" i], textarea[placeholder*="message" i], textarea[placeholder*="type" i], textarea').first();
      if (!(await inp.count().catch(() => 0))) inp = f.locator('[contenteditable="true"], input[type="text"]:not([placeholder*="name" i]):not([placeholder*="email" i])').first();
      await inp.click({ timeout: 5000 }).catch(() => {});
      await inp.fill(text).catch(async () => { await inp.type(text, { delay: 12 }).catch(() => {}); });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      try { const still = await inp.inputValue().catch(() => ""); if (still && still.trim()) { const b = f.locator('button[aria-label*="send" i], button[title*="send" i], button[type="submit"]').first(); if (await b.count()) await b.click({ timeout: 2500 }).catch(() => {}); } } catch {}
    },
  },

  // Zendesk messaging Virtual Assistant (AI agent).
  zendesk: {
    scope: { kind: "frame", match: "Messaging window" },
    async open(page) { await page.waitForTimeout(4000); await dismiss(page); await page.evaluate(() => { try { window.zE && window.zE("messenger", "open"); } catch (e) {} }); await page.waitForTimeout(4000); },
    async send(page, text) {
      const f = await findFrame(page, "Messaging window"); if (!f) return;
      const input = f.getByPlaceholder(/type a message|message/i).first();
      await input.click({ timeout: 5000 }).catch(() => {});
      await input.fill(text).catch(async () => { await input.type(text); });
      await page.keyboard.press("Enter");
    },
  },

  // Ada — static.ada.support iframe.
  ada: {
    // Ada injects 3 iframes; the CONVERSATION is #ada-chat-frame (the loose "ada" match
    // hit the empty ada-x-storage-frame → empty read). Target the chat frame by id.
    scope: { kind: "frame", match: "ada-chat-frame" },
    async open(page) {
      await dismiss(page);
      await page.waitForFunction(() => typeof window.adaEmbed !== "undefined", null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.evaluate(async () => { try { if (window.adaEmbed?.toggle) await window.adaEmbed.toggle(); else if (window.adaEmbed?.open) await window.adaEmbed.open(); } catch (e) {} }).catch(() => {});
      await page.waitForFunction(() => !!document.querySelector("#ada-chat-frame"), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3500);
      if (!(await findFrame(page, "ada-chat-frame"))) {   // fallback: click the launcher INSIDE the button frame (never a chip)
        const bf = page.frames().find(fr => /ada-button-frame/.test(fr.name() || "") || /ada\.support\/embed\/button/i.test(fr.url() || ""));
        if (bf) { try { const b = bf.locator('button, [role="button"]').first(); if (await b.count()) await b.click({ timeout: 2500 }).catch(() => {}); } catch {} await page.waitForFunction(() => !!document.querySelector("#ada-chat-frame"), null, { timeout: 12000 }).catch(() => {}); }
      }
      try { await page.frameLocator("#ada-chat-frame").locator('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]').first().waitFor({ state: "attached", timeout: 20000 }); } catch {}
      await page.waitForTimeout(1200);
    },
    async send(page, text) {
      if (!(await page.waitForSelector("#ada-chat-frame", { timeout: 8000 }).then(() => true).catch(() => false))) return;
      const fl = page.frameLocator("#ada-chat-frame");   // stable id → survives Ada's post-message frame navigation
      const cand = ['textarea[placeholder*="message" i]', 'textarea[placeholder*="ask" i]', 'textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="text"]'];
      let inp = null; const deadline = Date.now() + 20000;
      while (Date.now() < deadline && !inp) { for (const sel of cand) { const loc = fl.locator(sel).first(); if (await loc.count().catch(() => 0)) { inp = loc; break; } } if (!inp) await page.waitForTimeout(500); }
      if (!inp) return;
      await inp.click({ timeout: 5000 }).catch(() => {});
      await inp.fill(text).catch(async () => { await inp.type(text, { delay: 15 }).catch(() => {}); });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      try { const still = await inp.inputValue().catch(() => ""); if (still && still.trim()) { const b = fl.locator('button[aria-label*="send" i], button[type="submit"], button:has-text("Send")').first(); if (await b.count()) await b.click({ timeout: 2000 }).catch(() => {}); } } catch {}
    },
  },

  // ---- NEW vendor harnesses (best-effort scaffolds; verify per widget) ----
  // Rep AI — loads via initRep(); widget usually in a rep.ai / hellorep iframe.
  // Rep AI — HEADED only. In real Chrome the #ads-agent-host shadow is reachable, so we
  // drive the composer there; the assistant REPLY is read at the network layer
  // (server.myrepai.com/web/events carries it in sm[].t). transport:"net".
  repai: {
    transport: "net",
    scope: { kind: "shadowId", sel: "#ads-agent-host" },
    net: {
      match: /server\.myrepai\.com\/web\/events/i,
      parse(body) {
        const out = [];
        try {
          const arr = JSON.parse(body);
          for (const el of (Array.isArray(arr) ? arr : [arr])) {
            const sm = el && el.sm;
            if (Array.isArray(sm)) for (const m of sm) { const t = typeof m === "string" ? m : (m && (m.t || m.text || m.message)); if (typeof t === "string" && t.trim()) out.push(t.trim()); }
          }
        } catch {}
        return out;
      },
    },
    async open(page) {
      await page.waitForTimeout(4000); await dismiss(page);
      await page.evaluate(() => { try { window.initRep && window.initRep(); } catch (e) {} }).catch(() => {});
      await page.waitForTimeout(1500);
      await shadowClickLauncher(page, "#ads-agent-host");
      await page.waitForTimeout(4000);
    },
    async send(page, text) { await shadowSend(page, "#ads-agent-host", text); },
  },
  rufus: {
    scope: { kind: "dom", sel: "#rufus-conversation-container-inner" },
    handover: [],   // Amazon's shopping AI never hands off to a human
    async open(page) {
      // Runner navigates with waitUntil:"commit" (page not loaded yet). Amazon is heavy, so
      // WAIT for the page + the Rufus launcher before clicking, then wait for the composer.
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForSelector('#nav-rufus-disco, input[placeholder*="specific info" i]', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await dismiss(page).catch(() => {});
      await page.locator('#nav-rufus-disco, input[placeholder*="specific info" i], button:has-text("Ask something else")').first().click({ timeout: 12000 }).catch(() => {});
      await page.waitForSelector('#rufus-text-area', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
    },
    async send(page, text) {
      const inp = page.locator("#rufus-text-area").first();
      await inp.click({ timeout: 6000 }).catch(() => {});
      await inp.fill(text).catch(async () => { await inp.type(text, { delay: 15 }); });
      await inp.press("Enter");
    },
  },
  // Kodif — kodif-chat-widget iframe.
  kodif: {
    scope: { kind: "frame", match: "kodif" },
    async open(page) {
      await page.waitForTimeout(4000); await dismiss(page);
      await page.evaluate(() => document.querySelector('#kodif-chat-widget, [id*="kodif" i], [class*="kodif" i]')?.click?.());
      const f = await findFrame(page, "kodif");
      if (f) { try { await f.locator('button, [role="button"]').first().click({ timeout: 2500 }); } catch (e) {} }
      await page.waitForTimeout(3500);
    },
    async send(page, text) {
      const f = await findFrame(page, "kodif"); if (!f) return;
      const i = f.locator('textarea, input[type="text"], [contenteditable="true"]').first();
      await i.click({ timeout: 5000 }).catch(() => {}); await i.fill(text).catch(async () => { await i.type(text).catch(() => {}); });
      await page.keyboard.press("Enter");
    },
  },
  // Humind — boostWidgetIntegration (FR). Widget tech TBD; best-effort.
  // Humind — HEADED only. Renders in an OPEN shadow on a <humind-gift-finder> or
  // <humind-widget> custom element; the assistant REPLY streams from api.thehumind.com/chat-service/chat/stream.
  // transport:"net" (timing = stream completion; text reconstructed from SSE data lines).
  humind: {
    transport: "net",
    scope: { kind: "shadowId", sel: "humind-gift-finder, humind-widget" },
    net: {
      match: /api\.thehumind\.com\/chat-service\/chat\/stream/i,
      parse(body) {
        const texts = [];
        for (const ln of String(body).split(/\r?\n/)) {
          const m = ln.match(/^data:\s*(.+)$/); if (!m) continue;
          const raw = m[1].trim(); if (!raw || raw === "[DONE]") continue;
          try { const j = JSON.parse(raw); const t = j.text ?? j.content ?? j.delta ?? j.message ?? (j.choices && j.choices[0] && (j.choices[0].delta?.content ?? j.choices[0].text)); if (typeof t === "string" && t) texts.push(t); }
          catch { texts.push(raw); }
        }
        const joined = texts.join("");
        return joined.trim() ? [joined.trim()] : [];
      },
    },
    async open(page) {
      await page.waitForTimeout(4000); await dismiss(page);
      await page.evaluate(() => (document.querySelector("humind-gift-finder, humind-widget, [class*='humind' i], [aria-label*='chat' i]"))?.click?.()).catch(() => {});
      await shadowClickLauncher(page, "humind-gift-finder, humind-widget");
      await page.waitForTimeout(4000);
    },
    async send(page, text) { await shadowSend(page, "humind-gift-finder, humind-widget", text); },
  },

  // --- Vendors added 2026-07-03 (from Roman's benchmark coverage) --------------
  // GENERIC best-effort driver: dismiss banners, click the most chat-like launcher,
  // then type into the most chat-like input + Enter. Selectors are broad on purpose —
  // these three widgets aren't yet reverse-engineered like the others, so a run either
  // drives them (great, we get data) or records an honest error (→ pending in the
  // report), never a fabricated number. Refine per-vendor once a run shows the DOM.
  google_agentic: {
    scope: { kind: "frame", match: /nordstrom|chat|assistant/i },
    // Google Agentic Commerce streams the reply as SSE on this endpoint (Roman's finding)
    // — kept for reference; DOM timing is the primary source until net-parse is wired.
    net: { match: /agenticapplications\.googleapis\.com\/v1\/sales:executeChat/i },
    async open(page) { await genericOpenChat(page); },
    async send(page, text) { await genericSendChat(page, text); },
  },
  klaviyo: {
    // K:AI Customer Agent — split HTTP POST + WebSocket, token-streaming (Roman).
    // NOTE: in cold, un-identified sessions the K:AI accepted messages but returned no
    // answer (likely login/identity-gated) — captured as engaged-but-unanswered.
    scope: { kind: "frame", match: /klaviyo|customer hub|chat|assistant/i },
    async open(page) { await genericOpenChat(page); },
    async send(page, text) {
      // Driver fix (probe 2026-07-16, happywax): genericSendChat grabs the FIRST
      // textarea/input on the page — on stores with a prominent site-search box
      // ("What are you looking for?") it typed the question into SEARCH and Enter
      // navigated away, closing the chat (0/19 burned). Target K:AI's own composer
      // first — its textarea is labeled "Ask a question" inside the #k-hub pane —
      // and only fall back to the generic picker if no K:AI composer exists.
      const composer = 'textarea[placeholder*="ask a question" i], textarea[aria-label*="ask a question" i]';
      for (const f of page.frames()) {
        try {
          const inp = f.locator(composer).first();
          if (await inp.count().catch(() => 0)) {
            await inp.click({ timeout: 3000 }).catch(() => {});
            await inp.fill(text).catch(async () => { await inp.type(text).catch(() => {}); });
            await inp.press("Enter").catch(() => {});
            return;
          }
        } catch {}
      }
      await genericSendChat(page, text);
    },
  },
  decagon: {
    // Decagon — enterprise AI support agent. Loader https://decagon.ai/loaders/<client>.js
    // injects #decagon-embed-container + a #decagon-iframe; opening toggles
    // html[data-decagon-open='true']. Composer + transcript live inside the iframe, so we
    // scope to the decagon frame and drive it with the generic open/send helpers.
    //
    // Some installs (away, confirmed 2026-07-15) render the launcher button INSIDE the
    // decagon-iframe itself (aria-label "Open Chat Agent"), not as a separate element on the
    // top-level page — genericOpenChat only scans the top-level document, so it silently finds
    // nothing to click and the iframe stays collapsed at its 100x100 launcher size (composer
    // never renders, every turn reads a permanently-empty transcript). Try the in-frame
    // launcher FIRST; fall back to genericOpenChat for installs where the launcher lives
    // outside (oura, curology, etc. — unaffected, still work as before).
    scope: { kind: "frame", match: /decagon/i },
    async open(page) {
      await dismiss(page);
      // run.js navigates with waitUntil:"commit" (returns as soon as navigation starts, well
      // before Decagon's loader script even runs) — a single un-retried findFrame() call here
      // almost always ran before the iframe existed at all, making the in-frame-launcher check
      // below silently false every time and falling through to the no-op genericOpenChat. Poll
      // for the frame to actually exist first (confirmed needed on away 2026-07-15).
      let f = null;
      for (let i = 0; i < 20 && !f; i++) { f = await findFrame(page, /decagon/i); if (!f) await page.waitForTimeout(500); }
      const inFrameLauncher = f ? f.locator('[aria-label="Open Chat Agent"], [aria-label*="chat" i][aria-label*="open" i]').first() : null;
      const hasInFrameLauncher = inFrameLauncher && (await inFrameLauncher.count().catch(() => 0));
      if (hasInFrameLauncher) {
        // Click INSIDE the frame and stop — don't also run genericOpenChat: its page-level
        // click can land on an unrelated element that re-toggles this same widget CLOSED
        // right after we opened it (same failure mode found + fixed for Intercom's redundant
        // double-open). The panel expands (100x100 -> 500x700) near-instantly, but the
        // composer itself takes several MORE seconds to render after that — a fixed 2-3s
        // sleep here consistently missed it (0 turns ever answered). Wait for the actual
        // composer instead of guessing a delay.
        await inFrameLauncher.click({ timeout: 5000 }).catch(() => {});
        await f.locator('textarea, [contenteditable="true"]').first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
        return;
      }
      await genericOpenChat(page);
    },
    async send(page, text) {
      // Scope explicitly to the decagon frame rather than genericSendChat's blind
      // multi-frame scan — same fix as Intercom's decoy-frame bug: on a real page (many
      // tracking-pixel iframes, unlike a bare debug script), some OTHER frame earlier in
      // page.frames() order can spuriously match `textarea`/`input[type=text]` first, so the
      // message never reaches Decagon's composer at all (0 turns answered, no error thrown).
      const f = await findFrame(page, /decagon/i);
      if (!f) { await genericSendChat(page, text); return; }
      // TWO COMPOSER-EATING STATES (probed live on oura support, 2026-07-16 — the widget
      // works fine for a human; the driver just didn't know these states):
      // 1) INLINE FORM: Finn answers some questions with a dropdown form ("What are you
      //    trying to track: Ring, …? Select one below *" + Select/Close/Submit) that
      //    REPLACES the composer. A human picks an option and continues; we do the same —
      //    choose the first real option, Submit, and wait for the composer to return.
      // 2) CLOSED CONVERSATION: off-topic messages make Finn close the thread ("This
      //    conversation has been closed" + a "Start a new chat" button, composer removed).
      //    Reopen and continue — a human would click it.
      // Both states previously made every remaining turn a silent no-op (lat=NULL).
      // The form can be MULTI-STEP (probed: Select-dropdown step, then an "Email *" identity
      // step). Handle up to 3 steps. DOM truths that cost a day to learn:
      //  - the dropdown options are plain BUTTONs (no role attr, no option class) in a
      //    `.z-50` portal at body level — the ONLY reliable click is getByRole('button',
      //    {name}) with the option's text read from the portal (CSS-path clicks select
      //    intermittently across runs; JS el.click() never selects);
      //  - `.chat-form-submit` (widget's own class) stays disabled until the field registers;
      //  - email identity steps reuse fillEmailGate + the reserved dummy identity.
      for (let step = 0; step < 3; step++) {
        if (await f.locator('textarea, [contenteditable="true"]').first().count().catch(() => 0)) break;
        const newChat = f.locator('button, [role="button"]').filter({ hasText: /start a new chat/i }).first();
        if (await newChat.count().catch(() => 0)) {
          await newChat.click({ timeout: 4000 }).catch(() => {});
          await f.locator('textarea, [contenteditable="true"]').first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
          continue;
        }
        if (!(await f.locator(".chat-form-submit").count().catch(() => 0))) break;
        const selBtn = f.getByRole("button", { name: /^select$/i }).first();
        if (await selBtn.count().catch(() => 0)) {
          await selBtn.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(900);
          const optName = await f.evaluate(() => {
            const b = document.querySelector(".z-50 .overflow-y-auto button, .z-50 button");
            return b ? (b.innerText || "").trim() : null;
          }).catch(() => null);
          if (optName) await f.getByRole("button", { name: optName, exact: true }).first().click({ timeout: 4000 }).catch(() => {});
        }
        await fillEmailGate(page, f).catch(() => {});
        const submit = f.locator(".chat-form-submit:not([disabled])").first();
        await submit.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
        await submit.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      await f.locator('textarea, [contenteditable="true"]').first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      const inp = f.locator('textarea, [contenteditable="true"]').first();
      if (await inp.count().catch(() => 0)) {
        await inp.click({ timeout: 5000 }).catch(() => {});
        await inp.fill(text).catch(async () => { await inp.type(text, { delay: 12 }).catch(() => {}); });
        await inp.press("Enter").catch(() => {});
        return;
      }
      await genericSendChat(page, text);
    },
  },
  intercom: {
    // Intercom Messenger + Fin AI Agent. Loader is `widget.intercom.io` / the
    // `intercom-lightweight-app` bundle; `window.Intercom('show')` opens the launcher
    // (`#intercom-container`), and the conversation renders in a same-origin, dynamically
    // created `iframe[name="intercom-messenger-frame"]`. IMPORTANT: the page also mounts an
    // unrelated, contentless `iframe#intercom-frame` (no `name`) that appears EARLIER in DOM
    // order — a bare `/intercom/i` scope match hits that decoy first (its `id` contains
    // "intercom") and reads an eternally-empty transcript. Scope must match only the
    // messenger frame's `name`. The composer is a `<textarea>` whose aria-label flips between
    // "Ask a question…" (empty thread) and "Message…" (thread started) — same element, so we
    // just target `textarea` scoped to this frame, never the generic multi-frame scanner
    // (which checks the top-level page and every other frame first and can grab an unrelated
    // page textarea/search box before ever reaching Intercom's).
    //
    // Some installs (ninety, public) open to a Help-Center-style "Home" space (Home/Messages/
    // Help tabs, a "Get a personalized demo" card, NO textarea) instead of straight into a Fin
    // conversation like avocado/kajabi/synthesia. Reading that Home screen's static text as the
    // transcript looks like an eternally-unanswered conversation. Detect the missing textarea
    // and click the entry card ("Ask a question" / "Send us a message" — copy varies per
    // install) to open a real conversation first.
    //
    // KNOWN STRUCTURAL WALLS (verified 2026-07-13, re-probed 2026-07-15 — not selector bugs;
    // do not re-attempt the same fix here):
    //  - tado: UPDATED 2026-07-15 — the messenger frame DOES boot now (earlier "never boots"
    //    was the consent banner; dismiss() handles it). But its Fin variant opens on a
    //    quick-reply-only qualification flow ("Yes" / "No, I have a different question") with
    //    the composer SUPPRESSED until a quick reply is chosen, and those buttons are inert in
    //    headless: JS click/full pointer sequence/focus()+Enter all no-op (focus refuses to
    //    take), same server/client gating family as ninety/public below. Composer never
    //    appears → 0 timed answers. Structural wall for the headless runner; revisit headed.
    //  - ninety, public: the click-through above DOES reach a real conversation (textarea
    //    present, realtime websockets to nexus-websocket-a.intercom.io + Ably connect fine),
    //    but the Send button's `disabled` never clears — confirmed with real native
    //    page.keyboard.type() keystrokes (not synthetic events), force-clicking the disabled
    //    button (no-op — React never binds an onClick while disabled), across headed AND
    //    headless. This is specific to composers opened via the Home "start a NEW conversation"
    //    card; avocado/kajabi/synthesia open straight into an existing/default thread and never
    //    hit it. Root cause is presumably server-side gating on new-conversation creation for a
    //    cookie-less/analytics-less visitor, not something reachable from the client. Left as
    //    `candidate: true` for a future revisit; the balancer's strike system retires these
    //    stores unattended rather than burning budget on them.
    scope: { kind: "frame", match: /intercom-messenger-frame/ },
    handover: [/connect you (with|to) (a|one of our)?\s*(teammate|human|agent|team member)/i,
               /I'?ll (get|find) (you )?a teammate/i, /pass(ing)? (this|you) (on|over) to/i,
               /a teammate will (reply|follow up|get back)/i],
    async open(page) {
      await dismiss(page);
      await page.waitForFunction(() => typeof window.Intercom !== "undefined", null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => { try { window.Intercom && window.Intercom("show"); } catch (e) {} }).catch(() => {});
      let f = null;
      for (let i = 0; i < 20 && !f; i++) { f = await findFrame(page, /intercom-messenger-frame/); if (!f) await page.waitForTimeout(500); }
      if (!f) return;
      // Re-check: cookie-consent scripts (HubSpot et al.) often inject their banner a couple
      // seconds AFTER initial load, missing the dismiss() call above; its overlay silently
      // eats every click into the widget beneath it even though fill()/press() (which act on
      // the element directly, no hit-testing) appear to succeed.
      await dismiss(page);
      for (let i = 0; i < 8 && !(await f.locator("textarea").count().catch(() => 0)); i++) {
        await f.evaluate(() => {
          // Match the innermost [role=button]/button/a — clicking the containing card DIV
          // (which has no handler of its own) never reaches a nested button's onClick, since
          // a click only bubbles UP from the element it's dispatched on, never back down into
          // descendants.
          const rx = /ask a question|send (us )?a message|start a conversation|chat (with|to) us|new (message|conversation)/i;
          const cands = [...document.querySelectorAll('[role="button"], button, a')].filter((e) => rx.test((e.innerText || "").trim().slice(0, 24)));
          const el = cands.sort((a, b) => a.innerText.length - b.innerText.length)[0];
          if (el) el.click();
        }).catch(() => {});
        await page.waitForTimeout(1000);
      }
      // Fin home-menu variant (2026-07-15, tado°/Fin-for-Ecommerce probe): when the card
      // click-through still leaves us on a Home/menu screen with NO composer, the official
      // JS API `Intercom("showNewMessage")` opens a real conversation view directly — far
      // more reliable than DOM-clicking entry cards whose copy/DOM varies per install.
      if (!(await f.locator('textarea, [contenteditable="true"]').count().catch(() => 0))) {
        await page.evaluate(() => { try { window.Intercom && window.Intercom("showNewMessage"); } catch (e) {} }).catch(() => {});
        await page.waitForTimeout(3000);
      }
      await f.locator('textarea, [contenteditable="true"]').first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
    },
    async send(page, text) {
      await dismiss(page);
      const f = await findFrame(page, /intercom-messenger-frame/);
      if (!f) return;
      // Newer Fin builds render the composer as a contenteditable div, not a <textarea>.
      const inp = f.locator('textarea, [contenteditable="true"]').first();
      await inp.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      await inp.click({ timeout: 5000 }).catch(() => {});
      await inp.fill(text).catch(async () => { await inp.type(text, { delay: 12 }).catch(() => {}); });
      await inp.press("Enter").catch(() => {});
    },
  },
  shopify_inbox: {
    // Native Shopify Inbox — gated (name/email) single-shot ticket form in most configs
    // (Roman): 1 canned "Automated" reply, then silent. Expected to fall to no_answer;
    // that IS the finding. Gate is filled with a dummy identity by fillEmailGate.
    scope: { kind: "frame", match: /shopify|chat|inbox|message/i },
    async open(page) { await genericOpenChat(page); },
    async send(page, text) { await genericSendChat(page, text); },
  },
  yuma: {
    // Yuma's OWN "Chat AI" widget (cracked 2026-07-03) — a standalone iframe
    // https://app.yuma.ai/w/<uuid> injected by js.yuma.ai/widget.js. NOT the Gorgias/
    // Zendesk widget those merchants also run: on dual-widget stores (Tediber) we target
    // iframe[src*="app.yuma.ai"] specifically, no network-blocking needed. The embed
    // SKIPS loading when navigator.webdriver===true (our STEALTH sets it undefined ⇒
    // passes) and lazy-loads on first user interaction (scroll/pointerdown/keydown) —
    // hence the synthetic mouse/scroll nudges below. Everything (launcher included)
    // renders INSIDE the iframe. Transport: HTTP polling (fetch api.yuma.ai) — DOM-timed.
    scope: { kind: "frame", match: "app.yuma.ai" },
    handover: [/un (de nos )?conseillers? (vous|va|reviendra)/i, /nous revenons vers vous/i,
               /transmis (à|a) (notre|l.)?\s*(équipe|support)/i],
    async open(page) {
      await dismiss(page);
      // fire the lazy-load gate (widget.js waits for scroll/pointerdown/keydown)
      await page.mouse.move(280, 320).catch(() => {});
      await page.mouse.wheel(0, 260).catch(() => {});
      await page.keyboard.press("Tab").catch(() => {});
      // wait for the app.yuma.ai iframe to mount
      for (let i = 0; i < 22 && !(await findFrame(page, "app.yuma.ai")); i++) await page.waitForTimeout(900);
      const f = await findFrame(page, "app.yuma.ai");
      if (!f) return;
      // launcher lives INSIDE the iframe
      const launcher = f.locator('[aria-label="Open chat widget"], .widgetTrigger').first();
      await launcher.click({ timeout: 8000 }).catch(() => {});
      // WAIT for the composer to actually exist before returning (verified selector:
      // textarea.chatPage__textarea, aria-label="Ask your question"). Some native Yuma
      // installs now gate cold chats on email first (e.g. Tumble Living), so fill the
      // pre-chat identity form with reserved dummy PII if it appears.
      const composer = f.locator('.chatPage__textarea, [aria-label="Ask your question"], textarea').first();
      for (let i = 0; i < 5 && !(await composer.isVisible().catch(() => false)); i++) {
        await fillEmailGate(page, f);
        await page.waitForTimeout(1000);
      }
      await composer.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
    async send(page, text) {
      const f = await findFrame(page, "app.yuma.ai");
      if (!f) return;
      const inp = f.locator('.chatPage__textarea, [aria-label="Ask your question"], textarea').first();
      if (!(await inp.isVisible().catch(() => false))) {
        await fillEmailGate(page, f);
        await inp.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      }
      await inp.click({ timeout: 6000 }).catch(() => {});
      await inp.fill(text).catch(async () => { await inp.type(text, { delay: 12 }).catch(() => {}); });
      await inp.press("Enter").catch(async () => {
        await f.locator('[aria-label="Send message"], .chatPage__submitBtn').first().click({ timeout: 3000 }).catch(() => {});
      });
    },
  },
};

// Generic launcher-open: dismiss consent, then click the most chat-like control.
async function genericOpenChat(page) {
  await dismiss(page);
  await page.waitForTimeout(2500);
  const clicked = await page.evaluate(() => {
    const rx = /chat|message|assistant|help|concierge|ask/i;
    const cands = [...document.querySelectorAll('button,[role="button"],a,div[class*="launch" i],div[class*="chat" i],[aria-label]')]
      .filter(el => rx.test(el.getAttribute("aria-label") || "") || rx.test(el.className || "") || rx.test(el.id || ""));
    const btn = cands.find(el => el.offsetParent !== null) || cands[0];
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);
  await page.waitForTimeout(4000);
  await fillAnyChatEmailGate(page).catch(() => {});
  return clicked;
}

// Generic send: find the most chat-like text input (in page or any iframe) + Enter.
async function genericSendChat(page, text) {
  await fillAnyChatEmailGate(page).catch(() => {});
  // try iframes first (widgets are usually cross-origin frames)
  for (const f of page.frames()) {
    try {
      const inp = f.locator('textarea, [contenteditable="true"], input[type="text"]:not([type="email"])').first();
      if (await inp.count().catch(() => 0)) {
        await inp.click({ timeout: 3000 }).catch(() => {});
        await inp.fill(text).catch(async () => { await inp.type(text).catch(() => {}); });
        await f.page().keyboard.press("Enter").catch(() => {});
        return;
      }
    } catch {}
  }
  // fall back to the main page
  try {
    const inp = page.locator('textarea, [contenteditable="true"], input[type="text"]:not([type="email"])').first();
    await inp.click({ timeout: 3000 }).catch(() => {});
    await inp.fill(text).catch(async () => { await inp.type(text).catch(() => {}); });
    await page.keyboard.press("Enter");
  } catch {}
}

// ---------------------------------------------------------------------------
// Stores under test — 2–3 per vendor. `candidate:true` = needs verification that
// the widget is live/drivable; the runner attempts it and records an error if not.
// ---------------------------------------------------------------------------
export const STORES = [
  // Gorgias (us) — Glamnetic intentionally excluded
  { key: "gorgias-madura",   vendor: "Gorgias", store: "Madura",        url: "https://www.madura.com/en",            widget: "gorgias", us: true, locale: "en-US", v3: true },  // pre_ga (Cortex)
  { key: "gorgias-jade",     vendor: "Gorgias", store: "Jade",          url: "https://shop.jadeofficial.com/",       widget: "gorgias", us: true, v3: false }, // NOT on V3 (Cortex: no v3 beta phase) — excluded from Shopping
  { key: "gorgias-jshealth", vendor: "Gorgias", store: "JSHealth Vitamins", url: "https://us.jshealthvitamins.com/", widget: "gorgias", us: true, v3: true }, // pre_ga (Cortex)
  { key: "gorgias-beekman",  vendor: "Gorgias", store: "Beekman 1802",  url: "https://beekman1802.com/",             widget: "gorgias", us: true, v3: true }, // beta_3_sa — V3 Shopping Assistant (Cortex)
  { key: "gorgias-shoebacca", vendor: "Gorgias", store: "Shoebacca",    url: "https://www.shoebacca.com/",           widget: "gorgias", us: true, v3: true }, // beta_1_support (Cortex)
  // High-volume V3 (beta_3_sa) stores sourced 2026-07-04 to widen sample coverage, same as the
  // Ada/Zendesk widening passes. Verified: live config.gorgias widget on Shopify.
  { key: "gorgias-icewatch",   vendor: "Gorgias", store: "Ice-Watch",   url: "https://www.ice-watch.com/",  widget: "gorgias", locale: "en-US", v3: true }, // beta_3_sa · SA success 82% @6.4k tickets (Cortex)
  { key: "gorgias-amicci",     vendor: "Gorgias", store: "Amicci",      url: "https://amicci.com/",         widget: "gorgias", locale: "en-GB", v3: true }, // beta_3_sa · 1.2k AI int (Cortex)
  { key: "gorgias-addisonbay", vendor: "Gorgias", store: "Addison Bay", url: "https://addisonbay.com/",     widget: "gorgias", us: true, locale: "en-US", v3: true }, // beta_3_sa (Cortex)
  // International Gorgias merchants added 2026-07-10 (Max) to densify the Gorgias sample so the
  // #1 position is robust. All verified: live config.gorgias widget on the storefront. `v3`
  // left unset (shopping included, but NOT asserting V3 SA architecture — confirm via Cortex
  // dim_accounts.v3_ai_agent_architecture_beta_phase and set v3:false if any is v2).
  { key: "gorgias-artdeco",   vendor: "Gorgias", store: "ARTDECO",          url: "https://www.artdeco.de/",          widget: "gorgias", locale: "de-DE" },
  { key: "gorgias-loonas",    vendor: "Gorgias", store: "Loonas",           url: "https://loonas.de/",               widget: "gorgias", locale: "de-DE" },
  { key: "gorgias-misanto",   vendor: "Gorgias", store: "Mi Santo Remedio", url: "https://misantoremedio.com/",      widget: "gorgias", locale: "es-ES" },
  { key: "gorgias-saigu",     vendor: "Gorgias", store: "Saigu Cosmetics",  url: "https://saigu.es/",                widget: "gorgias", locale: "es-ES" },
  { key: "gorgias-keysafe",   vendor: "Gorgias", store: "Keysafe",          url: "https://www.keysafe.co.uk/",       widget: "gorgias", locale: "en-GB" },
  { key: "gorgias-toyworld",  vendor: "Gorgias", store: "Toyworld",         url: "https://www.toyworld.com.au/",     widget: "gorgias", locale: "en-AU" },
  // Second batch added 2026-07-10 (Max). Gorgias widget verified in static HTML on all except
  // Blueroot (async-injected — not in static HTML; capture will confirm, else drop like NWA Hype).
  { key: "gorgias-americanmeadows", vendor: "Gorgias", store: "American Meadows", url: "https://www.americanmeadows.com/", widget: "gorgias", us: true, locale: "en-US" },
  { key: "gorgias-unfolded",  vendor: "Gorgias", store: "Unfolded",         url: "https://thisisunfolded.com/",      widget: "gorgias", locale: "en-GB" },
  { key: "gorgias-baiafood",  vendor: "Gorgias", store: "Baia Food",        url: "https://baiafood.com/",            widget: "gorgias", locale: "es-ES" },
  { key: "gorgias-blueroot",  vendor: "Gorgias", store: "Blueroot Health",  url: "https://blueroothealth.co/",       widget: "gorgias", locale: "en-GB" }, // widget not in static HTML — capture validates
  { key: "gorgias-masderm",   vendor: "Gorgias", store: "Masderm",          url: "https://masderm.com/",             widget: "gorgias", locale: "fr-FR" },
  // NWA Hype (nwahype.com) dropped: captured 9 conversations, 0 measurable (all —ms — widget never
  // produced a timed answer; unmeasurable like Klaviyo/Humind/Decagon), so no honest data to add.

  // Spiffy.ai
  { key: "spiffy-supergoop", vendor: "Envive", store: "Supergoop",  url: "https://supergoop.com/products/everyday-sunscreen?variant=31189086634082", widget: "spiffy" },
  // Amazon Rufus (shopping AI on the PDP). Logged-in-only → dummy-account session in
  // secrets/amazon-state.json; run HEADED. Bare /dp/<ASIN> URL (tracking params expire → 404).
  { key: "rufus-amazon", vendor: "Amazon Rufus", store: "Amazon.com", url: "https://www.amazon.com/dp/B0DX391LXK", widget: "rufus", modes: ["shopping"], stateFile: "secrets/amazon-state.json", loggedIn: true },
  { key: "spiffy-2",         vendor: "Spiffy.ai", store: "(2nd store)", url: "",                                widget: "spiffy", candidate: true, todo: "find a 2nd Spiffy.ai storefront" },

  // Sierra
  { key: "sierra-casper",   vendor: "Sierra", store: "Casper",         url: "https://casper.com/",              widget: "sierra" },
  { key: "sierra-sonos",    vendor: "Sierra", store: "Sonos",          url: "https://www.sonos.com/",           widget: "sierra", candidate: true },
  { key: "sierra-chubbies", vendor: "Sierra", store: "Chubbies",       url: "https://www.chubbiesshorts.com/", widget: "sierra", candidate: true },

  // Siena
  { key: "siena-simplemodern", vendor: "Siena", store: "Simple Modern", url: "https://www.simplemodern.com/products/mesa-loop-30oz-49", widget: "siena" },
  { key: "siena-figs",         vendor: "Siena", store: "FIGS",          url: "https://www.wearfigs.com/pages/men-home", widget: "siena" },
  { key: "siena-jonesroad",    wall: true, vendor: "Siena", store: "Jones Road",    url: "https://www.jonesroadbeauty.com/", widget: "siena", candidate: true },

  // Yuma (runs behind a helpdesk; 2nd drivable store TBD)
  { key: "yuma-evryjewels", vendor: "Yuma", store: "EvryJewels",       url: "https://evryjewels.com/",          widget: "yuma" }, // PURE Yuma store (no Gorgias) — widget uuid 1c068af4; bot-guard defeated by STEALTH webdriver=undefined

  // DigitalGenius
  { key: "dg-bloomwild", vendor: "DigitalGenius", store: "Bloom & Wild", url: "https://www.bloomandwild.com/",  widget: "dg", candidate: true, personas: ["Willow"] }, // "Willow" = the bot's sender label, not a human
  { key: "dg-gstar",     vendor: "DigitalGenius", store: "G-Star RAW",   url: "https://www.g-star.com/en_us",    widget: "dg", candidate: true },
  // on.com — NOT DigitalGenius on-site (verified 2026-07-01); removed from DG list.

  // Zendesk AI agent (messaging Virtual Assistant) — corrected from mislabel "Meta AI" 2026-07-14
  { key: "meta-dermalogica", vendor: "Zendesk", store: "Dermalogica",   url: "https://www.dermalogica.com/",    widget: "zendesk" },
  { key: "meta-2",           vendor: "Zendesk", store: "(2nd store)",   url: "",                                widget: "zendesk", candidate: true, todo: "find a 2nd Zendesk AI storefront" },

  // Ada
  { key: "ada-loop", vendor: "Ada", store: "Loop Earplugs",            url: "https://www.loopearplugs.com/",    widget: "ada" },
  { key: "ada-2",    vendor: "Ada", store: "(2nd store)",             url: "",                                 widget: "ada", candidate: true, todo: "find a 2nd Ada retail storefront" },

  // ---- Added on request (refresh). Detected chat tech in comments. ----
  { key: "sierra-scotts",  vendor: "Sierra",  store: "Scotts Miracle-Gro", url: "https://scottsmiraclegro.com/", widget: "sierra" },
  { key: "yuma-tediber",   vendor: "Yuma",    store: "Tediber",            url: "https://www.tediber.com/",      widget: "yuma", locale: "fr-FR" }, // DUAL-widget store: Gorgias + Yuma-native (app.yuma.ai/w/8ea15f6c) — we target the Yuma iframe (Roman measured ~18.9s here)
  // Sourced from Gorgias backend (dim_integrations app 'Yuma AI' = active) 2026-07-07, then verified to carry the
  // NATIVE yuma-widget on-page (same dual pattern as Tediber). The Yuma handler targets the app.yuma.ai iframe, so
  // if only the Gorgias widget is live these yield no data & drop out — no Gorgias-as-Yuma mis-attribution.
  { key: "yuma-rouje",     vendor: "Yuma",    store: "Rouje",              url: "https://www.rouje.com/",        widget: "yuma", locale: "fr-FR" }, // native yuma-widget + Gorgias
  { key: "yuma-ledomaine", vendor: "Yuma",    store: "Le Domaine",         url: "https://le-domaine.com/",       widget: "yuma", locale: "fr-FR" }, // native yuma-widget + Gorgias
  // Atma: DUAL-widget, but Yuma's own iframe stays 1×1 (its config has forceSingleChatWidget:true —
  // Yuma defers to Gorgias Chat and answers INSIDE it, replies tagged "Automatisé"). So unlike
  // Rouje/Le Domaine above, the Gorgias shell IS the Yuma surface here — attribution verified by
  // probe 2026-07-07: js.yuma.ai widget.js loaded w/ salesAi, and a substantive Yuma product answer
  // (~40s) landed in the Gorgias thread after the in-chat email gate ("Communiquez-nous votre
  // adresse e-mail") was satisfied. Gate handling lives in gorgias.send() → fillEmailGate.
  // personas: Yuma's AI replies under a human first name ("Lucas says:") — exclude it from the
  // named-human handover heuristic (verified automated: answers ~40s post-email-gate, salesAi on).
  { key: "yuma-atma",      vendor: "Yuma",    store: "Atma Kitchenware",   url: "https://atmakitchenware.fr/",   widget: "gorgias", locale: "fr-FR", personas: ["Lucas"] },
  // Sourced 2026-07-16 from Gorgias's own product telemetry (dim_tickets joined to
  // dim_accounts via the agent-email `%yuma%` pattern used by the internal "Gorgias vs
  // Competitors Automation Rate Proxy" Metabase card, #14455) — ground truth on which real
  // merchants use Yuma, not a guess. Confirmed these 3 run Yuma answers BEHIND the Gorgias
  // widget (window.GorgiasChat present, no standalone app.yuma.ai script) — same pattern as
  // yuma-atma above, not the native-widget pattern most other yuma-* stores use.
  { key: "yuma-mfimedical", vendor: "Yuma", store: "MFI Medical",    url: "https://mfimedical.com/",       widget: "gorgias", us: true }, // 54k tickets/45d (Gorgias telemetry)
  { key: "yuma-glossier",   vendor: "Yuma", store: "Glossier",       url: "https://www.glossier.com/",     widget: "gorgias", us: true }, // 22k tickets/45d
  { key: "yuma-planttherapy", vendor: "Yuma", store: "Plant Therapy", url: "https://www.planttherapy.com/", widget: "gorgias", us: true }, // 8k tickets/45d
  { key: "envive-kut",     vendor: "Envive",  store: "Kut from the Kloth", url: "https://www.kutfromthekloth.com/", widget: "gorgias" }, // chat shell is Gorgias
  { key: "repai-fresh",    vendor: "Rep AI",  store: "Fresh Roasted Coffee", url: "https://www.freshroastedcoffee.com/", widget: "repai", candidate: true },
  { key: "kodif-dsc",      vendor: "Kodif",   store: "Dollar Shave Club",  url: "https://us.dollarshaveclub.com/", widget: "kodif", candidate: true },
  { key: "humind-chaiselongue", vendor: "Humind", store: "La Chaise Longue", url: "https://www.lachaiselongue.fr/", widget: "humind", candidate: true, locale: "fr-FR" },
  // Nordstrom — Google Agentic: SKIPPED (redirects to siteclosed.nordstrom.com; not accessible to us).

  // ===== Expanded verified storefronts (2026-07-01 sourcing campaign) =====
  // Spiffy = Envive (same company; on-site shopping assistant). widget=spiffy.
  { key: "envive-bandolier",  vendor: "Envive", store: "Bandolier",   url: "https://bandolierstyle.com/", widget: "spiffy" },
  { key: "envive-tushbaby",   vendor: "Envive", store: "Tushbaby",    url: "https://tushbaby.com/",       widget: "spiffy" },
  { key: "envive-greenpan",   vendor: "Envive", store: "GreenPan",    url: "https://www.greenpan.us/",    widget: "spiffy" },
  { key: "envive-fracture",   vendor: "Envive", store: "Fracture",    url: "https://fractureme.com/",     widget: "spiffy" }, // verified envive-injection on fractureme.com (2026-07-07)
  { key: "mavenoid-nanit",    vendor: "Mavenoid", store: "Nanit",     url: "https://nanit.com/",          widget: "mavenoid" }, // 2026-07-13: nanit's answering support widget is Mavenoid (decision-tree troubleshooting), not Envive — re-attributed. (An Envive shopping embed also loads, but Mavenoid is what serves support.)
  // Sierra (widget loads from sierra.chat; sierraConfig global)
  { key: "sierra-bark",       vendor: "Sierra", store: "BARK",        url: "https://bark.co/",            widget: "sierra" },
  { key: "sierra-sunandski",  vendor: "Sierra", store: "Sun & Ski",   url: "https://www.sunandski.com/",  widget: "sierra" },
  { key: "sierra-madisonreed",vendor: "Sierra", store: "Madison Reed",url: "https://www.madison-reed.com/", widget: "sierra" },
  { key: "sierra-aloyoga",    vendor: "Sierra", store: "Alo Yoga",    url: "https://www.aloyoga.com/",    widget: "sierra" }, // confirmed 2026-07-03: enable_sierra_ai_chat + sierra_enable_customer_token (Gladly = underlying contact form)
  // ---- sourcing pass 2026-07-03 (all signature-verified via curl by research agent) ----
  { key: "sierra-thirdlove",  vendor: "Sierra", store: "ThirdLove",   url: "https://www.thirdlove.com/",  widget: "sierra" },          // sierra.chat + sierraConfig
  { key: "spiffy-carbahn",    vendor: "Envive", store: "CarBahn",     url: "https://carbahn.com/",        widget: "spiffy" },          // cdn.spiffy
  { key: "siena-superfoods",  vendor: "Siena",  store: "Superfoods Company", url: "https://superfoodscompany.com/", widget: "siena" }, // siena.cx
  { key: "ada-simba",         wall: true, vendor: "Ada",    store: "Simba Sleep", url: "https://simbasleep.com/",     widget: "ada", locale: "en-GB" }, // static.ada.support + adaEmbed
  { key: "dg-organicbasics",  vendor: "DigitalGenius", store: "Organic Basics", url: "https://organicbasics.com/",     widget: "dg" },                    // digitalgenius.com
  { key: "dg-clubllondon",    vendor: "DigitalGenius", store: "Club L London",  url: "https://www.clubllondon.com/",   widget: "dg", locale: "en-GB" },   // digitalgenius.com
  { key: "dg-abbottlyon",     vendor: "DigitalGenius", store: "Abbott Lyon",    url: "https://www.abbottlyon.com/",    widget: "dg", locale: "en-GB" },   // digitalgenius.com
  { key: "repai-masteringthemix", vendor: "Rep AI", store: "Mastering The Mix", url: "https://www.masteringthemix.com/", widget: "repai", locale: "en-GB" }, // initRep
  { key: "gorgias-tommyjohn", vendor: "Gorgias", store: "Tommy John",   url: "https://www.tommyjohn.com/",  widget: "gorgias", us: true, v3: false }, // config.gorgias — NOT on V3 (Cortex: v3 phase null, SA never enabled) → excluded from Shopping
  { key: "gorgias-pepper",    vendor: "Gorgias", store: "Pepper",       url: "https://www.wearpepper.com/", widget: "gorgias", us: true, v3: true }, // config.gorgias + gorgias-chat — V3 (Cortex: beta_2_actions)
  { key: "gorgias-drbronner", vendor: "Gorgias", store: "Dr. Bronner's",url: "https://www.drbronner.com/",  widget: "gorgias", us: true, v3: false }, // config.gorgias — NOT on V3 (Cortex: v3 phase null; runs legacy/V2 Shopping Assistant) → excluded from Shopping
  { key: "gorgias-glamnetic", vendor: "Gorgias", store: "Glamnetic",    url: "https://www.glamnetic.com/",  widget: "gorgias", us: true, modes: ["support"] }, // config.gorgias — SUPPORT ONLY per Max (not Shopping Assistant)
  { key: "meta-butcherbox",   vendor: "Zendesk", store: "ButcherBox",   url: "https://www.butcherbox.com/", widget: "zendesk" },           // static.zdassets
  // Siena (chat.siena.cx webchat)
  { key: "siena-mudwtr",      vendor: "Siena",  store: "MUD\\WTR",    url: "https://mudwtr.com/",         widget: "siena" },
  // Sourced 2026-07-16 via StoreLeads (f:tech=Siena, f:p=shopify, f:ds=Active — 45 total).
  // Signature-verified live for all 3 on a cold page load (window.Siena / SienaLaunchChat +
  // siena script in page source under STEALTH), but only Portland Leather Goods actually
  // produced replies end-to-end (2/2 timed themes). Brooklinen and Dandelion Chocolate both
  // returned empty replies across every turn despite the widget being present — a repeat
  // debug pass on Brooklinen found the launcher script present but no siena iframe ever
  // mounted (inconsistent with the earlier signature check minutes prior — may be a
  // load-order/A-B-test flake rather than a stable driver bug). Left `candidate: true`
  // rather than chased further; do not re-attempt without new evidence.
  { key: "siena-brooklinen", candidate: true, vendor: "Siena", store: "Brooklinen",            url: "https://www.brooklinen.com/", widget: "siena" }, // bedding DTC, Shopify Plus, $1.5B/mo est. (Storeleads) — 0/2 valid, empty replies
  { key: "siena-plg",         vendor: "Siena", store: "Portland Leather Goods", url: "https://www.portlandleathergoods.com/", widget: "siena" }, // leather goods DTC, Shopify Plus, $842M/mo est. (Storeleads) — confirmed 2/2 valid
  { key: "siena-dandelion", candidate: true, vendor: "Siena", store: "Dandelion Chocolate",   url: "https://www.dandelionchocolate.com/", widget: "siena" }, // chocolate DTC, Shopify Plus, $193M/mo est. (Storeleads) — 0/2 valid, empty replies
  // Sourced 2026-07-16, second StoreLeads pass (f:tech=Siena, f:p=shopify, f:ds=Active — 45
  // total). Live-verified (window.SienaLaunchChat present): Heirloom Roses. Everydaydose,
  // Live Momentous, Canopy, Bare Performance Nutrition all checked live and do NOT have
  // Siena mounted despite matching the StoreLeads query — not registered.
  { key: "siena-heirloomroses", vendor: "Siena", store: "Heirloom Roses", url: "https://heirloomroses.com/", widget: "siena" }, // garden/roses DTC, Shopify Plus, $609M/mo est. (Storeleads)
  // Sourced 2026-07-16 from Gorgias's own product telemetry (same Metabase-card-14455 query
  // as yuma-mfimedical above, agent-email `%siena.cx%` pattern, msg.via='api'). bboutique.co
  // confirmed live (window.SienaLaunchChat present); several higher-ticket-volume Siena
  // accounts from the same list (earthbreeze 90k tickets/45d, mellowsleep, comfrt, eskiin,
  // madhappy) showed NO live chat widget on a cold check — their Siena usage there is likely
  // email-channel only (the telemetry counts both channels; only chat has an on-site widget
  // to capture), not a driver bug. Not registered.
  { key: "siena-bboutique", vendor: "Siena", store: "B Boutique", url: "https://bboutique.co/", widget: "siena" }, // 51k tickets/45d (Gorgias telemetry)
  // Yuma (runs behind Gorgias helpdesk → drive the Gorgias widget)
  // Zendesk AI — messaging widgets re-verified 2026-07-05 via ekr.zdassets.com/compose/<key>
  // (a `messenger` product block = live conversational widget, not a help-center form).
  { key: "meta-cottonon", wall: true,     vendor: "Zendesk",store: "Cotton On",   url: "https://cottonon.com/US/",    widget: "zendesk" }, // verified messenger. NOTE: Cotton On Group runs ONE deployment across cottonon/typo/factorie/supre — correlated, not independent samples.
  // quip (getquip.com) DROPPED 2026-07-05: dual-vendor page — Zendesk messenger AND a live Gorgias
  // chat install are both wired; ambiguous which widget a shopper gets, so its data can't be
  // attributed to a single vendor. Prior captures excluded from Zendesk aggregates via drop list.
  // Ada (often loads on the help/support page, not the homepage)
  { key: "ada-endy",          vendor: "Ada",    store: "Endy",        url: "https://www.endy.com/",       widget: "ada" },
  { key: "ada-ipsy",          vendor: "Ada",    store: "IPSY",        url: "https://help.ipsy.com/",      widget: "ada" },
  { key: "ada-yeti",          vendor: "Ada",    store: "YETI",        url: "https://www.yeti.com/",       widget: "ada" },
  { key: "ada-indigo",        vendor: "Ada",    store: "Indigo",      url: "https://www.indigo.ca/",      widget: "ada" },
  // top-ups to reach ≥5 sourced sites/vendor (most DG widgets lazy-load → may need headed)
  // Snipes / Beauty Pie — no DigitalGenius on-site widget (verified); DG on-site footprint = Bloom & Wild + G-Star only.
  // meta-motelrocks DROPPED 2026-07-05: help-center only — no live ekr snippet (legacy 2021 theme asset 404s); no drivable chat.
  { key: "yuma-cabaia",       vendor: "Yuma",   store: "CABAIA",      url: "https://cabaia.com/",         widget: "yuma" }, // Yuma-native (app.yuma.ai/w/26d426e8); Zendesk = email tickets only
  // MESHKI — the only OTHER Yuma-native brand found (2026-07-03); 3 regional instances with DISTINCT
  // widget UUIDs (meshki.us shares meshki.com's UUID → skipped as redundant). Pushes Yuma to 6 stores.
  { key: "yuma-meshki",       vendor: "Yuma",   store: "MESHKI",      url: "https://meshki.com/",         widget: "yuma", locale: "en-AU" }, // app.yuma.ai/w/4f7a9401
  { key: "yuma-meshki-au",    vendor: "Yuma",   store: "MESHKI AU",   url: "https://meshki.com.au/",      widget: "yuma", locale: "en-AU" }, // app.yuma.ai/w/df03b930
  { key: "yuma-meshki-uk",    vendor: "Yuma",   store: "MESHKI UK",   url: "https://meshki.co.uk/",       widget: "yuma", locale: "en-GB" }, // app.yuma.ai/w/5d646ace
  // yuma-bombayhair removed 2026-07-06 — no live AI agent / on-site chat on this store (verified, Max)
  // yuma-tumble RESTORED 2026-07-07 — the 07-06 removal ("email-gated") predates the email-gate fix;
  // today's run: 9/10 valid with real timed answers (16-31s). Without a roster entry gen.js silently
  // drops the store's committed convs from the report.
  { key: "yuma-tumble",       vendor: "Yuma",   store: "Tumble",       url: "https://www.tumbleliving.com/",   widget: "yuma" },              // US home/rugs · app.yuma.ai/w/fbb8eeda

  // Amazon Rufus ("Alexa" shopping assistant on amazon.com) — INVESTIGATED 2026-07-07, NOT capturable:
  // cold guest sessions (US zip set, no bot-wall) expose NO Rufus entry point on home or search —
  // only a hidden 1x1 test div (nav-rufus-disc-txt). Rufus + Alexa+ web are gated behind an Amazon
  // account login, which breaks the benchmark's cold-session methodology. Revisit if Amazon opens
  // it to guests; a logged-in capture would need an explicit methodology exception (shopping-only,
  // modes:["shopping"]).
  // Headed-only vendors (widget loads only in real Chrome). candidate=excluded from headless runs.
  { key: "humind-900care",    vendor: "Humind", store: "900.care",    url: "https://www.900.care/",       widget: "humind", candidate: true, locale: "fr-FR" },
  { key: "humind-puressentiel",vendor:"Humind", store: "Puressentiel",url: "https://fr.puressentiel.com/",widget: "humind", candidate: true, locale: "fr-FR" },
  { key: "humind-yumi",       vendor: "Humind", store: "Yumi",        url: "https://www.yumi.fr/",        widget: "humind", candidate: true, locale: "fr-FR" },
  { key: "humind-stormrock",  vendor: "Humind", store: "Stormrock",   url: "https://stormrock.fr/",       widget: "humind", candidate: true, locale: "fr-FR" },
  { key: "humind-weedy",      vendor: "Humind", store: "Weedy",       url: "https://weedy.fr/",           widget: "humind", candidate: true, locale: "fr-FR" }, // signature-verified: humind
  { key: "humind-solsemilla", vendor: "Humind", store: "Sol Semilla", url: "https://sol-semilla.fr/",     widget: "humind", candidate: true, locale: "fr-FR" }, // signature-verified: humind
  { key: "humind-supersmart", vendor: "Humind", store: "SuperSmart",  url: "https://www.supersmart.com/en", widget: "humind", candidate: true, locale: "en-GB" }, // widgets.thehumind.com + humind-widget
  { key: "humind-cbdfr",      vendor: "Humind", store: "CBD.fr",      url: "https://cbd.fr/",             widget: "humind", candidate: true, locale: "fr-FR" }, // embed.thehumind.com + humind-widget
  { key: "humind-hemphash",   vendor: "Humind", store: "Hemphash",    url: "https://hemphash.co.uk/",     widget: "humind", candidate: true, locale: "en-GB" }, // humind-gift-finder + humind-widget
  // NOTE: lamaisonconvertible.fr requested for Humind but is actually iAdvize (no humind signature) — skipped to avoid mislabeling.
  // Rep AI — headed-only (concierge injects ~12-15s after load). candidate=excluded from headless runs.
  { key: "repai-olly",        vendor: "Rep AI", store: "OLLY",            url: "https://www.olly.com/",          widget: "repai", candidate: true },
  { key: "repai-higherdose",  vendor: "Rep AI", store: "HigherDOSE",      url: "https://higherdose.com/",        widget: "repai", candidate: true },
  { key: "repai-nutrabio",    vendor: "Rep AI", store: "NutraBio",        url: "https://nutrabio.com/",          widget: "repai", candidate: true },
  { key: "repai-satya",       vendor: "Rep AI", store: "Satya Jewelry",   url: "https://www.satyajewelry.com/",  widget: "repai", candidate: true },
  { key: "repai-bikesonline", vendor: "Rep AI", store: "BikesOnline",     url: "https://bikesonline.com/",       widget: "repai" }, // verified rep-connector chat-embed.js on bikesonline.com (2026-07-07)
  { key: "repai-kinn",        vendor: "Rep AI", store: "Kinn Studio",     url: "https://kinnstudio.com/",        widget: "repai", candidate: true },
  { key: "repai-cwspirits",   vendor: "Rep AI", store: "Country Wine & Spirits", url: "https://cwspirits.com/",  widget: "repai", candidate: true },
  // Kodif — headed-only (kodif-chat-widget iframe). DSC + JustFoodForDogs + Neuro independent; Babyletto/daVinci/Namesake share one parent (Million Dollar Baby Co.).
  { key: "kodif-jffd",        vendor: "Kodif",  store: "JustFoodForDogs", url: "https://www.justfoodfordogs.com/", widget: "kodif", candidate: true },
  { key: "kodif-neuro",       vendor: "Kodif",  store: "Neuro",           url: "https://neurogum.com/",          widget: "kodif", candidate: true },
  { key: "kodif-babyletto",   vendor: "Kodif",  store: "Babyletto",       url: "https://babyletto.com/",         widget: "kodif", candidate: true },
  { key: "kodif-davinci",     vendor: "Kodif",  store: "daVinci Baby",    url: "https://davincibaby.com/",       widget: "kodif", candidate: true },
  { key: "kodif-namesake",    vendor: "Kodif",  store: "Namesake",        url: "https://namesakehome.com/",      widget: "kodif", candidate: true },

  // ===== Vendors added 2026-07-03 (Roman's coverage; merchants he verified) =====
  // All candidate:true — generic driver, not yet reverse-engineered; a run either
  // captures them or records an honest error. See notes/roman-benchmark-comparison.md.
  // Google Agentic Commerce (Nordstrom's in-house stack; the strategic new entrant).
  { key: "google-nordstrom",  vendor: "Google Agentic", store: "Nordstrom", url: "https://www.nordstrom.com/", widget: "google_agentic", candidate: true },
  // Klaviyo K:AI Customer Agent — merchants Roman confirmed live (cards + add-to-cart on nanuk/naked).
  { key: "klaviyo-nanuk",     vendor: "Klaviyo", store: "NANUK",           url: "https://nanuk.com/",             widget: "klaviyo", candidate: true },
  { key: "klaviyo-naked",     vendor: "Klaviyo", store: "Naked Wardrobe",  url: "https://www.nakedwardrobe.com/", widget: "klaviyo", candidate: true },
  { key: "klaviyo-happywax",  vendor: "Klaviyo", store: "HappyWax",        url: "https://happywax.com/",          widget: "klaviyo", candidate: true },
  { key: "klaviyo-harney",    vendor: "Klaviyo", store: "Harney & Sons",   url: "https://www.harney.com/",        widget: "klaviyo", candidate: true }, // signature-verified: klaviyo-onsite
  // Klaviyo public case study says K9 Ballistics adopted Customer Hub + K:AI Customer Agent across
  // both brand sites; raw served HTML verifies customer-hub-data + window.customerHub. Both also carry
  // a Gorgias live-chat block, so keep them candidate:true until a focused Klaviyo run confirms routing.
  { key: "klaviyo-k9ballistics", vendor: "Klaviyo", store: "K9 Ballistics", url: "https://k9ballistics.com/",       widget: "klaviyo", candidate: true },
  { key: "klaviyo-onefastcat",   vendor: "Klaviyo", store: "One Fast Cat",  url: "https://onefastcat.com/",        widget: "klaviyo", candidate: true },
  // Shopify Inbox (native) — expected gated/single-shot ticket form (Roman); the finding IS the result.
  { key: "shopify-schott",    vendor: "Shopify Inbox", store: "Schott NYC", url: "https://www.schottnyc.com/",    widget: "shopify_inbox", candidate: true },
  { key: "shopify-jnco",      vendor: "Shopify Inbox", store: "JNCO",       url: "https://www.jnco.com/",          widget: "shopify_inbox", candidate: true },
  // Native Shopify Inbox app block in raw served HTML (`shopify://apps/inbox/blocks/chat` +
  // shopify-chat-bundle-selector / inbox-chat-loader). Added to lift Shopify Inbox above the
  // >=5-store floor; all are independent storefronts.
  { key: "shopify-bluebohemian", vendor: "Shopify Inbox", store: "Blue Bohemian", url: "https://bluebohemian.com/", widget: "shopify_inbox", candidate: true },
  { key: "shopify-swimcore",     vendor: "Shopify Inbox", store: "Swimcore",      url: "https://www.swimcore.com/en-fr/products/active-yoga-toes-spreaders-durable-therapeutic-toe-separators", widget: "shopify_inbox", candidate: true },
  { key: "shopify-thegivenget",  vendor: "Shopify Inbox", store: "The Given Get", url: "https://thegivenget.com/", widget: "shopify_inbox", candidate: true },
  { key: "shopify-globosyfiesta",vendor: "Shopify Inbox", store: "Globos y Fiesta", url: "https://globosyfiesta.mx/", widget: "shopify_inbox", candidate: true, locale: "es-MX" },
  // ---- sourcing pass 2 (2026-07-03) — signature-verified, to raise statistical significance ----
  { key: "spiffy-clove",      vendor: "Envive", store: "Clove",         url: "https://goclove.com/",            widget: "spiffy" },          // cdn.spiffy.ai (2026-07-07: verified served-HTML signature on goclove.com, not clovebrand.com)
  { key: "repai-gosun",       vendor: "Rep AI", store: "GoSun",         url: "https://gosun.co/",               widget: "repai" },           // hellorep-lazyload.js (verified 2026-07-07)
  { key: "spiffy-fur",        vendor: "Envive", store: "Fur",           url: "https://www.furyou.com/",         widget: "spiffy" },          // cdn.spiffy.ai
  { key: "dg-kukoon",         vendor: "DigitalGenius", store: "Kukoon", url: "https://kukoon.com/",             widget: "dg", locale: "en-GB" }, // chat.digitalgenius.com
  { key: "dg-blakely",        vendor: "DigitalGenius", store: "Blakely Clothing", url: "https://www.blakelyclothing.com/", widget: "dg", locale: "en-GB" }, // chat.digitalgenius.com/init.js (verified 2026-07-07)
  { key: "dg-drift", ecommerce: false,          vendor: "DigitalGenius", store: "Drift", url: "https://drift.co/",                widget: "dg" }, // DG_CHAT_WIDGET_CONFIG + chat.digitalgenius.com/init.js
  // Cotton On Group siblings (typo/factorie/supre + cottonon) share ONE Zendesk deployment — correlated
  // samples, not independent stores; keep for coverage but read as one deployment family.
  { key: "meta-typo", wall: true,         vendor: "Zendesk", store: "Typo",         url: "",        widget: "zendesk", locale: "en-AU" }, // verified messenger (ekr compose)
  { key: "meta-factorie", wall: true,     vendor: "Zendesk", store: "Factorie",     url: "https://www.factorie.com.au/",    widget: "zendesk", locale: "en-AU" }, // verified messenger
  { key: "meta-supre", wall: true,        vendor: "Zendesk", store: "Supre",        url: "https://www.supre.com.au/",       widget: "zendesk", locale: "en-AU" }, // verified messenger
  { key: "meta-puma",         vendor: "Zendesk", store: "PUMA",         url: "https://us.puma.com/",            widget: "zendesk" }, // verified messenger
  { key: "meta-publicrec",    vendor: "Zendesk", store: "Public Rec",   url: "https://publicrec.com/",          widget: "zendesk" }, // verified messenger (Intercom strings on page are inert data, no loader)
  // meta-saatva DROPPED 2026-07-05: no chat-vendor snippet in served HTML (help-center links only) — not drivable headlessly.
  // NEW verified Zendesk-messenger retail storefronts (2026-07-05; ekr compose = messenger + endUserConversations):
  { key: "meta-generalpants", vendor: "Zendesk", store: "General Pants",   url: "https://www.generalpants.com/",     widget: "zendesk", locale: "en-AU" },
  { key: "meta-universalstore", vendor: "Zendesk", store: "Universal Store", url: "https://www.universalstore.com/", widget: "zendesk", locale: "en-AU" },
  { key: "meta-barkers",      vendor: "Zendesk", store: "Barkers",         url: "https://www.barkersonline.co.nz/",  widget: "zendesk", locale: "en-NZ" },
  { key: "meta-camilla",      vendor: "Zendesk", store: "CAMILLA",         url: "https://camilla.com/",              widget: "zendesk", locale: "en-AU" },
  { key: "meta-sealy",        vendor: "Zendesk", store: "Sealy",           url: "https://www.sealy.com/",            widget: "zendesk", us: true },
  { key: "meta-tempurpedic",  vendor: "Zendesk", store: "Tempur-Pedic",    url: "https://www.tempurpedic.com/",      widget: "zendesk", us: true },
  { key: "meta-horizn",       vendor: "Zendesk", store: "Horizn Studios",  url: "https://www.horizn-studios.com/",   widget: "zendesk", locale: "en-GB" },
  { key: "meta-nomnom",       vendor: "Zendesk", store: "NomNom",          url: "https://www.nomnomnow.com/",        widget: "zendesk", us: true },
  { key: "meta-hyperice",     vendor: "Zendesk", store: "Hyperice",        url: "https://www.hyperice.com/",         widget: "zendesk", us: true },
  { key: "meta-blundstone",   vendor: "Zendesk", store: "Blundstone",      url: "https://www.blundstone.com/",       widget: "zendesk", us: true },
  { key: "meta-next",         vendor: "Zendesk", store: "NEXT",            url: "https://www.next.co.uk/help",       widget: "zendesk", locale: "en-GB" }, // widget loads on /help route
  { key: "meta-petbarn",      vendor: "Zendesk", store: "Petbarn",         url: "https://www.petbarn.com.au/",       widget: "zendesk", locale: "en-AU" },
  // New Zendesk-AI e-commerce storefronts sourced 2026-07-16 (web research; Cortex/Storeleads
  // parked). NOBULL/Papier/New Look/Motel Rocks have PUBLISHED Zendesk AI-agent case studies;
  // Body Shop/Gousto have the zdassets messaging widget live but AI-agent unconfirmed.
  // candidate:true — capture self-filters any that only run human chat / a basic Answer Bot.
  { key: "zendesk-nobull",     vendor: "Zendesk", store: "NOBULL",        url: "https://www.nobullproject.com/",  widget: "zendesk", us: true, candidate: true }, // zdassets + zE + ekr/snippet; case study ~50% AI resolution
  { key: "zendesk-papier",     vendor: "Zendesk", store: "Papier",        url: "https://www.papier.com/",         widget: "zendesk", candidate: true },           // zdassets + zE; case study ~40% auto-resolved 24/7
  { key: "zendesk-newlook",    vendor: "Zendesk", store: "New Look",      url: "https://www.newlook.com/uk",      widget: "zendesk", locale: "en-GB", candidate: true }, // case study: AI agents on chat+email, 42% resolution
  { key: "zendesk-motelrocks", vendor: "Zendesk", store: "Motel Rocks",   url: "https://us.motelrocks.com/",      widget: "zendesk", us: true, candidate: true }, // case study: ~43% deflection, +9.44% CSAT
  { key: "zendesk-bodyshop",   vendor: "Zendesk", store: "The Body Shop", url: "https://www.thebodyshop.com/en-gb", widget: "zendesk", locale: "en-GB", candidate: true }, // zdassets messaging widget live; AI unconfirmed
  { key: "zendesk-gousto",     vendor: "Zendesk", store: "Gousto",        url: "https://www.gousto.co.uk/",       widget: "zendesk", locale: "en-GB", candidate: true }, // zdassets live; meal-kit (borderline ecom)
  { key: "sierra-babylist",   vendor: "Sierra", store: "Babylist",      url: "https://www.babylist.com/",       widget: "sierra" },          // sierraConfig
  // Sourced 2026-07-15 via the StoreLeads API (f:tech=Sierra, f:p=shopify) — signature-verified
  // live (sierra.chat / sierra_enable / enable_sierra_ai_chat in page source). casper/aloyoga/
  // bark/thirdlove/babylist above were already registered (skipped as duplicates). lifeisgood,
  // wilson, therabody did NOT show a live Sierra signature on re-check — not registered.
  { key: "sierra-olukai",      vendor: "Sierra", store: "OluKai",        url: "https://olukai.com/",         widget: "sierra", us: true, candidate: true }, // footwear DTC, Shopify Plus, $12.9M/mo est. (Storeleads)
  { key: "sierra-melin",       vendor: "Sierra", store: "Melin",         url: "https://melin.com/",          widget: "sierra", us: true, candidate: true }, // headwear DTC, Shopify Plus, $3.5M/mo est. (Storeleads)
  { key: "sierra-pendulum",    vendor: "Sierra", store: "Pendulum",      url: "https://pendulumlife.com/",   widget: "sierra", us: true, candidate: true }, // probiotics DTC, Shopify Plus, $1.4M/mo est. (Storeleads)
  { key: "sierra-bodi",        vendor: "Sierra", store: "BODi",         url: "https://www.bodi.com/",       widget: "sierra", us: true, candidate: true }, // fitness/wellness DTC (Beachbody), Shopify Plus, $4.4M/mo est. (Storeleads)
  { key: "ada-knix",          vendor: "Ada",    store: "Knix",          url: "https://knix.com/",               widget: "ada" },             // static.ada.support
  { key: "ada-goodfood",      vendor: "Ada",    store: "Goodfood",      url: "https://www.makegoodfood.ca/",    widget: "ada", locale: "en-CA" },
  // Wider Ada target — NEW retail storefronts sourced + widget-verified 2026-07-05 (real
  // static.ada.support embed + data-handle on the public homepage; consumer brands, public chat).
  { key: "ada-sodastream",    vendor: "Ada",    store: "SodaStream",      url: "https://www.sodastream.com/",   widget: "ada", us: true }, // data-handle sodastream
  { key: "ada-sodastream-uk", vendor: "Ada",    store: "SodaStream UK",   url: "https://sodastream.co.uk/",     widget: "ada", locale: "en-GB" },
  { key: "ada-moroccanoil",   vendor: "Ada",    store: "Moroccanoil",     url: "https://www.moroccanoil.com/",  widget: "ada", us: true }, // data-handle moroccanoil
  { key: "ada-peets",         vendor: "Ada",    store: "Peet's Coffee",   url: "https://www.peets.com/",        widget: "ada", us: true }, // data-handle peetscoffee
  { key: "ada-alen",          vendor: "Ada",    store: "Alen",            url: "https://www.alen.com/",         widget: "ada", us: true }, // data-handle alen (air purifiers — considered purchase)
  { key: "ada-americantall",  vendor: "Ada",    store: "American Tall",   url: "https://www.americantall.com/", widget: "ada", us: true }, // data-handle americantall-gen (sizing → shopping)
  { key: "ada-trx",           vendor: "Ada",    store: "TRX Training",    url: "https://www.trxtraining.com/",  widget: "ada", us: true }, // data-handle trx-gr
  { key: "ada-uaudio",        vendor: "Ada",    store: "Universal Audio", url: "https://www.uaudio.com/",       widget: "ada", us: true }, // data-handle universalaudio
  // Sourced 2026-07-16 via the StoreLeads API (f:tech=Ada, f:p=shopify, f:ds=Active — 202
  // total). Live-verified (window.adaEmbed present under STEALTH): Peloton, SodaStream,
  // Loop Earplugs, Knix. yeti.com/au also matched this StoreLeads query but live-checks
  // during this campaign confirmed it's actually Klaviyo now (see ada-yeti, registered
  // earlier) — StoreLeads' tech detection can be stale; always live-verify before trusting it.
  { key: "ada-peloton",  vendor: "Ada", store: "Peloton",       url: "https://www.onepeloton.com/", widget: "ada", us: true }, // fitness hardware DTC, Shopify Plus, $3.5B/mo est. (Storeleads)
  { key: "ada-sodastream", vendor: "Ada", store: "SodaStream",  url: "https://sodastream.com/",     widget: "ada", us: true }, // home appliances DTC, Shopify Plus, $703M/mo est. (Storeleads)
  { key: "ada-loop",     vendor: "Ada", store: "Loop Earplugs", url: "https://www.loopearplugs.com/", widget: "ada", us: false }, // earplugs DTC, Shopify Plus (Belgium HQ), $613M/mo est. (Storeleads)
  { key: "ada-knix",     vendor: "Ada", store: "Knix",          url: "https://knix.com/",           widget: "ada", us: true }, // apparel DTC, Shopify Plus, $276M/mo est. (Storeleads)
  { key: "repai-vibae",       vendor: "Rep AI", store: "VIBAe",         url: "https://vibae.com/",              widget: "repai" },           // initRep
  { key: "repai-safishing",   vendor: "Rep AI", store: "SA Fishing",    url: "https://www.safishing.com/",      widget: "repai" },
  { key: "repai-fass",        vendor: "Rep AI", store: "FASS Motorsports", url: "https://www.fassmotorsports.com/", widget: "repai" },

  // Decagon — enterprise AI support agent (added 2026-07-04). All 6 signature-verified live
  // (decagon.ai/loaders/<client>.js embed or #decagon-iframe / CSP allowlist in page source).
  { key: "decagon-oura",     vendor: "Decagon", store: "Oura",      url: "https://support.ouraring.com/",  widget: "decagon", us: true, candidate: true, modeUrl: { shopping: "https://ouraring.com/store/rings/oura-ring-5/silver" } }, // support desk on support.ouraring.com; SHOPPING agent lives on the store PDP (verified working 2026-07-14) — loader oura.js + #decagon-embed-container
  { key: "decagon-curology", vendor: "Decagon", store: "Curology",  url: "https://curology.com/",          widget: "decagon", us: true, candidate: true }, // #decagon-iframe site-wide
  { key: "decagon-bilt", ecommerce: false,     vendor: "Decagon", store: "Bilt",      url: "https://www.bilt.com/",           widget: "decagon", us: true, candidate: true }, // loader bilt.js embedded
  { key: "decagon-quince",   wall: true, vendor: "Decagon", store: "Quince",    url: "https://www.quince.com/",         widget: "decagon", us: true, candidate: true }, // "Chat provider":"Decagon"
  { key: "decagon-substack", ecommerce: false, vendor: "Decagon", store: "Substack",  url: "https://substack.com/",           widget: "decagon", us: true, candidate: true }, // enable_decagon_chat:true
  { key: "decagon-hertz", ecommerce: false,    vendor: "Decagon", store: "Hertz",     url: "https://www.hertz.com/rentacar/misc/index.jsp?targetPage=contact_us.jsp", widget: "decagon", us: true, candidate: true }, // decagon.ai in CSP
  // Sourced 2026-07-15 via the StoreLeads API (f:tech=Decagon, f:p=shopify, f:ds=Active — 9
  // total, most non-ecommerce or Cloudflare-blocked in headless). Live-verified (decagon-iframe
  // mounts under STEALTH): Away, Open Farm. backbone.com and www.topps.com ALSO show
  // Decagon in StoreLeads' crawl data but return Cloudflare challenge pages to headless
  // Playwright (403 / "Attention Required") — not selector bugs, structurally unreachable
  // unattended; left unregistered rather than added as candidate:true walls.
  // Away: UNRESOLVED wall, do not re-attempt the same fixes below without new evidence.
  // Its Fin-style launcher lives INSIDE the decagon-iframe (fixed in open() — see the
  // scope.open code) and a standalone minimal Playwright script (open in-frame launcher ->
  // wait for composer -> fill -> Enter) gets a REAL Decagon reply in ~10s every time. But
  // the exact same open()/send() sequence run through run.js's real turn loop (quiesceTranscript
  // -> timeTurn -> readTranscript polling) times out with 0 growth on every turn, every theme,
  // both before AND after that fix (confirmed 0/20 across 2 themes x 2 runs). Root cause not
  // found — something specific to the polling/quiescence path on this store, not the
  // open/send mechanics themselves. Left `candidate: true`; needs fresh eyes, not another
  // repeat of the same open()/send() debugging loop.
  { key: "decagon-away",       vendor: "Decagon", store: "Away",       url: "https://www.awaytravel.com/", widget: "decagon", us: true, candidate: true }, // luggage DTC, Shopify Plus, $1.3B/mo est. (Storeleads)
  { key: "decagon-openfarm",   vendor: "Decagon", store: "Open Farm",  url: "https://openfarmpet.com/",    widget: "decagon", us: true, candidate: true }, // pet food DTC, Shopify Plus, $475M/mo est. (Storeleads) — also runs Kustomer; scope to #decagon-iframe only
  // Sourced 2026-07-16 via a second StoreLeads pass (all-platform, not just Shopify) — the
  // Shopify-only search kept surfacing the same 9 stores already tried. Confirmed live
  // (script present in page source under STEALTH): Little Spoon (baby-food subscription
  // DTC). Frame doesn't mount on cold load (same lazy-mount pattern as away/openfarm) —
  // registered candidate:true pending a real capture run to confirm the composer opens.
  { key: "decagon-littlespoon", vendor: "Decagon", store: "Little Spoon", url: "https://www.littlespoon.com/", widget: "decagon", us: true, candidate: true }, // baby-food subscription DTC, $557M/mo est. (Storeleads) — tested 0/2 valid, empty replies; not chased further

  // Intercom (Fin AI Agent) — added 2026-07-09. All 6 signature-verified live via
  // widget.intercom.io / intercom-lightweight-app / api-iam.intercom.io in page source.
  // Fin is Intercom's default AI layer on top of the Messenger; whether it actually answers
  // cold is unconfirmed until the first capture (candidate:true), same standard as Decagon.
  { key: "intercom-avocado",    vendor: "Intercom", store: "Avocado Green Mattress", url: "https://www.avocadogreenmattress.com/", widget: "intercom", us: true, candidate: true, personas: ["AvoBot"] }, // app_id le9x6vbl + widget.intercom.io
  { key: "intercom-public", ecommerce: false, wall: true,     vendor: "Intercom", store: "Public.com",            url: "https://public.com/",                    widget: "intercom", us: true, candidate: true }, // widget.intercom.io on homepage
  { key: "intercom-kajabi", ecommerce: false,     vendor: "Intercom", store: "Kajabi",                url: "https://kajabi.com/",                    widget: "intercom", us: true, candidate: true }, // app_id gxun6ex4 + api-iam.intercom.io
  { key: "intercom-synthesia", ecommerce: false,  vendor: "Intercom", store: "Synthesia",             url: "https://help.synthesia.io/",             widget: "intercom", us: true, candidate: true }, // intercom-lightweight-app
  { key: "intercom-ninety", ecommerce: false, wall: true,     vendor: "Intercom", store: "Ninety",                url: "https://www.ninety.io/",                 widget: "intercom", us: true, candidate: true }, // app_id u6zkohf3 + widget.intercom.io
  { key: "intercom-tado", wall: true,       vendor: "Intercom", store: "tado°",                 url: "https://www.tado.com/",                  widget: "intercom", us: true, candidate: true }, // intercom-lightweight-app
  // E-commerce Intercom storefronts sourced 2026-07-14 (Intercom skews B2B; these are the rare
  // real merchants). Some run Intercom's "Fin for Ecommerce" Shopify app extension (dynamic —
  // may need a headed pass); capture will self-filter any that don't drive cold/headless.
  { key: "intercom-flaviar",       vendor: "Intercom", store: "Flaviar",         url: "https://flaviar.com/",           widget: "intercom", us: true, candidate: true, personas: ["Corky"] }, // Intercom( + intercomSettings; on Storeleads
  { key: "intercom-pureelectric", wall: true,  vendor: "Intercom", store: "Pure Electric",   url: "https://www.pureelectric.com/",  widget: "intercom", candidate: true },           // Fin-for-Ecommerce Shopify app extension
  // Solaris probe 2026-07-15 (tools/probe-fin2.mjs): NOT a driver bug — Fin here is a human
  // front door. T1 gets one canned reply, then "Give the team a way to reach you" + "Waiting
  // for a teammate" (out-of-hours human queue); T2 sends fine (visible in thread) but no AI
  // ever answers. Same family likely for Pure Electric/Goodbuy/Ritual (0-valid pattern).
  // Honest outcome = engaged-but-deflected; the balancer's strike system retires them.
  { key: "intercom-solarisjapan", wall: true,  vendor: "Intercom", store: "Solaris Japan",   url: "https://www.solarisjapan.com/",  widget: "intercom", candidate: true },           // same Fin-for-Ecommerce app extension
  { key: "intercom-goodbuygear", wall: true,   vendor: "Intercom", store: "Goodbuy Gear",    url: "https://www.goodbuygear.com/",   widget: "intercom", us: true, candidate: true }, // same Fin-for-Ecommerce app extension
  // Ninja Transfers probe 2026-07-15 (tools/probe-nt.mjs): the live chat is NEITHER Intercom
  // NOR Klaviyo — it's a proprietary printflyone.com/p/chat iframe (their in-house platform).
  // No standard driver applies; 0/10 under both. Needs a custom driver (backlog) — url kept
  // for reference, candidate so it never burns balancer budget.
  { key: "intercom-ninjatransfers",vendor: "Klaviyo", store: "Ninja Transfers", url: "",    widget: "klaviyo", us: true, candidate: true, todo: "custom printflyone chat driver" }, // live widget = printflyone iframe, not Intercom/Klaviyo
  // Sourced 2026-07-15 from a Store Leads "apps: intercom" export (Romain) — confirmed
  // Shopify Plus merchants, live-verified (window.Intercom + intercom-messenger-frame mount
  // under STEALTH), then confirmed VALID end-to-end with the runner (10/10 timed turns on
  // both modes for each). Gymshark was the ORIGINAL target store from this vendor's initial
  // brief. Ritual is a confirmed structural wall (0/20 timed turns, retested).
  { key: "intercom-gymshark", vendor: "Intercom", store: "Gymshark", url: "https://www.gymshark.com/", widget: "intercom", us: true, candidate: true }, // athleticwear DTC, $35M/mo est. sales (Storeleads)
  { key: "intercom-ritual",   wall: true, vendor: "Intercom", store: "Ritual",   url: "https://ritual.com/",       widget: "intercom", us: true, candidate: true }, // supplements DTC — wall: 0/20 timed turns
];

// Find a frame by element id / title / name / url. `match` may be a string
// (substring) OR a RegExp (e.g. Klaviyo's /klaviyo|chat|assistant/i) — using
// .includes() on a regex throws, so route through this predicate.
export async function findFrame(page, match) {
  const hit = (s) => match instanceof RegExp ? match.test(s || "") : (s || "").includes(match);
  for (const f of page.frames()) {
    if (hit(f.name()) || hit(f.url())) return f;
    try {
      const el = await f.frameElement();
      const id = (await el.getAttribute("id")) || "";
      const title = (await el.getAttribute("title")) || "";
      if (hit(id) || hit(title)) return f;
    } catch {}
  }
  return null;
}

// Read the current transcript (frame | shadow-by-text | shadow-by-id).
export async function readTranscript(page, scope) {
  if (scope.kind === "frame") {
    const f = await findFrame(page, scope.match);
    if (!f) return { len: 0, text: "" };
    try { const text = await f.evaluate(() => document.body.innerText || ""); return { len: text.length, text }; }
    catch { return { len: 0, text: "" }; }
  }
  if (scope.kind === "shadowId") {
    try {
      // Deep-walk the OPEN shadow tree under the host, gathering innerText from leaf
      // elements only, skipping <style>/<script> (the old first-<div> read leaked CSS).
      const text = await page.evaluate((sel) => {
        const host = document.querySelector(sel) || document.getElementsByTagName(sel)[0];
        const root = host && host.shadowRoot ? host.shadowRoot : host;
        if (!root) return "";
        let out = "";
        const walk = (n) => {
          if (!n) return;
          if (n.nodeType === 1) { const tag = n.tagName; if (tag === "STYLE" || tag === "SCRIPT" || tag === "NOSCRIPT") return; if (n.shadowRoot) walk(n.shadowRoot); }
          if (n.nodeType === 1 && !n.shadowRoot && n.childElementCount === 0) { const t = (n.innerText || n.textContent || "").trim(); if (t) out += t + "\n"; return; }
          for (const k of (n.childNodes || [])) walk(k);
        };
        walk(root);
        return out;
      }, scope.sel);
      return { len: text.length, text };
    } catch { return { len: 0, text: "" }; }
  }
  if (scope.kind === "dom") {
    try { const text = await page.evaluate((sel) => { const e = document.querySelector(sel); return e ? (e.innerText || "") : ""; }, scope.sel);
      return { len: text.length, text }; } catch { return { len: 0, text: "" }; }
  }
  // shadow DOM (Sierra): find the root that CONTAINS the composer (scope.match is the
  // composer selector). The old code matched textContent against the aria-label "Add new
  // message" — an attribute, never in textContent → always 0.
  try {
    const text = await page.evaluate((composerSel) => {
      const root = (window.__sierraRoot && window.__sierraRoot(composerSel)) || null;
      return root ? (root.innerText || root.textContent || "") : "";
    }, scope.match);
    return { len: text.length, text };
  } catch { return { len: 0, text: "" }; }
}

// Best-effort extraction of the latest assistant bubble. This is deliberately narrower than
// readTranscript(): timing and handover detection still use the full transcript, but report
// snippets should not include Yuma quick replies, footers, or old user echoes from body.innerText.
export async function readLatestAssistantReply(page, scope) {
  if (scope.kind !== "frame") return "";
  const f = await findFrame(page, scope.match);
  if (!f) return "";
  try {
    return await f.evaluate(() => {
      const roots = [
        ...document.querySelectorAll('[aria-label="Chat messages"], .messages__list'),
      ];
      for (const root of roots) {
        const rows = [...root.querySelectorAll(".message")];
        for (const row of rows.reverse()) {
          if (row.classList.contains("message--user")) continue;
          const parts = [...row.querySelectorAll(".message__text")]
            .map((el) => (el.innerText || el.textContent || "").trim())
            .filter(Boolean);
          const text = (parts.join("\n") || "").trim();
          if (text) return text;
        }
      }
      return "";
    });
  } catch {
    return "";
  }
}
