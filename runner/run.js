// Headless, COLD-session benchmark runner — 2–3 stores per vendor.
//
// For every STORE and each mode it:
//   1. opens a FRESH browser context (isolated storage = genuinely cold session,
//      no warm carryover — the thing live Chrome can't give us)
//   2. opens the chat widget
//   3. sends each turn of the standardized pool (NO turn asks for a human)
//   4. times each reply at the browser level (transcript grows + stabilizes)
//   5. flags any unprompted handover to a human (incl. "agent joined", transfer,
//      email-gate, FR phrasings) = the failure we measure
//   6. writes results/<date>/<store>-<mode>.json + a summary.json with
//      per-store and per-vendor latency + success rate (% turns, no handover)
//
// Usage:
//   node run.js                          # all stores, both modes
//   node run.js --store gorgias-madura   # one store
//   node run.js --vendor Sierra          # all stores of a vendor
//   node run.js --mode shopping
//   node run.js --skip-candidates        # only verified stores
//
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { WIDGETS, STORES, readLatestAssistantReply, readTranscript } from "./vendors.js";
import { SHOPPING_THEMES, SUPPORT_THEMES } from "./pools.js";
import { isGen, isAck, isNoAnswer, detectHandover, convoValidity } from "./classify.js";
import { normalizeUserMessage } from "./message-style.js";

// Prefix every log line with an ISO timestamp so run-status can render each activity event
// in the viewer's local time. runstatus.parseLog strips/keeps the prefix.
{ const _log = console.log.bind(console); console.log = (...a) => _log(new Date().toISOString() + " " + a.join(" ")); }

const POLL_MS = 250, STABLE_MS = 5000, GROWTH = 60, SETTLE_MS = 2500;
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS) || 60000;
// Real desktop UA — some chat widgets refuse to load for the default headless UA.
const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// Some AI widgets (Rep AI, Kodif, Humind…) refuse to load in headless — they
// detect the headless browser. --headed launches the real Chrome binary with a
// visible window (still a fresh context per run = cold), which they DO load.
const HEADED = process.argv.includes("--headed") || process.env.HEADED === "1";
// Anti-automation-detection: patch the obvious headless/automation tells.
const STEALTH = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  // A real-ish chrome.runtime stub. The old `{runtime:{}}` had a truthy `runtime` but no
  // sendMessage(), so widgets that do `if (chrome.runtime) chrome.runtime.sendMessage(...)`
  // (e.g. Spiffy/Envive's init) threw and aborted before mounting. Provide no-op functions.
  const _noop = () => {};
  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {};
  if (typeof window.chrome.runtime.sendMessage !== "function") window.chrome.runtime.sendMessage = () => Promise.resolve();
  if (typeof window.chrome.runtime.connect !== "function") window.chrome.runtime.connect = () => ({ postMessage: _noop, onMessage: { addListener: _noop }, disconnect: _noop });
  try { if (!("lastError" in window.chrome.runtime)) Object.defineProperty(window.chrome.runtime, "lastError", { get: () => undefined }); } catch {}
  // Sierra: find the shadow root that CONTAINS the composer (its aria-label is never in
  // textContent, so text-needle matching fails). Used by the sierra handler + reader.
  window.__sierraRoot = (composerSel) => {
    let found = null;
    const walk = (n) => {
      if (found || !n) return;
      for (const el of (n.querySelectorAll ? n.querySelectorAll("*") : [])) if (el.shadowRoot) {
        if (el.shadowRoot.querySelector(composerSel)) { found = el.shadowRoot; return; }
        walk(el.shadowRoot); if (found) return;
      }
    };
    walk(document);
    return found;
  };
};

// Handover detection lives in classify.js (imported above) so it can be unit-tested.

