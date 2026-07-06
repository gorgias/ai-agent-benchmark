# Yuma visible-chat sourcing - 2026-07-06

Goal: find at least 20 new storefronts that are publicly or internally tied to Yuma and have a
real chat surface available, without incorrectly adding Gorgias-front widgets as clean native Yuma
Shopping Assistant targets.

## Method

- Started from public Yuma sources:
  - Yuma case studies: https://yuma.ai/case-studies
  - Yuma Sales AI Shopify listing: https://apps.shopify.com/sales-ai-1
  - Yuma Sales AI launch mention: https://www.ycombinator.com/launches/OU1-sales-ai-shopify-product-q-a-widget-that-boosts-revenue
  - Gorgias/Yuma app listing: https://www.gorgias.com/apps/ticket-assistant-by-yuma-ai
- Cross-checked the existing internal Yuma install list in `notes/yuma-merchants-from-gorgias.md`.
- Excluded native Yuma stores already present in `runner/vendors.js`.
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
| Bombay Hair | https://bombayhair.com/ | Current Yuma run candidate; page signature confirmed dynamically | Visible Gorgias chat window/input/button plus `app.yuma.ai` Yuma iframe | Yes | Best next native-Yuma probe once the active headed run finishes |
| BloomsyBox | https://www.bloomsybox.com/ | Active Yuma install list | Visible Gorgias chat window/button/input frames; `window.GorgiasChat` present | No | Strong `Yuma-backed / Gorgias-front` candidate |
| 47 Brand Canada | https://47brand.ca/ | Active Yuma install list | Visible Gorgias chat window/button/input frames; `window.GorgiasChat` present | No | Strong `Yuma-backed / Gorgias-front` candidate |
| Franklin Pet Food | https://franklinpetfood.com/ | Active Yuma install list | Visible Gorgias chat window/button/input/campaign frames; `CHAT` button | No | Strong candidate |
| Glossier | https://www.glossier.com/ | Public Yuma case study | Visible Gorgias chat window/input/button frames; `window.GorgiasChat` present | No | Strong candidate |
| GYL Bag | https://gylbag.com/ | Active Yuma install list | Visible Gorgias chat window/button/input frames; `window.GorgiasChat` present | No | Strong candidate |
| Hiyo | https://drinkhiyo.com/ | Active Yuma install list | Visible Gorgias chat window/button/input frames; `window.GorgiasChat` present | No | Strong candidate |
| Huski | https://huski.co.nz/ | Active Yuma install list | Visible Gorgias chat window/button/input/campaign frames; `window.GorgiasChat` present | No | Strong candidate |
| Jolly Mama | https://jollymama.com/ | Active Yuma install list | Visible Gorgias chat window/input/button/campaign frames and a `Chat` button | No | Strong candidate |
| Kindthread | https://kindthread.com/ | Active Yuma install list | Visible Gorgias chat window/button/input frames; `window.GorgiasChat` present | No | Strong candidate |
| MFI Medical | https://www.mfimedical.com/ | Public Yuma case study | Visible Gorgias chat window/input/campaign frames; `window.GorgiasChat` present | No | Strong candidate |
| Morphea Bed | https://www.morpheabed.com/ | Active Yuma install list | Visible Gorgias chat window/button/input/campaign frames | No | Strong candidate |
| Ninni Co | https://ninnico.com/ | Active Yuma install list | Visible Gorgias chat window/button/input/campaign frames | No | Strong candidate |
| Parachute Home | https://www.parachutehome.com/ | Public Yuma Sales AI mention | Visible Gorgias chat window/input frames; `window.GorgiasChat` present | No | Strong candidate, especially for Sales AI / shopping context |
| Resparked | https://resparked.com/ | Active Yuma install list | Visible Gorgias chat window/button/input frames; `window.GorgiasChat` present | No | Strong candidate |
| SURI | https://www.trysuri.com/ | Active Yuma install list | Visible Gorgias chat window/button/input frames; `window.GorgiasChat` present | No | Strong candidate |
| The Fittest | https://www.thefittest.com/ | Active Yuma install list | Visible Gorgias chat input/button/window frames; `window.GorgiasChat` present | No | Strong candidate |
| The Frye Company | https://www.thefryecompany.com/ | Active Yuma install list | Visible Gorgias chat window/button/input/campaign frames; `window.GorgiasChat` present | No | Strong candidate |
| Vivo Life | https://www.vivolife.co.uk/ | Active Yuma install list | Visible Gorgias chat window/button/input frames; `window.GorgiasChat` present | No | Strong candidate |
| Wagwear | https://wagwear.com/ | Active Yuma install list | Visible Gorgias chat window/button/input/campaign frames; `window.GorgiasChat` present | No | Strong candidate |

## Backups / manual follow-up

| Store | URL | Why it is not in the primary 20 |
| --- | --- | --- |
| Grubbly Farms | https://grubblyfarms.com/ | `window.GorgiasChat` present and a visible `CHAT WITH US` surface, but no chat iframe opened in the dynamic pass |
| LyfeFuel | https://lyfefuel.com/ | Gorgias API and bundle loaded, but only a contact surface was visible in the pass |
| Susan Shaw | https://susanshaw.com/ | Native Yuma assets loaded (`js.yuma.ai/widget.js`), but the Yuma chat was not visible in the pass |
| UnBonMaillot | https://unbonmaillot.com/ | Public Yuma case study and a visible `assistant IA` with message field, but no native Yuma signature was detected |
| Our Place | https://fromourplace.com/ | Gorgias assets and a `Support` surface were present, but no Gorgias chat frame/API was confirmed |

## Checked but not ready

These showed only static help/contact surfaces, failed to expose a chat widget, or did not produce a
vendor-attributable chat signal in this pass:

Matiere Premiere, MamaFique, Studio Meen, OK Local, Apex Gaming PCs, Mikuta, Agape Studio, Balzac
Paris, Zero Waste Cartel, Pirani Life, YSE Paris, Ejam, Casanova Paris, MK5, Imperia Caviar,
Respire, Chirpish, Bells of Steel, Ortho Back, MyVariations, Petlibro, Clove, Liforme, Manucurist,
BonneGueule, Javy Coffee.

## Attribution decision

Do not add these stores to `runner/vendors.js` as plain `vendor: "Yuma"` with the current native
Yuma cohort. The shopper-facing widget detected on most of these sites is Gorgias, even when Yuma is
the backend AI layer. Mixing them into the native-Yuma score would make the benchmark harder to
defend.

Safer options:

1. Add a separate cohort such as `Yuma-backed (Gorgias front-end)` and document that it measures
   Yuma behavior through a Gorgias chat surface.
2. Use the backup/native-signature sites for manual proof or short probes until a native Sales AI or
   Chat AI surface is visible.
3. Keep the current native Yuma score limited to stores where `app.yuma.ai` / `yuma-widget` is the
   driven front-end.

## Next action

Do not launch a competing headed driver while the current Yuma headed run is active. If Bombay Hair
yields at least 3 timed AI answers in a bounded probe or existing run output, add it to the
native-Yuma expansion path. For the other 19 primary candidates, only add them after approving a
separate `Yuma-backed (Gorgias front-end)` attribution bucket, then run a 1-theme probe before
expanding to 5 conversations.
