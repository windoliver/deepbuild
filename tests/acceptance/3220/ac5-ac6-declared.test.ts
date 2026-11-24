// #3220 AC5: a key with two clean runs is admitted on what its check declares; a planted admission on one run's peak
// fails, naming the key. AC6: a change to a check's inputs makes a new key, admitted on what the check declares until it
// has three clean runs of its own. One scenario serves both: in the sample repo, whose spec check `alloc` declares
// memory_mb: 900 and holds 480 MiB, one worktree's sessions claim one after another (each changes NOTES.md, which the
// check doesn't read, and stops). Claims 1 to 4 run the check on its key K1; then the check's inputs change (its
// test/alloc.json holds 240 MiB), and claims 5 to 8 run it on a new key K2. What each run was admitted on is its
// run.started's needs.memory_mb; its key is its run.finished's key.id (#1018); its peak, its run.finished's used.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC5, AC6, claimOnce, cleanup, mustFail, peakOf, PLANTS, runsIn, sampleFiles, shownRun, World, type RunRead } from './helpers.ts';

afterAll(cleanup, 120_000);

const DECLARED = 900;
const CHECK = 'alloc';
const notes = (n: number): string => `# notes\n\n- first\n- round ${n}\n`;

/** The check's runs, one per claim, in claim order; K1's first `k1` claims, then K2's `k2`. */
interface Reading { k1: RunRead[]; k2: RunRead[] }
async function claims(k1: number, k2: number, plant?: string): Promise<Reading> {
  const w = new World({ files: sampleFiles([{ name: CHECK, mib: 480, holdMs: 1500, memoryMb: DECLARED }]), worktrees: 1, memMb: 16_000, ...(plant ? { plant } : {}) });
  const tree = w.worktrees[0]!;
  await w.startHub();
  try {
    const runOf = async (n: number): Promise<RunRead> => {
      const { claim, events } = await claimOnce(w, tree, notes(n), [CHECK]);
      const runs = runsIn(events).filter((r) => r.claim === claim && r.check === CHECK);
      if (runs.length !== 1 || runs[0]!.outcome !== 'passed') throw Error(`BLOCKED: claim ${n} must run ${CHECK} once, and the run must pass (a clean run): ${runs.map(shownRun).join('; ') || 'no run'}`);
      return runs[0]!;
    };
    const first: RunRead[] = [];
    for (let n = 1; n <= k1; n++) first.push(await runOf(n));
    // The check's inputs change: the file it reads holds another size, in the worktree the next claims snapshot.
    if (k2) writeFileSync(join(tree, 'test', `${CHECK}.json`), `${JSON.stringify({ mib: 240, hold_ms: 1500 })}\n`);
    const second: RunRead[] = [];
    for (let n = k1 + 1; n <= k1 + k2; n++) second.push(await runOf(n));
    return { k1: first, k2: second };
  } finally {
    await w.stopHub();
  }
}
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
/** The key's peaks, each recorded on its run's end; a run that recorded none fails here, naming it. */
function peaks(runs: RunRead[], key: string): number[] {
  return runs.map((r) => {
    const p = peakOf(r);
    expect(p, `key ${key}: ${r.run}'s end must record its peak (used.memory_peak_mb) for the key's next runs to be admitted on: ${shownRun(r)}`).toBeTypeOf('number');
    return p!;
  });
}
/** Every run is on one key, which is returned. */
function oneKey(runs: RunRead[], what: string): string {
  const key = runs[0]!.key;
  expect(key, `${what}: ${runs[0]!.run}'s run.finished must name its key (#1018): ${shownRun(runs[0]!)}`).toBeTypeOf('string');
  for (const r of runs) expect(r.key, `${what}: each run must be on one key, ${key}: ${shownRun(r)}`).toBe(key);
  return key!;
}
/** A run with fewer than three clean runs on its key before it is admitted on the check's declared number. */
function onDeclared(r: RunRead, key: string, before: number): void {
  expect(r.needs, `key ${key} had ${before} clean run${before === 1 ? '' : 's'} when ${r.run} started: it must be admitted on what its check declares, memory_mb ${DECLARED} (run.started's needs.memory_mb): ${shownRun(r)}`).toBe(DECLARED);
}
/** A run whose key had three clean runs before it is admitted on their peaks' 95th percentile: between their median and their largest. */
function onPeaks(r: RunRead, key: string, ps: number[]): void {
  const lo = median(ps);
  const hi = Math.max(...ps) + 1;
  expect(r.needs, `key ${key} had three clean runs, peaking at ${ps.join(', ')} MB, when ${r.run} started: it must be admitted on their 95th percentile, between ${lo} and ${hi} MB (run.started's needs.memory_mb): ${shownRun(r)}`).toBeTypeOf('number');
  expect(r.needs! >= lo && r.needs! <= hi, `key ${key} had three clean runs, peaking at ${ps.join(', ')} MB, when ${r.run} started: it must be admitted on their 95th percentile, between ${lo} and ${hi} MB, not on ${r.needs}: ${shownRun(r)}`).toBe(true);
}

