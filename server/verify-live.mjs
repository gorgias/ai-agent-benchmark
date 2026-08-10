#!/usr/bin/env node
// server/verify-live.mjs — prove the deployed site is actually serving what we just baked.
//
// "vercel deploy exited 0" is not proof. A deploy can succeed while serving a previous build, an
// alias can lag, and a push without a deploy leaves the site stale for a day — all of which look
// like success in a log. This fetches the live pages and compares them byte-for-byte to the local
// files, so the pipeline can only report success when the board really changed.
//
//   SITE_PASSWORD=… node server/verify-live.mjs
//   SITE_PASSWORD=… node server/verify-live.mjs --url https://gorgias-ai-benchmark.vercel.app
//
// The site sits behind the Edge middleware gate, so a plain curl gets the login page — which is
// exactly why past verification attempts couldn't check content. The gate's cookie is a SHA-256 of
// the shared secret (see middleware.js), so with SITE_PASSWORD we can mint the same cookie the
// browser would and read the real page. No secret is ever printed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const BASE = (process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : null)
  || process.env.SITE_URL || "https://gorgias-ai-benchmark.vercel.app";
const PASS = process.env.SITE_PASSWORD || "";
if (!PASS) {
  console.error("SITE_PASSWORD not set — cannot read past the access gate, so the live page cannot be verified.");
  console.error("Set it as a Fly secret (same value as the Vercel SITE_PASSWORD env var).");
  process.exit(2);                       // 2 = could not verify (distinct from 1 = verified mismatch)
}

// Mirrors middleware.js exactly: sha256("gorgias-benchmark:v1:" + password)
const token = createHash("sha256").update("gorgias-benchmark:v1:" + PASS).digest("hex");
const md5 = (s) => createHash("md5").update(s).digest("hex");

// Compare the <body> region rather than the whole document: Vercel's edge may add or reorder
// response headers, and cleanUrls rewrites can change nothing in the payload — but a build that
// served the OLD data differs inside the baked markers, which is what we actually care about.
const bakedRegion = (html) => {
  const i = html.indexOf("STORES");
  return i < 0 ? html : html.slice(i);
};

const PAGES = [
  { route: "/report", file: "report.html" },
  { route: "/takeaways", file: "takeaways.html" },
];

let bad = 0;
for (const p of PAGES) {
  const local = readFileSync(path.join(ROOT, p.file), "utf8");
  let res, body;
  try {
    res = await fetch(BASE + p.route, { headers: { cookie: `sb_auth=${token}`, "cache-control": "no-cache" }, redirect: "manual" });
    body = await res.text();
  } catch (e) {
    console.error(`✗ ${p.route}: fetch failed — ${e.message}`);
    bad++; continue;
  }
  if (res.status === 302 || res.status === 200 && /name="password"/.test(body)) {
    console.error(`✗ ${p.route}: got the login page — SITE_PASSWORD here does not match the one set in Vercel.`);
    bad++; continue;
  }
  if (!res.ok) { console.error(`✗ ${p.route}: HTTP ${res.status}`); bad++; continue; }

  const a = md5(bakedRegion(local)), b = md5(bakedRegion(body));
  if (a === b) console.log(`✓ ${p.route}: live matches local (${a.slice(0, 12)}, ${body.length}c)`);
  else { console.error(`✗ ${p.route}: LIVE DIFFERS from local — local ${a.slice(0, 12)} (${local.length}c) vs live ${b.slice(0, 12)} (${body.length}c)`); bad++; }
}

if (bad) { console.error(`\n${bad}/${PAGES.length} pages do not match — the deploy did not take effect.`); process.exit(1); }
console.log(`\nlive == local on ${PAGES.length} pages at ${BASE}`);
