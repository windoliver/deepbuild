// #84 AC25: a question at a stop that names no option, no requirement and no screen in the turn's evidence goes back to
// the agent once asking for `deep_ask`, and nothing keyed from its words reaches you (design: Questions at the stop,
// "goes back to the agent once, asking it to raise the question through deep_ask").
//
// Item 41: green, so the question is all that keeps the stop going. The turn touched only src/auth.js; nothing in it
// names a colour. Stop 1 asks for deep_ask. The agent ends on the same words again: stop 2 isn't asked again. Nothing
// reaches you at either. A sorter that keys an ask from the question's text fails, naming the question.
import { afterAll, describe, it } from 'vitest';
import {
  AC25, EXPIRED, asksNaming, cleanup, failureOf, item, lastPos, listed, makeWorld, must, reachingWith, replyText, Session, settle, shown, sleep, startHub,
  startOnItem, verdict,
} from './helpers.ts';

const QUESTION = 'Should it be blue?';

async function scenario(n: number, plant?: string): Promise<void> {
  const w = makeWorld({ items: [item(n, 'Expired tokens are accepted', [EXPIRED])] });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await startOnItem(hub, s, n, AC25);
  await s.green();
  const since = await lastPos(hub);
  const first = await s.stop(QUESTION);
  await sleep(3000);
  let events = await settle(hub, () => true);
  must(asksNaming(events, since, 'blue').length === 0, `${AC25} nothing keyed from the words of "${QUESTION}" raises an ask: ${listed(asksNaming(events, since, 'blue'))}`);
  must((await reachingWith(hub, 'blue')).length === 0, `${AC25} nothing keyed from the words of "${QUESTION}" reaches you: ${JSON.stringify(await reachingWith(hub, 'blue')).slice(0, 500)}`);
  must(replyText(first).includes('deep_ask'), `${AC25} the stop ending "${QUESTION}" goes back asking for deep_ask: ${shown(first)}`);
  const second = await s.stop(QUESTION);
  await sleep(3000);
  events = await settle(hub, () => true);
  must(!replyText(second).includes('deep_ask'), `${AC25} "${QUESTION}" goes back once: the second stop on it was asked for deep_ask again: ${shown(second)}`);
  must(asksNaming(events, since, 'blue').length === 0 && (await reachingWith(hub, 'blue')).length === 0, `${AC25} after the second stop on "${QUESTION}" nothing reaches you either: ${listed(asksNaming(events, since, 'blue'))}`);
}

afterAll(cleanup, 60_000);

describe(`${AC25} a question that names no option, no requirement and no screen goes back once asking for deep_ask, and nothing keyed from its words reaches you`, () => {
  it(`${AC25} item 41: "${QUESTION}" goes back once asking for deep_ask; the second stop on it isn't asked again, and no ask is raised`, async (ctx) => verdict(ctx, () => scenario(41)), 600_000);

  it(`${AC25} (wrong program) a sorter that keys an ask from the question's text (DEEP_HUB_PLANT=keys-ask-from-words) fails this test, naming the question`, async (ctx) => verdict(ctx, async () => {
    const why = await failureOf(() => scenario(42, 'keys-ask-from-words'));
    must(why !== null, `${AC25} the planted sorter keys-ask-from-words must fail this test; it passed`);
    must(why.includes(QUESTION) && /raises an ask|reaches you/.test(why), `${AC25} the planted sorter fails on the ask it raised, naming "${QUESTION}": ${why}`);
  }), 600_000);
});
