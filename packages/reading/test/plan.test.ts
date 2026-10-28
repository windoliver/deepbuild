// #63 AC1 shows a reading's plan usage; a job that crosses the 5-hour window's reset can't be measured from two
// readings, so it is not captured rather than a smaller number. Resets are in milliseconds, as the runner keeps them.
import { expect, test } from 'vitest';
import { usedBetween } from '../src/plan.ts';

const H = 3_600_000;
test('within one window, the use from start to end, though its reset drifts by seconds', () => {
  expect(usedBetween({ used: 5, resets: 100 * H }, { used: 7.256, resets: 100 * H + 30_000 })).toBe(2.26);
  expect(usedBetween({ used: 10, resets: 100 * H }, { used: 12, resets: 100 * H + 5000 })).toBe(2);
  expect(usedBetween({ used: 5, resets: null }, { used: 6, resets: null })).toBe(1);
});

test('across a reset, or with less used at the end, not captured', () => {
  expect(usedBetween({ used: 5, resets: 100 * H }, { used: 7, resets: 105 * H })).toBe('not captured');
  expect(usedBetween({ used: 5, resets: 100 * H }, { used: 2, resets: 105 * H })).toBe('not captured');
  expect(usedBetween({ used: 5, resets: null }, { used: 2, resets: null })).toBe('not captured');
});
