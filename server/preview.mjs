#!/usr/bin/env node
// Local preview that mirrors vercel.json: cleanUrls, / → Overview, /report → Full results.
// python3 -m http.server does none of that, so /report and /rubric 404.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8080);

const REDIRECTS = new Map([
  ["/takeaways", "/"],
  ["/takeaways.html", "/"],
  ["/takeaways-v2", "/"],
  ["/takeaways-v2.html", "/"],
  ["/report.html", "/report"],
  ["/report-v2", "/report"],
  ["/report-v2.html", "/report"],
  ["/report-v2.html", "/report"],
  ["/rubric.html", "/rubric"],
  ["/results", "/"],
  ["/results.html", "/"],
  ["/login", "/"],
  ["/login.html", "/"],
  ["/vendor-changes", "/"],
  ["/vendor-changes.html", "/"],
]);

const REWRITES = new Map([
  ["/", "/takeaways-v2.html"],
  ["/report", "/report-v2.html"],
  ["/rubric", "/rubric.html"],
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

const server = http.createServer((req, res) => {
  const pathname = urlPath(req);
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
  console.log("  /  /report  /rubric");
});
