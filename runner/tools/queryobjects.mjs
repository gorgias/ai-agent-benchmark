// One-shot: use CDP Runtime.queryObjects to enumerate live WebSocket instances
// (url + readyState) on every http(s) page AND iframe target. Confirms WHICH
// socket the widget uses; it does NOT measure timing (a WebSocket keeps no frame
// history — use cdp-ws-listener.mjs for that).
//
// Why iframes matter: queryObjects only sees sockets in the target it runs in.
// Many chat widgets (e.g. Ada) open their socket inside the cross-origin chat
// IFRAME, not the main page — so a main-page-only scan returns [] even though a
// socket exists. We scan iframe targets too. Still empty? The CDP frame listener
// may catch it anyway (it auto-attaches to all targets), so empty here is a hint,
// not proof of "no WebSocket".
//
// Usage: node queryobjects.mjs <browserCdpUrl>
//   get the url with:  agent-browser --session <s> get cdp-url
// Needs Node >= 22 (built-in global WebSocket).
const [,, CDP_URL] = process.argv;
if (!CDP_URL) { console.error('usage: node queryobjects.mjs <cdpUrl>'); process.exit(1); }

let nextId = 1;
const waiters = new Map();
const ws = new WebSocket(CDP_URL);
const cmd = (method, params = {}, sessionId) => new Promise((res) => {
  const id = nextId++;
  waiters.set(id, res);
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
});

const pageSessions = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  if (m.method === 'Target.attachedToTarget') {
    const ti = m.params.targetInfo || {};
    // page AND iframe targets — the widget's socket often lives in the chat iframe
    if ((ti.type === 'page' || ti.type === 'iframe') && /^https?:/.test(ti.url || '')) {
      pageSessions.push({ sid: m.params.sessionId, type: ti.type, url: (ti.url || '').slice(0, 80) });
    }
  }
});

ws.addEventListener('open', async () => {
  await cmd('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await new Promise(r => setTimeout(r, 800));
  for (const { sid, type, url } of pageSessions) {
    await cmd('Runtime.enable', {}, sid);
    const proto = await cmd('Runtime.evaluate', { expression: 'WebSocket.prototype' }, sid);
    const protoId = proto.result?.result?.objectId;
    if (!protoId) continue;
    const q = await cmd('Runtime.queryObjects', { prototypeObjectId: protoId }, sid);
    const arrId = q.result?.objects?.objectId;
    if (!arrId) continue;
    const got = await cmd('Runtime.callFunctionOn', {
      objectId: arrId,
      functionDeclaration: 'function(){return this.map(w=>({url:w.url,readyState:w.readyState}))}',
      returnByValue: true,
    }, sid);
    const val = got.result?.result?.value;
    if (val && val.length) { console.log(`[${type}] ${url}`); console.log(JSON.stringify(val, null, 2)); }
  }
  ws.close();
  process.exit(0);
});
