// AC12 #200.100d2ed4: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the seal's
// registry checks, for 10 registries of 100 entries with their kits, add under 5 ms at startup; resolving a pack
// entry by interned name takes under 1 µs; and nothing runs per frame"
//
// asserts: `core,test-registries-load` (test module test.load declaring ten registries of 100 entries each, with
// their kits and planted entries) lists them, and its `registry.seal.registries` ran once within `seal.ms`; on a fit
// reference Mac, five fresh processes after a warm-up here and on the merge base's `core` build: each `seal.ms` here
// within the merge base's median plus 5 ms, and each `seal.registries.ms` under 5 ms. In `core,test-mark` with
// test/testpack installed, `resolve` of testpack.ring through a board naming the pack with `runs: 1000` gives 1000
// lookup times; on the reference Mac five processes' medians are judged against 1,000 ns. Per frame (a count, so it
// runs everywhere): six frames at six times between two `registry` and `packs` calls leave `seal.runs` and
// `seal.registries.runs` at 1 with the same times, and the pack's check count at 1.
// Off a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal, load within the core count;
// mains power never gates) the timings skip as INCONCLUSIVE after their structural checks; none passes by skipping.

import { describe, expect, it } from 'vitest';
import {
  DOC, PACKS, TESTPACK, MARK, arr, baseBuild, board, environmentProblem, judgeRuns, listing, median, num, obj, packAt, packRow, present, rect, registry,
  registryChecks, resolveCall, run, scenario, settle, useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const LOAD: Build = { set: 'core', with: ['test-registries-load'] };
const MARKS: Build = { set: 'core', with: ['test-mark'] };
const builds = useBuilds([LOAD, MARKS]);
const evidence = useEvidence();
const LIMIT_MS = 5;
const LIMIT_NS = 1_000;
const RUNS = 1_000;

const sealOnce = (bin: string): ReturnType<typeof registry> => registry(run(bin, scenario(evidence(), [{ call: 'registry' }]))[0]!);
const fiveRuns = (bin: string): ReturnType<typeof registry>[] => { sealOnce(bin); return [0, 1, 2, 3, 4].map(() => sealOnce(bin)); };
const ringBoard = board('A ring', [packAt(TESTPACK)], [rect('frame', 'Frame', [0, 0, 640, 360], 'a0')]);
/** One process: the board naming the pack, then `runs` interned lookups of testpack.ring; their median in ns. */
function lookupMedian(bin: string): number {
  const [, resolved] = run(bin, scenario(evidence(), [present(DOC.a, ringBoard), resolveCall(DOC.a, MARK, 'testpack.ring', RUNS)], { packs: [TESTPACK] }));
  const ns = arr(resolved!['ns'], `resolve: ns (${RUNS} lookup times)`).map((n, i) => num(n, `resolve: ns[${i}]`));
  expect(ns.length, 'one time per lookup').toBe(RUNS);
  expect(obj(resolved!['entry'], 'resolve: entry')['name'], 'the lookups resolve testpack.ring').toBe('testpack.ring');
  return median(ns);
}

describe('AC12 #200.100d2ed4 budgets on the reference Mac against the merge base: registry checks at startup, pack entry lookups, nothing per frame', () => {
  it(`AC12 the seal's registry checks for 10 registries of 100 entries with their kits add under ${LIMIT_MS} ms at startup, compared with the merge base`, (ctx) => {
    const bin = builds.bin(LOAD);
    const load = listing(bin, evidence()).listed.filter((l) => l.kind === 'registry' && l.owner === 'test.load');
    expect(load.length, 'test.load declares ten registries').toBeGreaterThanOrEqual(10);
    for (const l of load) {
      expect((l.entries ?? []).length, `${l.name} holds 100 entries`).toBeGreaterThanOrEqual(100);
      expect([(l.kit ?? []).length > 0, (l.planted ?? []).length > 0], `${l.name} has its kit and a planted entry`).toEqual([true, true]);
    }
    const first = sealOnce(bin);
    const checks = registryChecks(first);
    expect(checks.runs, 'the seal ran its registry checks once at startup').toBe(1);
    expect(checks.ms, 'the registry checks are part of the seal\'s time').toBeLessThanOrEqual(first.seal.ms);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const base = baseBuild('core');
    const baseMedian = median(fiveRuns(base.bin).map((r) => r.seal.ms));
    const here = fiveRuns(bin);
    settle(ctx, [
      judgeRuns(`AC12 seal at startup with 10 × 100 entries (ms) against the merge base ${base.sha.slice(0, 12)}'s core median ${baseMedian.toFixed(3)} + ${LIMIT_MS}`, here.map((r) => r.seal.ms), baseMedian + LIMIT_MS),
      judgeRuns('AC12 the seal\'s registry checks alone (ms)', here.map((r) => registryChecks(r).ms), LIMIT_MS),
    ]);
  }, 7_200_000);

  it(`AC12 resolving a pack entry by interned name takes under ${LIMIT_NS} ns`, (ctx) => {
    const bin = builds.bin(MARKS);
    const first = lookupMedian(bin);
    expect(first, 'a lookup time is a positive number of ns').toBeGreaterThan(0);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, median ${first} ns): ${problem}`);
    const medians = [0, 1, 2, 3, 4].map(() => lookupMedian(bin));
    settle(ctx, [judgeRuns(`AC12 testpack.ring by interned name, median of ${RUNS} lookups per process (ns)`, medians, LIMIT_NS)]);
  }, 1_800_000);

  it('AC12 nothing runs per frame: after six frames at six times the seal and its registry checks have run once, with the same times, and the pack was checked once', () => {
    const frames: JsonObject[] = ['0s', '1s', '2s', '3s', '4s', '5s'].map((t) => present(DOC.a, ringBoard, { t }));
    const replies = run(builds.bin(MARKS), scenario(evidence(), [{ call: 'registry' }, PACKS, ...frames, { call: 'registry' }, PACKS], { packs: [TESTPACK] }));
    const before = registry(replies[0]!, 'the registry before the frames');
    const after = registry(replies[replies.length - 2]!, 'the registry after the frames');
    for (const [k, reply] of replies.slice(2, -2).entries()) expect(reply['outcome'], `frame ${k} is presented`).toBe('presented');
    expect([after.seal.runs, registryChecks(after).runs], 'the seal and its registry checks ran once, before the first document, never per frame').toEqual([1, 1]);
    expect([after.seal.ms, registryChecks(after).ms], 'their times are the startup\'s, unchanged by frames').toEqual([before.seal.ms, registryChecks(before).ms]);
    expect([packRow(replies[1]!, TESTPACK).checks, packRow(replies[replies.length - 1]!, TESTPACK).checks], 'the pack\'s entries were checked once, at its pack check, never per frame').toEqual([1, 1]);
  }, 600_000);
});
