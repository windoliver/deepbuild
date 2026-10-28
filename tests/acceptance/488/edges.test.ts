// #488.75ff3f37: at 240000/1001 fps, t = 2^62 flicks gives frame ⌊2^62 ÷ 2,942,940⌋ and t = −1 gives
// frame −1; a planted i64 product overflows on the first and a truncating division gives 0 on the
// second, each failing. The `rate` call (README) converts in integers: the product of a flick count
// and a rate in i128, the division Euclidean (Time and the flick: Conversions). 2^62 is past 2^53, so
// that scenario line is written as text (`rawScenario`). The wrong programs: the base (no `rate` call),
// the planted `frame_index_i64_product` (t × p in i64 wraps at 2^62 × 240000) and the planted
// `frame_index_truncating_division` (−1 ÷ Δ truncates toward 0).
import { describe, expect, it } from 'vitest';
import { FULL, frameRate, indexFailures, rawScenario, run, scenario, tryRun, useBuilds, useEvidence, validLength, type JsonObject } from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const RATE: [number, number] = [240000, 1001];
/** 705,600,000 × 1001 ÷ 240000. */
const FRAME = 2_942_940;
const T62 = 1n << 62n;
const T62_TEXT = T62.toString();
/** ⌊2^62 ÷ 2,942,940⌋ = 1,567,033,652,887, below 2^53, so the reply carries it as a JSON number. */
const INDEX_62 = Number(T62 / BigInt(FRAME));
const MARK = '<<<T62>>>';

/** Both edges in one scenario: t = 2^62 (as text) and t = −1. */
const edges = (ev: string, planted?: string) => rawScenario(scenario(ev, [frameRate(RATE), frameRate(RATE, { t: MARK }), frameRate(RATE, { t: -1 }), frameRate(RATE, { t: -FRAME }), frameRate(RATE, { t: -FRAME - 1 })], planted ? { planted } : {}), { [MARK]: T62_TEXT });

/** The check both planted programs must fail: the index at 2^62 and at −1, each failure naming the time. */
function edgeFailures(replies: JsonObject[] | null): string[] {
  return [
    ...indexFailures(replies?.[1], `2^62 (${T62_TEXT})`, INDEX_62, 'at 240000/1001 fps'),
    ...indexFailures(replies?.[2], '-1', -1, 'at 240000/1001 fps'),
  ];
}

describe('#488.75ff3f37 at 240000/1001 fps, t = 2^62 gives frame ⌊2^62 ÷ 2,942,940⌋ and t = −1 gives frame −1; a planted i64 product and a planted truncating division each fail', () => {
  it('#488.75ff3f37 the frame at 240000/1001 fps is 2,942,940 flicks; t = 2^62 gives frame 1,567,033,652,887; t = −1 gives frame −1; −Δ gives −1 and −Δ − 1 gives −2', () => {
    expect(INDEX_62).toBe(1_567_033_652_887);
    expect(T62 % BigInt(FRAME) !== 0n, '2^62 is not on the frame grid, so the floor matters').toBe(true);
    const replies = run(builds.bin(FULL), edges(evidence()));
    expect(validLength(replies[0]!, '240000/1001 fps'), 'the whole-flick frame').toBe(FRAME);
    expect(edgeFailures(replies), 'both edges are exact').toEqual([]);
    expect(indexFailures(replies[3], '-2942940', -1, 'at 240000/1001 fps'), 'a time on the grid before the start is its own frame').toEqual([]);
    expect(indexFailures(replies[4], '-2942941', -2, 'at 240000/1001 fps'), 'one flick before that floors toward −∞').toEqual([]);
  }, 600_000);

  it('#488.75ff3f37 a planted i64 product (frame_index_i64_product) overflows at t = 2^62 and fails, naming the time', () => {
    // The planted program is a program: it answers a rate within i64 before it fails the edge (a crash on the overflow counts as its failure, not a missing program).
    expect(validLength(run(builds.bin(FULL), scenario(evidence(), [frameRate(RATE, { k: 1 })], { planted: 'frame_index_i64_product' }))[0]!, 'the planted product at 240000/1001'), 'answers the frame').toBe(FRAME);
    const failures = edgeFailures(tryRun(builds.bin(FULL), edges(evidence(), 'frame_index_i64_product')));
    expect(failures.length, 'the planted product fails the check').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure is at 2^62').toContain(T62_TEXT);
  }, 600_000);

  it('#488.75ff3f37 a planted truncating division (frame_index_truncating_division) gives frame 0 at t = −1 and fails, naming the time', () => {
    expect(validLength(run(builds.bin(FULL), scenario(evidence(), [frameRate(RATE, { k: 1 })], { planted: 'frame_index_truncating_division' }))[0]!, 'the planted division at 240000/1001'), 'answers the frame').toBe(FRAME);
    const failures = edgeFailures(tryRun(builds.bin(FULL), edges(evidence(), 'frame_index_truncating_division')));
    expect(failures.length, 'the planted division fails the check').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure is at −1').toMatch(/t = -1 gave frame 0|t = -1 (was not answered|gave no integer)/);
  }, 600_000);
});
