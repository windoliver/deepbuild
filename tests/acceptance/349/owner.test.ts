// AC6: two test adapters that both see one agent session ID, the second to bind it the one that gates it: the gating
// adapter delivers each answer once and files the session's asks, and the other only relays its events to it; a
// host that lets both deliver sends one answer twice, and one that gives the session to the first adapter to bind
// it delivers through the adapter that doesn't gate it, and each fails this test, naming the session.
//
// `relay` binds the session first (its SessionStart) and maps only what it observes; `gater` binds it second and
// maps its gates (the PreToolUse deep-hook holds). Both can steer, so a delivery is immediate and the test reads
// only who delivered (README, Readings: binding, gating and owning).
import { describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/extension-host/src/index.ts';
import { adapterPackage, answerFor, hooks, RELAY_HOOKS } from './adapting.ts';
import { installAndLoad, loadInHub, openWorld, sessionId, sleep } from './helpers.ts';

/** The scenario and the criterion's assertion, on the real host or a planted twin. */
async function gatesAndRelays(s: string, plant?: Plant): Promise<void> {
  const w = await openWorld();
  const relay = await adapterPackage('relay', { steer: true, holdStop: true }, RELAY_HOOKS);
  const gater = await adapterPackage('gater', { steer: true, holdStop: true });
  const h = await loadInHub(w, relay.dir, { release: [gater.dir], ...(plant ? { plant } : {}) });
  await installAndLoad(h, gater.dir);
  expect((await h.adapters()).map((a) => a.name).sort()).toEqual(['gater', 'relay']);

  await hooks(h, relay.name, s, 'SessionStart');                       // relay binds the session first
  await hooks(h, gater.name, s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');   // gater binds it second, and gates it
  await hooks(h, relay.name, s, 'PostToolUse');                        // relay sees more of the session: it only relays
  const owner = await h.owner(s);
  expect(owner?.adapter, `the adapter that gates session ${s} owns it: ${JSON.stringify(owner)}`).toBe('gater');

  const first = await answerFor(w, s, 'Push feature/login to origin?');
  const second = await answerFor(w, s, 'Push feature/logout to origin?');
  for (const answer of [first, second]) {
    const out = await h.deliverAnswer(answer);
    expect(out, `session ${s}'s answer ${answer.ask} is delivered through the gating adapter: ${JSON.stringify(out)}`).toMatchObject({ status: 'delivered', adapter: 'gater', session: s });
  }
  await sleep(300);
  expect(gater.saw().map((x) => x.answer.ask), `the gating adapter delivers each of session ${s}'s answers once`).toEqual([first.ask, second.ask]);
  expect(relay.saw(), `the relaying adapter delivers nothing of session ${s}`).toEqual([]);
}

describe('AC6 #349.77853dd0 two adapters see one session; the second to bind it gates it and delivers each answer once, the other only relays; a host letting both deliver, or giving the session to the first to bind, fails naming the session', () => {
  it('AC6 the gating adapter, second to bind the session, owns it and delivers each answer once; the first to bind only relays', async () => {
    await gatesAndRelays(sessionId());
  }, 120_000);

  it('AC6 (wrong program) a host that lets both adapters deliver sends one answer twice, and fails this test naming the session', async () => {
    const s = sessionId();
    await expect(gatesAndRelays(s, 'both-adapters-deliver')).rejects.toThrow(s);
  }, 120_000);

  it('AC6 (wrong program) a host that gives the session to the first adapter to bind it delivers through the adapter that doesn\'t gate it, and fails this test naming the session', async () => {
    const s = sessionId();
    await expect(gatesAndRelays(s, 'first-to-bind-owns')).rejects.toThrow(s);
  }, 120_000);
});
