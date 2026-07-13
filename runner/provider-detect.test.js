// Unit tests for provider detection (the provider-drift guard).  Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { detect } from "./provider-detect.js";

test("detect: Envive (new envive-injection build) is identified", () => {
  const sig = { scripts: ["https://cdn.spiffy.ai/production/universal-build/envive-injection/index.js"], ids: ["envive-ai-container"], hosts: ["envive-ai-floating-chat"], globals: ["spiffy"] };
  assert.equal(detect(sig)[0].prov, "Envive");
});

test("detect: Mavenoid is identified by its shadow host (the nanit case)", () => {
  const sig = { scripts: [], ids: [], hosts: ["mavenoid-shadow-root"], globals: [] };
  assert.equal(detect(sig)[0].prov, "Mavenoid");
});

test("detect: Gorgias by script host", () => {
  const sig = { scripts: ["https://config.gorgias.chat/applications/123.js"], ids: [], hosts: [], globals: ["GorgiasChat"] };
  assert.equal(detect(sig)[0].prov, "Gorgias");
});

test("detect: a dual deployment ranks BOTH providers (nanit = Envive embed + Mavenoid support)", () => {
  const sig = { scripts: ["https://cdn.spiffy.ai/envive-injection/index.js"], ids: ["envive-ai-container"], hosts: ["mavenoid-shadow-root"], globals: ["spiffy"] };
  const provs = detect(sig).map((h) => h.prov);
  assert.ok(provs.includes("Envive") && provs.includes("Mavenoid"));
});

test("detect: no chat provider → empty (a page with only unrelated shadow hosts)", () => {
  const sig = { scripts: ["https://cdn.shopify.com/app.js"], ids: ["shopify-section-header"], hosts: ["shop-cart-sync", "klarna-placement"], globals: [] };
  assert.equal(detect(sig).length, 0);
});

test("detect: expected-vendor present among hits = no mismatch (Ada)", () => {
  const sig = { scripts: ["https://static.ada.support/embed.js"], ids: ["ada-button-frame"], hosts: [], globals: ["adaEmbed"] };
  assert.equal(detect(sig)[0].prov, "Ada");
});