const args = process.argv.slice(2);
const pick = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; const out = []; for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]); return out; };
const storeFilter = pick("--store");
const vendorFilter = pick("--vendor");
const modeFilter = pick("--mode");
const skipCandidates = args.includes("--skip-candidates");
// --video: record a .webm of the FIRST theme per (store,mode) — board-demo evidence
// (Roman's videos were the most persuasive artifact in his Notion doc). Off by default:
// videos are heavy and slow the pipeline; use for flagship/monthly runs.
const VIDEO = args.includes("--video");
const RESUME = !args.includes("--no-resume");   // skip (store,mode) already written this run-date → survives kills
const SERIAL = args.includes("--serial");        // per-store serialize (cleaner latency, slower); default OFF = max throughput
// Parallelism: each (store,mode) runs in its own incognito context, so they're
// independent. Latency is network/model-bound (not CPU-bound), so modest
// concurrency doesn't skew timing. Default 4; tune with --concurrency N.
const CONC = Math.max(1, Number((pick("--concurrency") || [])[0]) || Number(process.env.CONCURRENCY) || 4);
const THEME_LIMIT = Number((pick("--themes") || [])[0]) || 0;   // 0 = all themes
const MAX_CONVERSATIONS = Number((pick("--max-conversations") || [])[0]) || Number(process.env.MAX_CONVERSATIONS) || 0;   // 0 = unbounded
const MODES = (modeFilter || ["shopping", "support"]);
const STAMP = (process.env.RUN_DATE || new Date().toISOString().slice(0, 10));
const CAPTURE_BATCH = String(process.env.BENCHMARK_CAPTURE_BATCH || process.env.CAPTURE_BATCH || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "");

function normalizeCaptureOrigin(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return null;
  if (["codex", "openai-codex", "codex-desktop"].includes(v)) return "codex";
  if (["claude", "claude-code", "anthropic-claude"].includes(v)) return "claude";
  if (["automation", "cron", "launchd", "weekly-local", "daily-local"].includes(v)) return "automation";
  return v.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function detectCaptureOrigin() {
  const explicit = normalizeCaptureOrigin(process.env.BENCHMARK_CAPTURE_ORIGIN || process.env.CAPTURE_ORIGIN || process.env.AGENT_ORIGIN);
  if (explicit) return { origin: explicit, explicit: true };
  if (process.env.CODEX_SHELL || process.env.CODEX_CI || /codex/i.test(process.env.__CFBundleIdentifier || "")) return { origin: "codex", explicit: false };
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE || /claude/i.test(process.env.__CFBundleIdentifier || "")) return { origin: "claude", explicit: false };
  return { origin: "unknown", explicit: false };
}

const CAPTURE_ORIGIN = detectCaptureOrigin();

let targets = STORES.filter(s => s.url);
// --store accepts space- OR comma-separated keys (`--store a b` or `--store a,b`). pick()
// returns the space-split tokens; we also split on commas so a comma-list doesn't silently
// match nothing (which used to print a misleading "ALL DONE").
if (storeFilter) { const keys = storeFilter.flatMap(x => x.split(",")).map(x => x.trim()).filter(Boolean); targets = targets.filter(s => keys.includes(s.key)); }
if (vendorFilter) targets = targets.filter(s => vendorFilter.flatMap(x => x.split(",")).map(x => x.trim().toLowerCase()).includes(s.vendor.toLowerCase()));
if (skipCandidates) targets = targets.filter(s => !s.candidate);
if ((storeFilter || vendorFilter) && !targets.length) { console.error(`✗ --store/--vendor matched ZERO stores (filter: ${JSON.stringify(storeFilter || vendorFilter)}). Check the keys against vendors.js.`); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Typing / stall(ack) / no-answer classifiers now live in classify.js (imported above)
// so they can be unit-tested without a browser.

// TRUE end-to-end latency: t0 = the instant the user message is sent; complete_ms
// = the instant the AI's FULL, FINAL reply finished rendering (last text change) − t0.
// We skip the user-message echo, never stop on a "Thinking…" indicator, and never stop on
// an intermediate stall ("let me check…") — the clock runs to the real final answer.
async function timeTurn(page, scope, sendFn, q) {
  const before = (await readTranscript(page, scope)).len;
  const echoApprox = (q ? q.length : 80) + 70;   // "HH:MM. You said: <q> HH:MM"
  const REPLY_MIN = echoApprox + 40;              // growth beyond this = a real reply, not the echo
  const t0 = Date.now();
  await sendFn();
  let lastLen = before, lastChange = t0, ttft = null, sawGen = false, grownReply = false, complete = null, growthEvents = 0;
  const deadline = t0 + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const { len, text } = await readTranscript(page, scope);
    if (len !== lastLen) { lastChange = Date.now(); if (len > lastLen) growthEvents++; lastLen = len; }
    if (isGen(text)) sawGen = true;
    if (len > before + REPLY_MIN) { grownReply = true; if (ttft == null) ttft = Date.now() - t0; }
    // "still working" = a typing indicator, OR a short stall/ack message that will be
    // followed by the real answer. A long reply (>240 chars) is accepted even if it
    // coincidentally ends acknowledgement-like.
    const shortSoFar = (len - before) < 240;
    const working = isGen(text) || (isAck(text) && shortSoFar);
    const settled = Date.now() - lastChange > STABLE_MS;
    // A settled transcript that's just an offline/reconnecting state or a chip/"leave a
    // message" menu is NOT a real answer — never stop the clock on it (leaves complete_ms
    // null → the conversation's validity gate will drop it as noise).
    const realAnswer = (grownReply || (sawGen && len > before + 40)) && !isNoAnswer(text);
    if (settled && !working && realAnswer) { complete = lastChange - t0; break; }
  }
  // growth_events distinguishes DELIVERY: many increments = token/segment streaming,
  // 1-2 jumps = atomic bubble. Aggregated per vendor by gen.js (Roman's wire analysis
  // showed the split matters: streaming bots show substance long before full answer).
  return { ttft_ms: ttft, complete_ms: complete, grew: lastLen - before, growth_events: growthEvents };
}

