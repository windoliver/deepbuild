// AC12: a delivered result on issue 42 is not read back as an update on the next run; a source that reads its own
// delivery back fails this test, naming the send key. On the tracker, the delivery is a comment on issue 42 carrying
// its send key's marker, which bumps the issue's update time as a real tracker does; kim then comments, so the next
// runs read the thread again and have something to take in.
import { describe, expect, it } from 'vitest';
import { AC12, at, deliveryOf, MINUTE, result, step, taskFor } from './helpers.ts';
import { judgeReadBack } from './judges.ts';
import { markerIn, REPO_WEB } from './providers.ts';
import { readsOwnDelivery } from './twins.ts';
import { trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');

describe(`${AC12} A delivered result on issue 42 is not read back as an update on the next run; a source that reads its own delivery back fails this test, naming the send key`, () => {
  it('AC12 the delivery\'s comment never comes back; kim\'s later comment does; the wrong source fails, naming the key', async () => {
    const { c, h, tr } = await trackerWorld(T0, { rule: true });
    tr.add({ n: 42, created: T0 + MINUTE, updated: T0 + MINUTE });
    await step(h, c, T0 + MINUTE, T0 + 10 * MINUTE);
    const t = await taskFor(h, `${REPO_WEB}#42`);
    expect(t, 'issue 42 is a task').toBeTruthy();
    const key = await h.deliverResult(t!.task_ref, result('PASS', 2, 'https://receipts.example/r/42'));
    await step(h, c, T0 + 11 * MINUTE, T0 + 20 * MINUTE);
    expect((await deliveryOf(h, key))?.outcome).toBe('sent');
    const delivered = tr.issues.get(42)!.comments.filter((x) => markerIn(x.body) === key).map((x) => `${REPO_WEB}#42.c${x.id}`);
    expect(delivered.length, 'the tracker keeps the delivery with its marker').toBe(1);
    const kim = tr.comment(42, { event: 'e-42-kim', author: 'kim', body: 'Thanks, checking it now.', at: T0 + 25 * MINUTE });
    await step(h, c, T0 + 21 * MINUTE, T0 + 45 * MINUTE);
    const taken = (await h.workEvents(t!.task_ref)).map((e) => e.reading.source_id);
    expect(taken, 'kim\'s comment after the delivery is taken in').toContain(`${REPO_WEB}#42.c${kim.id}`);
    expect(judgeReadBack(taken, delivered, key)).toEqual([]);
    expect(judgeReadBack(await readsOwnDelivery(tr, 42), delivered, key).join('\n'), 'the wrong source fails, naming the key').toContain(key);
  }, 300_000);
});
