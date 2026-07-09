# Per-vendor breakdown

What each assistant is, how its widget is built, the transport it uses, how to open/drive it, where the session persists (relevant for cold runs), and behavioral observations. This is the reverse-engineering that the report and the headless runner are built on.

> Identifiers shown here (app keys, integration UUIDs, embed paths) are **public client-side values** already readable in each storefront's page source — not secrets. Included for reproducibility.

---

## Sierra — Casper ("Luna")

- **Site:** `casper.com` · **Agent:** "Luna"
- **Widget:** inline **shadow-DOM** component in the page (not an iframe).
- **Transport:** **SSE token streaming** via `https://sierra.chat/-/api/chat`. First byte ~0.4s; tokens stream in.
- **Open:** `window.openSierraChat()` (globals: `loadSierra`, `sierraConfig`).
- **Drive:** within the widget's shadow root — `textarea[aria-label="Add new message"]`, `button[aria-label="Send message"]`; transcript in `ol[aria-label="Chat messages"]` (each `li` prefixed "Agent said" / "You said"; a single reply can span multiple `li`s).
- **Latency signal:** SSE stream open→close (throttle-immune), or shadow-root text growth+stability.
- **Session:** server-side persisted (warm; not resettable from page scripts).
- **Observations:** **richest commerce UI** — renders interactive **product cards** (image, Select Size, **Add to Cart**). Fastest to a recommendation (~8s). Latency varies sharply by query type (FAQ ~4.6s vs rec ~9.7s). Quality 5.0 both modes.

## Siena — Simple Modern ("Maddie")

- **Site:** `simplemodern.com/products/mesa-loop-30oz-49` · **Agent:** "Maddie"
- **Widget:** cross-origin **iframe** `chat.siena.cx/dist/index.html` (+ `webchat.js`). Backend `api-prod.siena.cx`.
- **Transport / API (reverse-engineered):**
  - `POST /v1/live_chat/session?key=<appKey>` → session
  - `POST /v1/live_chat/messages` → submit user message (returns customer UUID)
  - `GET /v1/live_chat/message?page=1&page_size=20` → poll for the reply (delivered **atomically**, not streamed to the client)
  - `POST /v1/live_chat/delivery/confirm` (message_hash), `…/track/customer_interaction`
  - Auth headers: `x-siena-app-key`, `x-siena-organization-uuid`, `x-siena-livechat-session-uuid`, `x-siena-livechat-customer-uuid`, `x-siena-livechat-integration-uuid`. Public app key on Simple Modern: `bd1e796b-6afe-40a3-b42f-77e4eb72e175`; integration `93a746a4-…`; connected helpdesk: **Gorgias**.
- **Open:** `window.SienaLaunchChat()` / `window.SienaLiveChatWidget` (config exposes `IFRAME_SRC`, `API_BASE`, Sentry + Honeycomb keys).
- **Latency signal:** send→reply via the GET poll (atomic).
- **Observations:** answers in rich text with **linked product variants** (each color → its PDP) but **defers** confident product picks to the product pages ("check the product page", "share your email so the team can confirm"). Support FAQ strong; returns answer deflects (quality: FAQ 5.0, product-rec 1.0).

## Gorgias — Glamnetic (us) / also EvryJewels

- **Sites:** `glamnetic.com` (a **live production storefront** — Shopify shop `glamrco.myshopify.com`; magnetic lashes + press-on nails; assistant named **"Gina"**), `evryjewels.com`.
- **Widget:** **Gorgias Chat** (`config.gorgias.chat`, bundle-loader for `glamrco.myshopify.com`); AI-Agent UI. Launcher + input + **`chat-window`** iframe (same-origin under the Shopify domain — readable, so the transcript can be timed directly).
- **Transport:** **WebSocket** (`us-east1-*.gorgias.chat/ws`). Replies arrive as frames; `data.fromAgent === true` marks the bot. Frame events are network-driven → accurate timing even under tab throttling.
- **Open / drive:** `window.GorgiasChat.open()`; `window.GorgiasChat.sendMessage(text)` works programmatically once the conversation view is active (the AI replies post atomically into `chat-window`). The reply often arrives as one complete message rather than streaming, so completion = transcript length stable for ~4s, with a typing-indicator guard ("Thinking/Analyzing/…").
- **Latency signal:** first `fromAgent` WS frame, or `chat-window` iframe text growth+stability (typing-indicator aware).
- **Observations (Glamnetic):** renders **interactive Add-to-Cart product cards** and makes specific, **multi-item & cross-category** recommendations (press-on nails → matching magnetic lash → liner), reasons about **bundles**, and is **honest about limits** (won't add to cart for you; no in-chat shipping ETA). Strong product-rec quality (**4.7**, just behind Sierra's 5.0) but the **slowest rec-capable vendor (~20s)**. Support: specific policy answers (14-day returns, customs/duties, discount-code troubleshooting, cruelty-free/vegan) but **gates order-specific actions behind account login**, and **escalates to a human only when explicitly asked** (an appropriate handover, not an unprompted refusal). Being a real production store (vs the old NouriVida demo) makes this a fairer, tougher baseline.

## Yuma — EvryJewels

- **Site:** `evryjewels.com` (also referenced: Glossier).
- **Key finding:** **Yuma has no storefront chat widget of its own.** On every reference customer the on-site chat is **Gorgias Chat**; Yuma is a **back-end ticket-automation layer** on top of the helpdesk. So "Yuma latency" = the in-chat AI reply a shopper experiences through Gorgias Chat; attribution between Yuma and Gorgias's own AI can't be confirmed client-side.
- **Transport:** Gorgias Chat WebSocket (`fromAgent` frames).
- **Observations:** replies delivered in a **single block** (no streaming); uniformly slower (~14s); a product-rec ("necklace for a birthday") only gestured at collections rather than a specific item (quality 2.7); one question got **no in-chat reply within 70s**.

