// AC10: adding an email-label source over a fixture label holding 400 messages makes no task on its first run; a
// message arriving after the add becomes one task; "Fix <id>" on an older message still starts work. Removing the
// source while its run reads a page makes no task from that page. A source that turns its backlog into tasks fails
// this test, naming the count. The shipped Gmail label source over the recorded mailbox; the 400 messages are in
// `Label_7` before the switch-on, one a minute.
import { describe, expect, it } from 'vitest';
import { AC10, at, gate, MINUTE, runNow, step, tasksOf, waitUntil, YOU } from './helpers.ts';
import { judgeBacklog } from './judges.ts';
import { type Gmail } from './providers.ts';
import { backlogAsTasks } from './twins.ts';
import { gmailWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');
const msg = (i: number) => `m${String(i).padStart(4, '0')}`;
const backlog = (gm: Gmail) => { for (let i = 1; i <= 400; i++) gm.add({ id: msg(i), at: T0 - (401 - i) * MINUTE }); };

describe(`${AC10} Adding an email-label source over a fixture label holding 400 messages makes no task on its first run; a message arriving after the add becomes one task; "Fix <id>" on an older message still starts work. Removing the source while its run reads a page makes no task from that page. A source that turns its backlog into tasks fails this test, naming the count`, () => {
  it('AC10 the first run makes no task of the 400; the new message makes one; Fix m0042 starts work; the wrong source fails, naming 400', async () => {
    const { c, h, gm, handle } = await gmailWorld(T0, { before: backlog });
    const old = new Set([...gm.messages.keys()]);
    await runNow(h, handle);
    expect((await h.runs(handle)).length, 'the source ran').toBeGreaterThan(0);
    expect(judgeBacklog((await tasksOf(h, handle)).map((t) => t.id), old)).toEqual([]);
    expect((await tasksOf(h, handle)).length, 'no task on its first run').toBe(0);

    const fresh = gm.add({ id: 'm0401', at: T0 + 2 * MINUTE });
    await step(h, c, T0 + MINUTE, T0 + 20 * MINUTE);
    expect((await tasksOf(h, handle)).map((t) => t.id), 'the message after the add is one task').toEqual([fresh.id]);
    expect(judgeBacklog((await tasksOf(h, handle)).map((t) => t.id), old)).toEqual([]);

    const fixed = await h.fix(YOU, msg(42));
    expect(fixed.id, '"Fix m0042" starts work from the older message').toBe(msg(42));
    expect((await tasksOf(h, handle)).map((t) => t.id).sort()).toEqual([msg(42), fresh.id].sort());

    expect(judgeBacklog(await backlogAsTasks(gm), old).join('\n'), 'the wrong source fails, naming the count').toContain('400');
  }, 600_000);

  it('AC10 removing the source while its run reads a page makes no task from that page', async () => {
    const { c, h, gm, handle } = await gmailWorld(T0);
    gm.add({ id: 'm0601', at: T0 + 2 * MINUTE });
    const held = gate();
    gm.hold.list = held.wait;
    c.set(T0 + 3 * MINUTE);
    const since = gm.p.seen.length;
    const running = h.runNow(YOU, handle);
    await waitUntil(() => gm.p.seen.slice(since).some((s) => s.path.endsWith('/messages') && s.method === 'GET'), 60_000, 'the run reading the label\'s page');
    await h.removeWorkSource(YOU, handle);
    held.open();
    await running.catch(() => undefined);
    await h.idle();
    await step(h, c, T0 + 4 * MINUTE, T0 + 20 * MINUTE);
    expect((await h.workTasks()).map((t) => t.id), 'no task from the page read while the source was removed').toEqual([]);
  }, 300_000);
});