/** AC5: on K1, the first three runs (with 0, 1 and 2 clean runs before them) are each admitted on the declared 900. */
function declaredUntilThree({ k1 }: Reading): void {
  const key = oneKey(k1.slice(0, 3), 'AC5');
  k1.slice(0, 3).forEach((r, i) => onDeclared(r, key, i));
}
/**
 * AC6: K1's fourth run is admitted on K1's own peaks; the changed inputs make a new key K2, whose first three runs are
 * admitted on the declared 900 again, and its fourth on K2's own peaks.
 */
function newKeyStartsOver({ k1, k2 }: Reading): void {
  const one = oneKey(k1, 'AC6 before the change');
  onPeaks(k1[3]!, one, peaks(k1.slice(0, 3), one));
  const two = oneKey(k2, 'AC6 after the change');
  expect(two, `the change to the check's inputs (test/${CHECK}.json) must make a new key: ${k2[0]!.run} is on ${two}, the key the runs before the change were on`).not.toBe(one);
  k2.slice(0, 3).forEach((r, i) => onDeclared(r, two, i));
  onPeaks(k2[3]!, two, peaks(k2.slice(0, 3), two));
}

let shared: Promise<Reading> | undefined;
const eight = (): Promise<Reading> => (shared ??= claims(4, 4));

describe(`${AC5} a key with two clean runs is admitted on what its check declares`, () => {
  it(`${AC5} on a check declaring memory_mb ${DECLARED}, the key's runs with 0, 1 and 2 clean runs before them are each admitted on ${DECLARED}`, async () => {
    declaredUntilThree(await eight());
  }, 3_600_000);

  it(`${AC5} (wrong program ${PLANTS.onePeak}) an admission on one run's peak fails, naming the key`, async () => {
    const r = await claims(3, 0, PLANTS.onePeak);
    const p = peakOf(r.k1[0]!);
    expect(typeof p === 'number' && typeof r.k1[1]!.needs === 'number' && Math.abs(r.k1[1]!.needs - p) <= Math.max(2, p * 0.05), `${PLANTS.onePeak}: the planted admission must take the key's one clean run's peak, ${p}, for its second run: ${shownRun(r.k1[1]!)}`).toBe(true);
    await mustFail(`${PLANTS.onePeak} on AC5`, () => declaredUntilThree(r), [r.k1[0]!.key ?? 'the key']);
  }, 3_600_000);
});

describe(`${AC6} a change to a check's inputs makes a new key, admitted on what the check declares until it has three clean runs of its own`, () => {
  it(`${AC6} after the key's fourth run is admitted on its own peaks, a change to test/${CHECK}.json makes a new key whose first three runs are admitted on ${DECLARED} and its fourth on its own peaks`, async () => {
    newKeyStartsOver(await eight());
  }, 3_600_000);
});
