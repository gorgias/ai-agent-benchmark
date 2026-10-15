# Fashion Nova in-house agent ("Nova AI") — CUSTOM benchmark row (never published)

Added 2026-10-15 at Max's request. Fashion Nova moved 100% of its help-center traffic to its own
flows + AI agent on 2026-10-13 (Slack #C029SDSV9S7, churn-risk thread). There is no chat vendor to
rank, so the store is a **custom** row: captured and judged like any store, never published.

## What `custom: true` does

| Surface | Custom row |
|---|---|
| `run.js` | captured only when named: `--store fashionnova-inhouse` (or `--vendor`) |
| `daily-plan.js`, `tools/balance.mjs` | never scheduled (the nightly capture box has no signed-in session) |
| `eval-pack.js` / judge / `eval-merge.js` | judged like everything else (blind) |
| `gen.js` → report.html, takeaways.html, conv-text.json, board.json, MCP | skipped |
| `scoreboard-preview.js --custom` | ranked next to the field, in a table marked "NOT published" |

`deploy-artifacts.test.js` fails if a custom key or vendor label ever appears in a deployed artifact.

## How their agent is reached

- URL: `https://www.fashionnova.com/pages/help-center-v5/flow?topic=help_with_my_order`
- The agent answers **signed-in customers only**. Signed out, the flow ends on "Connecting you now"
  and nothing arrives (the hang colleagues reported on 2026-10-13 is this, not an outage).
- Route (navigation buttons, the equivalent of opening a launcher; every timed turn is typed):
  "Yes, I still need help" → "Chat with an AI Customer Service agent about this topic" →
  "briefly describe your issue" box (= turn 1) → chat composer (turns 2+). Enter does not send.
- The test account has no orders, so the flow opens with "I couldn't find any orders on this account".
- Replies arrive whole as JSON from `POST /api/chat-agent/send` (`transport: "net"`).
- The flow's hand-off step posts `inputs: {"agent": "giga", ...}`: the agent may run on Giga
  (gigaml.com) behind Fashion Nova's own UI. Inferred from that one field, not confirmed.

## Test account

Sign-in is a one-time code by email. The code goes to a throwaway mail.tm inbox read through its
public API, so no real mailbox is involved (AGENTS.md rule 5). Files (gitignored):
`runner/secrets/fashionnova-account.json` (inbox + password), `runner/secrets/fashionnova-state.json`
(signed-in browser session).

```bash
cd runner
node tools/fashionnova-account.mjs create    # new inbox + account + session (first time on a machine)
node tools/fashionnova-account.mjs status    # is the saved session still signed in?
node tools/fashionnova-account.mjs refresh   # sign in again
RUN_DATE=$(date +%F) node run.js --store fashionnova-inhouse --mode support --concurrency 2
node scoreboard-preview.js --custom        # compare with the field (local only)
```

The driver also signs in by itself when the saved session has expired. Fashion Nova appears to
throttle codes: two codes arrived within two minutes on 2026-10-15, then repeated requests in the
next half hour sent none. If `refresh` reports "no sign-in code", wait and retry, or run `create`
after deleting the account file.

`BENCHMARK_BROWSER_PROXY=http://host:port` routes the browser through a proxy (cloud sandboxes).

## Not covered yet

The Gorgias side of Kristyn's ask (Fashion Nova's Gorgias help center in preview mode,
`fashionnova-nyxrps4z2n0.gorgias.help/en-US?gs_aao_preview_mode=true`) is not a row yet.
