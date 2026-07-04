// runstatus.js — emit the capture-run status as DATA (run-status.json) + a client-side
// run-status.html shell that FETCHES that JSON and auto-refreshes every 8s. This is what makes
// the page actually update: the shell is written once, and each tick only rewrites the JSON, so
// an open browser (local during a run, or the Pages copy after a commit) refreshes on its own —
// no stale baked snapshot.
//
//   node runstatus.js --log /path/to/run.log            # one refresh of the JSON (+ shell)
//   node runstatus.js --log /path/to/run.log --watch     # rewrite the JSON every 8s while live
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { STORES } from "./vendors.js";
import { SHOPPING_THEMES, SUPPORT_THEMES } from "./pools.js";

const args = process.argv.slice(2);
const pick = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const LOG = pick("--log") || process.env.RUN_LOG || null;
const WATCH = args.includes("--watch");
const RESULTS = new URL("./results/", import.meta.url).pathname;
const OUT_HTML = new URL("../run-status.html", import.meta.url).pathname;
const OUT_JSON = new URL("../run-status.json", import.meta.url).pathname;

const VCOL = { Gorgias:"#f0603f", "Envive":"#22c55e", Spiffy:"#22c55e", Sierra:"#0ea5e9", Siena:"#a855f7",
  Kodif:"#eab308", Ada:"#64748b", "Meta AI":"#3b82f6", "Rep AI":"#ef4444", DigitalGenius:"#8b5cf6",
  Klaviyo:"#f59e0b", Humind:"#14b8a6", Yuma:"#ec4899", Decagon:"#7c3aed" };

async function newestDate() {
  const dirs = (await readdir(RESULTS, { withFileTypes: true }))
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name).sort();
  return dirs[dirs.length - 1];
}
const themesFor = (mode) => (mode === "support" ? SUPPORT_THEMES : SHOPPING_THEMES).length;
const modesFor = (s) => s.modes || ["shopping", "support"];

function parseLog(text) {
  const lines = text.split("\n");
  let total = 0, done = 0;
  const doneKeys = new Set(), failed = [], events = [];
  for (const ln of lines) {
    let m = ln.match(/✔ \[(\d+)\/(\d+)\]\s+(\S+)\/(\S+)\/(\S+)\s+·\s+success\s+(\S+)%?\s+·\s+avg\s+(\S+)/);
    if (m) { total = Math.max(total, +m[2]); done = Math.max(done, +m[1]); doneKeys.add(`${m[3]}/${m[4]}/${m[5]}`); events.push({ t: "done", id: `${m[3]}/${m[4]}/${m[5]}`, txt: ln.trim() }); continue; }
    m = ln.match(/\[(\S+)\/(\S+)\/(\S+)\]\s+(INVALID.*|FAILED.*)/);
    if (m) { failed.push({ id: `${m[1]}/${m[2]}/${m[3]}`, why: m[4].slice(0, 90) }); events.push({ t: "fail", id: `${m[1]}/${m[2]}/${m[3]}`, txt: ln.trim() }); continue; }
    m = ln.match(/✗\s+(\S+)\/(\S+)\/(\S+)\s+ERR\s+(.*)/);
    if (m) { failed.push({ id: `${m[1]}/${m[2]}/${m[3]}`, why: m[4].slice(0, 90) }); continue; }
    m = ln.match(/\[(\S+)\/(\S+)\/(\S+)\]\s+(page @|widget open|T\d+)/);
    if (m) events.push({ t: "run", id: `${m[1]}/${m[2]}/${m[3]}`, txt: ln.trim() });
  }
  const finished = /Done\. Wrote \d+ conversations/.test(text);
  const running = [...new Set(events.filter(e => e.t === "run" && !doneKeys.has(e.id)).map(e => e.id))].slice(-4);
  return { total, done, doneKeys, failed, events, running, finished };
}

