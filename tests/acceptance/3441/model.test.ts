import { describe, expect, it } from 'vitest';
import { MODEL_KEEPS_A_TIME_THRESHOLD, TEST_DEADLINE_MS, play, presentedVsyncs, useShow } from './helpers.ts';
import { CAPS, RATES, SEEDS, everyNth, firstDifference, sideBySideFailures } from './judges.ts';

const show = useShow();
const EXACT_THEN_JITTERED: readonly (number | null)[] = [null, SEEDS[0]!];

describe('#3441 the model and the window\'s rule side by side on the virtual display clock', () => {
  it('AC4 #3441.e809f907 on the virtual display clock at 60 and at 120 Hz, the vsyncs the model opens and the ticks the window\'s rule presents are the same list under each cap, the ticks exactly at their latches and jittered; a planted model that keeps a time threshold differs at the first capped tick and fails', () => {
    const failures: string[] = [];
    for (const cap of CAPS) for (const hz of RATES) for (const seed of EXACT_THEN_JITTERED) {
      const played = play(show(), { hz, cap, seed, withModel: true });
      const allowed = played.vsyncs.filter((_, tick) => tick % everyNth(hz, cap) === 0);
      expect(played.model, `${played.what}: with something new at every latch the model opens every vsync its cap allows, each ${everyNth(hz, cap)} ticks from the last`).toEqual(allowed);
      failures.push(...sideBySideFailures(played.what, played.vsyncs, played.model!, presentedVsyncs(played)));
    }
    expect(failures, 'the vsyncs the model opens and the ticks the window\'s rule presents, side by side').toEqual([]);

    for (const hz of RATES) {
      const twin = play(show(), { hz, cap: 'thermal', seed: null, withModel: true, planted: MODEL_KEEPS_A_TIME_THRESHOLD });
      const window = presentedVsyncs(twin);
      const failed = sideBySideFailures(twin.what, twin.vsyncs, twin.model!, window);
      const difference = firstDifference(twin.model!, window);
      const firstCappedTick = everyNth(hz, 'thermal');
      expect(failed.length, `the planted ${MODEL_KEEPS_A_TIME_THRESHOLD} fails at ${hz} Hz under the thermal cap: its vsyncs are not the window's ticks`).toBe(1);
      expect({ entry: difference?.entry, window: difference?.window }, `the planted ${MODEL_KEEPS_A_TIME_THRESHOLD} differs at the first capped tick, tick ${firstCappedTick} at ${hz} Hz, the second entry of both lists: ${failed[0]}`).toEqual({ entry: 1, window: twin.vsyncs[firstCappedTick] });
      expect(failed[0], 'the failure says where the lists differ').toContain(`differ first at entry 1: the model opens ${difference?.model === null ? 'nothing' : `the vsync ${difference?.model}`}`);
      expect(failed[0], 'the failure names the first capped tick').toContain(`where the window's rule presents the vsync ${twin.vsyncs[firstCappedTick]} (tick ${firstCappedTick})`);
    }
  }, TEST_DEADLINE_MS);
});
