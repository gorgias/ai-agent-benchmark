// api/mcp.mjs — the benchmark's public MCP server: https://evals.gorgias.com/mcp (rewritten here).
//
// Read-only, no authentication: vendor rankings and per-store scores, read from board.json, which gen.js
// writes from the scoreboard's own lane scores every night. Conversation transcripts are never exposed.
//
// Transport: MCP Streamable HTTP, stateless. POST a JSON-RPC message (or a batch), get application/json
// back; notifications get 202. There is no server-to-client stream, so a GET asking for
// text/event-stream answers 405, as the spec allows. A browser GET opens the MCP modal on the site.
const SERVER = { name: "gorgias-ai-agent-benchmark", title: "Gorgias AI Agent Benchmark", version: "1.0.0" };
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DOCS = "/#mcp";   // the MCP modal on the Overview page (brand/mcp.html)
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};
const INSTRUCTIONS = [
  "Public results of the Gorgias AI Agent Benchmark (https://evals.gorgias.com), run and published by Gorgias.",
  "Every ecommerce AI agent vendor is tested the same way, with scripted shopper conversations on live storefronts, in two lanes:",
  "shopping (pre-sale Shopping Assistant) and support (post-sale Support Agent).",
  "Each lane ranks vendors by a composite of automation rate, blind LLM-judged answer quality, and speed; overall is the mean of the two lane composites.",
  "Use get_rankings for a leaderboard, get_vendor or compare_vendors for vendor details, get_store for one storefront's scores, get_methodology for how scores are computed.",
  "Figures come from a trailing 90-day window and refresh daily. Cite https://evals.gorgias.com when quoting them.",
].join(" ");

