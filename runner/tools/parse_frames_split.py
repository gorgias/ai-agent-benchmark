#!/usr/bin/env python3
# Parse a SPLIT-TRANSPORT frame log (from cdp-ws-listener.mjs run WITH the optional
# [httpSendMatch] arg) -> per-interaction latency, on CDP monotonic timestamps.
# Segments by the {"t":"MARK",...} lines you write before each send.
#
# Use this variant when the widget SENDS the user message over HTTP and RECEIVES
# the bot reply over a WebSocket (e.g. Ada/Pusher). Here:
#   send  = the first {"t":"http-send"} line after a MARK (POST .../api/message/chat)
#   reply = WS frames whose JSON "event" matches REPLY_EVENT, after that send
# This also handles ENCRYPTED payloads (Pusher private-encrypted channels send
# {nonce, ciphertext}): we classify purely by the frame's `event` name, never by
# content, and read the actual answer text from screenshots. The bot delivers the
# answer as discrete atomic bubbles (no token streaming), so:
#   -> first feedback = send to FIRST reply frame
#   -> full answer    = send to LAST reply frame in the burst (before next MARK)
#
# >>> SET REPLY_EVENT for your platform (decode it in Phase A) <<<
#   Ada/Pusher: "message-added".  socket.io chat: often "message" or "bot_message".
#
# Usage: python3 parse_frames_split.py <frames.jsonl>
import sys, json, statistics

REPLY_EVENT = "message-added"   # <-- adapt per platform

events = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try: o = json.loads(line)
    except: continue
    events.append(o)

turns, cur = [], None
for o in events:
    t = o.get('t')
    if t == 'MARK':
        cur = {'turn': o.get('turn', '?'), 'label': o.get('label', ''), 'sends': [], 'replies': []}
        turns.append(cur)
    elif cur is None:
        continue
    elif t == 'http-send':
        cur['sends'].append(o['ts'])
    elif t == 'frame' and o.get('event') == REPLY_EVENT:
        cur['replies'].append(o['ts'])

print(f"{'#':<3}{'interaction':<48}{'-> first fb':>12}{'-> full answer':>15}{'bubbles':>9}")
print('-' * 90)
ff, fa = [], []
for tr in turns:
    label = str(tr['label'])[:46]
    if not tr['sends']:
        print(f"{tr['turn']:<3}{label:<48}{'(no send)':>12}"); continue
    send = tr['sends'][0]
    reps = sorted(r for r in tr['replies'] if r >= send)
    if not reps:
        print(f"{tr['turn']:<3}{label:<48}{'(no reply)':>12}"); continue
    a, b = reps[0] - send, reps[-1] - send
    ff.append(a); fa.append(b)
    print(f"{tr['turn']:<3}{label:<48}{a:>11.2f}s{b:>14.2f}s{len(reps):>9}")

print('-' * 90)
if ff:
    print(f"{'AVG':<3}{'':<48}{statistics.mean(ff):>11.2f}s{statistics.mean(fa):>14.2f}s")
