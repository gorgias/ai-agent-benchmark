# Yuma customers recovered from Gorgias backend (dim_integrations, app "Yuma AI" = 6392e5d9dda5a25e37b8753c)

Method: Yuma installs as a Gorgias App Store app, so Gorgias's own `dbt_product.dim_integrations`
(app_id = Yuma AI, status='active') joined to `dbt_core.dim_accounts.gorgias_account_id` yields
every active Yuma merchant + storefront domain. 100 active installs; 60 with a clean domain below
(newest-first). Queried 2026-07-07 via Cortex.

## Attribution caveat (important)
Most of these run Yuma **behind the Gorgias widget** (config.gorgias.chat on-page) — the shopper
sees the GORGIAS widget, Yuma processes server-side. Driving those would test Gorgias's front-end,
NOT Yuma → do NOT add them as "Yuma" benchmark stores. Only sites carrying the **native
`yuma-widget` / app.yuma.ai** front-end are cleanly attributable to Yuma.

## Verified native-Yuma-widget (added to benchmark)
- Tediber (tediber.com) · EvryJewels · CABAIA · MESHKI ×3  — already in set
- **Rouje (rouje.com)**, **Le Domaine (le-domaine.com)** — added 2026-07-07 (native yuma-widget confirmed)

## Full active list (name · domain · yuma_since) — candidates for future rendered-widget checks
jollymama.com 2026-07-02 · vivolife.co.uk 2026-07-02 · matiere-premiere.com 2026-07-01 · mamafique.com 2026-06-29 · studiomeen.nl · oklocal.com · apexgamingpcs.com · bloomsybox.com · mikuta.com · agape-studio.com · fromourplace.com · balzac-paris.com · resparked.com · zerowastecartel.com · 47brand.ca · grubblyfarms.com · drinkhiyo.com · pirani.life · trysuri.com · yse-paris.com · wagwear.com · gylbag.com · morpheabed.com · ejam.com · casanovaparis.fr · mk5.com.au · imperiacaviar.com · franklinpetfood.com · respire.co · chirpish.co · bonnegueule.fr · satisfio.fr · susanshaw.com · bellsofsteel.us · thefittest.com · drinkjavy.com · le-domaine.com · rouje.com · orthoback.de · glossier.com · ninnico.com · myvariations.com · lyfefuel.com · thefryecompany.com · kindthread.com · manucurist.com · scrubsandbeyond.com · liforme.com · huski.co.nz
(+ ~40 more on myshopify.com placeholder domains — resolve to real storefront before use)
