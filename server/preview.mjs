#!/usr/bin/env node
// Local preview that mirrors vercel.json: cleanUrls, / → Overview, /takeaways and /report
// are the Brand 2.0 pages (old shells live at *-archive). python3 -m http.server does none
// of that, so /report and /rubric 404 there.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8080);

const REDIRECTS = new Map([
  ["/takeaways", "/"],
  ["/takeaways.html", "/"],
  ["/takeaways-v2", "/"],
  ["/takeaways-v2.html", "/"],
  ["/report-v2", "/report"],
  ["/report-v2.html", "/report"],
  ["/rubric.html", "/rubric"],
  ["/results", "/"],
  ["/results.html", "/"],
  ["/vendor-changes", "/"],
  ["/vendor-changes.html", "/"],
]);

const REWRITES = new Map([
  ["/", "/takeaways.html"],
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".woff2": "font/woff2",
};

function urlPath(req) {
  try { return decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname); }
  catch { return "/"; }
}

function insideRoot(rel) {
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendFile(res, abs) {
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(abs).pipe(res);
  });
}

const CONV_NEXT = "/report?view=conversations";
const CONV_COOKIE = "sb_conv";
const CONV_PASS = process.env.CONV_PASSWORD || "gorgiasevalaccess";
const CONV_TOKEN = createHash("sha256").update("gorgias-benchmark:v1:" + CONV_PASS).digest("hex");

function hasConvCookie(req) {
  const m = String(req.headers.cookie || "").match(/(?:^|; )sb_conv=([a-f0-9]{64})/);
  return !!(m && m[1] === CONV_TOKEN);
}

function needsConvGate(pathname, searchParams) {
  if (pathname === "/conv-text.json" || pathname === "/live-feed.json") return true;
  if ((pathname === "/report" || pathname === "/report.html") && searchParams.get("view") === "conversations") return true;
  return false;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  const pathname = urlPath(req);

  if ((pathname === "/login" || pathname === "/login.html") && req.method === "POST") {
    readBody(req).then((raw) => {
      const params = new URLSearchParams(raw);
      if (params.get("password") === CONV_PASS) {
        send(res, 303, "", {
          Location: CONV_NEXT,
          "Set-Cookie": `${CONV_COOKIE}=${CONV_TOKEN}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`,
        });
        return;
      }
      send(res, 303, "", { Location: "/login?e=1&next=" + encodeURIComponent(CONV_NEXT) });
    });
    return;
  }

  if (needsConvGate(pathname, u.searchParams) && !hasConvCookie(req)) {
    send(res, 302, "", { Location: "/login?next=" + encodeURIComponent(CONV_NEXT) });
    return;
  }

  const dest = REDIRECTS.get(pathname);
  if (dest) {
    send(res, 308, "", { Location: dest });
    return;
  }
  let file = REWRITES.get(pathname) || pathname;
  if (file.endsWith("/")) file = file.slice(0, -1) || "/";
  if (file !== "/" && !path.extname(file)) file += ".html";
  const abs = insideRoot(file.replace(/^\//, ""));
  if (!abs) {
    send(res, 400, "Bad path\n", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  sendFile(res, abs);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Preview (Vercel routes) http://127.0.0.1:${PORT}/`);
  console.log("  /  /takeaways  /report  /rubric  /takeaways-archive  /report-archive");
});
