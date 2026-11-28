import { describe, expect, it } from 'vitest';
import { MERGE_BASE_RULE, TEST_DEADLINE_MS, play, useShow, type Planted } from './helpers.ts';
import { RATES, SEEDS, TICKS, everyTickFailures } from './judges.ts';

const show = useShow();
const EXACT_THEN_JITTERED: readonly (number | null)[] = [null, SEEDS[0]!];

describe('#3441 a window under no cap', () => {
  it('AC6 #3441.e80d0654 a window under no cap presents on every one of 600 ticks at 60 and at 120 Hz, exactly spaced and jittered, as the merge base\'s rule, planted, does; the same check fails a capped window, naming how many ticks presented nothing', () => {
    const failures = (planted?: Planted): string[] => RATES.flatMap((hz) => EXACT_THEN_JITTERED.flatMap((seed) => everyTickFailures(play(show(), { hz, cap: null, seed, ...(planted ? { planted } : {}) }))));
    expect(failures(), 'the ticks of a window under no cap that presented no frame').toEqual([]);
    expect(failures(MERGE_BASE_RULE), `as before: the ticks that presented no frame under no cap by the merge base's rule (planted ${MERGE_BASE_RULE})`).toEqual([]);
    const capped = everyTickFailures(play(show(), { hz: 120, cap: 'thermal', seed: null }));
    expect(capped.length === 1 && capped[0]!.includes(`of ${TICKS} ticks presented no frame`), `the same check fails a window the thermal cap holds at 120 Hz, naming its ticks without a frame: ${JSON.stringify(capped)}`).toBe(true);
  }, TEST_DEADLINE_MS);
});
