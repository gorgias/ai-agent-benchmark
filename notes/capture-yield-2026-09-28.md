# Why so few captures are usable — and what changed, 2026-09-28

Scope: the 6,885 conversations captured 2026-08-18 → 2026-09-16 (the last date on master; later
nights sit on unmerged `pipeline/*` branches). **4,193 were valid (61%).** Everything below was
derived from those stored transcripts; `node tools/capture-yield.mjs` reproduces the breakdown.

## 1. Where the 2,692 unusable captures go

| signature | convs | what it means | fixed here? |
|---|---:|---|---|
| **no text at all** | 1,117 | the widget's transcript was never readable on any turn | cost cut ~3×, plus a recovery retry (§3) |
| **killed early by a handover signal** | 794 | stopped before 3 timed answers on a "handover" | **yes** — 387 of them were not transfers (§2) |
| text but never timed | 460 | answers arrived but turns never settled into a timed answer | partly (§4) |
| composer locked (turn hard-timeout) | 118 | send() hung on an uneditable composer | **yes** for DigitalGenius (§4) |
| capture errors | 203 | open timeout 83, network 71, page navigation 39, other 10 | navigation **yes** (§4) |

By widget, valid share: Envive 91%, Sierra 76%, Kodif 73%, Ada 69%, Rep AI 65%, Gorgias 59%,
Zendesk 56%, Intercom 52%, Siena 51%, DigitalGenius 50%, Klaviyo 48%, Yuma 45%, Decagon 17%.

## 2. The handover detector ended conversations that no human ever touched

1,748 of the 6,885 conversations carried a handover signal; the runner treated every one as "a
human took over" and stopped sending. Re-reading the flagged turns:

- **~900 were OFFERS, not transfers** — "Sorry I'm not able to answer your question. Would you like
  to speak to a human?" (Zendesk), "If you'd like, I can connect you with someone who can confirm"
  (Klaviyo, Sierra, Kodif, DigitalGenius), "Once submitted, our team will follow up" (Envive).
- **~130 were regex false positives.** The worst: `share … order number\b.*(team|agent|assist|follow)`
  had an unbounded `.*`, so *"could you share your order number? It should start with "AL"
  followed by 7 digits"* matched on "followed". Also: "Simply enter your email and order number
  on our Returns Portal", "enter your details and payment at checkout", "Here's what our policy
  says:" read as a human called "policy", and Envive's widget rule firing on a quoted customer
  review ("Fracture has the best customer care team").
- **The same audit found real transfers the old patterns MISSED**, and those are integrity bugs,
  not yield bugs:
  - status lines the widget renders on a human take-over — Siena's "Routed to human agent", DG's
    "An agent is joining" and "Live Agent" sender label, Ada's "Agent connected" — are stripped as
    chrome before detection ran. **109 valid conversations** kept timing and judging replies after a
    human took over; on `dg-dreamcloudslee` a named "Eloise H • Live Agent" answered turns that were
    timed as the AI's.
  - phrasings: "I'm connecting you with one of my teammates now" (Siena — `connect you` does not
    match `connecting you`), "I'll hand you over to an agent" (DG), and Gorgias's own "I've passed
    your request to our team, and a person will follow up" / "A person from our team will follow up".

**Change** (`classify.js` `classifyHandover`, `statusTransfer`):
- every signal is classified TRANSFER (a human owns or is joining the thread → stop sending, as
  before) or OFFER (keep the conversation going; flagged `handover_offer`);
- an OFFER still counts against automation — as a *deflection* — exactly as the transfer it used to
  be recorded as did, so the rule change cannot inflate anyone's automation rate by relabelling;
- every pattern is bounded to one sentence; self-service instructions are guarded; status lines are
  read on the raw text; the missed phrasings above were added.

**Bake-time re-derivation** (`conversation-outcome.js` `rederiveHandover`, used by gen.js,
scoreboard-preview.js and eval-pack.js). Fixing only the capture side would leave the stored data on
the old verdicts, and correcting only the missed transfers (mostly competitors) while keeping
Gorgias's missed ones would be lopsided. So the baker re-applies the current classifier to every
stored conversation, for every vendor.

Dry-run effect on the scoreboard (`node scoreboard-preview.js`, same window, before → after):

| vendor | overall | shop automation | support automation |
|---|---|---|---|
| Gorgias | 69 → 66 | 84 → 80 | 74 → 68 |
| Decagon | 61 → 66 | 83 → 81 | 67 → 86 (n is small) |
| Sierra | 65 → 65 | 70 → 72 | 53 → 53 |
| Yuma | 65 → 61 | 81 → 69 | 83 → 71 |
| Siena | 65 → 57 | 73 → 56 | 76 → 61 |
| Intercom | 63 → 60 | 87 → 76 | 61 → 55 |
| Ada / Rep AI / DG / Envive / Klaviyo / Kodif / Zendesk | within ±2 | | |

**Merging this moves published numbers** (deploy-on-merge re-bakes from committed data). Gorgias
drops because its own missed hand-offs are now counted — that is the rule applied uniformly, and it
is the expected direction of an honest fix.

