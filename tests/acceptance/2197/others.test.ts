// #2197.def48d2c Nothing of another session. Given two sessions with an ask each, when one calls `deep_status`, then
//   the other's ask is not in the reply. A planted status that lists every session's asks fails.
// Two agent stand-ins work in one worktree of one repo, each with its own session, hooks and `deep mcp`, and each
// session has one open taste ask. Neither reply may hold the other's ask in any form: its handle, its bare ID or its
// question. Each reply must hold its own ask's handle, or the test would pass on a status that lists no ask at all,
// as the merge base's does. The wrong program is the plant `status-lists-every-ask` (README: Wrong programs): under
// it the same reading names the other session's ask.
// The Scope's "nothing of another session is listed" reaches further than the criterion's asks; the last test holds
// it for open items and for the other session's ID, and is tagged with no criterion.

import { afterEach, expect, test } from 'vitest';
import { cleanup, word } from '../26/helpers.ts';
import { entriesOf, formsOf, held, holdsText, idForms, openItem, shown, status, twoSessions, type Two } from './helpers.ts';

afterEach(cleanup, 30_000);

const PLANT = 'status-lists-every-ask';

test('#2197.def48d2c two sessions with an ask each: neither session\'s deep_status holds the other\'s ask, and each holds its own', async () => {
  const { a, b } = await twoSessions();
  for (const [mine, other] of [[a, b], [b, a]] as const) {
    const reply = await status(mine.agent);
    expect(reply.session, `deep_status answers for the calling session ${mine.session.id}: ${shown(reply)}`).toBe(mine.session.id);
    expect(held(reply, formsOf(other.ask)), `session ${mine.session.id}'s deep_status holds nothing of session ${other.session.id}'s ask ${other.ask.handle} ("${other.ask.question}"): ${shown(reply)}`).toEqual([]);
    expect(entriesOf(reply, mine.ask.handle).length, `session ${mine.session.id}'s deep_status holds its own open ask ${mine.ask.handle}; a status that lists no ask can't show it lists only its own: ${shown(reply)}`).toBeGreaterThan(0);
  }
}, 120_000);

test('#2197.def48d2c (wrong program) a planted status that lists every session\'s asks fails, naming the other session\'s ask', async () => {
  let two: Two | undefined;
  let why = '';
  try {
    two = await twoSessions(PLANT);
  } catch (error) {
    why = String(error);
  }
  expect(two, `the hub must start with DEEP_HUB_PLANT=${PLANT} (README: Wrong programs): ${why}`).toBeDefined();
  const { a, b } = two!;
  const reply = await status(a.agent);
  expect(held(reply, formsOf(b.ask)), `under ${PLANT}, session ${a.session.id}'s deep_status holds session ${b.session.id}'s ask, so the test above fails on it, naming ${b.ask.handle}: ${shown(reply)}`).toContain(b.ask.handle);
}, 120_000);

test('#2197.scope nothing of another session is listed: a session\'s deep_status holds its own open item, and neither the other session\'s open item nor its ID', async () => {
  const { hub, a, b } = await twoSessions();
  const tag = word();
  const items = new Map([[a, `The receipt email still has no plain-text part, batch ${tag}a`], [b, `The search page still has no empty state, batch ${tag}b`]]);
  for (const [party, text] of items) await openItem(hub, party, text);
  for (const [mine, other] of [[a, b], [b, a]] as const) {
    const reply = await status(mine.agent);
    expect(reply.session, `deep_status answers for the calling session ${mine.session.id}: ${shown(reply)}`).toBe(mine.session.id);
    expect(held(reply, [items.get(other)!, ...idForms(other.session.id)]), `session ${mine.session.id}'s deep_status holds neither session ${other.session.id}'s open item nor its ID: ${shown(reply)}`).toEqual([]);
    expect(holdsText(reply, items.get(mine)!), `session ${mine.session.id}'s deep_status holds its own open item, "${items.get(mine)!}"; a status that lists no item can't show it lists only its own: ${shown(reply)}`).toBe(true);
  }
}, 120_000);
