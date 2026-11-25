// #3220 AC1: a fixture run whose child allocates 600 MB, holds it for 2 s and exits records a peak within 10% of 600 MB,
// and CPU seconds within 20% of what the child reports for itself; a planted scan that keeps its first sample records
// under 100 MB and fails, naming the run. The run is the hub's (`run.start` on its socket, as `deep` starts one): the
// supervisor starts it in its sandbox and scans its tree, and its run.finished records what it used (README).
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, allocBinary, claimHandle, cleanup, finishedRun, mustFail, NO_COMMIT, PLANTS, shownRun, World, type RunRead } from './helpers.ts';

afterAll(cleanup, 120_000);

const MIB = 600;
/** The child waits 3 s before it allocates, so a scan's first sample comes before any of its memory, on a loaded machine too. */
const WAIT_MS = 3000;
const CPU_MS = 1500;
const HOLD_MS = 2000;

interface Reading { r: RunRead; child: { mib: number; cpu_s: number } }
/** The fixture run through a hub with `plant`: its run.finished, and what the child read of itself. */
async function fixtureRun(plant?: string): Promise<Reading> {
  const w = new World({ memMb: 16_000, ...(plant ? { plant } : {}) });
  const bin = allocBinary();
  const dir = join(w.tmp, 'run');
  mkdirSync(dir);
  await w.startHub();
  try {
    const { run } = await w.control('run.start', {
      check: 'alloc', claim: claimHandle(), commit: NO_COMMIT, argv: [bin, 'parent', dir, String(MIB), String(WAIT_MS), String(CPU_MS), String(HOLD_MS)], cwd: dir,
      grant: { read: [dirname(bin)], write: [dir] },
    });
    const r = await finishedRun(w, String(run));
    let child: Reading['child'];
    try {
      child = JSON.parse(readFileSync(join(dir, 'child.json'), 'utf8')) as Reading['child'];
    } catch {
      throw Error(`BLOCKED: the fixture's child wrote no reading of itself, so the run never did what the criterion needs: ${shownRun(r)}`);
    }
    if (r.outcome !== 'passed') throw Error(`BLOCKED: the fixture run must end passed (exit 0): ${shownRun(r)}`);
    return { r, child };
  } finally {
    await w.stopHub();
  }
}

/** AC1: the run's end records a peak within 10% of 600 MB and CPU seconds within 20% of the child's own. */
function recordsPeakAndCpu({ r, child }: Reading): void {
  const used = r.finished!.data.used;
  expect(used, `${r.run}'s run.finished must record what it used as used: {memory_peak_mb, cpu_s}: ${shownRun(r)}`).toBeTypeOf('object');
  const peak = used.memory_peak_mb;
  expect(peak, `${r.run}'s used.memory_peak_mb must be a number of MB: ${shownRun(r)}`).toBeTypeOf('number');
  expect(peak, `${r.run} held ${MIB} MiB in its child for ${HOLD_MS} ms: its recorded peak, ${peak} MB, must be within 10% of ${MIB}`).toBeGreaterThanOrEqual(MIB * 0.9);
  expect(peak, `${r.run} held ${MIB} MiB in its child for ${HOLD_MS} ms: its recorded peak, ${peak} MB, must be within 10% of ${MIB}`).toBeLessThanOrEqual(MIB * 1.1);
  const cpu = used.cpu_s;
  expect(cpu, `${r.run}'s used.cpu_s must be a number of CPU seconds: ${shownRun(r)}`).toBeTypeOf('number');
  expect(Math.abs(cpu - child.cpu_s), `${r.run}'s recorded CPU, ${cpu} s, must be within 20% of the ${child.cpu_s.toFixed(3)} s its child read of itself`).toBeLessThanOrEqual(child.cpu_s * 0.2);
}

describe(`${AC1} a run's end records the peak and CPU seconds the supervisor's scan read over its tree`, () => {
  it(`${AC1} a child that allocates ${MIB} MB, holds it ${HOLD_MS / 1000} s and exits: a peak within 10% of ${MIB} MB, CPU within 20% of the child's own`, async () => {
    recordsPeakAndCpu(await fixtureRun());
  }, 900_000);

  it(`${AC1} (wrong program ${PLANTS.firstSample}) a scan that keeps its first sample records under 100 MB and fails, naming the run`, async () => {
    const reading = await fixtureRun(PLANTS.firstSample);
    const peak = reading.r.used?.memory_peak_mb;
    expect(typeof peak === 'number' && peak < 100, `${PLANTS.firstSample}: the planted scan must record the first sample, taken before the child allocated, under 100 MB: ${shownRun(reading.r)}`).toBe(true);
    await mustFail(`${PLANTS.firstSample} on AC1`, () => recordsPeakAndCpu(reading), [reading.r.run]);
  }, 900_000);
});
