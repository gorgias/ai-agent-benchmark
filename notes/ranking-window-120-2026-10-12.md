# Ranking window 90 → 120 days — cross-vendor check (2026-10-12)

Proposed reason: capture volume. Too many storefronts hold too few conversations, and the nightly
machine lost most of 2026-09-29 → 2026-10-08 to publish and git-sync failures (#331, #337).

Same data (data_through 2026-10-11), baked by `gen.js` at 90 days (window 2026-07-14 → 10-11)
and at 120 days (2026-06-14 → 10-11). `ranking-window.js` asks that a new value be validated
across every vendor and that the timing be considered, so both are recorded here.

## Timing

At 90 days Gorgias fell from #1 overall (2026-10-05, composite 65) to #4 (2026-10-11, 62) as its
early-July conversations aged out (support quality: July 89.5 vs Aug 64.7, Sep 70.2, Oct 64.0).
This change was proposed while that was happening.

## Thin storefronts (store-lanes flagged `thin`)

| vendor | store-lanes 90→120 | thin 90→120 |
|---|---|---|
| Ada | 24→24 | 1→1 |
| Decagon | 12→12 | 1→1 |
| DigitalGenius | 23→23 | 2→2 |
| Envive | 14→14 | 0→0 |
| Gorgias | 84→93 | 12→7 |
| Intercom | 12→12 | 0→0 |
| Klaviyo | 10→10 | 0→0 |
| Kodif | 69→71 | 8→8 |
| Rep AI | 109→109 | 44→44 |
| Siena | 14→14 | 1→1 |
| Sierra | 32→32 | 0→0 |
| Yuma | 14→14 | 4→4 |
| Zendesk | 36→36 | 1→1 |
| **all** | **453→464** | **74→69** |

The thin stores are recent additions (mostly Rep AI and Kodif); a longer window has no older
conversations to give them. Every vendor was already rankable at 90 days (`not_ranked` empty).

## Lane rankings

Shopping — vendor | rank | composite | conversations | storefronts | CI95

| vendor | rank | composite | convs | storefronts | ci95 |
|---|---|---|---|---|---|
| Envive | 1→1 | 72→72 | 421→496 | 7→7 | 5.8→5.2 |
| Sierra | 3→2 | 65→65 | 442→566 | 16→16 | 9→8 |
| Decagon | 2→3 | 68→65 | 158→172 | 6→6 | 13.3→13.2 |
| Gorgias | 5→4 | 61→63 | 392→540 | 41→45 | 2.5→2.4 |
| Rep AI | 4→5 | 62→62 | 682→682 | 56→56 | 2.7→2.7 |
| Ada | 6→6 | 59→59 | 499→553 | 12→12 | 11→11.1 |
| Intercom | 7→7 | 59→59 | 444→445 | 6→6 | 14.6→15.9 |
| Yuma | 8→8 | 54→56 | 189→240 | 7→7 | 17.6→17.3 |
| Siena | 9→9 | 53→55 | 252→313 | 7→7 | 14.1→15.7 |
| Klaviyo | 11→10 | 50→52 | 266→286 | 5→5 | 12.5→12.4 |
| DigitalGenius | 10→11 | 52→51 | 661→722 | 11→11 | 13.1→12.8 |
| Kodif | 12→12 | 47→48 | 482→534 | 27→28 | 5.8→5.4 |
| Zendesk | 13→13 | 44→45 | 522→529 | 18→18 | 8.2→8.4 |

Support

| vendor | rank | composite | convs | storefronts | ci95 |
|---|---|---|---|---|---|
| Gorgias | 2→1 | 63→68 | 323→427 | 43→48 | 4.6→4.3 |
| Yuma | 4→2 | 63→65 | 166→199 | 7→7 | 14.4→14.3 |
| Decagon | 1→3 | 64→65 | 144→147 | 6→6 | 13.7→12 |
| Sierra | 3→4 | 63→64 | 356→420 | 16→16 | 8.9→7.7 |
| Rep AI | 5→5 | 62→62 | 282→282 | 53→53 | 4.5→4.5 |
| Ada | 6→6 | 62→62 | 386→420 | 12→12 | 9.1→8.7 |
| Intercom | 7→7 | 60→60 | 350→352 | 6→6 | 17.9→17.7 |
| Siena | 8→8 | 58→58 | 259→300 | 7→7 | 22.2→21.2 |
| DigitalGenius | 9→9 | 56→57 | 534→561 | 12→12 | 10.3→10.3 |
| Zendesk | 10→10 | 49→50 | 464→480 | 18→18 | 8.1→8.3 |
| Klaviyo | 11→11 | 48→49 | 353→367 | 5→5 | 11→11.5 |
| Kodif | 12→12 | 45→47 | 405→441 | 26→27 | 6.5→6.5 |
| Envive | 13→13 | 40→42 | 434→499 | 7→7 | 11.3→12.3 |

Overall: Gorgias 4→1 (62→66), Decagon 1→2 (66→65), Sierra 2→3 (64→65), Rep AI 3→4, Yuma 7→6,
Intercom 6→7, Kodif 13→12, Zendesk 12→13; others unchanged.

## Reading

The extra conversations come mostly from Gorgias (+148 shopping, +104 support), Sierra and
Envive. Storefront counts change only for Gorgias (+4/+5) and Kodif (+1/+1); CIs move by at most
~1.5 points. The thin-store problem the change was meant to address is essentially unchanged
(74→69, the 5 all Gorgias). Filling thin storefronts directly in the nightly plan addresses it for
every vendor without changing the window.
