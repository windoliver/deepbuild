// AC15: two deliveries of one task to one thread, the first answered 503 twice, reach the provider in the order
// recorded; a hub that sends the second first fails this test, naming both keys. On the tracker, issue 50's first two
// comment requests answer 503, whichever delivery they carry; the clock steps a minute at a time for three hours.
import { describe, expect, it } from 'vitest';
import { AC15, at, deliveryOf, HOUR, MINUTE, result, step, taskFor } from './helpers.ts';
import { judgeOrder } from './judges.ts';
import { markerIn, REPO_WEB } from './providers.ts';
import { sendsSecondFirst } from './twins.ts';
import { trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');

describe(`${AC15} Two deliveries of one task to one thread, the first answered 503 twice, reach the provider in the order recorded; a hub that sends the second first fails this test, naming both keys`, () => {
  it('AC15 the second waits while the first is tried again, and goes once the first is sent; the wrong hub fails, naming both keys', async () => {
    const { c, h, tr } = await trackerWorld(T0, { rule: true });
    const issue = tr.add({ n: 50, created: T0 + MINUTE, updated: T0 + MINUTE });
    await step(h, c, T0 + MINUTE, T0 + 10 * MINUTE);
    const t = await taskFor(h, `${REPO_WEB}#50`);
    expect(t, 'issue 50 is a task').toBeTruthy();
    issue.post = [503, 503];
    const first = await h.deliverResult(t!.task_ref, result('FAIL', 2, 'https://receipts.example/r/50-1'));
    const second = await h.deliverResult(t!.task_ref, result('PASS', 2, 'https://receipts.example/r/50-2'));
    await step(h, c, T0 + 11 * MINUTE, T0 + 3 * HOUR);
    const posts = tr.posts(50);
    const requests = posts.map((s, i) => ({ key: markerIn(s.body), status: i < 2 ? 503 : 201 }));
    expect(requests.filter((r) => r.key === first).length, `the first was tried three times: ${JSON.stringify(requests)}`).toBe(3);
    expect(judgeOrder(requests, first, second)).toEqual([]);
    expect([(await deliveryOf(h, first))?.outcome, (await deliveryOf(h, second))?.outcome]).toEqual(['sent', 'sent']);

    tr.add({ n: 51, created: T0, updated: T0, post: [503, 503] });
    const bodies = [first, second].map((key) => ({ key, body: JSON.parse(posts.find((s) => markerIn(s.body) === key)!.body).body as string }));
    const problems = judgeOrder(await sendsSecondFirst(tr, 51, bodies), first, second).join('\n');
    expect(problems, 'the wrong hub fails, naming both keys').toContain(first);
    expect(problems).toContain(second);
  }, 600_000);
});
