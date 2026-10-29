import { randomBytes, randomInt } from "node:crypto";

// Synthetic shoppers, never copied from a real customer. Rotate consumer domains so a
// merchant's example.* block does not identify every benchmark conversation at once.
const FIRST_NAMES = ["John", "Maya", "Nora", "Evan", "Lina", "Adam", "Sofia", "Noah"];
const LAST_NAMES = ["Minser", "Carrow", "Bellin", "Harper", "Linton", "Rossi", "Parker", "Madden"];
const EMAIL_HOSTS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"];
const identities = new WeakMap();
const pick = xs => xs[randomInt(xs.length)];

// run.js creates one cold browser context per conversation. Cache by context so form
// retries, iframe reloads, and later identity gates keep the same shopper; parallel
// conversations and later runs get independent identities, including on the same store.
export function getShopperIdentity(page) {
  const context = page.context();
  if (!identities.has(context)) {
    const firstName = pick(FIRST_NAMES), lastName = pick(LAST_NAMES);
    // 64 random bits minimize collisions with existing inboxes. All local parts stay
    // under Gmail's 30-character limit; no plus aliases or fixed benchmark/test marker.
    const token = randomBytes(8).toString("hex");
    const first = firstName.toLowerCase(), last = lastName.toLowerCase();
    const local = pick([`${first}.${last}.${token}`, `${first}${last}${token}`, `${first}.${token}`]);
    identities.set(context, Object.freeze({
      firstName, lastName, name: `${firstName} ${lastName}`,
      email: `${local}@${pick(EMAIL_HOSTS)}`,
    }));
  }
  return identities.get(context);
}
