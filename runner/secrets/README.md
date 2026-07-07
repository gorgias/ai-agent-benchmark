# Amazon Rufus (Alexa) benchmark harness

Amazon's on-PDP shopping AI ("Ask Alexa" / Rufus) only appears for a **logged-in**
session — guests see no module (verified headed + headless). So this vendor runs
against a **dedicated dummy Amazon account** with a saved session.

- **Account:** `max.pruvost+amazon@gorgias.com` (disposable benchmark account — creds in `../../.amazon-creds`)
- **Login (one-shot / when session expires):** `node runner/secrets/amazon-login.mjs`
  → writes `amazon-state.json` (session cookies; gitignored, regenerable).
- **Run (must be HEADED):** `HEADED=1 node runner/run.js --store rufus-amazon --mode shopping`
- Widget wiring lives in `vendors.js` (`WIDGETS.rufus`) + roster entry `rufus-amazon`.
- Bare `/dp/<ASIN>` URL only — Amazon's `pd_rd_*` tracking params expire → 404.
- Reported with a **"logged-in session"** disclaimer: other vendors are cold-guest,
  so Rufus is not strictly apples-to-apples. Shopping lane only (Rufus doesn't do support).
