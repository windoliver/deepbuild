// AC1 and AC2: a runner job's deadline past 2³¹ − 1 ms waits its full time, and a deadline_ms or output_timeout_ms
// that isn't a positive whole number of milliseconds is refused before the job starts, naming the field and the value.
//
// Read as (README, The surface under test): jobs are submitted to `@deepbuild/runner` (`openRunner`, `submit`,
// `status`, `wait`, `list`, `cancel`), on the real record, asks core, budget ledger and supervisor, so every job's
// process is a real one in the platform sandbox: the stand-in `claude` (helpers.ts), which prints one line and runs on.
// The fake clock is Vitest's fake timers and Date, which the runner's every clock reads (`now: Date.now`), moved
// ahead days at a time; the runner's own tick runs after each move. A job is "running" while the runner says so and
// its process is alive; "refused before it starts" means the supervisor recorded no process under the job's run.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JobRecord } from '../../../packages/runner/src/index.ts';
import { BAD, DAY, MAX_TIMER, MINUTE, THIRTY_DAYS, advance, alive, fakeClock, job, namesValue, openWorld, outcomeOf, own, realSleep, stopOwn, until, type World } from './helpers.ts';

let world: World | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await world?.close();
  world = undefined;
  stopOwn();
});

/** The job as the runner reads it after its tick, with whether its process is still alive. */
async function read(w: World, id: string): Promise<{ rec: JobRecord; up: boolean }> {
  await w.runner.tick();
  await realSleep(100);
  const rec = await w.runner.status(id);
  return { rec, up: alive(rec.pid) };
}

describe('AC1 #822 a job with a deadline_ms of 30 days runs until 30 days on a fake clock', () => {
  it('AC1 is still running just after its start and after 24.8 days, and is stopped as timed_out at 30 days, not at its start', async () => {
    const w = (world = await openWorld());
    fakeClock();
    const submitted = await w.runner.submit(job({ deadline_ms: THIRTY_DAYS }));
    own(submitted.pgid);
    expect(submitted.state, `the job started: ${JSON.stringify(submitted)}`).not.toBe('refused');
    await until(async () => (await w.runner.status(submitted.job)).state !== 'waiting', 30_000);

    // Just after its start: Node keeps a delay past 2³¹ − 1 ms as 1 ms, so a deadline armed with it stops here.
    await realSleep(1_000);
    const start = await read(w, submitted.job);
    own(start.rec.pgid);
    expect(start.rec.stop?.cause, `a 30-day deadline stopped the job at its start: ${JSON.stringify(start.rec)}`).toBeUndefined();
    expect(start.rec.state, 'just after its start the job runs').toBe('running');
    expect(start.up, `its process ${String(start.rec.pid)} is alive`).toBe(true);

    // Past 24.8 days (2³¹ − 1 ms and a minute): still running.
    await advance(MAX_TIMER + MINUTE);
    const past = await read(w, submitted.job);
    expect(past.rec.stop?.cause, `stopped before 30 days, after ${(MAX_TIMER + MINUTE) / DAY} days: ${JSON.stringify(past.rec)}`).toBeUndefined();
    expect(past.rec.state, 'after 24.8 days the job still runs').toBe('running');
    expect(past.up, 'its process is alive after 24.8 days').toBe(true);

    // A minute short of 30 days: still running.
    await advance(THIRTY_DAYS - MINUTE - (MAX_TIMER + MINUTE));
    const short = await read(w, submitted.job);
    expect(short.rec.state, `a minute before its deadline the job still runs: ${JSON.stringify(short.rec)}`).toBe('running');
    expect(short.up, 'its process is alive a minute before 30 days').toBe(true);

    // At 30 days: stopped, timed out, every process of it gone.
    await advance(2 * MINUTE);
    await w.runner.tick();
    const ended = await Promise.race([w.runner.wait(submitted.job), realSleep(30_000).then(() => undefined)]);
    expect(ended, `no end within 30 s of real time once 30 days passed: ${JSON.stringify(await w.runner.status(submitted.job))}`).toBeDefined();
    expect(ended!.state, `ended at 30 days: ${JSON.stringify(ended)}`).toBe('stopped');
    expect(ended!.stop?.cause, 'its cause').toBe('timed_out');
    expect(alive(start.rec.pid), 'its process is gone').toBe(false);
  }, 180_000);
});

