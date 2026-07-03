// Raw CDP listener: logs all WebSocket frames (with monotonic timestamps) across
// all targets (incl. cross-origin iframes / OOPIFs) to a JSONL file.
//
// Each frame line: {t:"frame", dir:"sent"|"recv", ts:<CDP monotonic seconds>,
//   wall:<Date.now() ms>, sid, len, event:<JSON "event" field if any>,
//   data:<payload truncated to MAX chars>}
// Also logs target attach + ws-created events. Timing = delta of `ts` between
// frames (one monotonic clock for send & receive => skew-free end-to-end).
//
// OPTIONAL 3rd arg <httpSendMatch>: a URL substring (e.g. "/api/message/chat").
// When given, the listener ALSO logs each matching outbound HTTP request as
//   {t:"http-send", ts:<CDP monotonic seconds>, wall, url}
// on the SAME monotonic clock as the WS frames. Use this for SPLIT-TRANSPORT
// widgets (e.g. Ada) that send the user message over HTTP POST but push the bot
// reply back over a WebSocket — http-send.ts -> message-frame.ts is skew-free.
// Omit it for single-WebSocket widgets (e.g. RepAI) where the send is a WS frame.
//
// Usage: node cdp-ws-listener.mjs <browserCdpUrl> <outFile> [httpSendMatch]
//   get the url with:  agent-browser --session <s> get cdp-url
// Needs Node >= 22 (built-in global WebSocket). Stop with: pkill -f cdp-ws-listener
import fs from 'node:fs';

const MAX = 400; // payload chars logged; raise when hunting for ids/timestamps in payloads
const [,, CDP_URL, OUT, HTTP_SEND_MATCH] = process.argv;
if (!CDP_URL || !OUT) { console.error('usage: node cdp-ws-listener.mjs <cdpUrl> <outFile> [httpSendMatch]'); process.exit(1); }

const out = fs.createWriteStream(OUT, { flags: 'a' });
const log = (o) => out.write(JSON.stringify(o) + '\n');

let nextId = 1;
const ws = new WebSocket(CDP_URL);
function send(method, params = {}, sessionId) {
  const msg = { id: nextId++, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
}

ws.addEventListener('open', () => {
  log({ t: 'listener', ev: 'open', wall: Date.now() });
  send('Target.setDiscoverTargets', { discover: true });
  send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
});

ws.addEventListener('message', (event) => {
  let m; try { m = JSON.parse(event.data); } catch { return; }
  const { method, params, sessionId } = m;

  if (method === 'Target.attachedToTarget') {
    const sid = params.sessionId, ti = params.targetInfo || {};
    log({ t: 'attached', sid, type: ti.type, url: (ti.url || '').slice(0, 120), wall: Date.now() });
    send('Network.enable', {}, sid);                                              // report WS frames on this target
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid);
    return;
  }
  if (method === 'Network.webSocketCreated') {
    log({ t: 'ws-created', sid: sessionId, url: (params.url || '').slice(0, 160), wall: Date.now() });
    return;
  }

  // Optional: the user-send leg over HTTP (split-transport widgets). Same monotonic
  // clock as the WS frames below, so http-send -> reply-frame deltas are skew-free.
  if (HTTP_SEND_MATCH && method === 'Network.requestWillBeSent') {
    const url = params.request?.url || '';
    if (url.includes(HTTP_SEND_MATCH)) {
      log({ t: 'http-send', ts: params.timestamp, wall: Date.now(), url: url.slice(0, 120) });
    }
    return;
  }

  const dir = method === 'Network.webSocketFrameSent' ? 'sent'
            : method === 'Network.webSocketFrameReceived' ? 'recv' : null;
  if (dir) {
    const r = params.response || {};
    if (r.opcode !== 1) return;                                                   // text frames only (skip ping/pong/binary)
    const data = r.payloadData || '';
    let evname = null; try { evname = JSON.parse(data).event; } catch {}          // pusher/socket.io event name, if any
    log({ t: 'frame', dir, ts: params.timestamp, wall: Date.now(), sid: sessionId, len: data.length, event: evname, data: data.slice(0, MAX) });
  }
});

ws.addEventListener('error', (e) => log({ t: 'listener', ev: 'error', msg: String(e.message || e), wall: Date.now() }));
ws.addEventListener('close', () => { log({ t: 'listener', ev: 'close', wall: Date.now() }); out.end(); });
process.on('SIGTERM', () => { try { ws.close(); } catch {} setTimeout(() => process.exit(0), 200); });
process.on('SIGINT',  () => { try { ws.close(); } catch {} setTimeout(() => process.exit(0), 200); });
