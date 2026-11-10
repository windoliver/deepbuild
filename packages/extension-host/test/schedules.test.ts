// #365's declared no-op, as schedule.run@1 records it (#13): the schema's verdict holds only the five verdicts, so a
// run whose job declared a no-op ends with `noop: true` and no verdict, is read back as uncounted, and still clears
// the schedule's FAIL count the way a PASS does.
import { describe, expect, it } from 'vitest';
import { fixtures, validate, type JsonValue } from '@deepbuild/contracts';
import { cadenceOf, Schedules, type Ended, type RunEvent, type ScheduleDecl } from '../src/schedules.js';

const DECL: ScheduleDecl = {
  name: 'ext.test.brief', plugin: 'test/brief', cadence: { every: 60_000 }, deadline: 10_000,
  declares: { readings: [], notices: [], stores: [], sends: [], noop: true },
};

/** A scheduler on a fake host whose job ends each run as `endings` says, in turn. */
function world(endings: Ended[]) {
  let now = 1_000_000, ids = 0;
  const events: RunEvent[] = [];
  const schedules = new Schedules({
    now: () => now,
    newRun: () => `run:${String(++ids).padStart(26, '0')}`,
    append: async (event) => void events.push(event),
    ready: () => true,
    blocked: async () => null,
    dispatch: () => Promise.resolve(endings.shift()!),
    saved: () => {},
  });
  const ended = () => events.filter((e) => e.phase === 'ended');
  /** Moves past the next slot and waits for that run's end to be recorded. */
  const runOnce = async () => {
    const before = ended().length;
    now += 7 * 3_600_000;
    await schedules.tick();
    for (let i = 0; i < 100 && ended().length === before; i++) await new Promise((r) => setTimeout(r, 0));
    expect(ended().length, 'the run ended').toBe(before + 1);
    return ended().at(-1)!;
  };
  return { schedules, runOnce, rows: () => schedules.rows(() => null) };
}

/** The event the host appends for `data`, on schedule.run@1's own valid fixture. */
const asRecorded = (data: RunEvent): JsonValue => ({ ...(fixtures('schedule.run@1')[0] as Record<string, JsonValue>), data: data as unknown as JsonValue });

describe('a declared no-op on schedule.run@1', () => {
  it('ends with noop and no verdict, and the record accepts it', async () => {
    const { schedules, runOnce } = world([{ verdict: 'uncounted', cause: 'a no-op its job declares', changes: [] }]);
    await schedules.register(DECL, { runs: [], settings: {} });
    const end = await runOnce();
    expect(end.noop).toBe(true);
    expect(end).not.toHaveProperty('verdict');
    const result = validate('schedule.run@1', asRecorded(end));
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it('a no-op written as a verdict is refused by the schema, naming the field', () => {
    const end: RunEvent = { run: `run:${'1'.padStart(26, '0')}`, schedule: DECL.name, plugin: DECL.plugin, phase: 'ended', due: 0, cause: null, changes: [] };
    const result = validate('schedule.run@1', asRecorded({ ...end, verdict: 'uncounted' as never }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('/data/verdict');
  });

  it('clears the FAIL count as a PASS does: four FAILs, a no-op, then four more never pause it', async () => {
    const fail: Ended = { verdict: 'FAIL', cause: 'its job failed', changes: [] };
    const { schedules, runOnce, rows } = world([fail, fail, fail, fail, { verdict: 'uncounted', cause: 'a no-op its job declares', changes: [] }, fail, fail, fail, fail]);
    await schedules.register(DECL, { runs: [], settings: {} });
    for (let i = 0; i < 9; i++) await runOnce();
    expect(rows().find((r) => r.name === DECL.name)?.state).toBe('on');
  });
});

describe('a cadence as edited', () => {
  it('refuses a cron line for a date that never comes, and takes one that does', () => {
    for (const cron of ['0 0 31 2 *', '0 0 30 2 *', '0 0 31 4 *']) expect(() => cadenceOf({ cron }), cron).toThrow(/matches no time/);
    expect(cadenceOf({ cron: '0 0 29 2 *' })).toEqual({ cron: '0 0 29 2 *' });
  });
});
