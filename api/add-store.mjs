// api/add-store.mjs — queue a storefront for the benchmark from the gated stores view.
//
// POST { url, vendor }                 → checks the storefront's served HTML for that vendor's chat code
// POST { url, vendor, confirm: true }  → also adds it to the submission queue. The next nightly sourcing
//                                        run opens it in a real browser first thing, and the store joins
//                                        the capture rotation only if the widget mounts.
// The HTML check is a fast pre-screen: a chat loaded by a tag manager can be missing from served HTML,
// so a miss can still be queued from here (a logged-in user); the browser check at night decides.
// The queue and the check live in api/_lib/store-queue.mjs, shared with the public MCP's request_store.
//
// Gated twice: middleware.js (same login as Conversations) and the cookie check below.
import { SIGNATURES, normalize, check, queue } from "./_lib/store-queue.mjs";
export { SIGNATURES, normalize, check, queue };

const COOKIE = "sb_conv";

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

export async function POST(request) {
  if (!await authed(request)) return Response.json({ error: "Log in first." }, { status: 401 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: "Send JSON." }, { status: 400 }); }
  const vendor = String(body.vendor || "");
  if (!SIGNATURES[vendor]) return Response.json({ error: "Pick one of the recognised vendors." }, { status: 400 });
  const n = normalize(body.url);
  if (!n) return Response.json({ error: "That doesn't look like a storefront address." }, { status: 400 });
  const { detected, commerce, ...checked } = await check(n.url, vendor);
  const result = { host: n.host, url: n.url, vendor, ...checked };
  if (!body.confirm) return Response.json(result);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ ...result, error: "Adding stores isn't switched on yet: the submission queue has no storage." }, { status: 503 });
  try { return Response.json({ ...result, ...(await queue({ vendor, url: n.url, host: n.host, source: "stores-view" })) }); }
  catch (e) { return Response.json({ ...result, error: "Could not queue it: " + String(e.message || e).slice(0, 160) }, { status: 502 }); }
}
