// #3220 AC2: a run whose tree the scan couldn't read, in a sandbox of its own, records no peak; a planted record that
// writes 0 fails. Both runs are the hub's (`run.start` with a command, as a claim's check runs through the command check
// kind): one in the supervisor's sandbox, which its scan reads, and the same command `outside: true`, which the kind runs
// with `own_sandbox` (#33, #1330), where the scan can't find its processes (#1409 refuses a memory limit there). The
// first is the control: it must record a peak, so a program that records nothing for any run can't pass (README).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC2, claimHandle, cleanup, finishedRun, fixtureIn, mustFail, NO_COMMIT, peakOf, PLANTS, shownRun, World, type RunRead } from './helpers.ts';

afterAll(cleanup, 120_000);

const MIB = 300;
const COMMAND = `node alloc.mjs ${MIB} 2000`;

interface Reading { boxed: RunRead; own: RunRead }
/** The same command twice through a hub with `plant`: in the supervisor's sandbox, then in a sandbox of its own. */
async function twoRuns(plant?: string): Promise<Reading> {
  const w = new World({ memMb: 16_000, ...(plant ? { plant } : {}) });
  const dir = join(w.tmp, 'run');
  mkdirSync(dir);
  fixtureIn(dir, 'alloc.mjs');
  await w.startHub();
  try {
    const start = async (outside: boolean): Promise<RunRead> => {
      const { run } = await w.control('run.start', { check: 'alloc', claim: claimHandle(), commit: NO_COMMIT, argv: ['/bin/sh', '-c', COMMAND], command: COMMAND, cwd: dir, ...(outside ? { outside: true } : {}) });
      return finishedRun(w, String(run));
    };
    const boxed = await start(false);
    const own = await start(true);
    if (!(own.started.data.withheld as string[] | undefined)?.includes('outside')) throw Error(`BLOCKED: the second run must be one the hub ran outside the supervisor's sandbox (run.started's withheld names outside): ${shownRun(own)}`);
    for (const r of [boxed, own]) if (r.outcome === 'missing' || r.outcome === 'uncounted') throw Error(`BLOCKED: the command must run: ${shownRun(r)}`);
    return { boxed, own };
  } finally {
    await w.stopHub();
  }
}

/** AC2: the run the scan read records its peak; the one in a sandbox of its own records none, never 0. */
function noPeakWhereUnread({ boxed, own }: Reading): void {
  const control = peakOf(boxed);
  const what = `the control, ${boxed.run}, ran in the supervisor's sandbox, where the scan reads its tree: its run.finished must record its peak in used.memory_peak_mb, at least ${MIB * 0.9} MB for the ${MIB} MiB it held: ${shownRun(boxed)}`;
  expect(control, what).toBeTypeOf('number');
  expect(control, what).toBeGreaterThanOrEqual(MIB * 0.9);
  const peak = own.used?.memory_peak_mb;
  expect(peak === undefined || peak === null, `${own.run} ran in a sandbox of its own, whose tree the scan can't read: it must record no peak (used.memory_peak_mb null or absent), never a number such as 0; it recorded ${JSON.stringify(peak)}: ${shownRun(own)}`).toBe(true);
}

describe(`${AC2} a tree the scan couldn't read records no peak, never zero`, () => {
  it(`${AC2} the same command in the supervisor's sandbox records its peak, and in a sandbox of its own records none`, async () => {
    noPeakWhereUnread(await twoRuns());
  }, 900_000);

  it(`${AC2} (wrong program ${PLANTS.unreadZero}) a record that writes 0 for the run it couldn't read fails`, async () => {
    const reading = await twoRuns(PLANTS.unreadZero);
    expect(reading.own.used?.memory_peak_mb, `${PLANTS.unreadZero}: the planted record must write 0 for ${reading.own.run}: ${shownRun(reading.own)}`).toBe(0);
    await mustFail(`${PLANTS.unreadZero} on AC2`, () => noPeakWhereUnread(reading), [reading.own.run]);
  }, 900_000);
});
