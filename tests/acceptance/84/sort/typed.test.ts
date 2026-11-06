// #84 AC5: text you type in the session closes a question that needs no authority, as answered in the session and
// unverified, and never closes an authority ask, whose card shows your words beside it (design: Questions at the stop).
//
// Item 61: the agent raises a choice with deep_ask and stops; you type "use option B", and the choice is closed. The
// agent's `git push origin main`, which the thread's ask doesn't name, is denied with an authority ask; you type "go ahead
// and push", and that ask stays open with your words on its row in `inbox.read`, which is what Needs you's card draws.
import { afterAll, describe, it } from 'vitest';
import {
  AC5, EXPIRED, askDraft, asksRaised, cleanup, decision, inbox, item, lastPos, listed, makeWorld, must, raisedAsk, Session, settle, setUp, shown, sleep, startHub,
  startOnItem, verdict, type Ev,
} from './helpers.ts';

const QUESTION = 'Which status should a rejected token get?';
const CHOICE = { kind: 'choice', question: QUESTION, options: [{ id: 'a', label: 'Option A: 401' }, { id: 'b', label: 'Option B: 403' }], recommended: 'a', steps: null, where: null, why: null, check: null, thread: null, subject: { point: 'req:R1', screen: null, element: null } };
const USE_B = 'use option B';
const GO_PUSH = 'go ahead and push';
const PUSH = 'git push origin main';

const closing = (events: readonly Ev[], ask: Ev): Ev[] => events.filter((e) => /^ask\.(answered|moot|cancelled|superseded|defaulted)$/.test(e.kind) && e.subject === `ask:${ask.id}`);

afterAll(cleanup, 60_000);

describe(`${AC5} typing "use option B" closes the open choice as answered in the session, and typing "go ahead and push" leaves the push's authority ask open, with your words shown beside it on the card`, () => {
  it(`${AC5} item 61: "${USE_B}" records ask.answered via session, unverified, and the choice leaves Needs you; "${GO_PUSH}" leaves the push's authority ask open, with your words on its row`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(61, 'Expired tokens are accepted', [EXPIRED])], drafts: [askDraft(USE_B), askDraft(GO_PUSH)] });
    const hub = await startHub(w);
    await setUp(w);
    const s = new Session(w);
    await startOnItem(hub, s, 61, AC5);
    await s.green();
    const since = await lastPos(hub);
    await s.deepAsk(CHOICE);
    const choice = await raisedAsk(hub, QUESTION, since, AC5);
    await s.stop(`${QUESTION} Option A or option B? I recommend option A.`);
    await s.typed(USE_B);
    let events = await settle(hub, (all) => closing(all, choice).length > 0, 15_000);
    const [closed] = closing(events, choice);
    must(closed?.kind === 'ask.answered', `${AC5} typing "${USE_B}" closes ask:${choice.id} as answered: ${listed(closing(events, choice))}`);
    must(closed!.data.via === 'session' && closed!.data.verified === false, `${AC5} it is recorded as answered in the session, unverified: ${JSON.stringify(closed!.data)}`);
    must(!(await inbox(hub)).some((r) => r.ask === `ask:${choice.id}` && r.status !== 'closed'), `${AC5} the closed choice leaves Needs you: ${JSON.stringify(await inbox(hub)).slice(0, 600)}`);

    const pushing = await lastPos(hub);
    const push = await s.bash(PUSH);
    must(decision(push.before) === 'deny', `${AC5} the thread's ask names no push, so \`${PUSH}\` is denied: ${shown(push.before)}`);
    events = await settle(hub, (all) => asksRaised(all, pushing).some((e) => e.data.kind === 'authority'), 15_000);
    const authority = asksRaised(events, pushing).find((e) => e.data.kind === 'authority');
    must(authority !== undefined, `${AC5} the denied push files an authority ask: ${listed(asksRaised(events, pushing))}`);
    await s.typed(GO_PUSH);
    await sleep(3000);
    events = await settle(hub, () => true);
    must(closing(events, authority!).length === 0, `${AC5} typing "${GO_PUSH}" never closes ask:${authority!.id}: ${listed(closing(events, authority!))}`);
    const row = (await inbox(hub)).find((r) => r.ask === `ask:${authority!.id}`);
    must(row !== undefined && row.status !== 'closed', `${AC5} the push's authority ask stays open in Needs you: ${JSON.stringify(row)}`);
    must(JSON.stringify(row).includes(GO_PUSH), `${AC5} your words "${GO_PUSH}" show beside the ask on its card: ${JSON.stringify(row).slice(0, 700)}`);
  }), 600_000);
});