async function computeStatus() {
  const date = pick("--date") || process.env.RUN_DATE || await newestDate();
  const convDir = `${RESULTS}${date}/conv`;
  let convFiles = [];
  try { convFiles = (await readdir(convDir)).filter(f => f.endsWith(".json")); } catch {}
  const validOf = (f) => { try { return JSON.parse(readFileSync(`${convDir}/${f}`, "utf8")).valid === true; } catch { return false; } };

  let log = null;
  if (LOG && existsSync(LOG)) { try { log = parseLog(await readFile(LOG, "utf8")); } catch {} }

  let next = null;
  try { next = JSON.parse(await readFile(new URL("../run-next.json", import.meta.url).pathname, "utf8")); } catch {}

  const mentioned = new Set();
  if (log) [...log.doneKeys, ...log.running, ...log.failed.map(f => f.id), ...log.events.map(e => e.id)].forEach(id => mentioned.add(id.split("/")[0]));
  else convFiles.forEach(f => mentioned.add(f.replace(/-(shopping|support)-.*$/, "")));
  const runStores = STORES.filter(s => mentioned.has(s.key));

  const rows = runStores.map(s => {
    const expected = modesFor(s).reduce((n, m) => n + themesFor(m), 0);
    const files = convFiles.filter(f => f.startsWith(s.key + "-"));
    const valid = files.filter(validOf).length;
    return { vendor: s.vendor, store: s.store || s.key, col: VCOL[s.vendor] || "#888", expected, captured: files.length, valid, invalid: files.length - valid, pending: Math.max(0, expected - files.length) };
  }).sort((a, b) => a.vendor.localeCompare(b.vendor) || a.store.localeCompare(b.store));

  const totExpected = rows.reduce((n, r) => n + r.expected, 0);
  const totValid = rows.reduce((n, r) => n + r.valid, 0);
  const totCaptured = rows.reduce((n, r) => n + r.captured, 0);
  const total = (log && log.total) || totExpected;
  const done = (log && log.done) || totCaptured;
  const state = !log ? "idle" : log.finished ? "done" : "running";

  // live feed (report Conversations tab) — mirror the active-run convos here too
  const LIVE = new URL("../live-feed.json", import.meta.url).pathname;
  if (log && !log.finished) {
    const convs = [];
    for (const f of convFiles) {
      if (!mentioned.has(f.replace(/-(shopping|support)-.*$/, ""))) continue;
      try { const d = JSON.parse(readFileSync(`${convDir}/${f}`, "utf8")); if (!(d.turns && d.turns.length)) continue;
        convs.push({ vendor: d.vendor, store: d.store, lane: d.mode, label: d.themeLabel || d.theme, lat: d.stats && d.stats.avg_ms != null ? `~${Math.round(d.stats.avg_ms / 100) / 10}s` : "—", valid: d.valid === true, ts: d.capturedAt || null }); } catch {}
    }
    convs.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
    await writeFile(LIVE, JSON.stringify({ active: true, runDate: date, convs }));
  } else { await writeFile(LIVE, JSON.stringify({ active: false, convs: [] })); }

  return {
    date, generatedAt: new Date().toISOString(), state,
    total, done, pct: total ? Math.round(100 * done / total) : 0,
    totValid, totInvalid: totCaptured - totValid, remaining: Math.max(0, total - done), storesInRun: rows.length,
    running: (log && log.running) || [],
    rows,
    failures: (log ? log.failed : []).slice(-14).reverse(),
    activity: (log ? log.events : []).slice(-16).reverse().map(e => ({ t: e.t, txt: e.txt.replace(/^\s+/, "") })),
    next: next && next.stores ? { plannedConvs: next.plannedConvs, newSites: next.newSites, stores: next.stores } : null,
  };
}

