// AC13: a delivery to an issue the provider answers 410 for, or to a locked conversation, ends gone on its first
// attempt with the cause and the task, and the schedule records no FAIL; a hub that tries it again, or pauses the
// schedule over it, fails this test, naming the send key. On the tracker, issue 43 was deleted after its task opened
// (a comment answers 410) and issue 44 is locked (a comment answers 403, "issue is locked"). The clock then runs on
// for three hours, a step every ten minutes.
import { describe, expect, it } from 'vitest';
import { AC13, at, deliveryOf, HOUR, MINUTE, result, rowOf, runsOf, step, taskFor } from './helpers.ts';
import { judgeGone } from './judges.ts';
import { markerIn, REPO_WEB } from './providers.ts';
import { triesAgain } from './twins.ts';
import { trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');

describe(`${AC13} A delivery to an issue the provider answers 410 for, or to a locked conversation, ends gone on its first attempt with the cause and the task, and the schedule records no FAIL; a hub that tries it again, or pauses the schedule over it, fails this test, naming the send key`, () => {
  it('AC13 both deliveries end gone on their one attempt, each with its cause, time and task; the schedule runs on with no FAIL; the wrong hubs fail, naming the key', async () => {
    const { c, h, tr, handle } = await trackerWorld(T0, { rule: true, every: 10 * MINUTE });
    tr.add({ n: 43, created: T0 + MINUTE, updated: T0 + MINUTE });
    tr.add({ n: 44, created: T0 + MINUTE, updated: T0 + MINUTE });
    await step(h, c, T0 + MINUTE, T0 + 15 * MINUTE);
    const [t43, t44] = [await taskFor(h, `${REPO_WEB}#43`), await taskFor(h, `${REPO_WEB}#44`)];
    expect(t43 && t44, 'issues 43 and 44 are tasks').toBeTruthy();
    tr.issues.get(43)!.gone = true;
    tr.issues.get(44)!.locked = true;
    const k43 = await h.deliverResult(t43!.task_ref, result('PASS', 2, 'https://receipts.example/r/43'));
    const k44 = await h.deliverResult(t44!.task_ref, result('PASS', 2, 'https://receipts.example/r/44'));
    await step(h, c, T0 + 16 * MINUTE, T0 + 3 * HOUR, 10 * MINUTE);

    const fails = (await runsOf(h, handle)).filter((r) => r.verdict === 'FAIL').length;
    const paused = (await rowOf(h, handle)).state !== 'on';
    const tried = (n: number, key: string) => tr.posts(n).filter((s) => markerIn(JSON.parse(s.body).body ?? '') === key).length;
    const [r43, r44] = [await deliveryOf(h, k43), await deliveryOf(h, k44)];
    expect(judgeGone(r43, { key: k43, task_ref: t43!.task_ref, attempts: tried(43, k43), fails, paused })).toEqual([]);
    expect(judgeGone(r44, { key: k44, task_ref: t44!.task_ref, attempts: tried(44, k44), fails, paused })).toEqual([]);
    expect(r43!.cause, 'the deleted issue\'s cause').toMatch(/410|delet/i);
    expect(r44!.cause, 'the locked conversation\'s cause').toMatch(/lock/i);
    expect(r43!.at, 'when: its one attempt').toBe(tr.posts(43)[0]!.at);

    // The wrong programs: one tries the deleted issue again; one pauses the schedule over the locked one.
    expect(judgeGone(r43, { key: k43, task_ref: t43!.task_ref, attempts: await triesAgain(tr, 43, k43), fails, paused }).join('\n')).toContain(k43);
    expect(judgeGone(r44, { key: k44, task_ref: t44!.task_ref, attempts: tried(44, k44), fails, paused: true }).join('\n')).toContain(k44);
  }, 600_000);
});
