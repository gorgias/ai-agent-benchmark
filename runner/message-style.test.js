import test from "node:test";
import assert from "node:assert/strict";
import { SHOPPING_THEMES, SUPPORT_THEMES } from "./pools.js";
import { hasStyledDash, normalizeUserMessage } from "./message-style.js";

test("normalizeUserMessage removes styled dashes from user turns", () => {
  assert.equal(
    normalizeUserMessage("Hi \u2014 can you help me choose?"),
    "Hi, can you help me choose?",
  );
  assert.equal(
    normalizeUserMessage("A\u2013B warranty question"),
    "A-B warranty question",
  );
  assert.equal(hasStyledDash(normalizeUserMessage("Need help \u2014 quickly")), false);
});

test("standardized customer message pools do not contain styled dashes", () => {
  const messages = [...SHOPPING_THEMES, ...SUPPORT_THEMES].flatMap((theme) => theme.turns || []);
  const offenders = messages.filter(hasStyledDash);
  assert.deepEqual(offenders, []);
});
