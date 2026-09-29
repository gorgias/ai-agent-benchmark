// Store submissions, shared by api/add-store.mjs (the stores view's "Add a store", behind the login) and
// api/mcp.mjs (the public MCP server's request_store). The underscore keeps this file from being deployed
// as a function of its own.
//
// The queue is the site's private Vercel Blob store ("benchmark-submissions", connected to the project, so
// Vercel injects BLOB_READ_WRITE_TOKEN): one JSON file per store under submissions/pending/. The nightly
// sourcing run (server/source-merchants.mjs via server/submission-queue.mjs) verifies each one in a real
// browser first thing, adds it to the capture rotation if the widget mounts, and moves the file to
// submissions/done/ with the outcome.
const BLOB_API = "https://vercel.com/api/blob";
export const PENDING = "submissions/pending/";
export const DONE = "submissions/done/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// What each recognised vendor's chat leaves in a storefront's served HTML.
export const SIGNATURES = {
  Gorgias: /gorgias\.chat|config\.gorgias|assets-manager\.gorgias/i,
  Envive: /spiffy\.ai|envive/i,
  Siena: /siena\.cx/i,
  Ada: /ada\.support|adaEmbed/i,
  Sierra: /sierra\.chat|sierra_enable|enable_sierra/i,
  Kodif: /kodif\.(io|ai)/i,
  Intercom: /widget\.intercom\.io|intercomcdn|intercomSettings/i,
  Zendesk: /zdassets\.com|ze-snippet/i,
  DigitalGenius: /digitalgenius/i,
  Klaviyo: /customer-?hub|k-hub|kServiceStyles/i,
  Decagon: /decagon\.ai/i,
  Yuma: /yuma\.ai/i,
  "Rep AI": /hellorep|myrepai|rep-connector|window\.RepAI/i,
};
// Markers of an online store in served HTML: the benchmark covers e-commerce storefronts only.
const COMMERCE = /cdn\.shopify\.com|window\.Shopify|Shopify\.theme|add[-_ ]?to[-_ ]?cart|\/cart(\.js)?["'?/]|\/checkout|"@type"\s*:\s*"(Product|Offer|ItemList)"|woocommerce|bigcommerce|demandware|salesforce-commerce|magento/i;

export function normalize(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u; try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(host)) return null;
  return { host: host.replace(/^www\./, ""), url: `https://${host}/` };
}

// A fast pre-screen of the served HTML. A chat loaded by a tag manager can be missing from it; the
// browser check at night is what decides.
export async function check(url, vendor) {
  let res, html = "", status = 0, finalUrl = url, error = null, code = "";
  try {
    res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000) });
    status = res.status; finalUrl = res.url || url;
    html = (await res.text()).slice(0, 3_000_000);
  } catch (e) { error = String(e && e.message || e).slice(0, 120); code = String((e && e.cause && e.cause.code) || ""); }
  const detected = Object.entries(SIGNATURES).filter(([, re]) => re.test(html)).map(([v]) => v);
  const others = detected.filter((v) => v !== vendor);
  // No DNS record, refused connection or a broken certificate: the address is wrong, not a bot wall.
  // A timeout stays "blocked" (a slow or protective site can still pass the nightly browser check).
  const unreachable = !status && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT|TLS|SSL/i.test(code + " " + (error || ""));
  const blocked = !unreachable && (!html || status === 403 || status === 429 || /verifying your connection|cf-chl|captcha/i.test(html.slice(0, 20000)));
  return { status, finalUrl, error, unreachable, blocked, found: !!vendor && detected.includes(vendor), others, detected, commerce: COMMERCE.test(html) };
}

const token = () => process.env.BLOB_READ_WRITE_TOKEN || "";
async function blobApi(pathAndQuery, init = {}) {
  const r = await fetch(BLOB_API + pathAndQuery, { ...init, signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${token()}`, "x-api-version": "12", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body, message: String((body.error && body.error.message) || "") };
}

// One file per store, written only if absent: a second submission of the same store finds it waiting.
export async function queue({ vendor, url, host, source = "stores-view" }) {
  const pathname = `${PENDING}${host}.json`;
  const put = await blobApi(`/?${new URLSearchParams({ pathname })}`, { method: "PUT",
    headers: { "x-vercel-blob-access": "private", "x-add-random-suffix": "0", "x-allow-overwrite": "0", "x-content-type": "application/json" },
    body: JSON.stringify({ host, url, vendor, at: new Date().toISOString(), source }) });
  if (put.ok) return { queued: true };
  if (/exist/i.test(put.message)) return { already: "queued" };
  throw new Error(`storage ${put.status}: ${put.message.slice(0, 120)}`);
}

// Where a store stands in the queue: waiting (pending) and/or its last outcome (done). ?cache=0 reads past
// the Blob CDN, which otherwise serves a stale copy of a file rewritten at the same path.
async function readBlob(pathname) {
  const storeId = token().split("_")[3];
  if (!storeId) return null;
  const r = await fetch(`https://${storeId}.private.blob.vercel-storage.com/${pathname}?cache=0`,
    { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}
export async function queueStatus(host) {
  const [pending, done] = await Promise.all([readBlob(`${PENDING}${host}.json`), readBlob(`${DONE}${host}.json`)]);
  return { pending, done };
}
export async function pendingCount() {
  const r = await blobApi(`?${new URLSearchParams({ prefix: PENDING, limit: "1000" })}`, { method: "GET" });
  return r.ok ? ((r.body && r.body.blobs) || []).length : 0;
}
