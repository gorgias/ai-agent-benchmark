// Vercel Edge Middleware — access gate for the whole benchmark site.
// A styled /login page (login.html) instead of the browser's native Basic-Auth popup, so the
// sign-in matches the report's Axiom look. Password is the SITE_PASSWORD env var (set in Vercel,
// NEVER committed; fail-closed if unset). On success we set an HttpOnly cookie whose value is a
// SHA-256 of the secret — the client never sees the secret and can't forge the cookie.
export const config = { matcher: ["/((?!favicon.ico|robots.txt).*)"] };

const COOKIE = "sb_auth";

async function expectedToken(pass) {
  const data = new TextEncoder().encode("gorgias-benchmark:v1:" + pass);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const PASS = process.env.SITE_PASSWORD || "";
  const good = PASS ? await expectedToken(PASS) : null;

  // POST /login — verify the submitted password, set the auth cookie, bounce to the board.
  if (url.pathname === "/login" && request.method === "POST") {
    let pw = "";
    try { pw = String((await request.formData()).get("password") || ""); } catch { pw = ""; }
    if (PASS && pw === PASS) {
      const res = new Response(null, { status: 303, headers: { Location: "/report" } });
      res.headers.append("Set-Cookie", `${COOKIE}=${good}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
      return res;
    }
    return new Response(null, { status: 303, headers: { Location: "/login?e=1" } });
  }

  // The login page (and its query variants) is always reachable — never gate it (avoids a loop).
  if (url.pathname === "/login") return;

  // Everything else requires a valid auth cookie; otherwise send them to the styled login.
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([a-f0-9]{64})"));
  if (good && m && m[1] === good) return; // authenticated → serve the file
  return new Response(null, { status: 302, headers: { Location: "/login" } });
}
