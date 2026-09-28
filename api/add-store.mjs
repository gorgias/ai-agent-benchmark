// api/add-store.mjs — queue a storefront for the benchmark from the gated stores view.
//
// POST { url, vendor }                 → checks the storefront's served HTML for that vendor's chat code
// POST { url, vendor, confirm: true }  → also adds it to the submission queue. The next nightly sourcing
//                                        run opens it in a real browser first thing, and the store joins
//                                        the capture rotation only if the widget mounts.
// The HTML check is a fast pre-screen: a chat loaded by a tag manager can be missing from served HTML,
// so a miss can still be queued; the browser check at night is what decides.
//
// The queue is the site's own private Vercel Blob store ("benchmark-submissions", connected to this
// project, so Vercel injects BLOB_READ_WRITE_TOKEN): one small JSON file per store under
// submissions/pending/. No repository and no hand-made token; the capture machine reads the queue with
// the Vercel token it already has (server/submission-queue.mjs). A prospect's domain never reaches the
// public repo before the store is actually benchmarked.
//
// Gated twice: middleware.js (same login as Conversations) and the cookie check below.
const COOKIE = "sb_conv";
const BLOB_API = "https://vercel.com/api/blob";
const PENDING = "submissions/pending/";
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

async function expectedToken(pass) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("gorgias-benchmark:v1:" + pass));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function authed(request) {
  const pass = process.env.CONV_PASSWORD || "";
  if (!pass) return false;                                  // no password configured: the gate stays shut
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + COOKIE + "=([a-f0-9]{64})"));
  return !!m && m[1] === await expectedToken(pass);
}

export function normalize(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u; try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(host)) return null;
  return { host: host.replace(/^www\./, ""), url: `https://${host}/` };
}

export async function check(url, vendor) {
  let res, html = "", status = 0, finalUrl = url, error = null, code = "";
  try {
    res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000) });
    status = res.status; finalUrl = res.url || url;
    html = (await res.text()).slice(0, 3_000_000);
  } catch (e) { error = String(e && e.message || e).slice(0, 120); code = String((e && e.cause && e.cause.code) || ""); }
  const others = Object.entries(SIGNATURES).filter(([v, re]) => v !== vendor && re.test(html)).map(([v]) => v);
  // No DNS record, refused connection or a broken certificate: the address is wrong, not a bot wall.
  // A timeout stays "blocked" (a slow or protective site can still pass the nightly browser check).
  const unreachable = !status && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT|TLS|SSL/i.test(code + " " + (error || ""));
  const blocked = !unreachable && (!html || status === 403 || status === 429 || /verifying your connection|cf-chl|captcha/i.test(html.slice(0, 20000)));
  return { status, finalUrl, error, unreachable, blocked, found: SIGNATURES[vendor].test(html), others };
}

async function blobApi(pathAndQuery, init = {}) {
  const r = await fetch(BLOB_API + pathAndQuery, { ...init, signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`, "x-api-version": "12", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, message: String((body.error && body.error.message) || "") };
}

// One file per store, written only if absent: a second submission of the same store finds it waiting.
export async function queue({ vendor, url, host }) {
  const pathname = `${PENDING}${host}.json`;
  const put = await blobApi(`/?${new URLSearchParams({ pathname })}`, { method: "PUT",
    headers: { "x-vercel-blob-access": "private", "x-add-random-suffix": "0", "x-allow-overwrite": "0", "x-content-type": "application/json" },
    body: JSON.stringify({ host, url, vendor, at: new Date().toISOString() }) });
  if (put.ok) return { queued: true };
  if (/exist/i.test(put.message)) return { already: "queued" };
  throw new Error(`storage ${put.status}: ${put.message.slice(0, 120)}`);
}

export async function POST(request) {
  if (!await authed(request)) return Response.json({ error: "Log in first." }, { status: 401 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: "Send JSON." }, { status: 400 }); }
  const vendor = String(body.vendor || "");
  if (!SIGNATURES[vendor]) return Response.json({ error: "Pick one of the recognised vendors." }, { status: 400 });
  const n = normalize(body.url);
  if (!n) return Response.json({ error: "That doesn't look like a storefront address." }, { status: 400 });
  const result = { host: n.host, url: n.url, vendor, ...(await check(n.url, vendor)) };
  if (!body.confirm) return Response.json(result);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ ...result, error: "Adding stores isn't switched on yet: the submission queue has no storage." }, { status: 503 });
  try { return Response.json({ ...result, ...(await queue({ vendor, url: n.url, host: n.host })) }); }
  catch (e) { return Response.json({ ...result, error: "Could not queue it: " + String(e.message || e).slice(0, 160) }, { status: 502 }); }
}
