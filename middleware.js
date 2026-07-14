// Vercel Edge Middleware — HTTP Basic Auth gate for the whole benchmark site.
// The password is read from the SITE_PASSWORD env var (set in Vercel project settings,
// NEVER committed). Fail-closed: if SITE_PASSWORD is unset, every request is denied.
export const config = { matcher: ["/((?!favicon.ico|robots.txt).*)"] };

export default function middleware(request) {
  const USER = "gorgias";
  const PASS = process.env.SITE_PASSWORD || "";
  const auth = request.headers.get("authorization") || "";
  if (PASS && auth.startsWith("Basic ")) {
    let decoded = "";
    try { decoded = atob(auth.slice(6)); } catch { decoded = ""; }
    const i = decoded.indexOf(":");
    if (i >= 0) {
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (u === USER && p === PASS) return; // authorized → serve the file
    }
  }
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Gorgias AI Benchmark", charset="UTF-8"' },
  });
}
