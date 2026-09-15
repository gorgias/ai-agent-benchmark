// recon.js — network-layer reconnaissance for closed-widget vendors (Rep AI / Kodif).
//
// Headed real Chrome. We DON'T try to read the DOM. We capture every WebSocket
// frame and every fetch/XHR body, send ONE probe message, and report:
//   1) widget structure (iframes? open/closed shadow hosts?)
//   2) which endpoint carried our probe (the SEND transport)
//   3) which payloads after the send look like the assistant's REPLY (the READ transport)
//   4) relative timing of each frame (so we can see if precise latency is recoverable)
//
//   node recon.js                 # all targets
//   node recon.js kodif           # just Kodif

import { chromium } from "playwright";

const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const STEALTH = () => { try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch (e) {} };

const TARGETS = {
  rep:    { vendor: "Rep AI", store: "Fresh Roasted Coffee", url: "https://www.freshroastedcoffee.com/", host: /rep\.ai|hellorep|getrep|ads-agent/i, launch: ['[id*="rep" i] button', '[class*="rep-launcher" i]', '[aria-label*="chat" i]', '#ads-agent-host'] },
  kodif:  { vendor: "Kodif", store: "Dollar Shave Club", url: "https://us.dollarshaveclub.com/", host: /kodif/i, launch: ['#kodif-chat-widget', '[id*="kodif" i]', '[class*="kodif" i]', '[aria-label*="chat" i]'] },
};

const PROBE = "Hi! Do you ship to Canada and how long does delivery take? (ref XQ7PZ)";
const PROBE_MARK = "XQ7PZ";
const snip = (s, n = 300) => (s || "").replace(/\s+/g, " ").slice(0, n);

