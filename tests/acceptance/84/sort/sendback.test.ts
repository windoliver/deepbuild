// #84 AC27: an authority ask and a provisional choice don't hold the send-back (design: A question holds the send-back,
// "An authority ask doesn't hold it, since the call it names stays held until you answer ... nor does a provisional taste
// call or choice, whose recommended option goes back in the same reply as the send-back").
//
// Each session makes FIX, so the unit check passes and R1's check fails.
//   item 81: the stop ends "Want me to open the PR?": it is sent back naming R1, and in the turn that follows the agent's
//     `gh pr create` is held, with an authority ask, until you answer; your yes lets the same call run.
//   item 82: the turn raises a choice with deep_ask, with a recommended option, and the stop ends on it: one reply
//     carries the recommended option and the send-back naming R1.
// A gate that holds the send-back for every ask leaves both stops idle and fails, naming the stop.
import { afterAll, describe, it } from 'vitest';
import {
  AC27, CRITERIA, EXPIRED, FIX, answered, asksRaised, blocked, cleanup, decision, failureOf, inbox, item, lastPos, listed, makeWorld, must, names, raisedAsk, replyText,
  sendBacksIn, Session, settle, setUp, shown, startHub, startOnItem, stopsOf, verdict, type Ev, type Hub, type Line, type World,
} from './helpers.ts';

const OFFER = 'Want me to open the PR?';
/** The body says Part of and lists what's left, so #322's rule on PR bodies has nothing to refuse: only the authority default can hold it. */
const PR = `gh pr create --base main --title "Reject expired tokens" --body "Part of #81. Left: R1, ${CRITERIA.expired}"`;
const QUESTION = 'Which status should a rejected token get?';
const RECOMMENDED = { id: 'status-401', label: 'Answer 401 Unauthorized' };
const CHOICE = { kind: 'choice', question: QUESTION, options: [RECOMMENDED, { id: 'status-403', label: 'Answer 403 Forbidden' }], recommended: RECOMMENDED.id, steps: null, where: null, why: null, check: null, thread: null, subject: { point: 'req:R1', screen: null, element: null } };

/** Sent back at this stop, or the failure naming it: a reply that blocks, naming R1, with its claim.sent_back. */
async function sentBack(hub: Hub, s: Session, since: number, reply: Awaited<ReturnType<Session['stop']>>, what: string): Promise<void> {
  const events = await settle(hub, (all) => sendBacksIn(all, since).length > 0, 10_000);
  const id = stopsOf(events, s).find((e) => e.log_pos > since)?.id ?? 'unrecorded';
  must(blocked(reply), `${AC27} the stop ending ${what} (agent.stop ${id}), with R1's check failing, is still sent back: it was left idle: ${shown(reply)}`);
  must(names(replyText(reply), 'R1', CRITERIA.expired), `${AC27} the send-back at ${what} (agent.stop ${id}) names R1: ${replyText(reply).slice(0, 500)}`);
  must(sendBacksIn(events, since).length > 0, `${AC27} the stop ending ${what} (agent.stop ${id}) is recorded as sent back: no claim.sent_back`);
}

async function prOffer(hub: Hub, w: World): Promise<void> {
  const s = new Session(w);
  await startOnItem(hub, s, 81, AC27);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const since = await lastPos(hub);
  await sentBack(hub, s, since, await s.stop(`The unit test passes. ${OFFER}`), `"${OFFER}"`);

  const held = await s.bash(PR);
  must(decision(held.before) === 'deny', `${AC27} the PR call is held until you answer: \`${PR}\` went through: ${shown(held.before)}`);
  const events = await settle(hub, (all) => asksRaised(all, since).some((e) => e.data.kind === 'authority'), 15_000);
  const asks: Ev[] = asksRaised(events, since).filter((e) => e.data.kind === 'authority');
  must(asks.length > 0, `${AC27} the held PR call has an authority ask for you to answer: ${listed(asksRaised(events, since))}`);
  must((await inbox(hub)).some((r: Line) => asks.some((a) => r.ask === `ask:${a.id}`) && r.status !== 'closed'), `${AC27} that authority ask waits in Needs you: ${JSON.stringify(await inbox(hub)).slice(0, 600)}`);
  for (const ask of asks) {
    const yes = (ask.data.options as Line[]).find((o) => o.decision === 'allow');
    must(yes !== undefined, `BLOCKED: ${AC27} ask:${ask.id} offers a yes: ${JSON.stringify(ask.data.options)}`);
    await answered(w, `ask:${ask.id}`, String(yes!.id), AC27);
  }
  const ran = await s.bash(PR, () => ({ stdout: 'https://github.com/acme/shop/pull/81\n', stderr: '', interrupted: false, isImage: false }));
  must(ran.allowed, `${AC27} once you say yes the same PR call runs: ${shown(ran.before)}`);
}

async function provisional(hub: Hub, w: World): Promise<void> {
  const s = new Session(w);
  await startOnItem(hub, s, 82, AC27);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.bump();
  const raised = await lastPos(hub);
  await s.deepAsk(CHOICE);
  const ask = await raisedAsk(hub, QUESTION, raised, AC27);
  must(ask.data.provisional === true, `${AC27} a choice with a recommended option is provisional: ${JSON.stringify(ask.data).slice(0, 500)}`);
  const since = await lastPos(hub);
  const stop = await s.stop(`${QUESTION} I recommend ${RECOMMENDED.label}.`);
  await sentBack(hub, s, since, stop, 'the provisional choice');
  const reply = replyText(stop);
  must(reply.includes(RECOMMENDED.id) || reply.includes(RECOMMENDED.label), `${AC27} one reply carries the recommended option, ${RECOMMENDED.label}, with the send-back: ${reply.slice(0, 600)}`);
}

afterAll(cleanup, 60_000);

const world = () => makeWorld({ items: [81, 82].map((n) => item(n, 'Expired tokens are accepted', [EXPIRED])) });
/** The hub, with setup run so deep_ask returns at once. */
const hubOf = async (w: World, plant?: string): Promise<Hub> => { const hub = await startHub(w, { plant }); await setUp(w); return hub; };

describe(`${AC27} an authority ask and a provisional choice don't hold the send-back`, () => {
  it(`${AC27} item 81: the stop ending "${OFFER}" with a check failing is sent back, and the PR call is held until you answer`, async (ctx) => verdict(ctx, async () => {
    const w = world();
    await prOffer(await hubOf(w), w);
  }), 600_000);

  it(`${AC27} item 82: the stop ending on a provisional choice with a check failing gets one reply carrying the recommended option and the send-back`, async (ctx) => verdict(ctx, async () => {
    const w = world();
    await provisional(await hubOf(w), w);
  }), 600_000);

  it(`${AC27} (wrong program) a gate that holds the send-back for every ask (DEEP_HUB_PLANT=holds-every-ask) leaves both stops idle and fails this test, naming the stop`, async (ctx) => verdict(ctx, async () => {
    const w = world();
    const hub = await hubOf(w, 'holds-every-ask');
    const pr = await failureOf(() => prOffer(hub, w));
    must(pr !== null && pr.includes(`"${OFFER}"`) && /left idle/.test(pr), `${AC27} the planted gate leaves the PR offer's stop idle and fails, naming it: ${pr ?? 'it passed'}`);
    const choice = await failureOf(() => provisional(hub, w));
    must(choice !== null && choice.includes('the provisional choice') && /left idle/.test(choice), `${AC27} the planted gate leaves the provisional choice's stop idle and fails, naming it: ${choice ?? 'it passed'}`);
  }), 600_000);
});
