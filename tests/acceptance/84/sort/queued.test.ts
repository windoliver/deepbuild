// #84 AC4: a question raised while your newer message sat in the queue is held, and after the agent reads the message and
// drops the question, nothing reaches you (design: Asks stay current, "An ask raised by a turn that hadn't yet read a
// message you typed waits until the agent has that message, and reaches you only if it still stands").
//
// The message is typed while a Read runs, so it sits in the transcript's queue. The agent, not having read it, raises a
// task with deep_ask and ends its turn on it. Claude Code then takes the message from the queue as the next prompt, and:
//   item 51: the agent reads it, does what it says, and ends without the question. Nothing has reached you at any point.
//   item 52 (the control): the agent reads it and raises the same task again, so the question still stands. It reaches
//     you, so a program that drops every held question fails too.
import { afterAll, describe, it } from 'vitest';
import {
  AC4, EXPIRED, askDraft, cleanup, item, lastPos, listed, makeWorld, must, reachingWith, asksRaised, Session, settle, setUp, sleep, startHub, startOnItem, verdict,
  type Hub, type World,
} from './helpers.ts';

const QUESTION = "Accept the speech model's license on the vendor's site";
const NAMED = 'speech model';
const TASK = {
  kind: 'unblock', question: QUESTION, options: null, recommended: null,
  steps: ["Open the speech model's page on the vendor's site", 'Accept its license', 'Save the acceptance as vendor/license-accepted in the repo'],
  where: 'the vendor site, in your browser', why: 'The voice tests need the speech model', check: 'ready', thread: null, subject: null,
};
const WORDS = `I need the speech model for the voice tests. ${QUESTION}, please.`;
const MESSAGE = 'Use the sandbox model instead, it needs no license.';
const DROPPED = 'Switched the voice tests to the sandbox model.';

/** The session up to its stop on the question, with your message still in the queue; nothing reached you. */
async function raisedUnread(hub: Hub, w: World, n: number): Promise<Session> {
  const who = `${AC4} item ${n}:`;
  const s = new Session(w);
  await startOnItem(hub, s, n, who);
  await s.green();
  await s.read('src/auth.js', { during: () => s.queue(MESSAGE) });
  const since = await lastPos(hub);
  await s.deepAsk(TASK);
  await sleep(3000);
  const shown = async (at: string) => {
    const rows = await reachingWith(hub, NAMED);
    const events = await settle(hub, () => true);
    must(rows.length === 0, `${who} the question raised while "${MESSAGE}" sat in the queue is held, ${at}: it reached you: ${JSON.stringify(rows).slice(0, 600)}; asks ${listed(asksRaised(events, since))}`);
  };
  await shown('after deep_ask');
  await s.stop(WORDS);
  await sleep(2000);
  await shown('after the stop that ends on it');
  return s;
}

afterAll(cleanup, 60_000);

describe(`${AC4} a question raised while your newer message sat in the queue is held, and after the agent reads the message and drops the question, nothing reaches you`, () => {
  it(`${AC4} item 51: held while the message is queued; the agent reads it and ends without the question, and nothing reaches you. Item 52: read, and the question raised again, it reaches you`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(51, 'Expired tokens are accepted', [EXPIRED]), item(52, 'Expired tokens are accepted', [EXPIRED])], drafts: [askDraft(MESSAGE)] });
    const hub = await startHub(w);
    await setUp(w);

    const dropped = await raisedUnread(hub, w, 51);
    await dropped.takes(MESSAGE);
    await dropped.bump();
    await dropped.stop(DROPPED);
    await sleep(5000);
    const rows = await reachingWith(hub, NAMED);
    must(rows.length === 0, `${AC4} item 51: the agent read "${MESSAGE}" and dropped the question, so nothing reaches you: ${JSON.stringify(rows).slice(0, 600)}`);

    const stands = await raisedUnread(hub, w, 52);
    await stands.takes(MESSAGE);
    await stands.bump();
    await stands.deepAsk(TASK);
    await stands.stop(WORDS);
    const deadline = Date.now() + 30_000;
    while (!(await reachingWith(hub, NAMED)).length && Date.now() < deadline) await sleep(500);
    must((await reachingWith(hub, NAMED)).length > 0, `${AC4} item 52 (the control): the agent read "${MESSAGE}" and raised the question again, so it still stands and reaches you: nothing did within 30 s`);
  }), 900_000);
});
