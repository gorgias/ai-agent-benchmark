// Page-level tap for an SSE-over-fetch chat stream (e.g. Humind:
// POST api.thehumind.com/chat-service/chat/stream). CDP gives you chunk
// *timestamps* but NOT the streaming body, so to learn WHAT each chunk carries
// — which is what lets you separate "first meaningful content" (product cards /
// real answer tokens) from "full answer" (text stream complete) — wrap fetch,
// tee the response body, and log each decoded chunk with performance.now().
//
// Inject ONCE per page load with agent-browser:
//   agent-browser --session shop eval -b "$(base64 < references/scripts/sse-content-tap.js)"
// It is wiped on navigation, so re-inject after the post-approval session reset.
// By default it matches "/chat/stream"; pass your own substring by setting
// window.__humindTapMatch before injecting (e.g. eval 'window.__humindTapMatch="/api/respond"').
//
// Read the log back at any point with:
//   agent-browser --session shop eval 'JSON.stringify(window.__humindLog)'
// Each entry: {reqId, ev:"send"|"headers"|"chunk"|"done"|"err", t:<performance.now ms>, len?, text?}
// send/headers/chunk/done all share the page's monotonic performance.now() clock,
// so deltas are skew-free. Classify chunk.text by the platform's event shape
// (Humind: lines like `data: {"type":"product_list",...}` — see latency-measurement.md).
(() => {
  if (window.__humindTapInstalled) return "already";
  window.__humindTapInstalled = true;
  window.__humindLog = [];
  const MATCH = window.__humindTapMatch || "/chat/stream";
  const origFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    let url = "";
    try { url = (typeof args[0] === "string") ? args[0] : (args[0] && args[0].url) || ""; } catch (e) {}
    if (!url.includes(MATCH)) return origFetch(...args);
    const reqId = window.__humindLog.length + "-" + Math.random().toString(36).slice(2, 6);
    window.__humindLog.push({ reqId, ev: "send", t: performance.now() });
    return origFetch(...args).then((resp) => {
      window.__humindLog.push({ reqId, ev: "headers", t: performance.now() });
      try {
        const reader = resp.clone().body.getReader();   // clone => the widget still consumes the original
        const dec = new TextDecoder();
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) { window.__humindLog.push({ reqId, ev: "done", t: performance.now() }); break; }
              window.__humindLog.push({ reqId, ev: "chunk", t: performance.now(), len: value.length, text: dec.decode(value, { stream: true }) });
            }
          } catch (e) { window.__humindLog.push({ reqId, ev: "err", t: performance.now(), msg: String(e) }); }
        })();
      } catch (e) { window.__humindLog.push({ reqId, ev: "cloneErr", t: performance.now(), msg: String(e) }); }
      return resp;
    });
  };
  return "installed (match=" + MATCH + ")";
})()
