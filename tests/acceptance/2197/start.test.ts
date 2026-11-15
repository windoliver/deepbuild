// #2197.b904fcd1 It names the checks. Given a session in a repo whose spec names the checks unit and e2e, when the
//   session calls `deep_status`, then the reply lists both names. Today the reply has no such field.
// #2197.c8fb2936 It names the session's open asks. Given a session with one open taste ask, when it calls
//   `deep_status`, then the reply holds that ask's handle, its state, its default and when it takes it. Today the
//   reply has no such field.
// #2197.b02b3f39 It names the session's open items. Given a session that recorded an open item, when it calls
//   `deep_status`, then the reply holds the item's text. Today the reply has no such field.
// Each test is one agent stand-in whose session the hub knows from its hooks, calling its own `deep mcp` against a
// live hub, in a repo whose spec names unit and e2e. On the merge base each fails at its assertion: the reply is
// `{session, gates, claims}` and holds none of these.

import { afterEach, expect, test } from 'vitest';
import { cleanup, word } from '../26/helpers.ts';
import { askProblems, CHECKS, holdsText, notListed, oneSession, openItem, shown, status } from './helpers.ts';

afterEach(cleanup, 30_000);

test('#2197.b904fcd1 in a repo whose spec names the checks unit and e2e, a new session\'s deep_status lists both names', async () => {
  const w = await oneSession();
  const reply = await status(w.agent);
  expect(reply.session, `deep_status answers for the agent's own session: ${shown(reply)}`).toBe(w.session.id);
  expect(notListed(reply, CHECKS), `deep_status lists the checks the repo's spec names, unit and e2e (today the reply has no such field): ${shown(reply)}`).toEqual([]);
}, 120_000);

test('#2197.c8fb2936 a session with one open taste ask: its deep_status holds the ask\'s handle, its state, its default and when it takes it', async () => {
  const w = await oneSession({ ask: 'Which accent for the login header?' });
  const reply = await status(w.agent);
  expect(reply.session, `deep_status answers for the agent's own session: ${shown(reply)}`).toBe(w.session.id);
  expect(askProblems(reply, w.ask!), `deep_status holds the session's open taste ask: its handle, its state, its default and when it takes it (today the reply has no such field): ${shown(reply)}`).toEqual([]);
}, 120_000);

test('#2197.b02b3f39 a session that recorded an open item: its deep_status holds the item\'s text', async () => {
  const w = await oneSession();
  const text = `The empty cart page still needs its copy checked, batch ${word()}`;
  await openItem(w.hub, w, text);
  const reply = await status(w.agent);
  expect(reply.session, `deep_status answers for the agent's own session: ${shown(reply)}`).toBe(w.session.id);
  expect(holdsText(reply, text), `deep_status holds the text of the open item the session recorded, "${text}" (today the reply has no such field): ${shown(reply)}`).toBe(true);
}, 120_000);