async function recon(browser, key) {
  const T = TARGETS[key];
  console.log(`\n\n========== ${T.vendor} · ${T.store} (${T.url}) ==========`);
  const ctx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1366, height: 900 }, locale: "en-US" });
  await ctx.addInitScript(STEALTH);
  const page = await ctx.newPage();

  const t0ref = { t: null };                       // set at send time
  const rel = () => t0ref.t == null ? "pre" : `+${((Date.now() - t0ref.t) / 1000).toFixed(2)}s`;
  const ws = [];   // {dir,url,t,payload}
  const http = []; // {url,status,ct,t,body,hasProbe}

  page.on("websocket", (sock) => {
    const u = sock.url();
    ws.push({ dir: "OPEN", url: u, t: rel(), payload: "" });
    sock.on("framesent", (f) => { const p = typeof f.payload === "string" ? f.payload : "<binary>"; ws.push({ dir: "→send", url: u, t: rel(), payload: p }); });
    sock.on("framereceived", (f) => { const p = typeof f.payload === "string" ? f.payload : "<binary>"; ws.push({ dir: "←recv", url: u, t: rel(), payload: p }); });
  });
  page.on("response", async (resp) => {
    try {
      const u = resp.url();
      const ct = (resp.headers()["content-type"] || "");
      if (!/json|text|event-stream/i.test(ct)) return;
      if (/\.(js|css|png|jpg|svg|woff|gif)(\?|$)/i.test(u)) return;
      let body = ""; try { body = (await resp.text()).slice(0, 4000); } catch {}
      http.push({ url: u, status: resp.status(), ct: ct.split(";")[0], t: rel(), body, hasProbe: body.includes(PROBE_MARK) });
    } catch {}
  });

  // 1) load
  await page.goto(T.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(e => console.log("goto:", String(e).slice(0, 100)));
  await page.waitForTimeout(3000);
  // dismiss cookie/consent
  for (const t of ["Accept all", "Accept All", "Accept", "I agree", "Got it", "Tout accepter", "Accepter"]) {
    try { await page.getByRole("button", { name: new RegExp(t, "i") }).first().click({ timeout: 1200 }); break; } catch {}
  }
  await page.waitForTimeout(2000);

  // 2) structure BEFORE opening
  const structPre = await page.evaluate(() => {
    const hosts = [];
    document.querySelectorAll("*").forEach(el => {
      // closed shadow: el.shadowRoot is null even though it has one — we can't directly tell,
      // but we can flag hosts whose tag/id hint at a widget.
      const id = el.id || ""; const cls = (el.className && el.className.baseVal !== undefined) ? el.className.baseVal : (typeof el.className === "string" ? el.className : "");
      if (/rep|kodif|boost|humind|agent|chat|widget/i.test(id + " " + cls) && (el.shadowRoot || /host|container|root|widget/i.test(id + cls))) {
        hosts.push({ tag: el.tagName.toLowerCase(), id, cls: String(cls).slice(0, 60), openShadow: !!el.shadowRoot });
      }
    });
    return { iframes: [...document.querySelectorAll("iframe")].map(f => ({ id: f.id, src: (f.src || "").slice(0, 80), title: f.title })), hosts: hosts.slice(0, 12) };
  });
  console.log("iframes:", JSON.stringify(structPre.iframes));
  console.log("candidate shadow/widget hosts:", JSON.stringify(structPre.hosts));
  console.log("frames():", page.frames().map(f => f.url().slice(0, 70)).filter(u => T.host.test(u) || /chat|widget|agent/i.test(u)));

  // 3) try to open the launcher
  for (const sel of T.launch) {
    try { await page.locator(sel).first().click({ timeout: 1500 }); console.log("clicked launcher:", sel); break; } catch {}
  }
  // Rep: force initRep + force-open shadow so we can find the textarea
  await page.evaluate(() => { try { window.initRep && window.initRep(); } catch (e) {} }).catch(() => {});
  await page.waitForTimeout(4000);

  // 4) locate an input — try main page, forced-open shadow, and every frame
  const inputProbe = await page.evaluate(() => {
    // monkeypatch attachShadow retroactively won't help existing closed roots; just search open ones + light dom
    const found = [];
    const scan = (root, where) => {
      root.querySelectorAll && root.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(e => found.push({ where, tag: e.tagName.toLowerCase(), ph: e.getAttribute("placeholder") || "" }));
    };
    scan(document, "light");
    document.querySelectorAll("*").forEach(el => { if (el.shadowRoot) scan(el.shadowRoot, "shadow:" + (el.id || el.tagName)); });
    return found;
  });
  console.log("inputs (light+open-shadow):", JSON.stringify(inputProbe));

  // 5) send the probe + mark t0
  let sent = false;
  // try frames first (Kodif iframe)
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const i = f.locator('textarea, input[type="text"], [contenteditable="true"]').first();
      if (await i.count()) { await i.click({ timeout: 2000 }); await i.fill(PROBE); t0ref.t = Date.now(); await page.keyboard.press("Enter"); sent = true; console.log("SENT via frame:", f.url().slice(0, 60)); break; }
    } catch {}
  }
  if (!sent) {
    try {
      const i = page.locator('textarea, input[type="text"], [contenteditable="true"]').first();
      if (await i.count()) { await i.click({ timeout: 2000 }); await i.fill(PROBE); t0ref.t = Date.now(); await page.keyboard.press("Enter"); sent = true; console.log("SENT via main/open-shadow input"); }
    } catch (e) { console.log("send attempt err:", String(e).slice(0, 80)); }
  }
  if (!t0ref.t) t0ref.t = Date.now();
  console.log("probe sent:", sent);

  // 6) capture the reply window
  await page.waitForTimeout(22000);

  // 7) report
  console.log("\n--- WS endpoints seen ---");
  const wsUrls = [...new Set(ws.map(e => e.url))];
  wsUrls.forEach(u => console.log("  ", u.slice(0, 90)));
  console.log("--- WS frames (post-send, payloads) ---");
  ws.filter(e => e.dir !== "OPEN" && e.t.startsWith("+")).slice(0, 40).forEach(e => console.log(`  ${e.t.padStart(8)} ${e.dir} ${snip(e.payload, 220)}`));
  const probeReq = [...ws.filter(e => e.payload.includes(PROBE_MARK)), ...http.filter(e => e.hasProbe)];
  console.log("\n--- WHERE OUR PROBE WENT (send transport) ---");
  probeReq.forEach(e => console.log("  ", e.dir || ("HTTP " + e.status), (e.url || "").slice(0, 80), "@", e.t));
  console.log("\n--- HTTP bodies post-send (candidate reply transport) ---");
  http.filter(e => e.t.startsWith("+")).slice(0, 25).forEach(e => console.log(`  ${e.t.padStart(8)} ${e.status} ${e.ct} ${e.url.slice(0, 70)} :: ${snip(e.body, 200)}`));

  await ctx.close();
  return { key, sent, wsUrls, wsFrames: ws.length, httpAfter: http.filter(e => e.t.startsWith("+")).length, probeFound: probeReq.length > 0 };
}

(async () => {
  const want = process.argv.slice(2).filter(a => TARGETS[a]);
  const keys = want.length ? want : Object.keys(TARGETS);
  let browser;
  try { browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] }); }
  catch (e) { console.log("chrome channel failed, trying default:", String(e).slice(0, 80)); browser = await chromium.launch({ headless: false }); }
  const out = [];
  for (const k of keys) { try { out.push(await recon(browser, k)); } catch (e) { console.log(`recon ${k} ERROR:`, String(e).slice(0, 200)); } }
  await browser.close();
  console.log("\n\n======== SUMMARY ========");
  out.forEach(r => console.log(`  ${r.key.padEnd(7)} sent=${r.sent} wsEndpoints=${r.wsUrls.length} wsFrames=${r.wsFrames} httpAfterSend=${r.httpAfter} probeLocated=${r.probeFound}`));
})();
