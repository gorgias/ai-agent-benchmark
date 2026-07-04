# Wire-level latency tools (vendored)

CDP-based scripts for **network-layer** latency measurement, adapted from Roman Fayzullin's
`ai_agent_benchmark` skill (gorgias/context-factory). Our main pipeline times at the DOM
(what the shopper sees); these time on the wire (skew-free CDP monotonic clock) and are used
for a one-shot **wire-vs-DOM calibration** and for decoding a widget's transport.

- `queryobjects.mjs`      — enumerate live WebSocket instances on page + iframe targets
- `cdp-ws-listener.mjs`   — log every WS frame (+ optional matching HTTP send) with CDP timestamps
- `parse_frames.py`       — segment single-WebSocket widgets (RepAI-style)
- `parse_frames_split.py` — segment split-transport widgets (Ada: HTTP send + WS receive, encrypted)
- `sse-content-tap.js`    — page-level fetch tee for HTTP/SSE widgets (Humind-style)
- `parse_sse_content.py`  — segment the SSE tap into first-feedback / first-meaningful / full-answer

Transport shapes + full recipe: see the vendored skill's `latency-measurement.md`.
