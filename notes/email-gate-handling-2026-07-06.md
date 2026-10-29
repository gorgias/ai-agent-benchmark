# Pre-chat email gate handling - 2026-07-06

> **Identity policy updated 2026-10-29:** Romain requested fresh synthetic consumer email
> addresses (Gmail, Yahoo, etc.) because merchants identified and blocked `example.*` users.
> The reserved-domain rule below is historical. Current generation and identity lifetime are
> documented in `docs/RUNBOOK.md` → Pre-chat identity gates and `runner/shopper-identity.js`.

## Trigger

`yuma-tumble` / Tumble Living exposed a native Yuma chat iframe, but the cold-session flow asked for
an email address before the chat composer appeared. That is a valid pre-chat gate, not a reason to
mark the widget dead.

## Rule

- Fill chat-start name/email gates so the benchmark can reach the free-text composer.
- Use generated dummy identities on the reserved `example.com` domain only.
- Do not use random Gmail, Outlook, or other real mailbox domains. A plausible-looking real-domain
  address can belong to an actual person and would violate the no-real-PII rule.
- Do not click quick-reply chips while bypassing the gate; the benchmark remains free-text only.

## Implementation

`runner/vendors.js` now centralizes this in `fillEmailGate`:

- generates a fresh dummy identity each time, e.g. `john.minser.<random>@example.com`;
- fills first name, last name, full name, and email fields when visible;
- handles common English and French start/submit buttons;
- is called by the native Yuma handler on open and send, plus the generic open/send path.

## Attribution

Filling the gate only starts the chat session. It is not counted as an assistant answer, does not
change latency timing, and does not make an invalid/no-answer conversation valid unless the widget
produces timed AI replies afterward.
