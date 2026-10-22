// Criteria 8, 10 and 13: an approval binds to the plan's digest and the click's token; decision comes
// only from the option chosen on the trusted path; a late allow after the default is refused.

import { afterEach, beforeEach, expect, test } from 'vitest';
import { RecordError } from '../../../packages/record/src/index.ts';
import { about, agent, ask, card, core, hook, openWorld, plan, planShown, refused, sha256, shownAsks, sourceOf, ulid, type World } from './helpers.ts';
import { lateAllow, pushAnsweredInWords } from './scenarios.ts';

let w: World;
beforeEach(async () => { w = await openWorld(); });
afterEach(async () => { await w.close(); });

test('#318.e41be4c3 only the plan whose digest you approved runs, bound to your click; a changed plan needs a new approval; an agent never approves', async () => {
  await w.start('S1', 'T1');
  const now = w.clock.now();
  const shownPlan = plan('main');
  const a = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', now, { subject: 'push-main' }), shownPlan);
  // Every authority ask shows its plan: the steps, what each changes, the undo and the cost, by its digest.
  const h1 = await planShown(w, a);
  expect(h1, `ask ${a}: its card shows the plan's digest`).toMatch(/^[0-9a-f]{64}$/);
  expect((await w.asks.card(a)).plan?.steps, `ask ${a}: its card shows the plan's steps`).toEqual(shownPlan.steps);
  expect(await w.asks.authorized(a, h1), `ask ${a}: the plan runs before any approval`).toBeNull();
  // An agent passing a flag never counts as your approval.
  for (const connection of [agent('S1'), hook('S1')]) {
    await refused(w.asks.answer(connection, a, { option: 'push', plan_hash: h1, token: '--approved' }));
  }
  await expect(w.record.append(agent('S1'), { v: 1, id: ulid(now), kind: 'ask.answered', subject: a, ts: now, data: { answer: 'push', plan_hash: h1, decision: 'allow' } }), 'an agent wrote an answer into the record').rejects.toBeInstanceOf(RecordError);
  expect(about(await w.events('ask.answered'), a), `ask ${a}: an agent's approval was recorded`).toEqual([]);
  expect(await w.asks.authorized(a, h1), `ask ${a}: an agent's flag approved the plan`).toBeNull();
  // Your click approves the plan you were shown, and only that plan.
  await w.asks.answer(card, a, { option: 'push', plan_hash: h1, token: 'click-7' });
  expect(await w.asks.authorized(a, h1), `ask ${a}: the approved plan runs under your click's token`).toBe('click-7');
  expect(await w.asks.authorized(a, sha256('a plan nobody showed')), `ask ${a}: a plan you weren't shown runs`).toBeNull();
  // A changed plan, the same push now with a tag, is a new ask with a new digest and needs a new approval.
  const changedPlan = { ...plan('main'), steps: [...plan('main').steps, { does: 'git push origin v1.2.0', changes: ['origin/v1.2.0'], undo: 'git push origin :refs/tags/v1.2.0', public: true, cost: 0 }] };
  const b = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', now, { subject: 'push-main', question: 'Push main, now with the v1.2.0 tag?' }), changedPlan);
  await w.asks.tick();
  const h2 = await planShown(w, b);
  expect(h2, 'a changed plan keeps the old digest').not.toBe(h1);
  expect(await w.asks.authorized(a, h2), `ask ${a}'s approval runs the changed plan`).toBeNull();
  expect(await w.asks.authorized(b, h2), `ask ${b}: the changed plan runs without a new approval`).toBeNull();
  expect((await w.row(b))?.outcome, `ask ${b}: the old approval answered the changed plan`).toBe('unanswered');
  expect(await shownAsks(w), `ask ${b} waits for you`).toContain(b);
  await w.asks.answer(card, b, { option: 'push', plan_hash: h2, token: 'click-8' });
  expect(await w.asks.authorized(b, h2), `ask ${b}: your new approval runs the changed plan`).toBe('click-8');
});

test('#318.d249acdc an answer carrying decision is refused; words alone record none and the push never runs; the allow option runs only its plan', async () => {
  await pushAnsweredInWords(w);
});

test('#318.898ac861 an allow from deep inbox answer at 12:01, after the default no at 12:00, is refused naming defaulted and 12:00, and nothing reaches the agent', async () => {
  await lateAllow(w);
});
