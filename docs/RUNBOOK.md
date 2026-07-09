# Runbook — operating the benchmark end to end

The pipeline is five stages. Each stage is idempotent and resumable; **conversations on
disk are immutable** (never moved, renamed, or archived — `gen.js` filters invalid ones).

```
CAPTURE ──▶ JUDGE ──▶ MERGE ──▶ BAKE ──▶ VERIFY ──▶ DEPLOY
run.js      blind      eval-     gen.js   verify-    PR → master →
(+tools/    subagent   merge.js           data.js    Pages build
 balance)   batches
```

All commands run **from `runner/`** unless noted.

---

## 1. Capture

```bash
export RUN_DATE=$(date +%F) BENCHMARK_CAPTURE_ORIGIN=claude

# one vendor / store list, both lanes, 5 themes each:
node run.js --store gorgias-madura gorgias-jade --themes 5 --concurrency 2

# equalization (water-fill the least-represented vendor first):
INCLUDE="Envive,Yuma" TARGET=80 BUDGET=60 STORE_TIMEOUT_MIN=8 LOAD_CAP=9 \
  node tools/balance.mjs        # --dry previews the pick order
```

**Overnight / detached** (survives the session): `nohup caffeinate -dimsu node … & disown`
— `caffeinate` stops the Mac sleeping, `nohup` detaches from the terminal. Record the PID
(`echo $! >> /tmp/run.pids`) — teardown is **by PID, never by broad pkill** (see §7).

### Parallel capture — the rules that keep latencies honest

Multiple `run.js` instances are safe: each conversation is **claimed via an O_EXCL lock**
(`results/<date>/conv/.locks/`) — a live owner's conversation is skipped, a dead owner's
lock is stolen. The balancer + manual runs + a second stream can overlap without
double-capturing.

- **≤ 3 streams on a laptop** (≈6 headless pages). Beyond that, CPU load inflates the
  latencies you are measuring — the ceiling is empirical (load 24 ⇒ +40 % on measured turns).
- Give parallel balancers **disjoint `INCLUDE` lists** — locks make overlap safe, but
  disjoint lists waste nothing.
- `LOAD_CAP=9` (balancer) pauses capture while the machine is busy. Keep it on.
- Latency is measured **to the true final answer** (anti-cheat: a "let me check…" stall
  never stops the clock), per conversation in a **fresh incognito context**.

### Vendor quirks (hard-won)

| Vendor | Quirk |
|---|---|
| Amazon Rufus | Logged-in only (dummy account, `secrets/amazon-state.json`), **headed**, bare `/dp/<ASIN>` URLs; dedicated `secrets/rufus-capture.mjs` |
| Rep AI, Kodif, Humind | Headed capture only (`--headed`) |
| Humind, Shopify Inbox, Google Agentic | **Walls** — 0 valid convs ever, unattended. Don't burn budget; document instead |
| Klaviyo, Meta AI, Decagon | Deflectors — partial capture only; expect high invalid rates |
| Yuma (Atma…) | AI replies under a human first name → per-store `personas` in vendors.js prevents false handover |

## 2. Judge (blind LLM eval)

```bash
node eval-pack.js /tmp/eval-batch 12       # packs UNSCORED valid convs → blind batches
```

Hand each `batch-NNN.json` to an LLM-judge subagent with `eval-rubric.md` (v2.3).
**The judge must write a JSON *array*** of entries — each carrying its own `k` (blind id),
`mode`, per-dimension `checks` `{pass, evidence}` (evidence verbatim), `resolution_class`,
one-line `learning` — to `scored-NNN.json` in the same directory. The judge never sees
vendor names; `map-NNN.json` (merge-side only) resolves blind ids back to conversations.

## 3. Merge

```bash
node eval-merge.js /tmp/eval-batch         # scored-*.json → eval-scores.json
```

Rejects malformed files loudly (`SKIP …: not an array`). Signal gates (price/link/review
presence) are re-derived from stored transcripts — a judge can't credit a rich element
the DOM never showed.

## 4. Bake

```bash
node gen.js                                 # splices STORES/SUPPORT into report.html
```

Rebuilds the report data + syncs `takeaways.html` stats/verdict markers. UI edits outside
the generated block survive. Vendor-level truths live in gen.js (`DELIVERY_OVERRIDE` —
streaming vs atomic is pinned per engine, never trusted to the growth_events proxy).

## 5. Verify — the business quality gate

```bash
node verify-data.js        # MUST pass before any deploy
```

Invariants, not opinions: data parses, latencies sane, `timed ≤ attempted`, judge scores
0–100, delivery values known, **judge coverage ≥ 90 %** of valid convs. Non-zero exit =
do not ship. CI runs this + the unit tests on every PR (`.github/workflows/tests.yml`).

## 6. Deploy

```bash
git checkout -B <branch> origin/master && git add -A && git commit && git push -u origin <branch>
gh pr create … && gh pr merge <pr> --squash --delete-branch
gh api -X POST repos/gorgias/ai-agent-benchmark/pages/builds     # force Pages build
curl -s https://gorgias.github.io/ai-agent-benchmark/report.html | grep <marker>  # verify live
```

Pages deploys from **master root**; the Actions trigger is unreliable — always force the
build and verify with curl (usually live in ~15 s).

## 7. Teardown & hygiene

- Kill detached runs **by PID** (`kill -9 $(cat /tmp/run.pids)`), then reap
  `chrome-headless-shell` and **verify zero**:
  `ps aux | grep -cE '[r]un.js --store|[c]hrome-headless-shell'` → `0`.
  Broad `pkill -f` patterns historically left zombie chromium that inflated load — and
  therefore the measured latencies.
- **Never** move/rename/archive anything in `results/<date>/conv/` — valid AND invalid
  captures stay in place. Isolate experiments by filename glob, not by relocating files.
- **Never quarantine latency outliers** by threshold — the slow tail is real signal
  (p75 exists to capture it); pruning it biases the benchmark faster than reality.

## Troubleshooting — a store captures `—ms` everywhere

In observed order of likelihood:

| Cause | Signature | Fix |
|---|---|---|
| Email gate | widget asks for email before answering | per-store gate flow in vendors.js (e.g. Atma) |
| Persona false-handover | AI signs with a human first name ("Lucas says:") | add name to store `personas` |
| Auto-greeting timed | greeting counted as the answer | greeting/ack regexes in classify.js (`ACK_RE`) |
| Container reset | transcript length drops mid-turn (Rufus outer div) | scope the INNER container; `timeTurn` trough handles resets |
| Machine overloaded | load > ~9, many parallel pages | LOAD_CAP, fewer streams, wait |
| Widget truly down / wall | 0 turns across all themes+stores | strike-out; document as structural |

## Statistical guardrails

- Ranking eligibility: ≥5 convs, ≥8 cleanly-timed turns, ≥30 % coverage. `<20` convs ⇒
  "not stat-sig yet" tag. Rankings use a trailing 14-day window; **p75 latency** is the
  headline latency metric.
- Equalization targets the **achievable tier** (vendors that actually capture unattended).
  Walls and deflectors are documented as such — that finding *is* competitive data.
