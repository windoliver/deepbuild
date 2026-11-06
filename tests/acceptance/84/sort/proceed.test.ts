// #84 AC1 and AC23: an in-scope question at a stop goes back to the agent with "proceed", is recorded with the question
// and the rule that sorted it as `question.proceeded`, and never reaches you (design: Questions at the stop).
//
// Item 11: the agent makes R1 and the unit test pass and ends on the issue's question. The reply sends it on with
// "proceed", so a program that does nothing with the question fails too, not only one that files an ask.
import { afterAll, describe, it } from 'vitest';
import {
  AC1, AC23, EXPIRED, asksNaming, blocked, cleanup, failureOf, item, lastPos, listed, makeWorld, must, proceededIn, reachingWith, saysProceed,
  Session, settle, shown, sleep, startHub, startOnItem, verdict, type Ev, type Line, type Ran,
} from './helpers.ts';

const QUESTION = 'want me to run the tests?';
const WORDS = `checkToken rejects expired tokens now. ${QUESTION}`;
/** The words a question is found by in the record and the inbox. */
const NAMED = 'run the tests';

interface Sorted { stop: Ran; events: Ev[]; proceeds: Ev[]; rows: Line[]; asks: Ev[] }
async function sorted(who: string, plant?: string): Promise<Sorted> {
  const w = makeWorld({ items: [item(11, 'Expired tokens are accepted', [EXPIRED])] });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await startOnItem(hub, s, 11, who);
  await s.green();
  const since = await lastPos(hub);
  const stop = await s.stop(WORDS);
  const events = await settle(hub, (all) => proceededIn(all, s, since).length > 0, 10_000);
  await sleep(3000);
  return { stop, events, proceeds: proceededIn(events, s, since), rows: await reachingWith(hub, NAMED), asks: asksNaming(events, since, NAMED) };
}
let setup: Promise<Sorted> | undefined;
const once = (): Promise<Sorted> => (setup ??= sorted(AC1));
afterAll(cleanup, 60_000);

function reachedNobody(r: Sorted, who: string): void {
  must(r.asks.length === 0, `${who} "${QUESTION}" raises no ask: ${listed(r.asks)}`);
  must(r.rows.length === 0, `${who} "${QUESTION}" never reaches Needs you: ${JSON.stringify(r.rows).slice(0, 600)}`);
}
function sentOn(r: Sorted, who: string): void {
  must(blocked(r.stop) && saysProceed(r.stop), `${who} the stop ending "${QUESTION}" goes back to the agent with "proceed": ${shown(r.stop)}`);
}
/** AC23's reading: the record names the question and the rule. */
function recorded(r: Sorted, who: string): void {
  const p = r.proceeds.find((e) => String(e.data.question).toLowerCase().includes(NAMED));
  must(p !== undefined, `${who} a sorter that answers "${QUESTION}" with "proceed" leaves a question.proceeded naming it: the record holds ${listed(r.proceeds)}`);
  const rule = String(p!.data.rule ?? '');
  must(rule.length > 0 && !rule.toLowerCase().includes(NAMED), `${who} the record names the rule that sorted "${QUESTION}", not its words: ${JSON.stringify(p!.data)}`);
}

describe(`${AC1} an in-scope "want me to run the tests?" never reaches you`, () => {
  it(`${AC1} item 11: the stop goes back with "proceed", no ask is raised and nothing shows in Needs you`, async (ctx) => verdict(ctx, async () => {
    const r = await once();
    sentOn(r, AC1);
    reachedNobody(r, AC1);
  }), 600_000);
});

describe(`${AC23} an in-scope question answered "proceed" leaves a record naming the question and the sorting rule, and nothing reaches Needs you`, () => {
  it(`${AC23} item 11: a question.proceeded holds "${QUESTION}" and its rule, and nothing reaches Needs you`, async (ctx) => verdict(ctx, async () => {
    const r = await once();
    sentOn(r, AC23);
    recorded(r, AC23);
    reachedNobody(r, AC23);
  }), 600_000);

  it(`${AC23} (wrong program) a sorter that answers without the record (DEEP_HUB_PLANT=proceed-unrecorded) fails this test, naming the question`, async (ctx) => verdict(ctx, async () => {
    const why = await failureOf(async () => {
      const r = await sorted(AC23, 'proceed-unrecorded');
      sentOn(r, AC23);
      recorded(r, AC23);
    });
    must(why !== null, `${AC23} the planted sorter proceed-unrecorded must fail this test; it passed`);
    must(why.includes('leaves a question.proceeded') && why.includes(QUESTION), `${AC23} the planted sorter fails on the missing record, naming "${QUESTION}": ${why}`);
  }), 600_000);
});
