# Yuma visible-chat sourcing - 2026-07-06

Goal: find at least 5 new storefronts that are publicly tied to Yuma and have a real chat surface
available, without incorrectly adding Gorgias-front widgets as clean native Yuma Shopping Assistant
targets.

## Method

- Started from public Yuma sources:
  - Yuma case studies: https://yuma.ai/case-studies
  - Yuma Sales AI Shopify listing: https://apps.shopify.com/sales-ai-1
  - Yuma Sales AI launch mention: https://www.ycombinator.com/launches/OU1-sales-ai-shopify-product-q-a-widget-that-boosts-revenue
  - Gorgias/Yuma app listing: https://www.gorgias.com/apps/ticket-assistant-by-yuma-ai
- Cross-checked the existing internal Yuma install list in `notes/yuma-merchants-from-gorgias.md`.
- Excluded stores already present in `runner/vendors.js`.
- Checked served HTML for native Yuma (`app.yuma.ai`, `yuma-widget`) versus helpdesk-front
  signatures (`config.gorgias.chat`, Zendesk, Klaviyo).
- Ran a bounded Playwright availability pass: load storefront, wait for chat boot, call known open
  APIs when present (`GorgiasChat.open`, Zendesk messenger open), then inspect visible iframes,
  buttons, and loaded chat assets.

## Primary candidates

These are actionable if we decide to benchmark "Yuma-backed chat over a Gorgias front-end" as a
separate attribution bucket. They should not be mixed into the native-Yuma score.

| Store | URL | Yuma source | Chat availability observed | Native Yuma front-end? | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Glossier | https://www.glossier.com/ | Public Yuma case study | Visible Gorgias chat window iframe after opening; Gorgias and Klaviyo assets loaded | No | Strong candidate for a `Yuma-backed / Gorgias-front` pool |
| MFI Medical | https://www.mfimedical.com/ | Public Yuma case study | Visible Gorgias chat window and campaign iframes; Gorgias assets loaded | No | Strong candidate for the same separate pool |
| Parachute Home | https://www.parachutehome.com/ | Public Yuma Sales AI mention | Visible Gorgias chat window iframe; Gorgias and Klaviyo assets loaded | No | Strong candidate, especially for Sales AI / shopping context |
| Jolly Mama | https://jollymama.com/ | Active Yuma install list | Visible Gorgias chat window/input/button frames and a `Chat` button | No | Strong candidate from the install list |
| Vivo Life | https://www.vivolife.co.uk/ | Active Yuma install list | Visible Gorgias chat window/button frames; Gorgias API present | No | Strong candidate from the install list |

## Backups

| Store | URL | Yuma source | Chat availability observed | Native Yuma front-end? |
| --- | --- | --- | --- | --- |
| Hiyo | https://drinkhiyo.com/ | Active Yuma install list | Visible Gorgias chat window/button frames | No |
| Wagwear | https://wagwear.com/ | Active Yuma install list | Visible Gorgias chat campaign/window/button frames | No |
| Huski | https://huski.co.nz/ | Active Yuma install list | Visible Gorgias chat campaign/window/button frames | No |

## Checked but not ready

| Store | URL | Why not ready |
| --- | --- | --- |
| Petlibro | https://www.petlibro.com/ | Public Yuma case study, but the dynamic pass did not expose a visible chat frame or supported chat API in this pass |
| MyVariations | https://myvariations.com/ | Public Yuma case study, but the dynamic pass only found a visible help/menu surface, not a confirmed chat widget |
| UnBonMaillot | https://unbonmaillot.com/ | Public Yuma case study, but no visible chat frame was confirmed in this pass |
| Our Place | https://fromourplace.com/ | Active Yuma install list and Gorgias assets present, but no visible chat frame was confirmed in this pass |

## Attribution decision

Do not add these stores to `runner/vendors.js` as plain `vendor: "Yuma"` with the current native
Yuma cohort. The shopper-facing widget detected here is Gorgias, even when Yuma is the backend AI
layer. Mixing these into the native-Yuma score would make the benchmark harder to defend.

Safer options:

1. Add a separate cohort such as `Yuma-backed (Gorgias front-end)` and document that it measures
   Yuma behavior through a Gorgias chat surface.
2. Use these sites only as a sourcing pool for manual proof / screenshots until a native Sales AI
   or Chat AI surface is visible.
3. Keep native Yuma score limited to stores where `app.yuma.ai` / `yuma-widget` is the driven
   front-end.

## Next action

If Max approves the separate attribution bucket, add the five primary candidates first, with an
explicit vendor label and a methodology note in the report. Then run only a 1-theme probe per store;
expand to 5 conversations only when the probe produces at least 3 timed AI answers.
