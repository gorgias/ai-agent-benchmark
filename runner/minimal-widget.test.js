// Offline browser regression: a merchant can run Minimal and Gorgias together.
// Check the actual public widget DOM contract, including hidden autosize fields,
// product/policy links, progress, and feedback; no live customer endpoint is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { WIDGETS, readTranscript } from "./vendors.js";

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
const bundled = !!chromium && existsSync(chromium.executablePath());
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/opt/google/chrome/chrome"].some(existsSync);

test("Minimal opens and sends only in its native widget, preserving evidence and progress", { skip: !chromium || (!bundled && !chrome) ? "requires Playwright and a locally installed browser" : false }, async () => {
  const browser = await chromium.launch({ headless: true, ...(bundled ? {} : { channel: "chrome" }) });
  try {
    const page = await browser.newPage();
    await page.setContent('<textarea id="site-search"></textarea><iframe id="chat-window"></iframe><iframe id="minimal-storefront-widget-frame-sw_pub_fixture"></iframe>');
    const decoy = await page.locator("#chat-window").elementHandle().then(el => el.contentFrame());
    await decoy.setContent('<textarea id="other-widget"></textarea><div>Gorgias decoy transcript</div>');
    const frame = await page.locator('[id^="minimal-storefront-widget-frame-"]').elementHandle().then(el => el.contentFrame());
    await frame.setContent(`
      <button aria-label="Chat openen" onclick="this.hidden=true;document.querySelector('#conversation').hidden=false">Launcher</button>
      <div id="conversation" hidden>
        <header>AI Agent toolbar</header>
        <div data-storefront-widget-transcript="true">
          <div data-storefront-message-role="assistant">Welcome. Our return policy is available here.</div>
          <button onclick="window.chipClicked=true">Yes</button>
          <div data-testid="storefront-csat-survey">Rate your conversation</div>
        </div>
        <textarea aria-hidden="true" style="display:none"></textarea>
        <div data-storefront-composer-surface="open"><textarea></textarea></div>
        <textarea id="escalation-note"></textarea>
      </div>
      <script>
      document.querySelector('[data-storefront-composer-surface] textarea').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const transcript = document.querySelector('[data-storefront-widget-transcript]');
        const customer = document.createElement('div');
        customer.dataset.storefrontMessageRole='customer';customer.textContent=e.target.value;transcript.append(customer);
        const answer = document.createElement('div');
        answer.dataset.storefrontMessageRole='assistant';
        answer.innerHTML='Yes, returns are accepted. Returns last 100 nights. <a href="https://fixture.example/returns">return policy</a><br><a href="https://fixture.example/pillow">Pillow € 59</a>';
        transcript.append(answer);e.target.value='';
      });
      </script>`);

    // The real capture starts at the first response byte, before merchant consent
    // hydrates. Reproduce a late overlay covering the native iframe launcher.
    await frame.getByRole("button", { name: "Chat openen" }).evaluate(el => { el.style.visibility = "hidden"; setTimeout(() => { el.style.visibility = "visible"; }, 250); });
    await page.evaluate(() => setTimeout(() => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:white";
      const consent = document.createElement("button");consent.textContent = "Alles accepteren";
      consent.onclick = () => { window.consentAccepted = true; overlay.remove(); };
      overlay.append(consent);document.body.append(overlay);
    }, 75));

    await WIDGETS.minimal.open(page);
    assert.equal(await page.evaluate(() => window.consentAccepted), true);
    await WIDGETS.minimal.send(page, "Where is the return policy?");
    const transcript = await readTranscript(page, WIDGETS.minimal.scope);
    assert.match(transcript.text, /Where is the return policy\?[\s\S]*Yes, returns are accepted\. Returns last 100 nights/);
    assert.match(transcript.text, /return policy \(https:\/\/fixture\.example\/returns\)/);
    assert.match(transcript.text, /^Welcome\. Our return policy is available here\./);
    assert.doesNotMatch(transcript.text, /Where is the return policy \(/);
    assert.equal((transcript.text.match(/https:\/\/fixture\.example\/returns/g) || []).length, 1);
    assert.match(transcript.text, /Pillow € 59 \(https:\/\/fixture\.example\/pillow\)/);
    assert.doesNotMatch(transcript.text, /toolbar|Gorgias|Cached reply|Rate your conversation/);
    assert.equal(await page.locator("#site-search").inputValue(), "");
    assert.equal(await decoy.locator("#other-widget").inputValue(), "");
    assert.equal(await frame.locator("#escalation-note").inputValue(), "");
    assert.equal(await frame.evaluate(() => !!window.chipClicked), false);
    assert.equal(transcript.generating, false);

    await frame.evaluate(() => {
      const progress = document.createElement("div");progress.dataset.testid="storefront-thinking-dots";
      document.querySelector("[data-storefront-widget-transcript]").append(progress);
    });
    assert.equal((await readTranscript(page, WIDGETS.minimal.scope)).generating, true);
    await frame.locator('[data-testid="storefront-thinking-dots"]').evaluate(el => el.remove());
    await frame.evaluate(() => {
      const progress = document.createElement("div");progress.dataset.testid="storefront-status-hint";
      progress.innerHTML='<span class="animate-text-shimmer">Even nadenken...</span>';
      document.querySelector("[data-storefront-widget-transcript]").append(progress);
    });
    assert.equal((await readTranscript(page, WIDGETS.minimal.scope)).generating, true);

    await frame.locator("[data-storefront-widget-transcript]").evaluate(el => el.remove());
    assert.deepEqual(await readTranscript(page, WIDGETS.minimal.scope), { len: 0, text: "", generating: false, unavailable: false });
    const generic = await readTranscript(page, { kind: "frame", match: "chat-window" });
    assert.match(generic.text, /Gorgias decoy transcript/);
    assert.equal(Object.hasOwn(generic, "generating"), false);
    assert.equal(Object.hasOwn(generic, "unavailable"), false);

    for (const notice of [
      "Our AI agent is not available right now. Please try again in a moment.",
      "Onze AI-agent is momenteel niet beschikbaar. Probeer het zo opnieuw.",
    ]) {
      await frame.setContent('<div id="notice"></div><textarea style="display:none"></textarea>');
      await frame.locator("#notice").evaluate((el, value) => { el.textContent = value; }, notice);
      assert.deepEqual(await readTranscript(page, WIDGETS.minimal.scope), { len: 0, text: "", generating: false, unavailable: true });

      // Identical real assistant prose is retained; only a replaced transcript
      // plus the exact stand-alone native notice denotes unavailable transport.
      await frame.setContent('<div data-storefront-widget-transcript="true"><div data-storefront-message-role="assistant"></div></div>');
      await frame.locator('[data-storefront-message-role="assistant"]').evaluate((el, value) => { el.textContent = value; }, notice);
      const realReply = await readTranscript(page, WIDGETS.minimal.scope);
      assert.equal(realReply.text, notice);
      assert.equal(realReply.unavailable, false);
    }
    await frame.setContent('<div>Our AI agent is not available right now. Please try again in a moment. Additional page content.</div>');
    assert.equal((await readTranscript(page, WIDGETS.minimal.scope)).unavailable, false);
  } finally {
    await browser.close();
  }
});
