// api/add-store.mjs — queue a storefront for the benchmark from the gated stores view.
//
// POST { url, vendor }                 → checks the storefront's served HTML for that vendor's chat code
// POST { url, vendor, confirm: true }  → also adds it to the submission queue. The next nightly sourcing
//                                        run opens it in a real browser first thing, and the store joins
//                                        the capture rotation only if the widget mounts.
// The HTML check is a fast pre-screen: a chat loaded by a tag manager can be missing from served HTML,
// so a miss can still be queued; the browser check at night is what decides.
//
// The queue lives in a PRIVATE repository (SUBMISSIONS_REPO): the benchmark repo is public, requires
// signed commits and pull requests on every branch, and a prospect's domain should not be published
// before it is actually benchmarked. The capture machine reads the same file with its own token.
//
// Gated twice: middleware.js (same login as Conversations) and the cookie check below.
const COOKIE = "sb_conv";
const QUEUE_REPO = process.env.SUBMISSIONS_REPO || "gorgias/ai-agent-benchmark-queue";
const QUEUE_FILE = "submitted-stores.json";
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
  let res, html = "", status = 0, finalUrl = url, error = null;
  try {
    res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000) });
    status = res.status; finalUrl = res.url || url;
    html = (await res.text()).slice(0, 3_000_000);
  } catch (e) { error = String(e && e.message || e).slice(0, 120); }
  const others = Object.entries(SIGNATURES).filter(([v, re]) => v !== vendor && re.test(html)).map(([v]) => v);
  const blocked = !html || status === 403 || status === 429 || /verifying your connection|cf-chl|captcha/i.test(html.slice(0, 20000));
  return { status, finalUrl, error, blocked, found: SIGNATURES[vendor].test(html), others };
}

async function gh(url, init = {}) {
  const r = await fetch(url, { ...init,
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${String(body.message || "").slice(0, 120)}`);
  return body;
}
const b64 = (obj) => Buffer.from(JSON.stringify(obj, null, 2) + "\n").toString("base64");

// Optimistic concurrency: the write carries the sha it read, so two submissions at once cannot lose one.
export async function queue({ vendor, url, host, note }) {
  const api = `https://api.github.com/repos/${QUEUE_REPO}/contents/${QUEUE_FILE}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await gh(api).catch((e) => (/GitHub 404/.test(e.message) ? null : Promise.reject(e)));
    const doc = cur ? JSON.parse(Buffer.from(cur.content, "base64").toString("utf8")) : { pending: [], done: [] };
    doc.pending = doc.pending || []; doc.done = doc.done || [];
    if (doc.pending.some((it) => it.host === host)) return { already: "queued" };
    doc.pending.push({ host, url, vendor, at: new Date().toISOString(), ...(note ? { note: String(note).slice(0, 200) } : {}) });
    try {
      await gh(api, { method: "PUT", body: JSON.stringify({ message: `queue ${host} (${vendor})`, content: b64(doc), ...(cur ? { sha: cur.sha } : {}) }) });
      return { queued: true, position: doc.pending.length };
    } catch (e) { if (!/GitHub (409|422)/.test(e.message)) throw e; }
  }
  throw new Error("the queue was busy, try again");
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
  if (!process.env.GITHUB_TOKEN) return Response.json({ ...result, error: "Adding stores isn't switched on yet: the submission queue has no access token." }, { status: 503 });
  try { return Response.json({ ...result, ...(await queue({ vendor, url: n.url, host: n.host, note: body.note })) }); }
  catch (e) { return Response.json({ ...result, error: "Could not queue it: " + String(e.message || e).slice(0, 160) }, { status: 502 }); }
}
