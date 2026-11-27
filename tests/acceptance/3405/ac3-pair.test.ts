// AC3: two scripted Claude Code sessions in the terminal, each with an inbox its hooks were told of, keep each other
// going: A's turns start from B's messages 21 times in 10 minutes (B's from A's 19 times), with no prompt from you.
// Both are held at their next such prompt, A at its 21st and B at its 20th, which B's own count would let through, so
// only the pair's hold holds it; one ask names both, and your "go on" lets both go. A hub that holds the receiver alone
// starts B's turn and fails, naming the sender's next turn.
import { afterAll, describe, it } from 'vitest';
import {
  AC3, ClaudeSession, PLANT, allEvents, answer, asksAfter, askText, cleanup, decision, goOnOption, heldMust, lastPos, listed, makeWorld,
  must, names, needRecordings, said, settle, shown, startHub, trust, worktree, type Ran,
} from './helpers.ts';

afterAll(cleanup, 60_000);

type Inboxed = Awaited<ReturnType<typeof ClaudeSession.withInbox>>;
/** One message from `from` to `to`: a turn of `to`'s started by it, then its stop when it went through. */
async function message(to: Inboxed, from: Inboxed, text: string): Promise<Ran> {
  const r = await to.message(from.peer, text);
  if (decision(r) === 'allow') await to.stop('Replied.');
  return r;
}

async function pair(plant?: string): Promise<void> {
  const w = makeWorld();
  const wa = worktree(w, 'wa', 'a/talk');
  const wb = worktree(w, 'wb', 'b/talk');
  await trust(w, [wa, wb]);
  const hub = await startHub(w, plant);
  const a = await ClaudeSession.withInbox(w, wa, 'wa');
  const b = await ClaudeSession.withInbox(w, wb, 'wb');
  await a.start();
  await b.start();
  await a.typed('Talk to the other session about the cart until it is done.');
  await a.stop('Asked it.');
  await b.typed('Answer the other session about the cart.');
  await b.stop('Ready.');
  const since = await lastPos(hub);
  const t0 = Date.now();
  for (let k = 1; k <= 20; k++) {
    const r = await message(a, b, `Cart question ${k}: does the total round each line?`);
    must(decision(r) === 'allow', `BLOCKED: ${AC3} session ${a.id}'s turn ${k} from ${b.id}'s message is within the limit and must go through: ${shown(r)}`);
    if (k > 19) continue;
    const back = await message(b, a, `Cart answer ${k}: yes, to cents.`);
    must(decision(back) === 'allow', `BLOCKED: ${AC3} session ${b.id}'s turn ${k} from ${a.id}'s message is within the limit and must go through: ${shown(back)}`);
  }
  const a21 = await message(a, b, 'Cart question 21: and the tax?');
  const b20 = await message(b, a, 'Cart answer 20: tax is separate.');
  const took = Date.now() - t0;
  must(took < 600_000, `INCONCLUSIVE: ${AC3} the turns took ${Math.round(took / 1000)} s, past the 10 minutes the rule counts in`);
  heldMust(a21, `${AC3} session ${a.id}'s 21st turn in 10 minutes from ${b.id}'s messages, with no prompt from you, must be held at its submit`);
  heldMust(b20, `${AC3} the sender ${b.id}'s next turn (its 20th from ${a.id}'s messages, within its own count) must be held too, since the pair keeps each other going; it went through`);

  const events = await settle(hub, (e) => asksAfter(e, since).some((x) => names(askText(x), a.id) && names(askText(x), b.id)), 15_000);
  const asks = asksAfter(events, since).filter((x) => names(askText(x), a.id) || names(askText(x), b.id));
  must(asks.length === 1, `${AC3} the pair must raise exactly one ask: ${asks.length} were raised: ${listed(asks)}`);
  must(names(askText(asks[0]!), a.id) && names(askText(asks[0]!), b.id), `${AC3} the ask must name both sessions, ${a.id} and ${b.id}: ${said(asks[0])}`);
  const option = goOnOption(asks[0]!);
  must(option !== undefined, `${AC3} the ask must offer to let them go on: ${said(asks[0])}`);
  const answered = await answer(w, asks[0]!, option);
  must(answered.code === 0, `BLOCKED: ${AC3} your "go on" (deep inbox answer ask:${asks[0]!.id} ${option}) must be taken: ${shown(answered)}`);

  const a22 = await message(a, b, 'Cart question 22: and the shipping?');
  must(decision(a22) === 'allow', `${AC3} after your "go on", session ${a.id}'s next turn from ${b.id}'s message must go: ${shown(a22)}`);
  const b21 = await message(b, a, 'Cart answer 21: shipping is flat.');
  must(decision(b21) === 'allow', `${AC3} after your "go on", the sender ${b.id}'s next turn from ${a.id}'s message must go: ${shown(b21)}`);
  const after = asksAfter(await allEvents(hub), since).filter((x) => names(askText(x), a.id) || names(askText(x), b.id));
  must(after.length === 1, `${AC3} letting them go on raises no second ask: ${listed(after)}`);
}

describe(`${AC3} two sessions that keep each other going are both held at their next such prompt, and your "go on" lets both go`, () => {
  it(`${AC3} A's 21st turn from B's messages and B's next turn from A's are both held, with one ask naming both; your "go on" lets both go`, async (ctx) => {
    if (!needRecordings(ctx)) return;
    await pair();
  }, 900_000);

  it(`${AC3} the planted hub that holds the receiver alone (${PLANT.receiverAlone}) fails this test, naming the sender's next turn`, async (ctx) => {
    if (!needRecordings(ctx)) return;
    const failure = await pair(PLANT.receiverAlone).then(() => undefined, (e: Error) => e);
    must(failure !== undefined, `${AC3} the planted hub ${PLANT.receiverAlone} must fail this test; it passed`);
    must(/the sender \S+'s next turn/.test(failure.message) && !/^(BLOCKED|INCONCLUSIVE)/.test(failure.message), `${AC3} the planted hub ${PLANT.receiverAlone} must fail naming the sender's next turn; it failed with: ${failure.message}`);
  }, 900_000);
});