// NETWORK-timed turn — for closed widgets (Rep AI, Humind) whose DOM is awkward but
// whose assistant reply arrives on a known backend endpoint. t0 = send; complete =
// when the last new reply payload arrived after t0 and then went quiet for STABLE_MS.
// `net.replies` is the live buffer filled by the page 'response' listener.
async function timeTurnNet(page, net, sendFn) {
  const base = net.replies.length;
  const t0 = Date.now();
  await sendFn();
  let lastNew = null, count = base, ttft = null, complete = null;
  const deadline = t0 + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (net.replies.length > count) { const r = net.replies[net.replies.length - 1]; if (r.t >= t0) { lastNew = r.t; if (ttft == null) ttft = lastNew - t0; } count = net.replies.length; }
    // don't settle on a short stall/ack ("let me check…") — wait for the real final answer
    const chunk = net.replies.slice(base);
    const joined = chunk.map(r => r.text).join("  ");
    const working = chunk.length && isAck(chunk[chunk.length - 1].text) && joined.length < 240;
    if (lastNew && !working && Date.now() - lastNew > STABLE_MS) { complete = lastNew - t0; break; }
  }
  return { ttft_ms: ttft, complete_ms: complete, grew: count - base, replyText: net.replies.slice(base).map(r => r.text).join("  ") };
}

