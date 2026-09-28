// Stores submitted from the stores view ("Add a store", api/add-store.mjs) wait in the site's private
// Vercel Blob store, benchmark-submissions, which is connected to the Vercel project. That connection
// gives the site BLOB_READ_WRITE_TOKEN without anyone handling a key.
//
//   submissions/pending/<host>.json   { host, url, vendor, at }             written by the site
//   submissions/done/<host>.json      the same + { checked, result, why }   written here, after the
//                                                                          nightly browser check
//
// The capture machine has no Blob token of its own: it reads the project's token through the Vercel
// API with the VERCEL_TOKEN it already uses to deploy. No repository, no extra secret.
const BLOB_API = "https://vercel.com/api/blob";
const OLD_TEAM = "team_vYmSPwekFJOPhVoUuAGAMPGK";          // pre-move team id some machines still carry
const TEAM = (process.env.VERCEL_ORG_ID && process.env.VERCEL_ORG_ID !== OLD_TEAM) ? process.env.VERCEL_ORG_ID : "team_gyas2ZRdwH5DtZtxarGNoQ2S";
const PROJECT = process.env.VERCEL_PROJECT_ID || "prj_Y7hKwp6KD568yGRxReyr8xtggNrv";
export const PENDING = "submissions/pending/";
export const DONE = "submissions/done/";

async function vercelApi(p, token) {
  const r = await fetch(`https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${TEAM}`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Vercel API ${r.status} on ${p.split("?")[0]}`);
  return r.json();
}

// The Blob store's read-write token: BLOB_READ_WRITE_TOKEN when set, else the project's production
// value fetched with VERCEL_TOKEN. Returns null when neither is available (the queue is then skipped).
export async function queueToken(env = process.env) {
  if (env.BLOB_READ_WRITE_TOKEN) return env.BLOB_READ_WRITE_TOKEN;
  if (!env.VERCEL_TOKEN) return null;
  const { envs = [] } = await vercelApi(`/v10/projects/${PROJECT}/env`, env.VERCEL_TOKEN);
  const ev = envs.find((e) => e.key === "BLOB_READ_WRITE_TOKEN" && (e.target || []).includes("production"));
  if (!ev) return null;
  const one = await vercelApi(`/v1/projects/${PROJECT}/env/${ev.id}`, env.VERCEL_TOKEN);
  return one.value || null;
}

async function blobApi(token, pathAndQuery, init = {}) {
  const r = await fetch(BLOB_API + pathAndQuery, { ...init, signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, "x-api-version": "12", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Blob ${r.status}: ${String((body.error && body.error.message) || "").slice(0, 120)}`);
  return body;
}

export async function putJson(token, pathname, obj, { overwrite = true } = {}) {
  return blobApi(token, `/?${new URLSearchParams({ pathname })}`, { method: "PUT", body: JSON.stringify(obj),
    headers: { "x-vercel-blob-access": "private", "x-add-random-suffix": "0", "x-allow-overwrite": overwrite ? "1" : "0",
      "x-content-type": "application/json" } });
}

async function listAll(token, prefix) {
  const out = [];
  let cursor;
  do {
    const q = new URLSearchParams({ prefix, limit: "1000", ...(cursor ? { cursor } : {}) });
    const page = await blobApi(token, `?${q}`, { method: "GET" });
    out.push(...(page.blobs || []));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

// ?cache=0 skips the Blob CDN, as @vercel/blob's get({ useCache: false }) does for private stores. Without
// it, a store submitted again after an earlier outcome reads the cached 404 of its deleted pending file
// (seen 2026-09-28 on hushblankets.com) and stays pending forever.
async function readJson(token, url) {
  const u = new URL(url);
  u.searchParams.set("cache", "0");
  const r = await fetch(u, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Blob read ${r.status}`);
  return r.json();
}

// Pending submissions, oldest first. Each keeps its blob URL so it can be settled later.
export async function readPending(token) {
  const blobs = await listAll(token, PENDING);
  const items = [];
  for (const b of blobs) {
    try { items.push({ ...(await readJson(token, b.url)), _blob: b.url }); }
    catch (e) { console.log(`submissions: unreadable ${b.pathname} (${String(e.message || e).slice(0, 60)})`); }
  }
  return items.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

// Record the outcome under done/ first, then clear the pending file: a crash in between leaves the store
// pending (checked again next run), never lost.
export async function settleSubmission(token, item, outcome) {
  const { _blob, ...rest } = item;
  await putJson(token, `${DONE}${item.host}.json`, { ...rest, ...outcome });
  await blobApi(token, "/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ urls: [_blob] }) });
}
