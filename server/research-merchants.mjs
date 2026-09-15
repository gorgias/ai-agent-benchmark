#!/usr/bin/env node
// server/research-merchants.mjs — candidate storefronts for one chat vendor, found in PUBLIC sources.
//
// Replaces the StoreLeads feed, whose key stopped working in September 2026 (sourcing then added no
// store for a week). Claude searches the open web: the vendor's customer stories and case studies,
// app-store reviews written by named stores, press about brands adopting the vendor, and brands' own
// help or contact pages. Each candidate comes with the page that links the store to the vendor, and a
// candidate whose evidence page never appeared in the searches is dropped.
//
// Two requests per vendor: the research itself (web search, free-form notes), then a small extraction
// that turns the notes into JSON. Web search always returns citations, and structured outputs reject
// citations, so the two cannot share one request; parsing the notes with a regex instead broke on the
// first real run.
//
// A claim is not a store. source-merchants.mjs still loads every candidate in a real browser and keeps
// it only if the vendor's widget host loads and a visible launcher mounts, so a wrong or stale claim
// costs one browser visit, never a bad row on the board.
//
//   node server/research-merchants.mjs --vendor Yuma                  # print candidates + cost
//   node server/research-merchants.mjs --vendor Yuma --want 6 --searches 4 --debug
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const require = createRequire(path.join(ROOT, "runner", "package.json"));
const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.default ?? sdk;

export const RESEARCH_MODEL = process.env.RESEARCH_MODEL || "claude-opus-5";
// medium: same cost as high and half the time on the 2026-09-15 Yuma test (6 stores named, 4 candidates kept).
const EFFORT = process.env.RESEARCH_EFFORT || "medium";
// List prices, for the report line only: Claude Opus 5 per million tokens, web search $10 per 1,000 searches.
const PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, search: 0.01 };
// Claude Opus 5 can decline a request; "default" re-runs a declined one on the recommended fallback model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

// What each vendor's on-site product is called, so the searches look for the chat product rather than,
// say, Zendesk's ticketing or Klaviyo's email.
const PRODUCT = {
  Gorgias: "Gorgias (AI Agent and live chat widget)",
  Envive: "Envive AI shopping agent (formerly Spiffy)",
  Siena: "Siena AI",
  Ada: "Ada AI customer service agent",
  Sierra: "Sierra AI agent",
  Kodif: "Kodif AI support agent",
  Intercom: "Intercom Messenger with the Fin AI agent",
  Zendesk: "Zendesk messaging Web Widget and AI agents",
  DigitalGenius: "DigitalGenius AI agent",
  Klaviyo: "Klaviyo Customer Hub and AI agent",
  Decagon: "Decagon AI agent",
  Yuma: "Yuma AI",
  "Rep AI": "Rep AI (HelloRep) AI sales associate",
};

// Hosts that talk about stores without being one: the vendors, marketplaces, review and data sites,
// social networks, press wires.
const NOT_A_STOREFRONT = [
  "gorgias.com", "envive.ai", "spiffy.ai", "siena.cx", "ada.cx", "sierra.ai", "kodif.ai", "kodif.io", "intercom.com",
  "zendesk.com", "digitalgenius.com", "klaviyo.com", "decagon.ai", "yuma.ai", "hellorep.ai", "rep.ai",
  "shopify.com", "g2.com", "capterra.com", "trustpilot.com", "trustradius.com", "getapp.com", "linkedin.com",
  "youtube.com", "medium.com", "substack.com", "reddit.com", "facebook.com", "instagram.com", "x.com", "twitter.com",
  "tiktok.com", "crunchbase.com", "builtwith.com", "wappalyzer.com", "storeleads.app", "similarweb.com",
  "prnewswire.com", "businesswire.com", "globenewswire.com", "amazon.com", "wikipedia.org", "github.com",
  "google.com", "apple.com",
];

const withScheme = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
export const hostOf = (u) => {
  try { return new URL(withScheme(u)).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
};
const pageOf = (u) => {
  try { return hostOf(u) + new URL(withScheme(u)).pathname.replace(/\/+$/, ""); }
  catch { return ""; }
};
const blocked = (host) => NOT_A_STOREFRONT.some((d) => host === d || host.endsWith(`.${d}`));

const SYSTEM = [
  "You find storefronts for a benchmark of ecommerce AI chat agents. The benchmark opens each store's website and chats with the vendor's live on-site widget, so a useful candidate is a consumer online store, ideally a US or English-language direct-to-consumer brand, where the named vendor's chat or AI agent is installed on the storefront today.",
  "",
  "Research with web search. Good evidence, roughly in this order: the vendor's customer stories, case studies and customer logos; app marketplace reviews written by a named store (for example on the Shopify App Store); news or press about a brand adopting the vendor; a brand's own help, contact or FAQ pages mentioning the vendor's chat. Brands switch chat vendors, so prefer evidence from the last 12 months.",
  "",
  "Exclude the vendor itself, agencies, marketplaces, B2B software, fintech, travel, and anything that is not an online store. Never invent a store or a URL: each candidate needs a page you found in your searches that links that brand to this vendor.",
].join("\n");

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["store_url", "store_name", "evidence_url", "evidence"],
        properties: {
          store_url: { type: "string" },
          store_name: { type: "string" },
          evidence_url: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
  },
};

export function newResearchClient() {
  return new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
}

const addUsage = (acc, u = {}) => {
  acc.input += u.input_tokens || 0;
  acc.output += u.output_tokens || 0;
  acc.cacheRead += u.cache_read_input_tokens || 0;
  acc.cacheWrite += u.cache_creation_input_tokens || 0;
  acc.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
};
const costOf = (u) =>
  (u.input * PRICE.input + u.output * PRICE.output + u.cacheRead * PRICE.cacheRead + u.cacheWrite * PRICE.cacheWrite) / 1e6
  + u.searches * PRICE.search;
