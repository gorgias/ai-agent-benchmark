import { test } from "node:test";
import assert from "node:assert/strict";
import { getShopperIdentity } from "./shopper-identity.js";

test("fresh conversations use unique synthetic consumer emails instead of example.*", () => {
  const hosts = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"]);
  const seen = new Set(), usedHosts = new Set();
  for (let i = 0; i < 1000; i++) {
    const context = {};
    const identity = getShopperIdentity({ context: () => context });
    assert.equal(identity.name, `${identity.firstName} ${identity.lastName}`);
    const [local, host] = identity.email.split("@");
    assert.ok(hosts.has(host));
    assert.match(local, /^[a-z0-9]+(?:\.[a-z0-9]+)*$/);
    assert.ok(local.length <= 30, "consumer email validators must accept the local part");
    assert.match(local, /[a-f0-9]{16}$/, "retain enough randomness to minimize existing-inbox collisions");
    assert.doesNotMatch(local, /benchmark|example|test|\+/);
    // Gmail ignores dots: changing punctuation must not be what makes an address unique.
    const canonical = `${local.replaceAll(".", "")}@${host}`;
    assert.ok(!seen.has(canonical), "separate conversations must not reuse an email identity");
    seen.add(canonical);
    usedHosts.add(host);
  }
  assert.equal(usedHosts.size, hosts.size, "rotate domains as well as usernames");
});

test("retries and pages in one cold context keep an identity; other contexts do not", () => {
  const context = {}, page = { context: () => context };
  const identity = getShopperIdentity(page);
  assert.equal(getShopperIdentity(page), identity);
  assert.equal(getShopperIdentity({ context: () => context }), identity);
  assert.notEqual(getShopperIdentity({ context: () => ({}) }).email, identity.email);
});