// Hard wall-clock cap around any awaited op. timeTurn's own deadline only bounds its POLL
// loop — it can't bound `await sendFn()` (a handler's selector/frame wait) or readTranscript,
// which run outside the loop. A handler that hangs there froze a whole shard for 82 min in CI
// (Gorgias, 2026-07-02). This races the op against a timer so a hang becomes a —ms turn the
// caller's try/catch already handles, and the loop advances to the next store.
function withTimeout(promise, ms, label) {
  let to;
  const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`hard-timeout:${label} after ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(to));
}

async function runStoreMode(browser, store, mode, theme) {
  const w = WIDGETS[store.widget];
  const pool = theme.turns;
  const out = {
    key: store.key, vendor: store.vendor, store: store.store, url: store.url, us: !!store.us, widget: store.widget,
    mode, theme: theme.key, themeLabel: theme.label, date: STAMP, capturedAt: new Date().toISOString(),
    capture: {
      origin: CAPTURE_ORIGIN.origin,
      origin_explicit: CAPTURE_ORIGIN.explicit,
      batch: CAPTURE_BATCH || null,
      runner: "run.js",
      browser: HEADED ? "headed" : "headless",
      schema: 1,
    },
    turns: [],
  };
  // INCOGNITO/COLD: a brand-new Playwright context has zero cookies/localStorage/
  // IndexedDB/cache for ANY origin (the widget's cross-origin storage included),
  // so there is never a pre-existing conversation. storageState is left undefined
  // (no profile) and we clear cookies as belt-and-suspenders.
  const ctxOpts = { viewport: { width: 1366, height: 900 }, locale: store.locale || "en-US", timezoneId: "America/New_York", userAgent: REAL_UA, extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }, storageState: store.stateFile ? new URL(store.stateFile, import.meta.url).pathname : undefined };
  // --video: only the first theme per (store,mode) gets recorded — one demo clip each.
  const isFirstTheme = theme.key === (mode === "support" ? SUPPORT_THEMES : SHOPPING_THEMES)[0].key;
  if (VIDEO && isFirstTheme) ctxOpts.recordVideo = { dir: `results/${STAMP}/video`, size: { width: 1366, height: 900 } };
  const context = await browser.newContext(ctxOpts);
  await context.addInitScript(STEALTH);
  // Spiffy/Envive gates its widget behind an A/B rollout bucket that a cold context re-rolls
  // to "disabled"; this sanctioned flag forces it ON before the session-bucket check.
  if (store.widget === "spiffy") await context.addInitScript(() => { try { localStorage.setItem("spiffy_on", "true"); } catch (e) {} });
  await context.clearCookies().catch(() => {});
  // Block only VIDEO/AUDIO (pure overhead, never part of a chat widget). We deliberately do
  // NOT block images/fonts — many chat launchers are icon-fonts or <img>, and blocking them
  // made open() fail to find the launcher and burn its fallback waits (slow to first message).
  await context.route("**/*", (route) => {
    return route.request().resourceType() === "media" ? route.abort() : route.continue();
  }).catch(() => {});
  const page = await context.newPage();

  // Capture the Gorgias ticket id + account subdomain so we can build a direct
  // agent-dashboard link to each conversation.
  const cap = { shop: null, accountId: null, appId: null, conversations: new Set(), ticketIds: new Set(), hosts: new Set() };
  if (store.widget === "gorgias") {
    const scan = (s) => {
      if (!s) return;
      let m;
      if (!cap.shop && (m = s.match(/"shopName"\s*:\s*"([^"]+)"/))) cap.shop = m[1];
      if (!cap.accountId && (m = s.match(/"account"\s*:\s*\{\s*"id"\s*:\s*(\d+)/))) cap.accountId = m[1];
      if (!cap.appId && (m = s.match(/"applicationId"\s*:\s*(\d+)/))) cap.appId = m[1];
      let re = /"conversationId"\s*:\s*"([a-f0-9-]{36})"/g; while ((m = re.exec(s))) cap.conversations.add(m[1]);
      re = /"ticket(?:_?[Ii]d)?"\s*:\s*(\d{4,})/g; while ((m = re.exec(s))) cap.ticketIds.add(m[1]);
      re = /\/tickets\/(\d{4,})/g; while ((m = re.exec(s))) cap.ticketIds.add(m[1]);
    };
    page.on("websocket", (ws) => {
      ws.on("framereceived", (f) => { try { scan(typeof f.payload === "string" ? f.payload : ""); } catch {} });
      ws.on("framesent", (f) => { try { scan(typeof f.payload === "string" ? f.payload : ""); } catch {} });
    });
    page.on("response", async (resp) => {
      try {
        const u = resp.url(); if (!/gorgias/.test(u)) return;
        cap.hosts.add(new URL(u).hostname);
        if (/ticket|message|conversation|application|widget|config/i.test(u)) { const t = await resp.text(); scan(t.slice(0, 200000)); }
      } catch {}
    });
  }

  // NETWORK-transport widgets (Rep AI, Humind): the assistant's reply text arrives on
  // a backend endpoint, not the DOM. Buffer every parsed reply with its arrival time.
  const net = { replies: [], seen: new Set() };
  if (w.transport === "net" && w.net) {
    page.on("response", async (resp) => {
      try {
        if (!w.net.match.test(resp.url())) return;
        const body = await resp.text();
        const t = Date.now();                 // for streams, text() resolves at stream END
        for (const txt of (w.net.parse(body, resp.url()) || [])) {
          const k = txt.slice(0, 120);
          if (txt && txt.trim() && !net.seen.has(k)) { net.seen.add(k); net.replies.push({ t, text: txt }); }
        }
      } catch {}
    });
  }

  try {
    const _t = Date.now(), _el = () => ((Date.now() - _t) / 1000).toFixed(0) + "s";
    // "commit" returns as soon as navigation starts (not full DOM) so widget-open begins ASAP.
    await page.goto(store.url, { waitUntil: "commit", timeout: 45000 });
    console.log(`  [${store.key}/${mode}/${theme.key}] page @${_el()} → opening widget…`);
    await withTimeout(w.open(page), 90000, "open");
    console.log(`  [${store.key}/${mode}/${theme.key}] widget open @${_el()} → first message`);
    let handedOver = false;
    const useNet = w.transport === "net" && w.net;
    for (let i = 0; i < pool.length; i++) {
      const q = normalizeUserMessage(pool[i]);
      // Handed to a human on an earlier turn → STOP talking to the human. We do NOT
      // keep sending scripted shopper messages to a live agent. The remaining turns
      // are recorded as "not sent" (by:human) so the full-journey denominator — and
      // therefore the success rate — is preserved (a bail-out at T3 of 7 stays 2/7,
      // it doesn't get flattered to 2/3).
      if (handedOver) {
        out.turns.push({ turn: i + 1, q, by: "human", ttft_ms: null, complete_ms: null,
          ai_latency_ms: null, handover: false, handover_hit: null, unsent: true,
          replyTail: "(not sent — conversation was handed to a human)" });
        console.log(`  [${store.key}/${mode}/${theme.key}] T${i + 1} (not sent — handed to human)`);
        continue;
      }
      let r, handoverTail, replyTail;
      if (useNet) {
        try { r = await withTimeout(timeTurnNet(page, net, () => w.send(page, q)), TURN_TIMEOUT_MS + 15000, "turn-net"); }
        catch (e) { r = { ttft_ms: null, complete_ms: null, error: String(e).slice(0, 120) }; }
        handoverTail = replyTail = net.replies.slice(-3).map(x => x.text).join("  ").slice(-700);
      } else {
        const beforeAssistant = store.widget === "yuma"
          ? await readLatestAssistantReply(page, w.scope).catch(() => "")
          : "";
        try { r = await withTimeout(timeTurn(page, w.scope, () => w.send(page, q), q), TURN_TIMEOUT_MS + 15000, "turn"); }
        catch (e) { r = { ttft_ms: null, complete_ms: null, error: String(e).slice(0, 120) }; }
        const transcript = (await readTranscript(page, w.scope)).text;
        handoverTail = transcript.slice(-700);
        const latestAssistant = store.widget === "yuma" ? await readLatestAssistantReply(page, w.scope) : "";
        // Yuma keeps the previous assistant bubble in the DOM after an unanswered/timeout
        // turn. Only attach a Yuma reply snippet when a new bubble appeared for this turn.
        replyTail = store.widget === "yuma"
          ? (latestAssistant && latestAssistant !== beforeAssistant ? latestAssistant : "")
          : handoverTail;
        replyTail = replyTail.slice(-700);
      }
      // Pass the store/vendor name so the bot's own brand label ("Tediber says:") isn't
      // misread as a human agent named "Tediber".
      // store.personas covers AI agents replying under a human first name (Atma/Yuma's "Lucas says:").
      const handover = detectHandover(handoverTail, w.handover, [store.store, store.vendor, ...(store.personas || [])]);
      if (handover) handedOver = true;
      // Once a human owns the thread, every later turn is human too. We NEVER
      // count a human reply's latency — only the AI's own responses are timed.
      const by = handedOver ? "human" : "ai";
      out.turns.push({ turn: i + 1, q, by, ...r, ai_latency_ms: by === "ai" ? r.complete_ms : null, handover: !!handover, handover_hit: handover, replyTail: replyTail.slice(-500) });
      console.log(`  [${store.key}/${mode}/${theme.key}] T${i + 1} ${by === "ai" ? (r.complete_ms ?? "—") + "ms" : "(human)"}${handover ? "  ⛔ HANDOVER: " + handover : ""}`);
      await sleep(SETTLE_MS);
    }
  } catch (e) {
    out.error = String(e).slice(0, 200);
    console.log(`  [${store.key}/${mode}/${theme.key}] FAILED: ${out.error}`);
  } finally {
    // Build the Gorgias agent-dashboard ticket link(s) from what we captured.
    if (store.widget === "gorgias") {
      const tids = [...cap.ticketIds], convs = [...cap.conversations];
      const sub = cap.shop, tid = tids[tids.length - 1] || null;
      out.ticket = {
        subdomain: sub, account_id: cap.accountId, application_id: cap.appId,
        ticket_id: tid, conversation_id: convs[convs.length - 1] || null,
        url: (sub && tid) ? `https://${sub}.gorgias.com/app/ticket/${tid}` : (sub ? `https://${sub}.gorgias.com/app/tickets` : null),
        all_ticket_ids: tids, all_conversations: convs, hosts: [...cap.hosts],
      };
      console.log(`  [${store.key}] ticket: shop=${sub} acct=${cap.accountId} tid=${tid} conv=${out.ticket.conversation_id}`);
    }
    // Rename the Playwright-random video file to a meaningful name (path is only
    // final after context.close()).
    let vid = null;
    if (VIDEO && isFirstTheme) { try { vid = await page.video()?.path(); } catch {} }
    await context.close();
    if (vid) {
      const dest = `results/${STAMP}/video/${store.key}-${mode}.webm`;
      try { const { rename } = await import("node:fs/promises"); await rename(vid, dest); out.video = dest; console.log(`  [${store.key}/${mode}] 🎬 video → ${dest}`); } catch {}
    }
  }

  // Latency is computed ONLY over AI turns — human replies are never timed.
  const aiValid = out.turns.filter(t => t.by === "ai").map(t => t.complete_ms).filter(x => x != null);
  const firstHandover = out.turns.find(t => t.handover);
  const answered = out.turns.filter(t => t.by === "ai" && t.complete_ms != null).length;
  // Validity gate: a conversation is a real data point only if it hit a handover (a genuine
  // finding) OR produced enough cleanly-timed answers. Otherwise it's noise (menu/offline/
  // timeout) and must not pollute the report.
  const v = convoValidity(out.turns);
  out.valid = v.valid;
  out.invalid_reason = v.reason;
  out.stats = {
    turns: out.turns.length,
    answered_no_handover: answered,
    success_rate: out.turns.length ? Math.round((answered / out.turns.length) * 100) : null,
    avg_ms: aiValid.length ? Math.round(aiValid.reduce((a, b) => a + b, 0) / aiValid.length) : null,
    min_ms: aiValid.length ? Math.min(...aiValid) : null,
    max_ms: aiValid.length ? Math.max(...aiValid) : null,
    latency_basis: "AI turns only (human replies excluded)",
    handover_turn: firstHandover ? firstHandover.turn : null,
    valid: v.valid, timed_turns: v.timed,
  };
  console.log(`  [${store.key}/${mode}/${theme.key}] ${v.valid ? "VALID" : "INVALID — " + v.reason} (timed ${v.timed}/${v.aiAttempted}${v.hadHandover ? ", handover" : ""})`);
  return out;
}

