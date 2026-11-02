// #185.5d087cb0: budgets, on the reference Mac in the local preflight, compared with the merge base: the seal's
// interface checks add under 5 ms at startup; and nothing runs per frame.
// Startup: the R2 build's `registry.seal.ms` (registration and the seal, #305) in five fresh processes after a
// warm-up, on this checkout and on its merge base (exported with `git archive` into target/acceptance-185-base/
// and built apart); each run here must be within the merge base's median plus 5 ms, and the interface checks'
// own time (`registry.seal.interfaces.ms`) under 5 ms, both judged by the design's rule. Off a reference Mac
// (Mac15,7 or Mac15,12, on mains power, Low Power Mode off, thermal state nominal) or loaded past its core count,
// the timing skips as INCONCLUSIVE after its structural checks; it never passes by skipping.
// Per frame: six frames at six times leave the seal and its interface checks run once, with the same times. That
// is a count, not a timing, so it runs everywhere.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTo, environmentProblem, frameAt, interfaceChecks, judgeRuns, median, mergeBase, mergeBaseCheckout, registry, run, scenario, settle, useBuilds,
  useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const R2: Build = { set: 'r2' };
const LIMIT_MS = 5;
const builds = useBuilds([R2]);
const evidence = useEvidence();

/** One fresh process's `registry`. */
const sealOnce = (bin: string): ReturnType<typeof registry> => registry(run(bin, scenario(evidence(), [{ call: 'registry' }]))[0]!);
/** A warm-up, then five fresh processes. */
const fiveRuns = (bin: string): ReturnType<typeof registry>[] => { sealOnce(bin); return [0, 1, 2, 3, 4].map(() => sealOnce(bin)); };

describe('#185.5d087cb0 budgets on the reference Mac against the merge base: the seal\'s interface checks add under 5 ms at startup, and nothing runs per frame', () => {
  it(`#185.5d087cb0 the seal's interface checks add under ${LIMIT_MS} ms at startup to the R2 build, compared with the merge base (five fresh processes after a warm-up)`, (ctx) => {
    const bin = builds.bin(R2);
    const first = sealOnce(bin);
    const checks = interfaceChecks(first);
    expect(checks.runs, 'the seal ran its interface checks once at startup').toBe(1);
    expect(checks.ms, 'the interface checks are part of the seal\'s time').toBeLessThanOrEqual(first.seal.ms);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const base = mergeBase();
    const baseDir = mergeBaseCheckout(base);
    const baseBin = join(baseDir, 'deep-show-r2');
    expect(buildTo(baseDir, ['r2'], false, baseBin, { CARGO_TARGET_DIR: join(baseDir, 'target') }), `the merge base ${base.slice(0, 12)}'s R2 build compiles in ${baseDir}`).toBe('');
    const baseMedian = median(fiveRuns(baseBin).map((r) => r.seal.ms));
    const here = fiveRuns(bin);
    settle(ctx, [
      judgeRuns(`#185.5d087cb0 R2 seal at startup (ms) against the merge base ${base.slice(0, 12)}'s median ${baseMedian.toFixed(3)} + ${LIMIT_MS}`, here.map((r) => r.seal.ms), baseMedian + LIMIT_MS),
      judgeRuns('#185.5d087cb0 R2 seal\'s interface checks alone (ms)', here.map((r) => interfaceChecks(r).ms), LIMIT_MS),
    ]);
  }, 7_200_000);

  it('#185.5d087cb0 nothing runs per frame: after six frames at six times the seal and its interface checks have still run once, with the same times', () => {
    const frames = ['0s', '1s', '2s', '3s', '4s', '5s'].map(frameAt);
    const replies = run(builds.bin(R2), scenario(evidence(), [{ call: 'registry' }, ...frames, { call: 'registry' }]));
    const before = registry(replies[0]!, 'the registry before the frames');
    const after = registry(replies[replies.length - 1]!, 'the registry after the frames');
    for (const [k, reply] of replies.slice(1, -1).entries()) expect((reply as JsonObject)['outcome'], `frame ${k} is presented`).toBe('presented');
    expect([after.seal.runs, interfaceChecks(after).runs], 'the seal and its interface checks ran once, before the first document, never per frame').toEqual([1, 1]);
    expect([after.seal.ms, interfaceChecks(after).ms], 'their times are the startup\'s, unchanged by frames').toEqual([before.seal.ms, interfaceChecks(before).ms]);
  }, 600_000);
});
