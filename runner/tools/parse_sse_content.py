#!/usr/bin/env python3
# Parse the page-level SSE content tap (window.__humindLog from sse-content-tap.js)
# into per-interaction latency, separating FIRST MEANINGFUL CONTENT from FULL ANSWER.
#
# Dump the log to a file first, e.g.:
#   agent-browser --session shop eval 'JSON.stringify(window.__humindLog)' > sse-log.json
# then:
#   python3 parse_sse_content.py sse-log.json
#
# The tap records, on the page's monotonic performance.now() clock:
#   {ev:"send"}  {ev:"headers"}  {ev:"chunk", text, len}  {ev:"done"}
# Each "send" begins a new interaction (turns segment on send events, in order).
#
# CLASSIFY chunks by the platform's event shape. The defaults below are HUMIND's
# typed SSE events (`data: {"type":"<name>",...}`) — ADAPT these sets to whatever
# you decoded in Phase A for your platform:
#   - MEANINGFUL = the first chunk carrying user-facing substance. For a shopping
#     bot that's the product list/cards; for a text answer it's the first answer
#     token. Humind: `product_list` (curated carousel that renders) is the headline
#     "products shown"; `currentSegment` is the first answer-text token.
#   - The FULL ANSWER is the last chunk before the stream goes idle / `done`.
import sys, json, re

# --- platform classification (Humind defaults — adapt per platform) -------------
MEANINGFUL_PRODUCT = ["product_list"]          # curated carousel that actually renders
MEANINGFUL_PRODUCT_RAW = ["product_list_unfiltered"]  # raw candidates (a bit earlier; report as a parenthetical)
MEANINGFUL_TEXT = ["currentSegment", "message"]       # first real answer token (text-only turns / refusals)
ACK = ["action_summary"]                               # bot echoes/acknowledges the request

def types_in(text):
    return re.findall(r'"type":"([a-zA-Z_]+)"', text or "")

def main():
    rows = json.load(open(sys.argv[1]))
    if isinstance(rows, str):
        rows = json.loads(rows)  # eval output is often a JSON-quoted string
    sends = [i for i, r in enumerate(rows) if r.get("ev") == "send"]
    labels = sys.argv[2:] if len(sys.argv) > 2 else []
    print(f"{'#':>3}  {'turn':<26}{'ack':>7}{'meaningful':>12}{'(raw prod)':>11}{'full ans':>10}")
    print("-" * 70)
    for k, si in enumerate(sends):
        end = sends[k + 1] if k + 1 < len(sends) else len(rows)
        seg = rows[si:end]
        s = seg[0]["t"]
        def first_type(names):
            for r in seg:
                if r.get("ev") != "chunk":
                    continue
                if any(t in names for t in types_in(r.get("text", ""))):
                    return (r["t"] - s) / 1000.0
            return None
        def last_chunk():
            ch = [r for r in seg if r.get("ev") == "chunk"]
            return (ch[-1]["t"] - s) / 1000.0 if ch else None
        ack = first_type(ACK)
        prod = first_type(MEANINGFUL_PRODUCT)
        prod_raw = first_type(MEANINGFUL_PRODUCT_RAW)
        txt = first_type(MEANINGFUL_TEXT)
        meaningful = prod if prod is not None else txt   # products if present, else first answer token
        full = last_chunk()
        name = labels[k] if k < len(labels) else f"turn {k+1}"
        f = lambda x: f"{x:.2f}s" if x is not None else "—"
        print(f"{k+1:>3}  {name[:26]:<26}{f(ack):>7}{f(meaningful):>12}{f(prod_raw):>11}{f(full):>10}")

if __name__ == "__main__":
    main()
