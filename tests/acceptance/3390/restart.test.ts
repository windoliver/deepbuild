// AC7: the same call with the same request ID never asks twice, a hub restart between your answer and the retry included.
//
// The hub is stopped (SIGTERM) and started again on the same home; the agent, its session and its MCP servers run on.
import { describe, expect, it } from 'vitest';
import {
  answer, answerAndSave, brief, call, entered, events, hold, named, openAsksOf, openWorld, pkg, raised, restartHub, runs, SEND, SET_ALERT, TEST_MS, type Call, type World,
} from './world.ts';

/** The call made again after a restart: its reply, which must be its result, never held, declined, refused or failed. */
async function again(w: World, c: Call, when: string): Promise<void> {
  const { a } = w;
  const before = raised(await events(w), a);
  const o = await call(w, a, c);
  const all = await events(w);
  const asked = raised(all, a).filter((ask) => !before.includes(ask));
  expect({ isError: o.isError, status: o.value?.status }, `${named(c)}, ${when}, returns its result; it raised ${brief(asked)} and answered ${brief(o.reply)}`).toEqual({ isError: false, status: 'done' });
  expect(entered(all, c), `the input of ${named(c)} entered once, and only once, ${when}`).toEqual([c.input]);
  expect(await openAsksOf(w, a), `${named(c)}, ${when}, leaves no open ask`).toEqual([]);
}

describe('AC7 #3390.c9e68b9b Your yes, then a hub restart, then the same request called again: a change runs once, with no open ask left, and a send runs once on that yes with no second ask.created; the same request called once more after a second restart returns a result, runs nothing again and leaves no open ask', () => {
  it('AC7 a change you said yes to runs once after a hub restart, and after a second restart returns its result and runs nothing again', async () => {
    const w = await openWorld([await pkg('stocks')]);
    const { a } = w;
    const change = await hold(w, a, SET_ALERT, { symbol: 'NVDA', above: 200 });
    await answerAndSave(w, change, 'approve');
    expect(entered(await events(w), change), `${named(change)} enters nothing before its retry`).toEqual([]);

    await restartHub(w);
    await again(w, change, 'called again after a hub restart on your yes');
    expect(await runs(w, a), 'the handler ran once in this load').toEqual({ set_alert: 1, send_digest: 0 });

    await restartHub(w);
    await again(w, change, 'called once more after a second hub restart');
    expect(await runs(w, a), 'the handler ran nothing again in this load').toEqual({ set_alert: 0, send_digest: 0 });
  }, TEST_MS);

  it('AC7 a send you said yes to runs once on that yes after a hub restart, with no second ask, and after a second restart returns its result and runs nothing again', async () => {
    const w = await openWorld([await pkg('stocks')]);
    const { a } = w;
    const send = await hold(w, a, SEND, { to: 'a@example.invalid' });
    await answer(w, send.ask, 'approve');
    expect(entered(await events(w), send), `${named(send)} enters nothing before its retry`).toEqual([]);

    const asksOnce = async (when: string): Promise<void> => expect(raised(await events(w), a), `${named(send)}, the only call of the session that asks, asks once: no second ask.created ${when}`).toEqual([send.ask]);
    await restartHub(w);
    const first = await call(w, a, send);
    await asksOnce(`when called again after a hub restart on your yes, which answered ${brief(first.reply)}`);
    await again(w, send, 'called again after a hub restart on your yes');
    expect(await runs(w, a), 'the send ran once in this load').toEqual({ set_alert: 0, send_digest: 1 });

    await restartHub(w);
    await again(w, send, 'called once more after a second hub restart');
    await asksOnce('when called once more after a second hub restart');
    expect(await runs(w, a), 'the send ran nothing again in this load').toEqual({ set_alert: 0, send_digest: 0 });
  }, TEST_MS);
});
