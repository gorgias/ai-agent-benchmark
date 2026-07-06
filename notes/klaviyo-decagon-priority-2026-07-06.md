# Klaviyo + Decagon priority sourcing — 2026-07-06

Goal: deepen the undersampled Klaviyo Shopping Assistant pool first, then Decagon.

## Klaviyo

Strong Customer Agent / Shopping Assistant evidence:

- `klaviyo-nanuk` — NANUK. Klaviyo case study explicitly says K:AI Customer Agent is live, with product-recommendation queries resolved by AI; raw served HTML confirms `customer-hub-data`, `window.customerHub`, and `klaviyo-onsite`.
- `klaviyo-naked` — Naked Wardrobe. Klaviyo case study explicitly says Customer Agent handles pre-purchase recommendation requests; raw served HTML confirms Klaviyo Customer Hub signatures.
- `klaviyo-harney` — Harney & Sons. Klaviyo Service case study explicitly says K:AI Customer Agent sits in Customer Hub and handles recommendation queries; raw served HTML confirms Klaviyo Customer Hub signatures.
- `klaviyo-k9ballistics` — K9 Ballistics. Klaviyo case study explicitly says K:AI Customer Agent handles product recommendations and discounts; raw served HTML confirms Klaviyo Customer Hub signatures. Also has a Gorgias network signature, so keep `candidate:true` until captures prove routing.
- `klaviyo-onefastcat` — One Fast Cat. Same K9 Ballistics case study says both K9 Ballistics and One Fast Cat adopted Customer Hub + K:AI Customer Agent; raw served HTML confirms Klaviyo Customer Hub signatures. Also has a Gorgias network signature, so keep `candidate:true` until captures prove routing.

Lower-priority / not yet Customer-Agent-proven:

- `klaviyo-happywax` — Klaviyo Customer Hub signature and Gorgias signature are both present, but no strong public Customer Agent case-study evidence found in this pass.
- ThirdLove and Half Magic show Klaviyo Customer Hub signatures, but the public evidence found is Customer Hub-oriented, not clearly Customer Agent / Shopping Assistant. Do not add them as Klaviyo Shopping Assistant stores until a live run proves a drivable Customer Agent chat.

Current valid Shopping sample before this pass:

- Klaviyo has 3 valid Shopping conversations, all from `klaviyo-nanuk` on 2026-07-06.
- Older 2026-07-03 Klaviyo NANUK captures failed before turns due the old regex `scope.match` bug; current `findFrame` supports regex, so re-running is worthwhile.

Post-run result:

- Added 5 Codex-origin Klaviyo Shopping captures: `klaviyo-nanuk` gift, `klaviyo-naked` everyday-value/gift/problem-solver, and `klaviyo-k9ballistics` everyday-value.
- Klaviyo now has 8 valid Shopping conversations across 3 merchants (`NANUK`, `Naked Wardrobe`, `K9 Ballistics`) in the trailing 14-day window, clearing the 5-conversation rankability floor for Shopping.
- Current Shopping scoreboard line: 25% automation, quality 74/100, mean latency 15.2s, p75 14.3s, composite 47. Support remains absent, so Klaviyo is not yet comparable as a two-lane provider.
- Capture/judge provenance: new raw conversations have `capture.origin=codex`; the new quality entries were merged with `BENCHMARK_EVAL_ORIGIN=codex`.
- K9 Ballistics and NANUK show catalog-search stalls / handovers in these flows; Naked Wardrobe is the stronger quality signal but still hands over on review/cart certainty.

## Decagon

Strong public/live signatures already in `runner/vendors.js`:

- `decagon-oura` — live dynamic detection: `decagon.ai/loaders` and `#decagon-iframe`; currently the only Decagon store with valid Shopping captures.
- `decagon-curology` — live dynamic detection: `#decagon-iframe`.
- `decagon-bilt` — live dynamic detection: `decagon.ai/loaders`.

Raw/static signatures only in this pass:

- `decagon-quince` — raw HTML contains `"Chat provider":"Decagon"`, but headless live detection did not observe a dynamic widget.
- `decagon-substack` — raw HTML contains `enable_decagon_chat`, but headless live detection did not observe a dynamic widget.
- `decagon-hertz` — raw HTML / CSP contains Decagon references, but headless live detection did not observe a dynamic widget.

## Operational status

Added `runner/priority-klaviyo-decagon-run.sh` for the next available headed slot:

```bash
RUN_DATE=$(date +%F) BENCHMARK_CAPTURE_ORIGIN=codex runner/priority-klaviyo-decagon-run.sh
```

The script defaults to Shopping mode, runs Klaviyo + Decagon in a single headed driver, and exits without launching if any `node run.js` driver is already active.

On 2026-07-06, a weekly headed driver was already running from `/Users/maxpruvost/ai-chat-latency-benchmark` (`node run.js --headed --concurrency 2`), so the focused run correctly skipped rather than stacking browsers. Later the oversized weekly run was stopped gracefully with SIGINT, and the focused Klaviyo pass was run as a single headed driver.
