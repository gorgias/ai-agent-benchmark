# Resume — where we left off (2026-07-13 evening)

Live board (deployed, gate PASSED, 1050 convs): **Gorgias #1 overall (73.0) · #1 support (76) · #2 shopping (70, 1pt behind Envive 71)**.

## To do at next session
1. **Judge the 8 raw Klaviyo convs** committed in this PR (2026-07-13 evening, klaviyo-nanuk — all valid, all handovers): `node eval-pack.js /tmp/eb 12` → judge → `eval-merge` → `gen` → `verify-data` → deploy.
2. **Rescue wave 2 unfinished phases** (script: scratchpad rescue-wave2.sh pattern — meta/repai/intercom never ran):
   - Meta (butcherbox/dermalogica/quip ×5 themes both lanes), Rep AI (fresh), Intercom probe.
3. **Decagon: 14/15 shopping** — one valid conv short; crosses the floor on the next day's date slots (don't overwrite today's judged slots).
4. Envive fracture/greenpan still need PDP-navigation in the spiffy driver open() to mount their widget.
5. siena-spanx: provider audit found NO widget — verify with interaction, re-attribute or drop.

## Standing guards (all wired into verify-data)
integrity-check (misreads) · boilerplate-audit (chrome patterns, allowlist in boilerplate-allow.json) · provider-detect (capture-time provider stamping + provider-audit.mjs sweeps).
