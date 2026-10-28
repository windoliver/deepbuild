// #488.12324609: 8, 12 and 16 fps and their ×1000/1001 forms have whole-flick frames (88,200,000,
// 58,800,000 and 44,100,000 flicks at the integer rates) and round-trip frame to flicks to frame exactly.
// The `rate` call (README) answers a frame rate's whole-flick frame, frame k's flicks and a time's frame
// index, in integers. The wrong programs: the base (no `rate` call), a rate table kept in seconds as a
// float (a ×1000/1001 frame rounds), and a conversion through f64 that loses a flick at large k.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FLICKS, FULL, frameRate, frameRateText, int, outcome, rateReply, run, scenario, useBuilds, useEvidence, validLength, type JsonObject } from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** The fast-check seed of the generated round trips, recorded so a failure replays. */
const SEED = 488_0001;

/** The six rates and their whole-flick frames: 705,600,000 × q ÷ p. */
const RATES: { rate: [number, number]; frame: number }[] = [
  { rate: [8, 1], frame: 88_200_000 },
  { rate: [12, 1], frame: 58_800_000 },
  { rate: [16, 1], frame: 44_100_000 },
  { rate: [8000, 1001], frame: 88_288_200 },
  { rate: [12000, 1001], frame: 58_858_800 },
  { rate: [16000, 1001], frame: 44_144_100 },
];

/** Round-trip calls for frame k at a rate: k → flicks, and the index at k·Δ, k·Δ − 1 and k·Δ + 1. */
function roundTrip(rate: [number, number], frame: number, k: number): JsonObject[] {
  const t = k * frame;
  expect(Number.isSafeInteger(t), `k·Δ = ${t} stays below 2^53`).toBe(true);
  return [frameRate(rate, { k }), frameRate(rate, { t }), frameRate(rate, { t: t - 1 }), frameRate(rate, { t: t + 1 })];
}
/** The four replies of one round trip, each failure naming the rate and k. */
function roundTripFailures(replies: JsonObject[], rate: [number, number], frame: number, k: number): string[] {
  const name = frameRateText(rate);
  const failures: string[] = [];
  const [toFlicks, atK, before, after] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
  const value = (r: JsonObject, field: string): number | null => (typeof r[field] === 'number' && Number.isSafeInteger(r[field]) ? (r[field] as number) : null);
  if (outcome(toFlicks) !== 'valid' || value(toFlicks, 't') !== k * frame) failures.push(`${name}: frame ${k} gave ${JSON.stringify(toFlicks['t'])} flicks, not ${k * frame}`);
  if (outcome(atK) !== 'valid' || value(atK, 'index') !== k) failures.push(`${name}: ${k * frame} flicks (k·Δ) gave frame ${JSON.stringify(atK['index'])}, not ${k}`);
  if (outcome(before) !== 'valid' || value(before, 'index') !== k - 1) failures.push(`${name}: ${k * frame - 1} flicks (k·Δ − 1) gave frame ${JSON.stringify(before['index'])}, not ${k - 1}`);
  if (outcome(after) !== 'valid' || value(after, 'index') !== k) failures.push(`${name}: ${k * frame + 1} flicks (k·Δ + 1) gave frame ${JSON.stringify(after['index'])}, not ${k}`);
  return failures;
}

describe('#488.12324609 8, 12 and 16 fps and their ×1000/1001 forms have whole-flick frames and round-trip frame to flicks to frame exactly', () => {
  it('#488.12324609 the six rates are valid with frames of 88,200,000, 58,800,000, 44,100,000, 88,288,200, 58,858,800 and 44,144,100 flicks', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), RATES.map((r) => frameRate(r.rate))));
    for (const [i, r] of RATES.entries()) {
      const name = frameRateText(r.rate);
      expect(validLength(replies[i]!, `${name} fps`), `${name} fps has a frame of ${r.frame} flicks (705,600,000 × ${r.rate[1]} ÷ ${r.rate[0]})`).toBe(r.frame);
      expect(rateReply(replies[i]!, name).rate, 'the reply names the rate').toBe(name);
      expect(FLICKS * r.rate[1], 'the table itself: the frame is whole').toBe(r.frame * r.rate[0]);
    }
  }, 600_000);

  it('#488.12324609 frames 0, 1, 195, 2^20 and −7 round-trip exactly at every rate: frame(k·Δ) = k, frame(k·Δ − 1) = k − 1, frame(k·Δ + 1) = k', () => {
    const ks = [0, 1, 195, 2 ** 20, -7];
    const calls: JsonObject[] = [];
    for (const r of RATES) for (const k of ks) calls.push(...roundTrip(r.rate, r.frame, k));
    const replies = run(builds.bin(FULL), scenario(evidence(), calls));
    const failures: string[] = [];
    let i = 0;
    for (const r of RATES) for (const k of ks) { failures.push(...roundTripFailures(replies.slice(i, i + 4), r.rate, r.frame, k)); i += 4; }
    expect(failures, 'every round trip is exact').toEqual([]);
    // Spot values: frame 195 at 8 fps is 17,199,000,000 flicks; at 16000/1001 fps it is 8,608,099,500.
    expect(int(replies[RATES.findIndex((r) => r.rate[0] === 8 && r.rate[1] === 1) * ks.length * 4 + 2 * 4]!['t'], 'frame 195 at 8 fps')).toBe(17_199_000_000);
    expect(int(replies[RATES.findIndex((r) => r.rate[0] === 16000) * ks.length * 4 + 2 * 4]!['t'], 'frame 195 at 16000/1001 fps')).toBe(8_608_099_500);
  }, 600_000);

  it(`#488.12324609 generated frames k in [−2^26, 2^26] at the six rates round-trip exactly (fast-check seed ${SEED}, 8 runs of up to 40 cases)`, () => {
    const bin = builds.bin(FULL);
    const cases = fc.array(fc.record({ rate: fc.constantFrom(...RATES), k: fc.integer({ min: -(2 ** 26), max: 2 ** 26 }) }), { minLength: 1, maxLength: 40 });
    fc.assert(
      fc.property(cases, (list) => {
        const calls: JsonObject[] = [];
        for (const c of list) calls.push(...roundTrip(c.rate.rate, c.rate.frame, c.k));
        const replies = run(bin, scenario(evidence(), calls));
        const failures: string[] = [];
        for (const [i, c] of list.entries()) failures.push(...roundTripFailures(replies.slice(i * 4, i * 4 + 4), c.rate.rate, c.rate.frame, c.k));
        expect(failures, 'every generated round trip is exact').toEqual([]);
      }),
      { seed: SEED, numRuns: 8, endOnFailure: true },
    );
  }, 1_200_000);
});
