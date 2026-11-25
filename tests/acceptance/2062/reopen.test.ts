// AC4 and AC5: a series reopen that fails is tried again at the next land or tick, from empty windows (README, Criteria).
// The source `ext.meter.load` returns two named values a call, has a 5 s timeout, and is read through the host, whose
// timer is the test's: every land, tick and time is on the controlled clock.
import { describe, expect, it } from 'vitest';
import {
  AC, answering, clock, closeHost, failsAtThird, failsFirstRead, heldHost, land, meter, METER_GRANT, openWorld, settled, setUp, SOURCE, t,
} from './helpers.ts';

const MINUTE = t('10:00:00');
/** Past the 10:00 minute's end and the source's timeout. */
const CLOSED = t('10:01:10');

describe(`${AC[4]} the first land after a failed read of the record rejects, naming the read; the second succeeds, and its minute's rollup holds its batch`, () => {
  it('AC4 the record\'s first read fails once: the first land rejects, naming it, the second succeeds, and the closed minute\'s rollup holds that batch', async () => {
    const c = clock(t('10:00:05'));
    const w = await openWorld(c);
    const flaky = failsFirstRead(w.record);
    const h = await heldHost(w, { record: flaky.record, http: answering([{ checkout: 4, search: 40 }, { checkout: 7, search: 70 }]) });
    await setUp(h, meter(), 'the series source\'s package', METER_GRANT);

    flaky.arm();
    c.set(t('10:00:10'));
    const first = await land(h);
    expect(flaky.failed, 'the fixture record store failed one read').toHaveLength(1);
    expect(first.file, 'the first land rejects: it lands no batch').toBeNull();
    expect(first.refused, 'the first land\'s rejection names the read that failed').toContain(flaky.failed[0]);

    c.set(t('10:00:20'));
    const second = await land(h);
    expect(second.refused, 'the second land succeeds, the record read again').toBeNull();
    expect((await w.events('reading.batch')).map((e) => e.data), 'the record holds the second land\'s batch alone').toEqual([{ source: SOURCE, as_of: t('10:00:20'), file: second.file }]);

    c.set(CLOSED);
    expect(await settled(h.tick()), 'the tick that closes the minute').toBe('done');
    expect(await h.rollup(SOURCE, 'minute', MINUTE), 'the 10:00 minute\'s rollup holds the second land\'s batch').toEqual({
      checkout: { min: 7, max: 7, mean: 7, last: 7, count: 1 },
      search: { min: 70, max: 70, mean: 70, last: 70, count: 1 },
    });
  }, 300_000);
});

describe(`${AC[5]} a reopen that fails once after rebuilding 2 of a minute's 3 batches starts again from empty windows: the minute's rollup counts 3 values for each series`, () => {
  it('AC5 three batches land before a restart; the reopen fails once after 2 of them, its second try succeeds, and the minute counts 3 values of each series', async () => {
    const c = clock(t('10:00:05'));
    const before = await openWorld(c);
    const first = await heldHost(before, { http: answering([{ checkout: 4, search: 40 }, { checkout: 1, search: 10 }, { checkout: 15, search: 150 }]) });
    await setUp(first, meter(), 'the series source\'s package', METER_GRANT);
    const files = new Set<string>();
    for (const at of ['10:00:10', '10:00:20', '10:00:30']) {
      c.set(t(at));
      const { file, refused } = await land(first);
      if (file === null) throw Error(`set-up: the batch of ${at} lands before the restart: ${refused}`);
      files.add(file);
    }
    if (files.size !== 3) throw Error(`set-up: three lands made ${files.size} batch files, not one each`);
    await closeHost(first);
    await before.close();

    // The restart: the same record, evidence and installs, opened again; the reopen fails at the third batch's file.
    const after = await openWorld(c, before.dir);
    const flaky = failsAtThird(after.evidence, files);
    const h = await heldHost(after, { evidence: flaky.evidence, http: answering([]) });
    const [installed] = await h.installed();
    const load = await h.load(installed!);
    if (load.status !== 'loaded') throw Error(`set-up: the series source's package loads after the restart: ${load.reason}`);
    c.set(t('10:00:40'));
    const failing = await settled(h.tick());
    expect(flaky.before.length, 'the reopen\'s first try read 2 of the 3 batches').toBe(2);
    expect(flaky.failed, `the reopen\'s first try failed at the third (its tick: ${failing})`).toHaveLength(1);
    expect(await settled(h.tick()), 'the reopen\'s second try succeeds').toBe('done');

    c.set(CLOSED);
    expect(await settled(h.tick()), 'the tick that closes the minute').toBe('done');
    const rollup = await h.rollup(SOURCE, 'minute', MINUTE);
    expect(Object.keys(rollup ?? {}).sort(), 'the 10:00 minute\'s rollup holds both series').toEqual(['checkout', 'search']);
    for (const series of ['checkout', 'search']) expect(rollup![series]!.count, `the 10:00 minute's rollup counts 3 values of ${series}`).toBe(3);
  }, 300_000);
});