const textOf = (msg) => msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
const stopCheck = (msg, step) => {
  if (msg.stop_reason === "refusal") throw new Error(`${step} refused${msg.stop_details && msg.stop_details.category ? ` (${msg.stop_details.category})` : ""}`);
  if (msg.stop_reason === "max_tokens") throw new Error(`${step} truncated (max_tokens)`);
};

// The notes → JSON. No tools and no citations in this request, so structured outputs are allowed.
async function extract(client, notes, usage) {
  const msg = await client.beta.messages.stream({
    model: RESEARCH_MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
    messages: [{
      role: "user",
      content: "List every storefront candidate named in these research notes, with the evidence URL given for it. " +
        "Copy URLs exactly as written. Do not add stores or URLs that are not in the notes.\n\n<notes>\n" + notes + "\n</notes>",
    }],
  }).finalMessage();
  addUsage(usage, msg.usage);
  stopCheck(msg, "extraction");
  return JSON.parse(textOf(msg)).candidates || [];
}

export async function researchVendor(client, { vendor, want = 12, known = [], maxSearches = 5 }) {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  const result = { vendor, candidates: [], dropped: { known: 0, notStorefront: 0, unsupported: 0 }, named: 0, usage, cost: 0, error: null, notes: "", pagesSeen: 0 };
  const messages = [{
    role: "user",
    content: [
      `Vendor: ${PRODUCT[vendor] || vendor}`,
      `Find up to ${want} storefronts that use it and are not already in the benchmark.`,
      `Already in the benchmark, skip these: ${known.join(", ") || "none"}`,
      "",
      "End with the list of candidates: for each one, the store homepage URL, the store name, the URL of the page that shows it uses this vendor, and what that page shows in under 20 words.",
    ].join("\n"),
  }];
  const blocks = [];
  try {
    let msg;
    for (let hop = 0; hop < 3; hop++) {
      msg = await client.beta.messages.stream({
        model: RESEARCH_MODEL,
        max_tokens: 32000,
        ...FALLBACK,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        system: SYSTEM,
        tools: [{ type: "web_search_20260318", name: "web_search", max_uses: maxSearches }],
        messages,
      }).finalMessage();
      addUsage(usage, msg.usage);
      blocks.push(...msg.content);
      // A long server-side search turn pauses; sending the paused turn back unchanged resumes it.
      if (msg.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: msg.content });
    }
    stopCheck(msg, "research");

    // Every page the searches returned or the answer cited. An evidence URL must be one of them.
    const seen = new Set();
    for (const b of blocks) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) seen.add(pageOf(r.url));
      if (b.type === "text") for (const c of b.citations || []) if (c.url) seen.add(pageOf(c.url));
    }
    result.pagesSeen = seen.size;
    result.notes = textOf(msg);
    const named = result.notes.trim() ? await extract(client, result.notes, usage) : [];
    result.named = named.length;

    const knownHosts = new Set(known.map(hostOf));
    const taken = new Set();
    for (const c of named) {
      const host = hostOf(c.store_url || "");
      if (!host || taken.has(host)) continue;
      if (knownHosts.has(host)) { result.dropped.known++; continue; }
      if (blocked(host)) { result.dropped.notStorefront++; continue; }
      if (!seen.has(pageOf(c.evidence_url || ""))) { result.dropped.unsupported++; continue; }
      taken.add(host);
      result.candidates.push({ url: `${new URL(withScheme(c.store_url)).origin}/`, store: String(c.store_name || "").trim(),
        evidenceUrl: c.evidence_url, evidence: String(c.evidence || "").trim().slice(0, 200) });
      if (result.candidates.length >= want) break;
    }
  } catch (e) {
    result.error = e instanceof Anthropic.APIError ? `API ${e.status}: ${String(e.message).slice(0, 160)}` : String((e && e.message) || e).slice(0, 160);
  }
  result.cost = costOf(usage);
  return result;
}

// ── CLI: research one vendor and print what came back ─────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
  const vendor = arg("vendor");
  if (!vendor) { console.error("usage: node server/research-merchants.mjs --vendor <name> [--want N] [--searches N] [--debug]"); process.exit(1); }
  const { STORES } = await import(pathToFileURL(path.join(ROOT, "runner", "vendors.js")).href);
  const known = STORES.filter((s) => s.vendor === vendor).map((s) => hostOf(s.url || "")).filter(Boolean);
  let client;
  try { client = newResearchClient(); } catch (e) { console.error(`cannot create the Anthropic client: ${e.message}`); process.exit(1); }
  const t0 = Date.now();
  const r = await researchVendor(client, { vendor, want: Number(arg("want", 12)), known, maxSearches: Number(arg("searches", 5)) });
  if (process.argv.includes("--debug")) console.log(`--- research notes (${r.pagesSeen} pages seen) ---\n${r.notes.slice(0, 3000)}\n--- end of notes ---`);
  for (const c of r.candidates) console.log(`  ${c.url}  ${c.store}\n      ${c.evidenceUrl}\n      ${c.evidence}`);
  console.log(`${vendor}: ${r.candidates.length} candidates of ${r.named} named · dropped ${r.dropped.known} known, ${r.dropped.notStorefront} not a store, ` +
    `${r.dropped.unsupported} without a found source · ${r.usage.searches} searches · ~$${r.cost.toFixed(2)} · ${Math.round((Date.now() - t0) / 1000)}s ` +
    `on ${RESEARCH_MODEL} (effort ${EFFORT})` + (r.error ? ` · ERROR ${r.error}` : ""));
}
