// Vercel Edge Middleware — the board is public (Overview / Full results / Rubric).
// Conversation transcripts are gated: /report?view=conversations, /conv-text.json, /live-feed.json.
// Password is CONV_PASSWORD only (default in source). Do not read SITE_PASSWORD — that leftover
// whole-site secret would silently change the conversations token and reject the known password.
export const config = { matcher: ["/((?!favicon.ico|robots.txt).*)"] };

const COOKIE = "sb_conv";
const CONV_NEXT = "/report?view=conversations";

async function expectedToken(pass) {
  const data = new TextEncoder().encode("gorgias-benchmark:v1:" + pass);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function convPassword() {
  return process.env.CONV_PASSWORD || "gorgiasevalaccess";
}

function isConversationsPath(url) {
  const path = url.pathname.replace(/\.html$/, "") || "/";
  if (path === "/conv-text.json" || path === "/live-feed.json") return true;
  if (path === "/report" && url.searchParams.get("view") === "conversations") return true;
  return false;
}

function safeNext(raw) {
  if (!raw) return CONV_NEXT;
  try {
    const u = new URL(raw, "https://evals.gorgias.com");
    if (u.pathname.replace(/\.html$/, "") === "/report" && u.searchParams.get("view") === "conversations") {
      return CONV_NEXT;
    }
  } catch {}
  return CONV_NEXT;
}

function loginLocation(url) {
  return "/login?next=" + encodeURIComponent(CONV_NEXT) + (url.searchParams.get("e") ? "&e=1" : "");
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
    return new Response(null, { status: 303, headers: { Location: "/login?e=1&next=" + encodeURIComponent(CONV_NEXT) } });
  }

  if (url.pathname === "/login" || url.pathname === "/login.html") return;

  if (!isConversationsPath(url)) return;

  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([a-f0-9]{64})"));
  if (good && m && m[1] === good) return;
  return new Response(null, { status: 302, headers: { Location: loginLocation(url) } });
}
