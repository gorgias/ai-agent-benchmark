#!/usr/bin/env node
// Count product recommendations in Shopping Assistant conversations and render an
// ASCII bar-chart table. The detector is intentionally conservative: it counts
// distinct products with transcript evidence, not broad categories.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STORES } from "./vendors.js";
import { convoValidity, connectivityFail } from "./classify.js";
import { isQuarantinedConversation } from "./conversation-quarantine.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, "results");
const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_BAR_WIDTH = 24;

const PRICE_RE = /(?:[$\u00A3\u20AC]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|AUD|CAD))/i;
const PRODUCT_URL_RE = /(?:https?:\/\/[^\s)]+)?\/products\/([a-z0-9][a-z0-9-]{2,})(?:[?#/][^\s)]*)?/gi;

const GENERIC_RE = /\b(?:order|orders|shipping|delivery|return|refund|discount|promo|promotion|code|checkout|cart|payment|installments?|warranty|guarantee|policy|customer|support|team|product page|homepage|newsletter|email|sms|standard|express|overnight|ground|next day|2nd day|ups|usps|fedex|dhl|free shipping|tax|total|gift-ready|gift receipt|size|sizes?|color|colour|category|collection|collections|registry favorites|shower gifts|gifts under|shop by|options?|details?|more products?|other products?|view product|ask maggie|verify order|tesco clubcard|multi-item discount|voucher|vouchers)\b/i;

const CTA_RE = /\b(?:want to|ready to|go ahead|open it|check out|grab it|add it|finish the order|now\??|from here|below|in one tap)\b/i;

function titleFromSlug(slug) {
  return String(slug || "")
    .replace(/-\d+$/g, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function stripEchoes(text) {
  return String(text || "")
    .replace(/\d{1,2}:\d{2}\s*(?:AM|PM)?\.?\s*You said:[\s\S]*?(?=\d{1,2}:\d{2}\s*(?:AM|PM)?|$)/gi, " ")
    .replace(/\b(?:Track orders|This chat is AI-powered for faster assistance|Report a problem|See last conversation)\b/gi, " ");
}

function compactWhitespace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function canonicalProductName(name) {
  return compactWhitespace(name)
    .replace(PRICE_RE, " ")
    .replace(/\([^)]*$/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*(?:[\u2022*-]\s+|\d+[.)]\s+)/, "")
    .replace(/^(?:great choice|for you|for your needs|therefore|overall|yes|okay|sure)[.!]?\s+(?:the\s+)?/i, "")
    .replace(/^(?:choose|go with|pick|try|grab|start with)\s+(?:the\s+)?/i, "")
    .replace(/^.*\blike the\s+/i, "")
    .replace(/^.*:\s+/i, "")
    .replace(/\b(?:Product Details|Learn More|More Options|Other Products|Buy Now|Shop Now|Details)\b/gi, " ")
    .replace(/\s+-\s+YouTube\b[\s\S]*$/i, "")
    .replace(/\s*[\u2013\u2014-]\s*(?:it|if|and)\b[\s\S]*$/i, "")
    .replace(/\s*,\s+available in\b[\s\S]*$/i, "")
    .replace(/^[\s:;,.!?'"\u201C\u201D\u2018\u2019()[\]-]+|[\s:;,.!?'"\u201C\u201D\u2018\u2019()[\]-]+$/g, "")
    .replace(/^(?:the|a|an|our|my|your)\s+/i, "")
    .replace(/\s+(?:because|since|while|if|so|which|based on|on the page|pricing in|ranges from|depending on|on a tight|for an easy|to get|to keep|plus|and checkout|and check out|and grab|and add|with free|before tax|plus tax|at checkout)\b[\s\S]*$/i, "")
    .replace(/\s+(?:at|for)\s*,?\s+(?:and\s+)?(?:only|just|currently)\b[\s\S]*$/i, "")
    .replace(/\s+(?:and|or)\s+(?:keep|make|give|grab|add|check|checkout|you|it|if)\b[\s\S]*$/i, "")
    .replace(/\s+(?:is|are|would be|looks|feels|costs|priced)\b[\s\S]*$/i, "")
    .replace(/\s+(?:at|for|from|to|with|before|after)\s*$/i, "")
    .replace(/\s*[\u2013\u2014-]\s*$/i, "")
    .replace(/\s+\b(?:is|are|was|were)\s+(?:the|a|an)\b[\s\S]*$/i, "")
    .trim();
}

function productKey(name) {
  return canonicalProductName(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasProductShape(name) {
  const n = canonicalProductName(name);
  if (n.length < 4 || n.length > 90) return false;
  if (GENERIC_RE.test(n) || CTA_RE.test(n)) return false;
  if (/^[\d.,]+$/.test(n)) return false;
  if (/^\d+\s+(?:products?|items?|months?|of|each)\b/i.test(n)) return false;
  if (/^\d+\s+(?:comfort|layers?)\b/i.test(n)) return false;
  if (/^(?:duo|set|3-piece)$/i.test(n)) return false;
  if (/\b(?:each month|subscriptions?|select \d|pick \d|right razor from dollar shave club|take a look|let me know|please let me know|specific preferences|do you have|value recipes?|value meals?|whole bean|print it as a pdf|ai agent powered|cancel message)\b/i.test(n)) return false;
  if (/^(?:if|for|one|next|view|ask|also|prices|therefore|what|you|to get|to make|don't|do not|shop|just note|i can|i could|you are|orders?|shipping|the product|product details|learn more)\b/i.test(n)) return false;
  if (/^[a-z]/.test(n) && !/^(?:adidas|ipsy|iPhone|iPad)\b/.test(n)) return false;
  const words = n.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const titleish = words.filter((w) => /^[A-Z0-9][A-Za-z0-9'&.-]*$/.test(w) || /^[A-Z0-9][A-Z0-9'&.-]+$/.test(w)).length;
  const hasDigit = /\d/.test(n);
  const hasHyphenBrand = /[A-Za-z]+-[A-Za-z]+/.test(n);
  return titleish >= 2 || (titleish >= 1 && (hasDigit || hasHyphenBrand || words.length >= 3));
}

function collapseContainedProducts(products) {
  const sorted = [...products].sort((a, b) => productKey(b.name).length - productKey(a.name).length);
  const kept = [];
  for (const product of sorted) {
    const key = productKey(product.name);
    if (!key) continue;
    const duplicate = kept.some((other) => {
      const otherKey = productKey(other.name);
      const words = key.split(/\s+/).filter(Boolean);
      const otherWords = new Set(otherKey.split(/\s+/).filter(Boolean));
      const coveredByLongerName = words.length >= 3 && words.every((w) => otherWords.has(w));
      return (otherKey.includes(key) && otherKey.length >= key.length + 5) || coveredByLongerName;
    });
    if (!duplicate) kept.push(product);
  }
  return kept.sort((a, b) => a.name.localeCompare(b.name));
}

function addProduct(products, rawName, source, evidence) {
  const name = canonicalProductName(rawName);
  if (source === "recommendation_phrase" && /\b(?:subscriptions?|months?|each month|select \d|pick \d)\b/i.test(evidence)) return;
  if (!hasProductShape(name)) return;
  const key = productKey(name);
  if (!key || key.length < 4) return;
  const current = products.get(key);
  if (!current || source === "product_card" || source === "product_link") {
    products.set(key, {
      name,
      source,
      evidence: compactWhitespace(evidence).slice(0, 180),
    });
  }
}

function addProductFromUrl(products, slug, evidence) {
  const name = titleFromSlug(slug);
  addProduct(products, name, "product_link", evidence);
}

function looksLikePriceLine(line) {
  const l = compactWhitespace(line);
  return PRICE_RE.test(l) && l.length <= 80;
}

function extractFromPriceCards(raw, products) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((x) => compactWhitespace(x))
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || /you said:|^\d{1,2}:\d{2}/i.test(line)) continue;

    const sameLine = line.match(/^(.{4,95}?)\s+(?:[$\u00A3\u20AC]\s?\d|\d[\d,.]*\s?(?:USD|EUR|GBP|AUD|CAD)\b)/i);
    if (sameLine) addProduct(products, sameLine[1], "product_card", line);

    const next = lines[i + 1] || "";
    const next2 = lines[i + 2] || "";
    if ((looksLikePriceLine(next) || looksLikePriceLine(next2)) && !PRICE_RE.test(line)) {
      addProduct(products, line, "product_card", `${line} ${next} ${next2}`);
    }
  }
}

function splitCandidateList(segment) {
  const cleaned = canonicalProductName(segment)
    .replace(/^(?:between|both|these|those|two|top|best)\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const pieces = cleaned
    .split(/\s+(?:or|and)\s+(?=(?:the\s+)?[A-Z0-9])|,\s+(?=(?:the\s+)?[A-Z0-9])/)
    .map((x) => canonicalProductName(x))
    .filter(Boolean);
  return pieces.length ? pieces : [cleaned];
}

function extractFromRecommendationPhrases(raw, products) {
  const text = stripEchoes(raw).replace(/\r?\n/g, " ");
  const patterns = [
    /\b(?:top|final|starter|gift|best|overall|personal|beginner|safest|right|strongest|smartest|better-value|quality-first)?\s*(?:recommendation|pick|choice|option|move)\s+(?:is|would be|:)\s+(?:the\s+)?([^.!?\n]{4,150})/gi,
    /\b(?:we(?:'|\u2019)?d|we would|i(?:'|\u2019)?d|i would)\s+(?:recommend|pick|suggest|choose)\s+(?:the\s+)?([^.!?\n]{4,130})/gi,
    /\b(?:go with|choose|start with|try|grab)\s+(?:the\s+)?([^.!?\n]{4,120})/gi,
    /\b(?:best|top|strongest|nicest)\s+(?:pairings|options|ideas|picks)\s+(?:are|include)\s+(?:the\s+)?([^.!?\n]{4,180})/gi,
    /\b(?:the two|two)\s+(?:strongest|best|top)\s+(?:picks|options|ideas)\s+(?:for you\s+)?(?:are|would be)\s+(?:the\s+)?([^.!?\n]{4,180})/gi,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      for (const candidate of splitCandidateList(m[1])) {
        addProduct(products, candidate, "recommendation_phrase", m[0]);
      }
    }
  }
}

export function extractRecommendedProducts(turns) {
  const products = new Map();
  for (const turn of turns || []) {
    if (turn.unsent || turn.by === "human") continue;
    const raw = turn.replyText || turn.replyTail || "";
    let m;
    PRODUCT_URL_RE.lastIndex = 0;
    while ((m = PRODUCT_URL_RE.exec(raw))) addProductFromUrl(products, m[1], m[0]);
    extractFromPriceCards(raw, products);
    extractFromRecommendationPhrases(raw, products);
  }
  return collapseContainedProducts(products.values());
}

function parseArgs(argv) {
  const out = {
    windowDays: DEFAULT_WINDOW_DAYS,
    allDates: false,
    date: null,
    markdown: null,
    json: null,
    barWidth: DEFAULT_BAR_WIDTH,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--window-days") out.windowDays = Number(argv[++i]);
    else if (a === "--all-dates") out.allDates = true;
    else if (a === "--date") out.date = argv[++i];
    else if (a === "--markdown") out.markdown = argv[++i];
    else if (a === "--json") out.json = argv[++i];
    else if (a === "--bar-width") out.barWidth = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node runner/product-recommendation-bars.js [--window-days 14|--all-dates|--date YYYY-MM-DD] [--markdown path] [--json path]");
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  if (out.date && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error(`Invalid --date: ${out.date}`);
  if (!Number.isFinite(out.windowDays) || out.windowDays < 1) throw new Error(`Invalid --window-days: ${out.windowDays}`);
  if (!Number.isFinite(out.barWidth) || out.barWidth < 4) throw new Error(`Invalid --bar-width: ${out.barWidth}`);
  return out;
}

function allRunDates() {
  return fs.readdirSync(RESULTS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name) && fs.existsSync(path.join(RESULTS, d.name, "conv")))
    .map((d) => d.name)
    .sort();
}

function cutoffFor(latest, windowDays) {
  const d = new Date(`${latest}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (windowDays - 1));
  return d.toISOString().slice(0, 10);
}

function siteByKey() {
  return new Map(STORES.map((s) => [s.key, s]));
}

function includeStore(store, mode) {
  if (!store || !store.url) return false;
  // Gorgias-only v3:false exclusion removed 2026-07-17 for neutrality (see gen.js note).
  if (store.key === "gorgias-madura" && mode === "shopping") return false;
  return true;
}

function loadConversationRows({ dates }) {
  const sites = siteByKey();
  const rows = [];
  for (const date of dates) {
    const dir = path.join(RESULTS, date, "conv");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x.includes("-shopping-")).sort()) {
      const id = `${date}/${f}`;
      if (isQuarantinedConversation(id) || f.includes("guardrails")) continue;
      let obj;
      try { obj = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
      if (obj.mode !== "shopping" || obj.theme === "guardrails") continue;
      const store = sites.get(obj.key);
      if (!includeStore(store, "shopping")) continue;
      if (connectivityFail(obj.turns || [])) continue;
      if (obj.valid === false || !convoValidity(obj.turns || []).valid) continue;
      const products = extractRecommendedProducts(obj.turns || []);
      rows.push({
        id,
        date,
        vendor: obj.vendor,
        store: obj.store,
        key: obj.key,
        theme: obj.theme,
        theme_label: obj.themeLabel || obj.theme,
        product_count: products.length,
        products: products.map((p) => p.name),
        evidence: products,
      });
    }
  }
  return rows;
}

function summarizeByVendor(rows) {
  const by = new Map();
  for (const row of rows) {
    const current = by.get(row.vendor) || { vendor: row.vendor, conversations: 0, total_products: 0, with_products: 0, max_products: 0 };
    current.conversations++;
    current.total_products += row.product_count;
    if (row.product_count > 0) current.with_products++;
    current.max_products = Math.max(current.max_products, row.product_count);
    by.set(row.vendor, current);
  }
  return [...by.values()]
    .map((x) => ({
      ...x,
      avg_products: x.conversations ? Math.round((x.total_products / x.conversations) * 100) / 100 : 0,
      product_rate: x.conversations ? Math.round((x.with_products / x.conversations) * 100) : 0,
    }))
    .sort((a, b) => b.avg_products - a.avg_products || b.product_rate - a.product_rate || a.vendor.localeCompare(b.vendor));
}

function bar(value, maxValue, width) {
  if (!value || !maxValue) return "-";
  const n = Math.max(1, Math.round((value / maxValue) * width));
  return "#".repeat(n);
}

function mdEscape(s) {
  return String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatAverage(n) {
  return Number(n || 0).toFixed(2);
}

export function renderMarkdown({ rows, summary, dates, cutoff, latest, barWidth = DEFAULT_BAR_WIDTH }) {
  const maxConversationCount = Math.max(1, ...rows.map((r) => r.product_count));
  const maxAvg = Math.max(1, ...summary.map((r) => r.avg_products));
  const lines = [];
  lines.push("# Shopping Assistant product recommendations");
  lines.push("");
  lines.push(`Generated from captured Shopping Assistant conversations in \`${dates.join(", ")}\`.`);
  lines.push(`Ranking window: \`${cutoff}\` to \`${latest}\`.`);
  lines.push("");
  lines.push("Definition: counts distinct product recommendations with transcript evidence. Product cards, product links, and named products in recommendation phrases count. Generic categories alone do not count, so this is a conservative lower-bound. Card-only recommendations that are not serialized into the captured transcript can be undercounted.");
  lines.push("");
  lines.push("## Vendor Summary");
  lines.push("");
  lines.push("| Vendor | Conversations | Avg products / conv | Conv with products | Bar | Max in one conv |");
  lines.push("|---|---:|---:|---:|---|---:|");
  for (const row of summary) {
    lines.push(`| ${mdEscape(row.vendor)} | ${row.conversations} | ${formatAverage(row.avg_products)} | ${row.product_rate}% | \`${bar(row.avg_products, maxAvg, barWidth)}\` | ${row.max_products} |`);
  }
  lines.push("");
  lines.push("## Per Conversation");
  lines.push("");
  lines.push("| Vendor | Store | Theme | Products | Bar | Products detected | Conversation |");
  lines.push("|---|---|---|---:|---|---|---|");
  for (const row of [...rows].sort((a, b) => b.product_count - a.product_count || a.vendor.localeCompare(b.vendor) || a.store.localeCompare(b.store))) {
    lines.push(`| ${mdEscape(row.vendor)} | ${mdEscape(row.store)} | ${mdEscape(row.theme_label)} | ${row.product_count} | \`${bar(row.product_count, maxConversationCount, barWidth)}\` | ${mdEscape(row.products.join("; ") || "-")} | \`${row.id}\` |`);
  }
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("node runner/product-recommendation-bars.js --markdown docs/SHOPPING_PRODUCT_RECOMMENDATIONS.md --json runner/.eval-wip/shopping-product-recommendations.json");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function renderConsole({ rows, summary, dates, cutoff, latest, barWidth }) {
  const markdown = renderMarkdown({ rows, summary, dates, cutoff, latest, barWidth });
  const sections = markdown.split("\n## Per Conversation\n");
  console.log(sections[0]);
  console.log("\n## Per Conversation\n");
  console.log(sections[1].split("\n## Reproduce\n")[0].split("\n").slice(0, 35).join("\n"));
  if (rows.length > 30) console.log(`\n... ${rows.length - 30} more conversations. Use --markdown to write the full table.`);
}

export function buildProductRecommendationReport(args = {}) {
  const allDates = allRunDates();
  const latest = allDates[allDates.length - 1];
  const dates = args.date ? [args.date] : (args.allDates ? allDates : allDates.filter((d) => d >= cutoffFor(latest, args.windowDays || DEFAULT_WINDOW_DAYS)));
  const cutoff = dates[0] || latest;
  const rows = loadConversationRows({ dates });
  const summary = summarizeByVendor(rows);
  return { generated_at: new Date().toISOString(), dates, latest, cutoff, rows, summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildProductRecommendationReport(args);
  renderConsole({ ...report, barWidth: args.barWidth });
  if (args.markdown) {
    fs.mkdirSync(path.dirname(args.markdown), { recursive: true });
    fs.writeFileSync(args.markdown, renderMarkdown({ ...report, barWidth: args.barWidth }));
    console.log(`\nWrote ${args.markdown}`);
  }
  if (args.json) {
    fs.mkdirSync(path.dirname(args.json), { recursive: true });
    fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
    console.log(`Wrote ${args.json}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`product-recommendation-bars failed: ${err.message}`);
    process.exit(1);
  });
}
