// Shared PROVIDER-DETECTION registry + logic. Used at CAPTURE TIME (run.js stamps the actual
// provider serving the widget onto every conversation) and by the periodic audit
// (provider-audit.mjs). Merchants switch chat providers constantly — attributing a conversation
// to a stale static vendor is a data-integrity bug (nanit→Mavenoid, Grove=human desk). Detecting
// the provider from the live DOM/script/global signature ties each conversation to the provider
// that ACTUALLY served it: (conversation ↔ site ↔ real provider).
//
// A provider matches if any signature hits; script-host hits are strongest (weight 2), a
// distinctive element/shadow-host id or a window global add 1 each. detect() returns providers
// ranked by strength.

export const PROVIDER_SIGNATURES = {
  "Gorgias":       { scripts: [/gorgias\.chat|config\.gorgias|gorgias\.io/i], ids: [/^gorgias-chat/i], hosts: [/gorgias/i], globals: ["GorgiasChat"] },
  "Envive":        { scripts: [/cdn\.spiffy\.ai|envive-injection|envive\.ai/i], ids: [/^(envive|spiffy)-ai|spiffy-modal-container/i], hosts: [/^(envive|spiffy)-ai-floating/i], globals: ["Envive", "spiffy"] },
  "Siena":         { scripts: [/siena\.cx|siena\.chat|assets\.siena/i], ids: [/siena/i], hosts: [/siena/i], globals: ["Siena", "SienaChat"] },
  "Ada":           { scripts: [/ada\.support|static\.ada|adacdn/i], ids: [/^ada-(entry|button|embed|frame)/i], hosts: [/^ada-/i], globals: ["adaEmbed", "adaSettings"] },
  "Sierra":        { scripts: [/sierra\.chat/i], hosts: [/sierra/i], globals: ["openSierraChat", "sierra"] },
  "Kodif":         { scripts: [/kodif/i], ids: [/kodif/i], hosts: [/kodif/i] },
  "Intercom":      { scripts: [/widget\.intercom\.io|intercomcdn\.com/i], ids: [/^intercom-(container|frame)/i], globals: ["Intercom"] },
  "Zendesk":       { scripts: [/static\.zdassets\.com|zendesk\.com|zopim/i], ids: [/^(launcher|webWidget)/i], globals: ["zE", "zESettings", "$zopim"] },
  "DigitalGenius": { scripts: [/digitalgenius|chat\.digitalgenius/i], hosts: [/digitalgenius/i] },
  "Mavenoid":      { scripts: [/mavenoid\.com|mavenoid\.io/i], ids: [/mavenoid/i], hosts: [/mavenoid/i], globals: ["Mavenoid"] },
  // PRECISION FIX (2026-07-28): the old signature matched Klaviyo's generic onsite pixel
  // (static.klaviyo.com/onsite/js/klaviyo.js + window.klaviyo / _klOnsite), which ships on
  // nearly every Shopify store for EMAIL capture and is NOT a chat surface. It scored
  // script(2)+global(1)=3 and therefore outranked the real chat widget on ~500 captures,
  // producing bogus "declared X → detected Klaviyo" audit rows across 8 vendors. Match only
  // Klaviyo's Customer-Hub / chat assets, which is the surface this benchmark actually tests.
  "Klaviyo":       { scripts: [/customerHubRoot|kServiceStyles|atlas-app\.services\.klaviyo/i], ids: [/^k-hub|customer-hub/i], globals: ["customerHub"] },
  "Decagon":       { scripts: [/decagon\.ai|decagon/i], ids: [/decagon/i], hosts: [/decagon/i], globals: ["Decagon"] },
  "Rep AI":        { scripts: [/hirep\.ai|getrep\.ai|rep-?ai|initrep/i], ids: [/rep-?ai/i], globals: ["initRep", "RepChat"] },
  "Yuma":          { scripts: [/yuma\.ai|getyuma/i], hosts: [/yuma/i], globals: ["Yuma"] },
  "Humind":        { scripts: [/humind/i], hosts: [/humind/i] },
  "Shopify Inbox": { scripts: [/shopify.*chat|shop_chat|shopifychat/i], ids: [/shopify-chat/i] },
  "Gladly":        { scripts: [/gladly\.com/i], globals: ["Gladly"] },
  "Tidio":         { scripts: [/tidio\.co/i], globals: ["tidioChatApi"] },
  "Zowie":         { scripts: [/zowie\.ai/i], globals: ["Zowie"] },
};

