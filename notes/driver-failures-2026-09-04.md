# Why 36 storefronts yield nothing — analysis, 2026-09-04

Ordered by what the evidence supports. **No driver was changed** — see *Why this stops at
diagnosis* at the end.

## 1. `driver-triage.json` is stale and should not be used to plan work

Its 32 unfixed entries are dated **mid-to-late July**. Cross-checking against
`tools/driver-health.mjs` over the last 14 days, they barely overlap with the stores actually
failing now: `decagon-backbone`, `zendesk-nobull`, `gorgias-blueroot`, `siena-simplemodern`
and most other current zero-yield stores appear nowhere in it. Plan from `driver-health.mjs`.

## 2. The dominant failure is missing reply TEXT, not a missing widget

Of **1,677 invalid captures** since 2026-08-18:

| signature | count | share |
|---|---|---|
| **no AI text at all** | **1,138** | **68%** |
| text present, still untimed / <3 answers | 487 | 29% |
| pre-chat or email gate | 43 | 3% |
| widget offline | 9 | 1% |

Two hypotheses worth naming and discarding: "the widgets are offline at 02:00 ET" is **wrong**
— it is 1%, one store (`zendesk-nobull`). "These are not AI agents" is **also wrong** for most
of them; `intercom-gymshark` and `zendesk-nobull` both identify as AI agents in the transcript.

The 68% bucket records 40–80 AI turns per store with **zero** reply text, across Gorgias, Siena,
Zendesk, Klaviyo, DigitalGenius, Decagon, Ada and Yuma alike. Eight widget families failing the
same way is one systemic cause, not eight driver bugs.

## 3. Where to look first

`run.js` sets `replyTail` from `readTranscript(page, w.scope)`, and `replyFull` from a
line-level delta. Commit **39990d2e** (2026-07-29, "Stop attributing the whole page to a turn
when the prefix scan fails", #198) changed the fallback so a turn that adds no new lines now
yields `""` instead of the whole transcript. That was a correct fix — page dumps were
*suppressing* vendor quality — and its own commit message predicts this signature exactly:
*"A turn that adds nothing now yields ''"*.

What it does **not** explain on its own: `complete_ms` comes from `timeTurn`, which runs before
the delta, so empty text alone should not zero the timing. Both are zero on these stores. So
either scope resolution is failing (transcript unreadable → both empty), or `timeTurn`'s
completion detection shares the growth assumption the delta gave up on. **That is the question
to answer with a live probe**, and it is one question, not 36.

Timing note: results jump 2026-07-29 → 2026-08-10 (capture outage). Six stores across four
vendors last produced valid data on 07-29, but that is the last date *before the gap* — the
break happened somewhere in that window, not provably on the 29th.

## 4. Split the 36 before spending effort

- **11 never produced a single valid capture** — `yuma-petlibro`, `zendesk-newlook`,
  `zendesk-bodyshop`, `gorgias-evdnce`, `gorgias-blueroot`, `gorgias-evolutionpt`,
  `gorgias-olivelle`, `decagon-blindsonline`, `decagon-topps`, `zendesk-snocks`,
  `decagon-rituals`. These are **sourcing** failures, not regressions: they passed DOM
  detection and were never validated end-to-end. Adding a "must produce one valid conversation
  before it enters the rotation" step would have caught all eleven.
- **10+ regressed after working well** — `siena-simplemodern` (100 valid, then nothing),
  `klaviyo-happywax` (46), `dg-gstar` (48), `klaviyo-k9ballistics` (49), `ada-endy` (45),
  `siena-mudwtr` (66), `dg-airup` (25), `ada-peloton`, `siena-plg`, `siena-spanx`. These are
  worth real debugging — the capability existed and was lost.
- **2 are gate failures the driver already has a mechanism for** — `intercom-gymshark` (20) and
  `zendesk-papier` (20) sit on a name/email pre-chat form. AGENTS.md §3a documents
  `fillEmailGate` for exactly this; it is not firing. Smallest, most self-contained fix here.

## 5. Do NOT wall these yet

`wall: true` is the right tool for a structural wall, and the precedent comments
(`sierra-sonos`, `yuma-rouje`) match this evidence shape. It was tempting to wall the five
stores whose transcripts show only consent/greeting chrome. **Reading the full samples
contradicted that**: `zendesk-nobull` greets as "NOBULL Digital Assistant", `gorgias-tommyjohn`
answered a shipping question correctly in one capture. Walling them would have permanently
removed recoverable coverage on a misread. Wall only after a live probe confirms a wall.

## Why this stops at diagnosis

Fixing a driver means reading the live widget's DOM to find the right selector, then confirming
the fix captures a real conversation. **Neither is possible from a Claude Code session**: the
egress proxy returns **403** for competitor storefronts (`curl https://www.topps.com/support` →
403; github.com, Notion and the Vercel board all resolve fine). `tools/probe-generic.mjs` gets
`ERR_CONNECTION_RESET` on every store.

A driver change written without seeing the widget is a guess, and an unverified guess pushed
into the nightly capture costs a night of data across every store it touches. The work belongs
on the Fly capture box, which has the egress and the headed browser for it. This note is the
starting point so that session begins with one question instead of thirty-six.
