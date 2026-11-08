// AC9: with a recorded provider where one of 20 items answers deleted (410) and another answers not found (404) on
// every read, a run takes in the other 18 and ends without FAIL, drops the deleted item at once, and drops the 404
// item 24 h after its first failed read; the source never pauses. A source that fails the run over one item, or
// drops the 404 item at once, fails this test, naming the item. An item that answers 404 for 3 h and then reads
// again is taken in from where its read position stood.
// On the tracker, issues 1 to 20 are made after the switch-on; 5 answers 410 and 9 answers 404 to every read. The
// clock steps 10 minutes at a time across the day.
import { describe, expect, it } from 'vitest';
import { AC9, at, HOUR, MINUTE, rowOf, runsOf, step, taskFor, tasksOf } from './helpers.ts';
import { judgeReads, type ReadsSeen } from './judges.ts';
import { REPO_WEB } from './providers.ts';
import { dropsAtOnce, failsRunOnItem } from './twins.ts';
import { trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');
const id = (n: number) => `${REPO_WEB}#${n}`;
const ALL = Array.from({ length: 20 }, (_, i) => id(i + 1));

describe(`${AC9} With a recorded provider where one of 20 items answers deleted (410) and another answers not found (404) on every read, a run takes in the other 18 and ends without FAIL, drops the deleted item at once, and drops the 404 item 24 h after its first failed read; the source never pauses. A source that fails the run over one item, or drops the 404 item at once, fails this test, naming the item. An item that answers 404 for 3 h and then reads again is taken in from where its read position stood`, () => {
  it('AC9 the 18 are taken in with no FAIL; 5 is dropped at once; 9 is tried each run and dropped 24 h after its first failed read; the source never pauses; the two wrong sources fail, naming the item', async () => {
    const { c, h, tr, handle } = await trackerWorld(T0, { every: 10 * MINUTE });
    for (let n = 1; n <= 20; n++) tr.add({ n, created: T0 + MINUTE, updated: T0 + MINUTE, ...(n === 5 ? { read: () => 410 } : n === 9 ? { read: () => 404 } : {}) });
    await step(h, c, T0 + MINUTE, T0 + HOUR, 10 * MINUTE);
    const taken = async () => (await tasksOf(h, handle)).map((t) => t.id);
    expect((await taken()).sort(), 'the other 18 are tasks').toEqual(ALL.filter((x) => x !== id(5) && x !== id(9)).sort());
    const firstFailed = tr.reads(9)[0]?.at;
    expect(firstFailed, 'issue 9 was read').toBeDefined();
    let page = await h.workPage(handle);
    expect(page.dropped.map((d) => [d.id, d.why]), 'the deleted item is dropped at once').toEqual([[id(5), 'deleted']]);
    expect(page.dropped.find((d) => d.id === id(5))!.at, 'at its first failed read').toBe(tr.reads(5)[0]!.at);
    expect(page.failing.map((f) => f.id), 'the 404 keeps its error on itself').toEqual([id(9)]);

    await step(h, c, T0 + HOUR + 10 * MINUTE, firstFailed! + 23 * HOUR, 10 * MINUTE);
    page = await h.workPage(handle);
    expect(page.dropped.map((d) => d.id), 'not found is tried again, not dropped, before 24 h').toEqual([id(5)]);
    expect(tr.reads(9).filter((s) => s.at > firstFailed! + 20 * HOUR).length, 'issue 9 is still read in the day\'s last hours').toBeGreaterThan(0);
    await step(h, c, firstFailed! + 23 * HOUR + 10 * MINUTE, firstFailed! + 25 * HOUR, 10 * MINUTE);
    page = await h.workPage(handle);

    const runs = await runsOf(h, handle);
    const seen: ReadsSeen = {
      taken: await taken(), verdicts: runs.map((r) => ({ verdict: r.verdict, cause: r.cause })),
      paused: (await rowOf(h, handle)).state !== 'on', dropped: page.dropped.map((d) => ({ id: d.id, at: d.at })),
    };
    const x = { all: ALL, deleted: id(5), notFound: id(9), firstFailed: firstFailed!, now: c.now() };
    expect(judgeReads(seen, x)).toEqual([]);
    expect(page.dropped.find((d) => d.id === id(9))?.why, 'named on the source\'s page as not found').toBe('not found');

    // The wrong programs, on the same provider.
    expect(judgeReads(await failsRunOnItem(tr, ALL), x).join('\n')).toContain(id(5));
    expect(judgeReads(await dropsAtOnce(tr, ALL, firstFailed!), x).join('\n')).toContain(id(9));
  }, 600_000);

  it('AC9 an item that answers 404 for 3 h and then reads again is taken in from where its read position stood', async () => {
    const { c, h, tr, handle } = await trackerWorld(T0, { every: 10 * MINUTE });
    const from = T0 + 30 * MINUTE;
    tr.add({ n: 12, created: T0 + MINUTE, updated: T0 + MINUTE, read: (now) => (now >= from && now < from + 3 * HOUR ? 404 : 200) });
    const c1 = tr.comment(12, { event: 'e-12-1', author: 'kim', body: 'First note.', at: T0 + 15 * MINUTE });
    await step(h, c, T0 + MINUTE, T0 + 25 * MINUTE, 10 * MINUTE);
    const t = await taskFor(h, id(12));
    expect(t, 'issue 12 is a task').toBeTruthy();
    const comments = async () => (await h.workEvents(t!.task_ref)).filter((e) => e.kind === 'comment').map((e) => e.id);
    expect(await comments()).toEqual([c1.event]);
    const c2 = tr.comment(12, { event: 'e-12-2', author: 'kim', body: 'Second note.', at: from + 10 * MINUTE });
    const c3 = tr.comment(12, { event: 'e-12-3', author: 'ana', body: 'Third note.', at: from + 2 * HOUR });
    await step(h, c, T0 + 35 * MINUTE, from + 3 * HOUR - MINUTE, 10 * MINUTE);
    expect(tr.reads(12).some((s) => s.at >= from && s.at < from + 3 * HOUR), 'issue 12 was read while it answered 404').toBe(true);
    expect((await h.workPage(handle)).dropped, 'not dropped within 24 h').toEqual([]);
    await step(h, c, from + 3 * HOUR, from + 4 * HOUR, 10 * MINUTE);
    expect((await comments()).sort(), 'each comment once: the first from before, the two made while it failed').toEqual([c1.event, c2.event, c3.event].sort());
    expect((await tasksOf(h, handle)).filter((x) => x.id === id(12)).length, 'still one task').toBe(1);
  }, 600_000);
});
