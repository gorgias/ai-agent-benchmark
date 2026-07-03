#!/usr/bin/env python3
# Parse a WebSocket frame log (from cdp-ws-listener.mjs) -> per-interaction latency,
# using CDP monotonic timestamps. Segments by the {"t":"MARK",...} lines you write
# before each send/click.
#
# >>> ADAPT THESE THREE CLASSIFIERS PER PLATFORM <<<
# They currently match RepAI (decode your target's protocol in Phase A first):
#   is_send(d)   : the user's outbound message/request frame
#   is_status(d) : interim "typing"/status feedback frames
#   is_answer(d) : frames carrying the actual answer content
# Heartbeats/acks fall through and are ignored.
#
# RepAI delivers each answer ATOMICALLY (one frame), so send->answer is both
# "first text" and "full answer". For a TOKEN-STREAMING bot: treat the first
# content frame as first-token TTFT and the final-chunk/"done" frame as full-answer
# (add that marker to is_answer / a separate is_done()).
#
# Usage: python3 parse_frames.py <frames.jsonl>
import sys, json, statistics

def is_send(d):   return '"rt":"USER_REQUEST"' in d
def is_status(d): return 'statusUpdates' in d
def is_answer(d): return ('"sm":[' in d) or ('"o":[{' in d) or ('"r":"http' in d)

frames = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try: o = json.loads(line)
    except: continue
    if o.get('t') in ('MARK', 'frame'): frames.append(o)

turns, cur = [], None
for o in frames:
    if o.get('t') == 'MARK':
        if cur: turns.append(cur)
        cur = {'mark': o, 'fr': []}
    elif cur and o.get('t') == 'frame':
        cur['fr'].append(o)
if cur: turns.append(cur)

print(f"{'#':<3}{'interaction':<34}{'send->1st-status':>17}{'send->answer':>14}   note")
print('-' * 92)
rows = []
for tr in turns:
    m, fr = tr['mark'], tr['fr']
    send = next((f for f in fr if f['dir'] == 'sent' and is_send(f['data'])), None)
    if not send:
        print(f"{m.get('turn','?'):<3}{str(m.get('label',''))[:33]:<34}{'(no send frame)':>17}")
        continue
    base = send['ts']
    sts = [f for f in fr if f['dir'] == 'recv' and is_status(f['data']) and f['ts'] >= base]
    ans = [f for f in fr if f['dir'] == 'recv' and is_answer(f['data']) and f['ts'] >= base]
    t_status = (sts[0]['ts'] - base) if sts else None
    t_ans = (ans[0]['ts'] - base) if ans else None
    note = ''
    if ans:
        d = ans[0]['data']
        note = 'redirect' if '"r":"http' in d else 'carousel/cards' if '"o":[{' in d else 'text'
    sstr = f"{t_status:.2f}s" if t_status is not None else "n/a"
    astr = f"{t_ans:.2f}s" if t_ans is not None else "n/a"
    print(f"{m.get('turn','?'):<3}{str(m.get('label',''))[:33]:<34}{sstr:>17}{astr:>14}   {note}")
    rows.append((m.get('turn'), m.get('label', ''), t_status, t_ans))

st  = [r[2] for r in rows if r[2] is not None]
an  = [r[3] for r in rows if r[3] is not None]
llm = [r[3] for r in rows if r[3] is not None and 'click' not in str(r[1]).lower()]
print('-' * 92)
if st:  print(f"avg send->first-status (all):        {statistics.mean(st):.2f}s")
if an:  print(f"avg send->answer (all):              {statistics.mean(an):.2f}s   (n={len(an)})")
if llm: print(f"avg send->answer (LLM turns only):   {statistics.mean(llm):.2f}s   (n={len(llm)})")
if an:  print(f"median send->answer (all):           {statistics.median(an):.2f}s")