## DigitalGenius — Bloom & Wild ("Willow")

- **Site:** `bloomandwild.com` · **Agent:** "Willow"
- **Widget:** `chat.digitalgenius.com` built on **Sunshine Conversations** (`sunco.js`) + **Pusher** (WebSocket, EU cluster). Transcript renders in the same-origin **`dg-chat-widget-iframe`**.
- **Open / drive:** `window.dgchat.methods.launchWidget()`, `sendMessage()`; SDK methods `initialiseSDK` / `sendMessageToSDK`. Pusher WS lives in the iframe (not the parent).
- **Gate:** a **prechat lead-capture form (name + email)** blocks the assistant until filled — unique among the set. A throwaway `example.com` identity is used to start the chat.
- **Session:** stored in the **parent origin** → **the only vendor resettable from page scripts** (clearing storage brings the prechat form back). Used to measure cold vs warm: **12.7s cold vs 14.3s warm**.
- **Observations:** solid, specific FAQ/policy answers. On a product-recommendation question it **🚩 hands off to a human** ("I'll connect you with someone from our team"); when agents are unavailable it falls into a support-ticket flow that **locks the chat**. Quality: FAQ 4.3, product-rec 0.

## Meta AI¹ — Dermalogica

- **Site:** `dermalogica.com` · **Agent:** "Dermalogica's Virtual Assistant · AI"
- **Widget:** **Zendesk messaging** (`zE` / `zEmbed`). Transcript in the same-origin **"Messaging window"** iframe, which **re-mounts on each turn** (so DOM polling must re-acquire the frame; latency here is screenshot-approx, ~5s for FAQ).
- **Open:** `window.zE('messenger','open')`.
- **¹Naming:** requested as "Meta AI"; client-side it is Zendesk's Virtual Assistant — the underlying model isn't verifiable from the browser. Labeled as requested with that caveat.
- **Observations:** fast, clear FAQ/policy (returns answer strong). On a product-recommendation question it **🚩 hands off to a human** and opens a lead-capture form (Name/email), which then locks the chat. Quality: returns 5.0, shipping vague 2.0, product-rec 0.

## Ada — Loop Earplugs

- **Site:** `loopearplugs.com` (geo instance `loopearplugs-gr.ada.support`).
- **Widget:** `static.ada.support/embed2.js`; `window.adaEmbed.toggle()`; cross-origin **`ada-chat-frame`** iframe.
- **Status:** **deployed but the bot backend was down on both test days** ("The chat is experiencing technical difficulties…") across EU and US instances. No latency/quality measured — an availability data point in itself. Re-test when it recovers (the runner includes it and will record `null` + error until then).

## Intercom — Fin AI Agent (Avocado Green Mattress, Public.com, Kajabi, Synthesia, Ninety, tado°)

- **Sites (6, signature-verified 2026-07-09):** `avocadogreenmattress.com` (DTC mattress e-commerce),
  `public.com` (consumer investing app), `kajabi.com` (creator platform), `help.synthesia.io` (AI
  video SaaS support), `ninety.io` (B2B EOS software), `tado.com` (smart-home DTC hardware). Each
  confirmed by `widget.intercom.io` / `intercom-lightweight-app` / `api-iam.intercom.io` present in
  the page source (public client-side loader signatures, same verification standard used for
  Decagon).
- **Widget:** **Intercom Messenger** — launcher mounts in `#intercom-container`; the conversation
  renders in a standard cross-origin `iframe[name="intercom-messenger-frame"]`.
- **Fin AI Agent:** Intercom's default AI layer on top of the Messenger on paid plans — not
  independently confirmable from a cold, logged-out page load. Whether Fin actually answers cold
  free-text (vs. gating on identity, or falling straight to a human queue) is **unconfirmed until
  the first capture run** — registered as `candidate: true`, same as Decagon's initial batch.
- **Open / drive:** `window.Intercom('show')` to open; best-effort generic composer/send helpers
  (`genericOpenChat`/`genericSendChat`) until a run shows the live DOM and selectors can be
  tightened, matching the Decagon/Klaviyo/Shopify Inbox scaffold pattern.
- **Status:** scaffolded, not yet captured — will show as "pending" in Coverage until the first
  cold run.

---

### Quick reference — automation hooks

| Vendor | Open | Send | Read transcript |
|---|---|---|---|
| Sierra | `openSierraChat()` | shadow textarea + send button | shadow `ol[aria-label="Chat messages"]` |
| Siena | `SienaLaunchChat()` | iframe input + Enter | `chat.siena.cx` iframe / REST poll |
| Gorgias | `GorgiasChat.open()` | `GorgiasChat.sendMessage(t)` | `chat-window` iframe / WS `fromAgent` |
| Yuma | `GorgiasChat.open()` | `GorgiasChat.sendMessage(t)` | Gorgias WS `fromAgent` |
| DigitalGenius | `dgchat.methods.launchWidget()` (+ prechat form) | iframe input + Enter | `dg-chat-widget-iframe` |
| Meta AI | `zE('messenger','open')` | "Messaging window" iframe input | "Messaging window" iframe (re-mounts) |
| Ada | `adaEmbed.toggle()` | `ada-chat-frame` input | `ada-chat-frame` iframe |
| Intercom | `Intercom('show')` | generic composer + Enter (best-effort) | `intercom-messenger-frame` iframe |