describe('AC2 #822 a deadline_ms or output_timeout_ms that is not a positive whole number of ms is refused before the job starts, naming the field and the value', () => {
  let w: World;
  beforeAll(async () => {
    w = await openWorld();
    return async () => { await w.close(); stopOwn(); };
  }, 60_000);

  for (const field of ['deadline_ms', 'output_timeout_ms'] as const) {
    for (const bad of BAD) {
      it(`AC2 ${field} ${bad.written} is refused before the job starts, naming ${field} and ${bad.written}`, async () => {
        const before = new Set((await w.runner.list()).map((j) => j.job));
        const got = await outcomeOf(() => w.runner.submit(job({ [field]: bad.value })));
        const mine = (await w.runner.list()).filter((j) => !before.has(j.job));
        for (const j of mine) own(j.pgid);
        try {
          // Refused: submit threw, or the job came back refused; either way no process of it started.
          if (!got.threw) {
            const rec = got.value as JobRecord;
            expect(rec.state, `${field} ${bad.written} was taken: the job is ${rec.state} (${JSON.stringify(rec)})`).toBe('refused');
            expect(rec.pid, 'a refused job has no process').toBeUndefined();
          }
          for (const j of mine) {
            expect(await w.launched(j.job), `a process of the job ${j.job} started with ${field} ${bad.written}`).toBe(false);
            expect(['running', 'stopping', 'stopped', 'finished'], `the job with ${field} ${bad.written} ran: ${JSON.stringify(j)}`).not.toContain(j.state);
          }
          const said = got.threw ? got.text : String((got.value as JobRecord).refused ?? '');
          expect(said, `the refusal names the field: ${said}`).toContain(field);
          expect(namesValue(said, bad.written), `the refusal names the value ${bad.written} as written: ${said}`).toBe(true);
        } finally {
          for (const j of mine) await w.runner.cancel(j.job).catch(() => undefined);
        }
      }, 60_000);
    }
  }

  it('AC2 positive whole deadline_ms and output_timeout_ms are taken: the job starts and runs', async () => {
    const rec = await w.runner.submit(job({ deadline_ms: 3_600_000, output_timeout_ms: 3_600_000 }));
    own(rec.pgid);
    try {
      expect(rec.state, `a job with deadline_ms and output_timeout_ms of an hour: ${JSON.stringify(rec)}`).not.toBe('refused');
      expect(await until(async () => (await w.runner.status(rec.job)).state === 'running', 30_000), 'it runs').toBe(true);
      expect(await w.launched(rec.job), 'its process started').toBe(true);
    } finally {
      await w.runner.cancel(rec.job).catch(() => undefined);
    }
  }, 60_000);
});

describe('AC2 #822 leaving deadline_ms and output_timeout_ms out still means no deadline', () => {
  it('AC2 a job with neither field is taken and still runs after 60 days on a fake clock', async () => {
    const w = (world = await openWorld());
    fakeClock();
    const rec = await w.runner.submit(job());
    own(rec.pgid);
    expect(rec.state, `a job with no deadline: ${JSON.stringify(rec)}`).not.toBe('refused');
    expect(await until(async () => (await w.runner.status(rec.job)).state === 'running', 30_000), 'it runs').toBe(true);
    await advance(60 * DAY);
    const later = await read(w, rec.job);
    own(later.rec.pgid);
    expect(later.rec.state, `after 60 days with no deadline: ${JSON.stringify(later.rec)}`).toBe('running');
    expect(later.up, 'its process is alive after 60 days').toBe(true);
  }, 180_000);
});
