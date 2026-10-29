// Drive the real gate handlers against local HTML, never a live merchant or inbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { WIDGETS } from "./vendors.js";
import { getShopperIdentity } from "./shopper-identity.js";

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
const bundled = !!chromium && existsSync(chromium.executablePath());
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/opt/google/chrome/chrome"].some(existsSync);
const skip = !chromium || (!bundled && !chrome) ? "requires Playwright and a locally installed browser" : false;

const GATE = `
  <button class="widgetTrigger" onclick="this.remove()">Open chat</button>
  <form>
    <input name="name" placeholder="Name" required>
    <input name="email" type="email" placeholder="Email" required>
    <button type="submit">Start chat</button>
  </form>
  <script>
    window.submissions = [];
    document.querySelector('form').onsubmit = e => {
      e.preventDefault();
      window.submissions.push(Object.fromEntries(new FormData(e.target)));
      e.target.hidden = true;
      const composer = document.createElement('textarea');
      composer.placeholder = 'Type a message';
      composer.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); window.sent = e.target.value; } };
      document.body.append(composer);
    };
  </script>`;

for (const [widget, url, id] of [
  ["yuma", "https://app.yuma.ai/w/fixture", "yuma-chat"],
  ["siena", "https://chat.siena.cx/dist/index.html", "SIENA_CHAT_IFRAME"],
  ["dg", "https://chat.digitalgenius.com/fixture", "dg-chat-widget-iframe"],
]) {
  test(`${widget} gates submit the conversation identity${widget === "yuma" ? ", including a later gate" : ""}`, { skip }, async () => {
    const browser = await chromium.launch({ headless: true, ...(bundled ? {} : { channel: "chrome" }) });
    try {
      const context = await browser.newContext();
      await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: route.request().url() === url ? GATE : '<button>Open chat</button>' }));
      const page = await context.newPage();
      await page.setContent(`
        <script>window.dgchat = { methods: { launchWidget() {} } };</script>
        <iframe id="dg-chat-widget-launcher-iframe" src="https://fixture.test/launcher"></iframe>
        <iframe id="${id}" src="${url}"></iframe>`);
      const frame = await page.locator(`#${id}`).elementHandle().then(el => el.contentFrame());
      await frame.locator("form").waitFor();
      await WIDGETS[widget].open(page);
      const identity = getShopperIdentity(page);
      const expected = { name: identity.name, email: identity.email };
      assert.deepEqual(await frame.evaluate(() => window.submissions), [expected]);
      assert.equal(await frame.locator("textarea").isVisible(), true);

      if (widget === "yuma") {
        // A later email gate in the same conversation must reuse the original email.
        await frame.evaluate(() => { document.querySelector("textarea").remove(); document.querySelector("form").hidden = false; });
        await WIDGETS.yuma.send(page, "What is the return window?");
        assert.deepEqual(await frame.evaluate(() => window.submissions), [expected, expected]);
        assert.equal(await frame.evaluate(() => window.sent), "What is the return window?");
      }
    } finally {
      await browser.close();
    }
  });
}