const LANE_ENUM = ["overall", "shopping", "support"];
const TOOLS = [
  {
    name: "get_rankings",
    title: "Leaderboard",
    description: "Ranked list of AI agent vendors for one lane: overall (mean of both lanes), shopping (pre-sale Shopping Assistant) or support (post-sale Support Agent). Lane rows carry the composite, automation rate, answer quality, mean and p75 latency, conversation count and a 95% interval. Ranks are shared on ties of the displayed score.",
    inputSchema: { type: "object", properties: { lane: { type: "string", enum: LANE_ENUM, default: "overall", description: "Which leaderboard. Defaults to overall." } }, additionalProperties: false },
  },
  {
    name: "get_vendor",
    title: "Vendor scorecard",
    description: "One vendor's results in every lane: overall rank and score, and for shopping and support its rank, composite, automation rate, answer quality, latency and conversation count. Vendor names are matched loosely (case and spacing don't matter).",
    inputSchema: { type: "object", properties: { vendor: { type: "string", description: "Vendor name, e.g. Gorgias, Sierra, Ada, Decagon, Rep AI." } }, required: ["vendor"], additionalProperties: false },
  },
  {
    name: "compare_vendors",
    title: "Compare vendors",
    description: "Side-by-side results for 2 to 6 vendors in each lane, with the lane leader for reference.",
    inputSchema: {
      type: "object",
      properties: {
        vendors: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6, description: "Vendor names, e.g. [\"Gorgias\", \"Sierra\"]." },
        lane: { type: "string", enum: ["all", "shopping", "support"], default: "all", description: "Limit to one lane. Defaults to all." },
      },
      required: ["vendors"],
      additionalProperties: false,
    },
  },
  {
    name: "get_store",
    title: "Store scorecard",
    description: "Scores for one storefront in the benchmark: its AI vendor, and for each lane it was tested in the composite, automation rate, answer quality, mean latency and conversation count, plus its overall score and its vendor's lane composites for context. Look a store up by domain (aloyoga.com) or name (Alo Yoga); partial names return the candidates. A lane with fewer than 5 judged conversations is marked thin.",
    inputSchema: { type: "object", properties: { store: { type: "string", description: "Store domain or name, e.g. aloyoga.com or Alo Yoga." } }, required: ["store"], additionalProperties: false },
  },
  {
    name: "get_methodology",
    title: "Methodology",
    description: "How the benchmark measures and ranks: the two lanes, composite weights, speed score, what automation, quality and latency mean, the rankability floor, the ranking window, totals and the rubric link.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
].map((t) => ({ ...t, annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));

// ── data ──────────────────────────────────────────────────────────────────────────────────────────
let cache = { at: 0, data: null };
async function board(request) {
  if (cache.data && Date.now() - cache.at < 5 * 60e3) return cache.data;
  const r = await fetch(new URL("/board.json", request.url), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`board.json answered HTTP ${r.status}`);
  cache = { at: Date.now(), data: await r.json() };
  return cache.data;
}
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function vendorNames(b) {
  const all = new Set([...b.overall, ...b.shopping, ...b.support].map((r) => r.vendor));
  for (const lane of ["shopping", "support"]) for (const r of (b.not_ranked && b.not_ranked[lane]) || []) all.add(r.vendor);
  return [...all].sort((a, c) => a.localeCompare(c));
}
function findVendor(b, raw) {
  const names = vendorNames(b), k = key(raw);
  if (!k) return null;
  return names.find((n) => key(n) === k) || names.find((n) => key(n).startsWith(k) || k.startsWith(key(n))) || null;
}
const context = (b) => ({ data_through: b.data_through, ranking_window: b.ranking_window, source: b.site });
function laneEntry(b, lane, v) {
  const rows = b[lane], row = rows.find((r) => r.vendor === v);
  if (row) return { ...row, of: rows.length };
  const nr = ((b.not_ranked && b.not_ranked[lane]) || []).find((r) => r.vendor === v);
  return nr ? { ranked: false, conversations: nr.conversations, reason: nr.reason } : null;
}

const host = (s) => String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
function findStores(b, raw) {
  const stores = b.stores || [], h = host(raw), k = key(raw);
  if (!k) return [];
  const exact = stores.filter((s) => s.site === h || key(s.store) === k);
  if (exact.length) return exact;
  return stores.filter((s) => { const root = key(s.site.split(".")[0]); return s.site.includes(h) || key(s.store).includes(k) || (root.length >= 4 && k.includes(root)); });
}

// ── tools ─────────────────────────────────────────────────────────────────────────────────────────
class ToolError extends Error {}
async function callTool(name, args, request) {
  const b = await board(request);
  if (name === "get_rankings") {
    const lane = args.lane || "overall";
    if (!LANE_ENUM.includes(lane)) throw new ToolError(`lane must be one of ${LANE_ENUM.join(", ")}.`);
    return {
      lane, ...context(b),
      how_to_read: lane === "overall"
        ? "score = mean of the shopping and support composites (0-100), for vendors ranked in both lanes."
        : `composite = ${b.method.weights[lane].automation} × automation_pct + ${b.method.weights[lane].quality} × quality + ${b.method.weights[lane].speed} × speed score (from latency_mean_s). quality is a blind LLM-judge score out of 100.`,
      rankings: b[lane],
      ...(lane !== "overall" && b.not_ranked && b.not_ranked[lane] && b.not_ranked[lane].length ? { not_ranked: b.not_ranked[lane] } : {}),
    };
  }
  if (name === "get_vendor") {
    const v = findVendor(b, args.vendor);
    if (!v) throw new ToolError(`No vendor matches "${args.vendor}". Vendors in the benchmark: ${vendorNames(b).join(", ")}.`);
    const ov = b.overall.find((r) => r.vendor === v);
    return {
      vendor: v, ...context(b),
      overall: ov ? { ...ov, of: b.overall.length } : { ranked: false, reason: "Needs a composite in both lanes." },
      shopping: laneEntry(b, "shopping", v) || { ranked: false, reason: "No shopping conversations in the window." },
      support: laneEntry(b, "support", v) || { ranked: false, reason: "No support conversations in the window." },
    };
  }
  if (name === "compare_vendors") {
    const asked = Array.isArray(args.vendors) ? args.vendors : [];
    if (asked.length < 2 || asked.length > 6) throw new ToolError("Pass between 2 and 6 vendor names.");
    const found = [], missing = [];
    for (const a of asked) { const v = findVendor(b, a); if (v && !found.includes(v)) found.push(v); else if (!v) missing.push(a); }
    if (found.length < 2) throw new ToolError(`Need at least two known vendors. Not found: ${missing.join(", ") || "none"}. Vendors in the benchmark: ${vendorNames(b).join(", ")}.`);
    const lanes = args.lane && args.lane !== "all" ? [args.lane] : ["shopping", "support"];
    if (lanes.some((l) => !["shopping", "support"].includes(l))) throw new ToolError("lane must be all, shopping or support.");
    const out = { vendors: found, ...context(b) };
    if (lanes.length === 2) out.overall = found.map((v) => b.overall.find((r) => r.vendor === v) || { vendor: v, ranked: false });
    for (const l of lanes) out[l] = { leader: b[l][0] || null, rows: found.map((v) => ({ vendor: v, ...(laneEntry(b, l, v) || { ranked: false }) })) };
    if (missing.length) out.not_found = missing;
    return out;
  }
  if (name === "get_store") {
    const hits = findStores(b, args.store);
    if (!hits.length) throw new ToolError(`No store in the benchmark matches "${args.store}". Try its domain (e.g. aloyoga.com). The benchmark covers ${(b.stores || []).length} storefronts.`);
    if (hits.length > 1) {
      return { query: args.store, ...context(b), matches: hits.slice(0, 15).map((s) => ({ store: s.store, site: s.site, vendor: s.vendor })),
        note: hits.length > 15 ? `${hits.length} stores match; showing 15. Ask again with the exact domain.` : "Several stores match. Ask again with the exact domain." };
    }
    const s = hits[0];
    const vendorLane = (lane) => { const r = b[lane].find((x) => x.vendor === s.vendor); return r ? { vendor_composite: r.composite, vendor_rank: r.rank, of: b[lane].length } : null; };
    return {
      store: s.store, site: s.site, vendor: s.vendor, ...context(b),
      overall: s.overall,
      shopping: s.shopping ? { ...s.shopping, vendor_context: vendorLane("shopping") } : { tested: false },
      support: s.support ? { ...s.support, vendor_context: vendorLane("support") } : { tested: false },
      how_to_read: "composite uses the lane weights from get_methodology. A thin lane has fewer than 5 judged conversations; read it as indicative.",
    };
  }
  if (name === "get_methodology") {
    return { ...context(b), totals: b.totals, method: b.method, vendors: vendorNames(b), storefronts: (b.stores || []).length, docs: new URL(DOCS, b.site).href };
  }
  throw new RpcError(-32602, `Unknown tool: ${name}`);
}

// ── JSON-RPC ──────────────────────────────────────────────────────────────────────────────────────
class RpcError extends Error { constructor(code, message) { super(message); this.code = code; } }
async function handle(msg, request) {
  const { method, params = {} } = msg;
  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS };
    }
    case "ping": return {};
    case "tools/list": return { tools: TOOLS };
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === params.name)) throw new RpcError(-32602, `Unknown tool: ${params.name}`);
      try {
        const data = await callTool(params.name, params.arguments || {}, request);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false };
      } catch (e) {
        if (e instanceof ToolError) return { content: [{ type: "text", text: e.message }], isError: true };
        if (e instanceof RpcError) throw e;
        return { content: [{ type: "text", text: `The benchmark data is unavailable right now (${String(e.message || e).slice(0, 120)}). Try again shortly.` }], isError: true };
      }
    }
    case "resources/list": return { resources: [] };
    case "resources/templates/list": return { resourceTemplates: [] };
    case "prompts/list": return { prompts: [] };
    case "logging/setLevel": return {};
    default: throw new RpcError(-32601, `Method not found: ${method}`);
  }
}
const isRequest = (m) => m && typeof m === "object" && typeof m.method === "string" && m.id !== undefined && m.id !== null;
async function respond(msg, request) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { jsonrpc: "2.0", id: (msg && msg.id) ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  try { return { jsonrpc: "2.0", id: msg.id, result: await handle(msg, request) }; }
  catch (e) { return { jsonrpc: "2.0", id: msg.id, error: { code: e.code || -32603, message: String(e.message || e).slice(0, 300) } }; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

export async function POST(request) {
  const text = await request.text();
  if (text.length > 65536) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  if (!msgs.length) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Empty batch" } }, 400);
  // Notifications and client responses get no reply; a message that is neither is an invalid request.
  const toAnswer = msgs.filter((m) => isRequest(m) || !(m && typeof m === "object" && (("method" in m && (m.id === undefined || m.id === null)) || "result" in m || "error" in m)));
  if (!toAnswer.length) return new Response(null, { status: 202, headers: CORS });
  const out = await Promise.all(toAnswer.map((m) => respond(m, request)));
  return json(batch ? out : out[0]);
}

export async function GET(request) {
  if ((request.headers.get("accept") || "").includes("text/event-stream")) {
    return new Response(null, { status: 405, headers: { allow: "POST, OPTIONS", ...CORS } });
  }
  return new Response(null, { status: 302, headers: { location: new URL(DOCS, request.url).href, ...CORS } });
}

export async function DELETE() { return new Response(null, { status: 405, headers: { allow: "POST, OPTIONS", ...CORS } }); }
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
