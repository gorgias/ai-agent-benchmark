// Vercel Edge Middleware — the board is public (Overview / Full results / Rubric).
// Conversation transcripts are gated: /report?view=conversations, /conv-text.json, /live-feed.json.
// The per-store explorer (/report?view=stores) and its add-a-store endpoint (/api/add-store) sit behind
// the same login and cookie; an API call without it gets a 401, not the login page.
// Password is CONV_PASSWORD only, set on Vercel. There is deliberately NO fallback: this repo is public,
// so a default written here would be a published password. When the variable is missing (a preview
// deployment, a deleted env var) the gate stays shut: every login fails and every gated path goes to /login.
// Do not read SITE_PASSWORD — that leftover
// whole-site secret would silently change the conversations token and reject the known password.
export const config = { matcher: ["/((?!favicon.ico|robots.txt).*)"] };

const COOKIE = "sb_conv";
const CONV_NEXT = "/report?view=conversations";
const STORES_NEXT = "/report?view=stores";
const GATED_VIEWS = { conversations: CONV_NEXT, stores: STORES_NEXT };

async function expectedToken(pass) {
  const data = new TextEncoder().encode("gorgias-benchmark:v1:" + pass);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function convPassword() {
  return process.env.CONV_PASSWORD || "";
}

function isConversationsPath(url) {
  const path = url.pathname.replace(/\.html$/, "") || "/";
  if (path === "/conv-text.json" || path === "/live-feed.json" || path === "/api/add-store") return true;
  if (path === "/report" && GATED_VIEWS[url.searchParams.get("view")]) return true;
  return false;
}

function safeNext(raw) {
  if (!raw) return CONV_NEXT;
  try {
    const u = new URL(raw, "https://evals.gorgias.com");
    if (u.pathname.replace(/\.html$/, "") === "/report" && GATED_VIEWS[u.searchParams.get("view")]) {
      return GATED_VIEWS[u.searchParams.get("view")];
    }
  } catch {}
  return CONV_NEXT;
}

function loginLocation(url) {
  const path = url.pathname.replace(/\.html$/, "");
  const next = (path === "/report" && GATED_VIEWS[url.searchParams.get("view")]) || CONV_NEXT;
  return "/login?next=" + encodeURIComponent(next) + (url.searchParams.get("e") ? "&e=1" : "");
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const PASS = convPassword();
  const good = PASS ? await expectedToken(PASS) : null;

  if (url.pathname === "/login" && request.method === "POST") {
    let pw = "", next = CONV_NEXT;
    try {
      const fd = await request.formData();
      pw = String(fd.get("password") || "");
      next = safeNext(String(fd.get("next") || url.searchParams.get("next") || ""));
    } catch { pw = ""; }
    if (good && pw === PASS) {
      const res = new Response(null, { status: 303, headers: { Location: next } });
      res.headers.append("Set-Cookie", `${COOKIE}=${good}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
      return res;
    }
    return new Response(null, { status: 303, headers: { Location: "/login?e=1&next=" + encodeURIComponent(next) } });
  }

  if (url.pathname === "/login" || url.pathname === "/login.html") return;

  if (!isConversationsPath(url)) return;

  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([a-f0-9]{64})"));
  if (good && m && m[1] === good) return;
  if (url.pathname.startsWith("/api/")) return new Response(JSON.stringify({ error: "Log in first." }), { status: 401, headers: { "content-type": "application/json" } });
  return new Response(null, { status: 302, headers: { Location: loginLocation(url) } });
}
