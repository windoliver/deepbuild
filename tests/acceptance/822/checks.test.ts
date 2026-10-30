// AC3, the check's deadline (`checks-command`): a deadline past 2³¹ − 1 ms waits its full time, and a deadline that
// isn't a positive whole number of ms is refused, naming it.
//
// Read as (README, The surface under test): a command check runs through `@deepbuild/checks-command`'s public entry,
// `runCommandCheck({ host, run, spec, checkout, deadline })`, on the real supervisor as its host@1, so the check's
// command is a real process in the platform sandbox: `node hold.mjs`, which runs for an hour of real time and prints
// nothing. The host the check gets is the supervisor itself, seen through a wrapper that only counts the starts and
// signals the check asks of it and keeps each process group's ID; for the long deadline the wrapper turns the fake
// clock on as the process starts (setTimeout and clearTimeout, moving with real time too), which is where the check
// arms its deadline. "Waits its full time" means no signal reaches the process and the run doesn't return until the
// deadline, then the run ends `overran` with its exit's cause `deadline`. "Refused" means no process was started.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import type { CheckSpec } from '../../../packages/conformance/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Host, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import { BAD, DAY, MAX_TIMER, MINUTE, THIRTY_DAYS, advance, alive, fakeClock, namesValue, outcomeOf, own, realSleep, stopOwn, tempDir, tracked, until } from './helpers.ts';

const SPEC: CheckSpec = { kind: 'command', runner: 'node hold.mjs', inputs: ['hold.mjs'], depth: 'unit', oracle: 'code', contract: null };
let record: RecordStore;
let sup: Supervisor;
let n = 0;

beforeAll(async () => {
  const dir = tempDir('checks');
  record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
}, 60_000);
afterEach(() => { vi.useRealTimers(); stopOwn(); });
afterAll(async () => {
  await sup?.close();
  await record?.close();
});

/** A checkout whose one file holds its process for an hour. */
function checkout(): string {
  const dir = tempDir('checkout');
  writeFileSync(join(dir, 'hold.mjs'), 'setTimeout(() => {}, 3_600_000);\n');
  return dir;
}
/** The supervisor as the check's host, every start and signal counted; `fake` turns the fake clock on as the process starts. */
function host(fake: boolean): { host: Host; starts: string[]; signals: string[]; pids: number[] } {
  const starts: string[] = [];
  const signals: string[] = [];
  const pids: number[] = [];
  return {
    starts, signals, pids,
    host: {
      name: sup.name,
      start: async (spec) => {
        starts.push(spec.run);
        const s = await sup.start(spec);
        if (s.status === 'started') { pids.push(s.pid); own(s.pgid); }
        if (fake) fakeClock();
        return s;
      },
      signal: async (run, signal) => { signals.push(signal); return sup.signal(run, signal); },
      wait: (run) => sup.wait(run),
      facts: () => sup.facts(),
    },
  };
}
const run = (): string => `run:01K822CHECK${String(n++).padStart(15, '0')}`;

describe('AC3 #822 a check\'s deadline of 30 days waits its full time', () => {
  it('AC3 checks-command: a run with a deadline of 30 days is still running after 24.8 days on a fake clock, and ends overran at 30 days', async () => {
    const h = host(true);
    const going = tracked(runCommandCheck({ host: h.host, run: run(), spec: SPEC, checkout: checkout(), deadline: THIRTY_DAYS }));
    expect(await until(() => h.pids.length > 0, 30_000), 'the check\'s process started').toBe(true);

    // Just after its start: Node keeps a delay past 2³¹ − 1 ms as 1 ms, so a deadline armed with it stops it here.
    await realSleep(1_500);
    expect(h.signals, 'a signal reached the run just after its start: its 30-day deadline fired at once').toEqual([]);
    expect(going.settled(), 'the run returned just after its start').toBe(false);
    expect(alive(h.pids[0]), 'its process is alive').toBe(true);

    await advance(MAX_TIMER + MINUTE);
    await realSleep(200);
    expect(h.signals, 'a signal reached the run before 30 days, after 24.8').toEqual([]);
    expect(going.settled(), 'the run returned before 30 days, after 24.8').toBe(false);
    expect(alive(h.pids[0]), 'its process is alive after 24.8 days').toBe(true);

    await advance(THIRTY_DAYS - MINUTE - (MAX_TIMER + MINUTE));
    await realSleep(200);
    expect(h.signals, 'a signal reached the run a minute before 30 days').toEqual([]);
    expect(going.settled(), 'the run returned a minute before 30 days').toBe(false);

    await advance(2 * MINUTE);
    const done = await Promise.race([going.promise, realSleep(30_000).then(() => undefined)]);
    expect(done, 'the run never returned once 30 days passed').toBeDefined();
    const r = done as CommandRun;
    expect(r.outcome, `ended at its deadline: ${JSON.stringify({ outcome: r.outcome, exit: r.exit })}`).toBe('overran');
    expect(r.exit?.cause, 'its exit\'s cause').toBe('deadline');
    expect(h.signals.length, 'its deadline signalled the run').toBeGreaterThan(0);
  }, 120_000);
});

describe('AC3 #822 a check\'s deadline that is not a positive whole number of ms is refused, naming it', () => {
  for (const bad of BAD) {
    it(`AC3 checks-command: deadline ${bad.written} is refused before the check's process starts, naming deadline and ${bad.written}`, async () => {
      const h = host(false);
      const got = await outcomeOf(() => runCommandCheck({ host: h.host, run: run(), spec: SPEC, checkout: checkout(), deadline: bad.value }));
      expect(h.starts, `a process started for a check with deadline ${bad.written}`).toEqual([]);
      if (!got.threw) {
        const r = got.value as CommandRun;
        expect(['passed', 'overran'], `a refused check neither passed nor ran past a deadline: ${r.outcome}`).not.toContain(r.outcome);
      }
      expect(got.text, `the refusal names the field: ${got.text}`).toContain('deadline');
      expect(namesValue(got.text, bad.written), `the refusal names the value ${bad.written} as written: ${got.text}`).toBe(true);
    }, 60_000);
  }
});