(async () => {
  let browser;
  const launchOpts = { headless: !HEADED, args: ["--disable-blink-features=AutomationControlled",
    "--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions", "--mute-audio", "--no-first-run",
    "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-features=Translate,BackForwardCache,MediaRouter"] };
  try { browser = await chromium.launch({ ...launchOpts, channel: HEADED ? "chrome" : undefined }); }
  catch (e) { browser = await chromium.launch(launchOpts); }
  console.log(HEADED ? "Running HEADED (visible Chrome) — bot-blocked widgets load here." : "Running headless.");
  console.log(`Capture origin: ${CAPTURE_ORIGIN.origin}${CAPTURE_ORIGIN.explicit ? " (explicit)" : " (auto-detected; override with BENCHMARK_CAPTURE_ORIGIN=codex|claude|automation)"}`);
  const CONV_DIR = `results/${STAMP}/conv`;
  await mkdir(CONV_DIR, { recursive: true });   // one file PER CONVERSATION (theme)

  // Build the (store,mode,theme) task list. EACH theme is one independent ~7-turn
  // conversation in its own cold context. RESUME is THEME-level: we skip any
  // conversation already on disk, so a kill loses at most the one in flight —
  // relaunch continues exactly where it stopped. Aggregation happens on READ (gen.js).
  const convFile = (k, mode, theme) => `${CONV_DIR}/${k}-${mode}-${theme}${CAPTURE_BATCH ? `-${CAPTURE_BATCH}` : ""}.json`;
  const tasks = [];
  let skipped = 0;
  for (const store of targets) for (const mode of MODES.filter(m => !store.modes || store.modes.includes(m))) {
    // per-store `modes` restricts a store to specific lanes (e.g. Glamnetic = support only)
    let themes = mode === "support" ? SUPPORT_THEMES : SHOPPING_THEMES;
    if (THEME_LIMIT) themes = themes.slice(0, THEME_LIMIT);
    for (const theme of themes) {
      // RESUME: skip only if a VALID capture exists. Network/load failures (0 turns) AND
      // noise captures (invalid: menu/offline/timeout with no handover) are re-tried,
      // never treated as done — so a re-run keeps trying to get a clean measurement.
      if (RESUME && existsSync(convFile(store.key, mode, theme.key))) {
        try { const j = JSON.parse(readFileSync(convFile(store.key, mode, theme.key), "utf8")); if (j.turns && j.turns.length > 0 && j.valid !== false) { skipped++; continue; } } catch {}
      }
      tasks.push({ store, mode, theme });
    }
  }
  if (skipped) console.log(`↩︎ RESUME: skipping ${skipped} conversations already on disk.`);
  // INTERLEAVE by vendor so early captures span ALL vendors — under frequent kills the
  // report fills in representatively (every vendor gets some data) instead of one vendor
  // at a time; depth accrues on later passes.
  if (!SERIAL && tasks.length) {
    const byV = {}; for (const t of tasks) (byV[t.store.vendor] = byV[t.store.vendor] || []).push(t);
    const lists = Object.values(byV); const rr = [];
    for (let i = 0; rr.length < tasks.length; i++) for (const l of lists) if (l[i]) rr.push(l[i]);
    tasks.length = 0; tasks.push(...rr);
  }
  if (MAX_CONVERSATIONS > 0 && tasks.length > MAX_CONVERSATIONS) {
    const original = tasks.length;
    tasks.length = MAX_CONVERSATIONS;
    console.log(`↯ MAX_CONVERSATIONS: capped ${original} pending conversations to ${tasks.length}.`);
  }
  if (!tasks.length) { console.log("ALL DONE — every conversation already captured for this run-date."); await browser.close(); return; }
  console.log(`Running ${tasks.length} conversations at concurrency ${CONC}, each in a fresh incognito context.\n`);

  const remaining = tasks.slice();
  const inflight = new Set();
  let done = 0, failed = 0;
  async function worker(wid) {
    while (true) {
      let t;
      if (SERIAL) {
        const idx = remaining.findIndex(x => !inflight.has(x.store.key));
        if (idx < 0) { if (remaining.length === 0) break; await sleep(300); continue; }
        t = remaining.splice(idx, 1)[0]; inflight.add(t.store.key);
      } else { t = remaining.shift(); if (!t) break; }
      try {
        const res = await runStoreMode(browser, t.store, t.mode, t.theme);
        // WRITE THIS CONVERSATION IMMEDIATELY — finest-grained durability.
        await writeFile(convFile(t.store.key, t.mode, t.theme.key), JSON.stringify(res)).catch(e => console.log("write err", e.message));
        done++;
        console.log(`  ✔ [${done}/${tasks.length}] ${t.store.key}/${t.mode}/${t.theme.key} · success ${res.stats.success_rate ?? "n/a"}% · avg ${res.stats.avg_ms ?? "n/a"}ms${res.stats.handover_turn ? `  🚩 handover@T${res.stats.handover_turn}` : ""}`);
      } catch (e) { failed++; console.log(`  ✗ ${t.store.key}/${t.mode}/${t.theme.key} ERR ${String(e).slice(0, 100)}`); }
      finally { if (SERIAL) inflight.delete(t.store.key); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, tasks.length) }, (_, i) => worker(i + 1)));
  await browser.close();
  console.log(`Done. Wrote ${done} conversations (${failed} failed) to ${CONV_DIR}/`);
})();
