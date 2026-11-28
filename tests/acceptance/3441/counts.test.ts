import { describe, expect, it } from 'vitest';
import { MERGE_BASE_RULE, TEST_DEADLINE_MS, play, useShow, type Planted } from './helpers.ts';
import {
  FRAMES_OF_600_TICKS, MERGE_BASE_FRAMES_OF_600_EXACT_TICKS_UNDER_THE_THERMAL_CAP, RATES, SEEDS, countFailures, framesOf, gapFailures, seedFailures,
  type CapName, type Rate, type Seeded,
} from './judges.ts';

const show = useShow();
const planting = (planted?: Planted): { planted?: Planted } => (planted ? { planted } : {});
const seededPlays = (cap: CapName, hz: Rate, planted?: Planted): Seeded[] => SEEDS.map((seed) => ({ seed, play: play(show(), { hz, cap, seed, ...planting(planted) }) }));
const at = (hz: Rate) => (failure: string): boolean => failure.includes(`at ${hz} Hz`);

describe('#3441 a capped window presents a whole number of its display\'s ticks apart, exactly spaced and jittered', () => {
  it('AC1 #3441.fe33f0e7 under the thermal cap, 600 ticks exactly 1/60 s apart present 600 frames and 600 ticks 1/120 s apart present 300; the merge base\'s rule, planted, presents 300 and 200 and fails, naming both counts', () => {
    const failures = (planted?: Planted): string[] => RATES.flatMap((hz) => countFailures(play(show(), { hz, cap: 'thermal', seed: null, ...planting(planted) }), FRAMES_OF_600_TICKS.thermal[hz]));
    expect(failures(), 'the frames 600 exactly spaced ticks present under the thermal cap').toEqual([]);
    const failed = failures(MERGE_BASE_RULE);
    for (const hz of RATES) {
      const count = `presented ${MERGE_BASE_FRAMES_OF_600_EXACT_TICKS_UNDER_THE_THERMAL_CAP[hz]} frames, not ${FRAMES_OF_600_TICKS.thermal[hz]}`;
      expect(failed.filter(at(hz)).some((failure) => failure.includes(count)), `the planted ${MERGE_BASE_RULE} fails at ${hz} Hz, naming its count (${count}): ${JSON.stringify(failed)}`).toBe(true);
    }
  }, TEST_DEADLINE_MS);

  it('AC2 #3441.84feca42 the same two runs with each tick moved by a seeded offset of up to 200 µs either way present 600 and 300 for every seed, and no two presented frames are further apart than one cap period plus one refresh; the planted rule\'s counts differ between two seeds and fail', () => {
    const failures = (planted?: Planted): string[] => RATES.flatMap((hz) => {
      const seeded = seededPlays('thermal', hz, planted);
      return [...seedFailures(`under the thermal cap at ${hz} Hz${planted ? ` (planted ${planted})` : ''}`, seeded, FRAMES_OF_600_TICKS.thermal[hz]), ...seeded.flatMap((one) => gapFailures(one.play))];
    });
    expect(failures(), 'the frames 600 jittered ticks present under the thermal cap, seed by seed, and their gaps').toEqual([]);
    const failed = failures(MERGE_BASE_RULE);
    for (const hz of RATES) {
      expect(failed.filter(at(hz)).some((failure) => failure.includes('the counts differ between seeds')), `the planted ${MERGE_BASE_RULE} fails at ${hz} Hz with counts that differ between two seeds, naming both: ${JSON.stringify(failed.slice(0, 12))}`).toBe(true);
      expect(failed.filter(at(hz)).some((failure) => failure.includes('past one cap period plus one refresh')), `the planted ${MERGE_BASE_RULE} fails the gap bound at ${hz} Hz: ${JSON.stringify(failed.slice(0, 12))}`).toBe(true);
    }
  }, TEST_DEADLINE_MS);

  it('AC3 #3441.5ba15fef for a window that isn\'t active, 600 ticks at 60 Hz present 300 frames and 600 ticks at 120 Hz present 150, exactly spaced and jittered; the planted rule, jittered, presents fewer and fails, naming its longest gap', () => {
    const exact = RATES.flatMap((hz) => {
      const played = play(show(), { hz, cap: 'inactive', seed: null });
      return [...countFailures(played, FRAMES_OF_600_TICKS.inactive[hz]), ...gapFailures(played)];
    });
    const jittered = (planted?: Planted): string[] => RATES.flatMap((hz) => {
      const seeded = seededPlays('inactive', hz, planted);
      return [...seedFailures(`under the inactive cap at ${hz} Hz${planted ? ` (planted ${planted})` : ''}`, seeded, FRAMES_OF_600_TICKS.inactive[hz]), ...seeded.flatMap((one) => gapFailures(one.play))];
    });
    expect([...exact, ...jittered()], 'the frames 600 ticks present for a window that isn\'t active, exactly spaced and jittered, and their gaps').toEqual([]);
    const failed = jittered(MERGE_BASE_RULE);
    for (const hz of RATES) {
      const frames = seededPlays('inactive', hz, MERGE_BASE_RULE).map((one) => framesOf(one.play));
      expect(frames.filter((count) => count >= FRAMES_OF_600_TICKS.inactive[hz]), `the planted ${MERGE_BASE_RULE}, jittered, presents fewer than ${FRAMES_OF_600_TICKS.inactive[hz]} frames at ${hz} Hz for every seed; it presented ${JSON.stringify(frames)}`).toEqual([]);
      expect(failed.filter(at(hz)).some((failure) => failure.includes('its longest gap between two presented frames is')), `the planted ${MERGE_BASE_RULE}, jittered, fails at ${hz} Hz, naming its longest gap: ${JSON.stringify(failed.slice(0, 12))}`).toBe(true);
    }
  }, TEST_DEADLINE_MS);
});
