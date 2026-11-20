// #2365 AC1: "A Claude Code transcript of 100 MB, 94% of it tool results with one line of 2 MB, already archived,
// gains 1 MB. The pass that follows adds under 2 MB to the evidence store, ends within 1 s, raises the process's
// resident memory by under 64 MB, and the process serves a 5 ms timer at least every 50 ms throughout (the three
// limits are drafted). On the merge base the same pass takes 5.8 s or more, serves no timer for up to 1.2 s, peaks
// above 800 MB and stores a whole copy. A planted archive that reads the file whole fails, naming the peak."
//
// Heavy: run by hand or in the budget window (README, How to run), never in the unit lane. The setup: the fixture
// (probe/fixture.mjs) written to 100,000,000 bytes in whole turns, archived by one pass in a child; then 1,000,000
// bytes more appended. That home is the snapshot. Each run clones it and runs the pass that follows in a fresh child
// (probe/pass.mjs), which the archive opens as the hub does at its start; one warm-up run, then five.
//
// Judged: the evidence bytes added, on every run, on any machine (bytes, not a time or memory budget); the pass's
// time, its longest stretch with the 5 ms timer unserved, and its rise in resident memory, by the perf lane's judge
// on the five runs (PASS on a reference Mac in a fit state when all five are within; FAIL when all five are over by
// more than the margin; otherwise INCONCLUSIVE, which fails this test as not a pass). The limits are the issue's: 1 s,
// 50 ms, 64 MB (64,000,000 bytes) and 2 MB (2,000,000 bytes). The first run's copy is also checked: its parts joined
// equal the transcript scrubbed a line at a time, and the last message gained resolves.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectCopy, HOUR, openWorld, removeTemps, resolved, scrubbedByLine, scrubText, T0, tempDir } from '../helpers.ts';
import { cloneHome, fixture, judgeAll, mb, MB, measuredPass, needBuild, transcriptPath, TWIN_WHOLE, type Meta, type PassResult } from './run.ts';

afterAll(removeTemps);

const AC1 = '#2365 AC1';
const ID = '2365a001-0000-4000-a000-000000000100';
const LIMITS = { ms: 1000, gapMs: 50, rise: 64 * MB, added: 2 * MB };
let dir = '';
let snapshot = '';
let meta: Meta;

beforeAll(async () => {
  needBuild();
  dir = tempDir('ac1');
  snapshot = join(dir, 'snapshot');
  const first = fixture('write', transcriptPath(snapshot, ID), 100 * MB);
  expect(first.bytes, 'the transcript is 100 MB').toBeGreaterThanOrEqual(100 * MB);
  expect(first.toolShare, `94% of it tool results (${(first.toolShare * 100).toFixed(2)}%)`).toBeGreaterThanOrEqual(0.935);
  expect(first.toolShare).toBeLessThanOrEqual(0.95);
  expect(first.longest, 'one line of 2 MB').toBeGreaterThanOrEqual(2 * MB);
  const setup = await measuredPass(snapshot, 'pass', T0);
  console.log(`${AC1} setup: the first copy of 100 MB: ${setup.ms.toFixed(0)} ms, longest unserved stretch ${setup.maxGapMs.toFixed(0)} ms, peak ${mb(setup.peakRss)}, evidence +${mb(setup.added)}`);
  expect(setup.error, `BLOCKED: the 100 MB transcript must be archived before it gains 1 MB: ${setup.error}`).toBeNull();
  meta = fixture('append', transcriptPath(snapshot, ID), MB);
  expect(meta.bytes - first.bytes, 'it gains 1 MB').toBeGreaterThanOrEqual(MB);
}, 3_600_000);

/** One warm-up and five runs of the pass that follows, each on a clone of the snapshot. */
async function runs(archive?: string, check?: (home: string) => Promise<void>): Promise<PassResult[]> {
  const out: PassResult[] = [];
  for (let k = 0; k < 6; k++) {
    const home = join(dir, `run-${archive ? 'twin' : 'real'}-${k}`);
    cloneHome(snapshot, home);
    try {
      const r = await measuredPass(home, 'pass', T0 + HOUR, archive ? { archive } : {});
      out.push(r);
      console.log(`${AC1} ${archive ? 'twin' : 'archive'} run ${k}${k ? '' : ' (warm-up)'}: ${r.ms.toFixed(0)} ms, longest unserved stretch ${r.maxGapMs.toFixed(1)} ms, peak resident memory ${mb(r.peakRss)} from ${mb(r.rssStart)} (+${mb(r.rise)}), evidence +${mb(r.added)}${r.error ? `, error: ${r.error}` : ''}`);
      if (k === 1 && check) await check(home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
  return out;
}
/** The criterion's check on six runs (the first a warm-up): throws naming each reading that misses. */
async function criterion(all: PassResult[]): Promise<void> {
  const problems: string[] = [];
  const errors = all.filter((r) => r.error).map((r) => r.error);
  if (errors.length) problems.push(`FAIL: ${AC1} every pass ends without an error, but ${errors.length} didn't: ${errors[0]}`);
  if (all.some((r) => r.added >= LIMITS.added)) problems.push(`FAIL: ${AC1} each pass adds under 2 MB to the evidence store; evidence added per run: ${all.map((r) => mb(r.added)).join(', ')}`);
  const five = all.slice(1);
  try {
    await judgeAll([
    { name: `${AC1} the pass ends within 1 s`, limit: LIMITS.ms, runs: five.map((r) => r.ms), shown: five.map((r) => `${r.ms.toFixed(0)} ms`) },
    { name: `${AC1} the 5 ms timer is served at least every 50 ms`, limit: LIMITS.gapMs, runs: five.map((r) => r.maxGapMs), shown: five.map((r) => `longest unserved stretch ${r.maxGapMs.toFixed(1)} ms`) },
    { name: `${AC1} resident memory rises by under 64 MB`, limit: LIMITS.rise, runs: five.map((r) => Math.max(0, r.rise)), shown: five.map((r) => `peak resident memory ${mb(r.peakRss)} from ${mb(r.rssStart)}: +${mb(r.rise)}`) },
    ], five.map((r) => r.load));
  } catch (error) {
    problems.push((error as Error).message);
  }
  if (problems.length) expect.fail(problems.join(' | '));
}

describe(`${AC1} a 100 MB transcript, already archived, gains 1 MB: the pass that follows costs what was added`, () => {
  it(`${AC1} the pass that follows: under 2 MB of evidence, within 1 s, under 64 MB more resident memory, a 5 ms timer served at least every 50 ms`, async () => {
    const all = await runs(undefined, async (home) => {
      const w = await openWorld({ home });
      try {
        await expectCopy(w, ID, () => scrubbedByLine(transcriptPath(home, ID)), `${AC1} the copy after the pass that follows`);
        expect(await resolved(w, ID, meta.last.uuid), `${AC1} session:<id>#${meta.last.uuid}, the last message gained, resolves`).toBe(scrubText(meta.last.text));
      } finally {
        await w.close();
      }
    });
    await criterion(all);
  }, 3_600_000);

  it(`${AC1} (wrong program) an archive that reads the file whole fails, naming the peak`, async () => {
    const all = await runs(TWIN_WHOLE);
    expect(all.filter((r) => r.rise < LIMITS.rise).map((r) => `+${mb(r.rise)}`), 'every run of the twin raises resident memory by 64 MB or more').toEqual([]);
    await expect(criterion(all), 'the criterion fails on the twin, naming the peak').rejects.toThrow(/peak resident memory \d+\.\d MB/);
  }, 3_600_000);
});
