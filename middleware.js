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

// PUBLIC SINCE 2026-09-03, by explicit decision: the benchmark is open, no sign-in.
//
// Note the gate below is fail-CLOSED — with no SITE_PASSWORD it redirects everyone to /login
// rather than serving the site. So opening the report cannot be done by removing the secret;
// it takes this early return. Everything under it is intact: delete these three lines and the
// styled login gate is back exactly as it was, no other change needed.
//
// What being open means, since it cannot be quietly undone once the URL is shared: the report
// names eighteen vendors and publishes numbers several of them will not like, and it is now
// readable by all of them. It is also now verifiable from outside, which is the point — a
// competitive benchmark nobody can check is only an assertion.
const SITE_IS_PUBLIC = true;

export default async function middleware(request) {
  if (SITE_IS_PUBLIC) return;
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