Going forward the bigger effect is on yield: 387 of the 794 early-killed conversations would have
kept going, and ~800 VALID conversations were truncated early by an offer (Zendesk 146, Sierra 150,
Klaviyo 80 …), so they were judged on fewer turns than the script.

## 3. "No text at all": dead widgets cost 12 minutes each

A conversation whose transcript is never readable burned 4 dead turns × (120 s turn timeout + 60 s
late-flush) ≈ 12 min before the dead-conversation abort — ~230 h over the period, against a 3 h
nightly capture window. A first turn that reads *nothing* is decisive: of 1,416 such
conversations only 18 (1.3%) ever became valid.

**Change** (`run.js`): a turn gives up after `SCOPE_GRACE_MS` (45 s) of a completely unreadable
transcript and skips the late-flush; an unreadable FIRST turn abandons the conversation
(`error: widget-absent`) and the worker regenerates it once in a fresh context — cold session
preserved — in **recovery mode**: accept the consent banner and move/scroll like a visitor.

Why recovery mode, from the raw served HTML of the stores that yield nothing (curl, 2026-09-28):
- **consent-gated chats.** Madura (Gorgias, 0 valid since 2026-07-01) boots its chat only on
  Axeptio's `axeptio:gorgias` grant, and `dismiss()` clicks "Refuser" first. The default path is
  unchanged; only the recovery retry accepts.
- **interaction-lazy loaders** — the pattern already found on Rep AI; many zero-text captures
  detected no chat provider at all on the loaded page although the loader is in the HTML.

Stores whose served HTML **no longer carries the declared vendor** (probe, then retire or re-map —
not walled here because a tag manager could still inject it): `zendesk-snocks` (LiveChat now),
`klaviyo-k9ballistics` (Gorgias only), `siena-simplemodern`, `gorgias-blueroot`,
`decagon-rituals`, `repai-puursmile` (Richpanel), `repai-slipdoctors` (Gorgias only),
`repai-magnoliapearl`, `repai-cwspirits`, `repai-charliebcollection`, `repai-clothandpaper`,
`repai-blingcartel`, `repai-americanhomefurniture`, `ada-peloton`, `ada-endy`,
`intercom-gymshark`, `intercom-littleformula`. Blocked to curl (403/429, inconclusive):
`dg-airup`, `zendesk-newlook`, `decagon-backbone`, `decagon-topps`, `repai-peterthomasroth`.

Stores whose HTML **does** carry the vendor but capture nothing — driver work: Siena PLG /
MUD\WTR / Spanx (healthy until late July; the reader now prefers the siena.cx frame that holds the
composer, in case the webchat mounts a second frame), Gorgias Madura / Olivelle / Evdnce /
Spacegods / Evolution PT, DG G-Star, Zendesk Pabo / Sealy / NOBULL, Yuma Petlibro.

## 4. Smaller driver fixes

- **DigitalGenius rating prompt locks the composer.** After an answer DG posts "Was the information
  I provided helpful? Yes / No" and disables the textarea; send() then hung until the turn's hard
  timeout — 111 turns in September (Kukoon, OBee, Blakely, Abbott Lyon). New `unlockComposer` hook,
  run BEFORE quiescing, outside every timed window: it clicks "Yes" only when the composer is
  actually uneditable. It is a rating widget, not a quick-reply chip (no question sent, no answer
  served); flagging it here so the choice can be vetoed.
- **Rep AI chatbot disclosure** ("Accept & continue / Decline") replaced the composer on
  Peter Thomas Roth and Bling Cartel: 14 captures, 0 valid. The driver now accepts it.
- **Page navigating under the Gorgias open()** ("Execution context was destroyed") failed 38
  `gorgias-tommyjohn` captures before a single message: now waits for the new document and retries.
- DG `send()` actions are bounded (8 s) so an uneditable composer fails fast.

Verified against local HTML fixtures in a real Chromium (DG lock → unlocked and reaction kept out of
the timed turn; Rep AI closed-shadow disclosure → accepted and message typed; two siena.cx frames →
the composer frame is read; recovery mode accepts OneTrust, default mode does not; a navigation
during Gorgias open() survives; a store with no readable widget → one `widget-absent` turn, one
regeneration). **Not verified against live storefronts:** this container's browser cannot reach
them (TLS interception), so the first nightly run is the live test — watch the `widget absent`,
`composer was locked`, and `human-help offer (continuing)` log lines.

## 5. Not fixed, with evidence

- **In-chat email gates** — Zendesk Wildling repeats "Could you share your email address with
  me?" every turn; Tempur-Pedic's assistant opens with "please enter your email address"; DG
  Organic Basics / Blakely ask before answering. Answering with a dummy `example.com` address as a
  chat message would unlock them but changes the scripted conversation; needs a methodology call.
- **Ada TRX / Oh Polly** — button-menu flows ("Choose from common order issues below"); free-text
  rule, structural.
- **Short clarifying answers never stop the clock** — "Which two items would you like me to
  compare?" is under `MIN_SUBSTANCE` (80 chars). Only 129 turns / 7 conversations affected; the
  anti-stall guard is worth more than they are.
- Capture-box network errors (`ERR_INTERNET_DISCONNECTED`, 71) are infrastructure, not drivers.
