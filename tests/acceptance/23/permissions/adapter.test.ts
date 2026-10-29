// #23.02482c32 at the adapter (README, Criteria): the Claude Code adapter's permission reply, from the shipped
// registry, for an answer whose decision is cancel: never a deny, never an allow. Its allow and deny stay what they
// are, so an adapter that answers nothing fails too, and an allow never carries a lasting rule.
import { test } from 'vitest';
import { CANCEL } from './helpers.ts';
import { claudeReply } from './plants.ts';
import { cancelGetsCancel } from './scenarios.ts';

test(`${CANCEL} the Claude Code adapter answers a cancelled ask's prompt with cancel: no decision, never deny`, () => {
  cancelGetsCancel(claudeReply());
});