// The client-side shell — written once; it fetches run-status.json and re-renders every 8s.
const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Run status — Gorgias AI Agent Benchmark</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Inter+Tight:wght@700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#16120D;--paper:#F6F2EC;--on:#1B1712;--mut:#6B6259;--faint:#A89D92;--coral:#F0603F;--mint:#1E9E6A;--amber:#D98A00;--red:#D64545;--line:rgba(27,23,18,.10)}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',-apple-system,sans-serif;background:var(--paper);color:var(--on);padding:28px 22px 60px;line-height:1.5}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}.n{text-align:right}.note{color:var(--mut);font-size:12.5px}.warn{color:var(--amber);font-weight:700}
.wrap{max-width:900px;margin:0 auto}h1{font-family:'Inter Tight';font-size:30px;font-weight:900;letter-spacing:-.02em;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
a.back{color:var(--coral);text-decoration:none;font-weight:700;font-size:13px}
.badge{font-size:12px;font-weight:800;padding:4px 11px;border-radius:999px;letter-spacing:.02em}
.badge.live{background:#FDEAEA;color:var(--red)}.badge.ok{background:#E2F4EA;color:var(--mint)}.badge.idle{background:#EEE9E4;color:var(--faint)}
.sub{color:var(--mut);font-size:13px;margin-top:6px}
.big{margin:26px 0;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px 24px}
.big .pct{font-family:'Inter Tight';font-size:52px;font-weight:900;letter-spacing:-.03em;line-height:1}.big .cap{color:var(--mut);font-size:13px;margin-top:2px}
.bar{height:9px;border-radius:999px;background:rgba(27,23,18,.08);overflow:hidden}.bar span{display:block;height:100%;border-radius:999px}
.big .bar{height:14px;margin-top:16px}.big .bar span{background:linear-gradient(90deg,var(--coral),#FF8B5D)}
.kpis{display:flex;gap:26px;margin-top:14px;flex-wrap:wrap}.kpi b{font-family:'Inter Tight';font-size:22px;font-weight:800}.kpi span{color:var(--mut);font-size:12px;display:block}
h2{font-family:'Inter Tight';font-size:16px;font-weight:800;margin:26px 0 10px}
table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);text-align:left;padding:9px 12px;border-bottom:1px solid var(--line)}
td{padding:9px 12px;border-bottom:1px solid rgba(27,23,18,.05);vertical-align:middle}tr:last-child td{border-bottom:none}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px}.chip{display:inline-block;font-size:11.5px;font-weight:700;background:#FDEAEA;color:var(--red);padding:2px 9px;border-radius:999px;margin:2px 0}
.feed{background:var(--ink);color:#E9E3DA;border-radius:14px;padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:11.5px;line-height:1.7;max-height:320px;overflow:auto}
.ev-done{color:#43D598}.ev-fail{color:#FF7A5C}.ev-run{color:#C9BEB0}
.live-dot{width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;animation:pulse 1.4s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
#upd{font-size:11px;color:var(--faint);margin-left:auto}
</style></head><body><div class="wrap">
<h1>Capture run status <span id="badge"></span><span id="upd"></span></h1>
<div class="sub" id="meta"></div>
<div id="root"><div class="note" style="margin-top:24px">Loading run status…</div></div>
</div>
<script>
const VC=${JSON.stringify(VCOL)};
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
const bar=(v,max,col)=>'<div class="bar"><span style="width:'+(max?Math.round(100*v/max):0)+'%;background:'+(col||'linear-gradient(90deg,#F0603F,#FF8B5D)')+'"></span></div>';
function render(d){
  const badge={running:'<span class="badge live"><span class="live-dot"></span> LIVE — capturing</span>',done:'<span class="badge ok">✓ run complete</span>',idle:'<span class="badge idle">idle — last run</span>'}[d.state]||'';
  document.getElementById('badge').innerHTML=badge;
  document.getElementById('meta').innerHTML='Run date <b>'+esc(d.date)+'</b> · snapshot '+esc((d.generatedAt||'').replace('T',' ').slice(0,19))+' UTC · <a class="back" href="report.html">← report</a> · <a class="back" href="takeaways.html">summary</a> · <a class="back" href="report.html?view=conversations">conversations</a>';
  const rows=(d.rows||[]).map(r=>'<tr><td><span class="dot" style="background:'+r.col+'"></span><b>'+esc(r.vendor)+'</b> · '+esc(r.store)+'</td><td class="mono n">'+r.valid+'/'+r.expected+'</td><td style="min-width:150px">'+bar(r.valid,r.expected,r.col)+'</td><td class="mono n">'+(r.invalid?'<span class="warn">'+r.invalid+'</span>':'·')+'</td><td class="mono n">'+(r.pending||'·')+'</td></tr>').join('')||'<tr><td colspan="5" class="note">No stores in this run.</td></tr>';
  const fails=(d.failures||[]).map(f=>'<tr><td class="mono">'+esc(f.id)+'</td><td class="note">'+esc(f.why)+'</td></tr>').join('')||'<tr><td colspan="2" class="note">No failed/invalid conversations.</td></tr>';
  const acts=(d.activity||[]).map(e=>'<div class="ev-'+e.t+'">'+esc(e.txt)+'</div>').join('')||'<div class="note">No live log attached.</div>';
  const running=d.state==='running'&&d.running&&d.running.length?'<div class="sub" style="margin-top:14px">⏳ In flight: '+d.running.map(x=>'<span class="chip">'+esc(x)+'</span>').join(' ')+'</div>':'';
  const next=d.next&&d.next.stores&&d.next.stores.length?'<h2>Upcoming — next daily run</h2><div class="big" style="padding:16px 20px"><div class="sub" style="margin:0 0 10px"><b>Daily · 08:00 local</b> · ~'+d.next.plannedConvs+' conversations across '+d.next.stores.length+' stores'+(d.next.newSites?' · <span class="warn">'+d.next.newSites+' never-measured (new)</span>':'')+'</div><div style="display:flex;flex-wrap:wrap;gap:6px">'+d.next.stores.map(s=>'<span class="chip" style="background:rgba(240,96,63,.10);color:#F0603F">'+esc(s.vendor)+' · '+esc(s.store)+(s.lastRun?'':' ✦')+'</span>').join('')+'</div><div class="note" style="margin-top:8px">✦ = never measured yet (grows pool diversity).</div></div>':'';
  document.getElementById('root').innerHTML=
    '<div class="big"><div class="pct">'+d.pct+'%</div><div class="cap">'+d.done+' of '+d.total+' conversations captured this run</div>'+bar(d.done,d.total)+
    '<div class="kpis"><div class="kpi"><b class="mono">'+d.totValid+'</b><span>valid (timed)</span></div><div class="kpi"><b class="mono">'+d.totInvalid+'</b><span>invalid / failed</span></div><div class="kpi"><b class="mono">'+d.remaining+'</b><span>remaining</span></div><div class="kpi"><b class="mono">'+d.storesInRun+'</b><span>stores in run</span></div></div>'+running+'</div>'+
    next+'<h2>By store</h2><table><thead><tr><th>Store</th><th class="n">Valid</th><th>Progress</th><th class="n">Invalid</th><th class="n">Pending</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<h2>Failed / invalid</h2><table><thead><tr><th>Conversation</th><th>Reason</th></tr></thead><tbody>'+fails+'</tbody></table>'+
    '<h2>Recent activity</h2><div class="feed">'+acts+'</div>';
}
let lastOk=0;
async function tick(){
  try{ const r=await fetch('run-status.json?_='+Date.now()); if(!r.ok) throw 0; const d=await r.json(); render(d); lastOk=Date.now();
    document.getElementById('upd').textContent='updated '+new Date().toLocaleTimeString();
  }catch(e){ document.getElementById('upd').textContent='(offline — retrying)'; }
}
tick(); setInterval(tick, 8000);   // auto-refresh — the page updates itself, no rebuild needed
</script></body></html>`;

async function refresh() {
  const status = await computeStatus();
  await writeFile(OUT_JSON, JSON.stringify(status));
  await writeFile(OUT_HTML, SHELL);            // idempotent shell
  return status;
}

if (WATCH) {
  let s = await refresh();
  process.stdout.write(`\r[runstatus] ${s.pct}% ${s.done}/${s.total} (${s.state})   `);
  const iv = setInterval(async () => {
    s = await refresh().catch(() => null);
    if (s) { process.stdout.write(`\r[runstatus] ${s.pct}% ${s.done}/${s.total} (${s.state})   `); if (s.state === "done") { clearInterval(iv); console.log("\n[runstatus] run complete."); process.exit(0); } }
  }, 8000);
} else {
  const s = await refresh();
  console.log(`Wrote run-status.json + shell — ${s.pct}% (${s.done}/${s.total}), ${s.storesInRun} stores, state=${s.state}`);
}
