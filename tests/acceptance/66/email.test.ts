// AC2: an email in the label you named becomes a task with a link back to its thread, and the result goes back as a
// reply under your rule. The shipped Gmail label source (packages/sources/gmail) over the recorded mailbox: the label
// `Label_7` is empty when you switch it on; a client's email arrives in it, and another arrives in the inbox only.
// Your rule is "reply in the thread it came from".
import { describe, expect, it } from 'vitest';
import { AC2, at, authorityAsks, deliveryOf, MINUTE, result, step, tasksOf } from './helpers.ts';
import { LABEL } from './providers.ts';
import { gmailWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');

describe(`${AC2} An email in the label you named becomes a task with a link back to its thread, and the result goes back as a reply under your rule`, () => {
  it('AC2 the labelled email is one task linking its thread; the result goes back into that thread as a reply, with no ask', async () => {
    const { c, w, h, gm, handle } = await gmailWorld(T0, { rule: true });
    const asked = gm.add({ id: 'm0501', threadId: 't-0501', at: T0 + 2 * MINUTE, subject: 'The export drops rows', text: 'Please fix the nightly export, it drops rows.' });
    gm.add({ id: 'm0502', threadId: 't-0502', at: T0 + 3 * MINUTE, labelIds: ['INBOX'], subject: 'Lunch?', text: 'Not work.' });
    await step(h, c, T0 + MINUTE, T0 + 15 * MINUTE);
    const tasks = await tasksOf(h, handle);
    expect(tasks.map((t) => t.id), `only the email in ${LABEL} is a task: ${JSON.stringify(tasks)}`).toEqual([asked.id]);
    expect(tasks[0]!.link, 'the task links back to its thread').toContain(asked.threadId);

    const key = await h.deliverResult(tasks[0]!.task_ref, result('PASS', 2, 'https://receipts.example/r/m0501'));
    await step(h, c, T0 + 16 * MINUTE, T0 + 25 * MINUTE);
    const sent = gm.sent();
    expect(sent.length, `one reply was sent: ${JSON.stringify(sent)}`).toBe(1);
    expect(sent[0]!.threadId, 'the reply is in the thread the email came from').toBe(asked.threadId);
    expect(sent[0]!.to, 'it goes to the client who wrote').toContain('ana@client.example.test');
    const d = await deliveryOf(h, key);
    expect(d?.outcome).toBe('sent');
    expect(d?.rule, 'it went under your rule').toBeTruthy();
    expect((await authorityAsks(w)).length, 'your rule covers it: no ask').toBe(0);
  }, 300_000);
});