const GLOBAL_NAMES = [...new Set(Object.values(PROVIDER_SIGNATURES).flatMap((s) => s.globals || []))];

// Collect provider signals from a live page (walks shadow roots too). Runs in the page context.
export async function collectSignals(page) {
  return page.evaluate((globalNames) => {
    const out = { scripts: [], ids: [], hosts: [], globals: [] };
    for (const s of document.querySelectorAll("script[src]")) out.scripts.push(s.src);
    for (const el of document.querySelectorAll("[id]")) if (el.id) out.ids.push(el.id);
    const walk = (n) => { for (const el of (n.querySelectorAll ? n.querySelectorAll("*") : [])) if (el.shadowRoot) { out.hosts.push(el.id || el.tagName.toLowerCase()); walk(el.shadowRoot); } };
    walk(document);
    for (const g of globalNames) { try { if (window[g] !== undefined) out.globals.push(g); } catch {} }
    return out;
  }, GLOBAL_NAMES);
}

// Rank providers present in the collected signals.
export function detect(sig) {
  const hits = [];
  for (const [prov, s] of Object.entries(PROVIDER_SIGNATURES)) {
    const scriptHit = (s.scripts || []).some((re) => (sig.scripts || []).some((u) => re.test(u)));
    const idHit = (s.ids || []).some((re) => (sig.ids || []).some((i) => re.test(i)));
    const hostHit = (s.hosts || []).some((re) => (sig.hosts || []).some((h) => re.test(h)));
    const globalHit = (s.globals || []).some((g) => (sig.globals || []).includes(g));
    const strength = (scriptHit ? 2 : 0) + (idHit || hostHit ? 1 : 0) + (globalHit ? 1 : 0);
    if (strength > 0) hits.push({ prov, strength, via: [scriptHit && "script", (idHit || hostHit) && "dom", globalHit && "global"].filter(Boolean).join("+") });
  }
  return hits.sort((a, b) => b.strength - a.strength);
}

// Capture-time convenience: detect providers on a live page and compare to the expected vendor.
// Returns { detected: ["Envive(script+dom)", …], top, mismatch: bool }. `mismatch` is only true
// when SOMETHING was detected and the expected vendor is not among the hits (a NONE-detected
// result is NOT a mismatch — the widget may lazy-load / need interaction).
export async function detectProviderOnPage(page, expectedVendor) {
  let hits = [];
  try { hits = detect(await collectSignals(page)); } catch { return { detected: [], top: null, mismatch: false, ambiguous: false }; }
  const provs = hits.map((h) => h.prov);
  const top = provs[0] || null;
  return {
    detected: hits.map((h) => `${h.prov}(${h.via})`),
    top,
    mismatch: provs.length > 0 && expectedVendor != null && !provs.includes(expectedVendor),
    // BLIND SPOT this closes: `mismatch` stays false whenever the expected vendor appears
    // ANYWHERE in the hit list — so a store where the vendor only ships a non-chat bundle
    // (e.g. Envive's search build) while a DIFFERENT vendor's widget actually answers looked
    // perfectly clean. `ambiguous` marks "expected vendor detected but OUT-RANKED by another
    // chat vendor on the same page", i.e. attribution needs a human/headed check before the
    // conversation is trusted. Vendor-blind: it fires the same way whoever out-ranks whom.
    ambiguous: expectedVendor != null && provs.includes(expectedVendor) && top !== expectedVendor,
  };
}
