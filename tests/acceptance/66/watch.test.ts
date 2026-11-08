// AC16: a comment on an item 3 days after its task ended is taken in; one 15 days after, with no update between, is
// not read by the schedule, and a mention of you there still brings it in. On the tracker, issues 60 and 61 become
// tasks and both tasks end; a comment comes on 60 three days later, and on 61 fifteen days later, then a comment on
// 61 that mentions you. The clock steps an hour at a time.
import { describe, expect, it } from 'vitest';
import { AC16, at, DAY, HOUR, MINUTE, step, taskFor, YOU } from './helpers.ts';
import { REPO_WEB } from './providers.ts';
import { trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');

describe(`${AC16} A comment on an item 3 days after its task ended is taken in; one 15 days after, with no update between, is not read by the schedule, and a mention of you there still brings it in`, () => {
  it('AC16 the comment at 3 days is taken in; the one at 15 days isn\'t read; the mention at 15 days is taken in', async () => {
    const { c, h, tr } = await trackerWorld(T0, { every: HOUR });
    tr.add({ n: 60, created: T0 + MINUTE, updated: T0 + MINUTE });
    tr.add({ n: 61, created: T0 + MINUTE, updated: T0 + MINUTE });
    await step(h, c, T0 + MINUTE, T0 + 2 * HOUR, HOUR);
    const [t60, t61] = [await taskFor(h, `${REPO_WEB}#60`), await taskFor(h, `${REPO_WEB}#61`)];
    expect(t60 && t61, 'issues 60 and 61 are tasks').toBeTruthy();
    const ended = T0 + 3 * HOUR;
    c.set(ended);
    await h.endTask(YOU, t60!.task_ref);
    await h.endTask(YOU, t61!.task_ref);
    const taken = async (ref: string) => (await h.workEvents(ref)).map((e) => e.reading.source_id);

    await step(h, c, ended + HOUR, ended + 3 * DAY, HOUR);
    const late = tr.comment(60, { event: 'e-60-late', author: 'kim', body: 'Still seeing it on Fridays.', at: c.now() });
    await step(h, c, ended + 3 * DAY + HOUR, ended + 3 * DAY + 4 * HOUR, HOUR);
    expect(await taken(t60!.task_ref), 'the comment 3 days after the task ended is taken in').toContain(`${REPO_WEB}#60.c${late.id}`);

    await step(h, c, ended + 3 * DAY + 5 * HOUR, ended + 15 * DAY, HOUR);
    const quiet = tr.comment(61, { event: 'e-61-quiet', author: 'kim', body: 'Is this still on?', at: c.now() });
    await step(h, c, ended + 15 * DAY + HOUR, ended + 15 * DAY + 4 * HOUR, HOUR);
    expect(tr.reads(61).filter((s) => s.at >= quiet.at).length, 'the schedule doesn\'t read issue 61 at 15 days').toBe(0);
    expect(await taken(t61!.task_ref)).not.toContain(`${REPO_WEB}#61.c${quiet.id}`);

    const mention = tr.comment(61, { event: 'e-61-mention', author: 'kim', body: '@you this came back, can you look?', at: c.now(), mention: true });
    await step(h, c, ended + 15 * DAY + 5 * HOUR, ended + 15 * DAY + 8 * HOUR, HOUR);
    expect(await taken(t61!.task_ref), 'the mention of you brings it in').toContain(`${REPO_WEB}#61.c${mention.id}`);
  }, 900_000);
});
