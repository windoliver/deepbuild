// The judge, held to a right input and the wrong ones, with no hub, CLI or replica: a judge that passes what it should
// fail would let the criterion pass on a wrong program. No criterion tag: these pass at the base, anywhere.
import { describe, expect, test } from 'vitest';
import { countsIn, oneFailures, type Reading } from './helpers.ts';

const OPEN = 'ask:01KB1810AK0000000000000003';
const DONE = ['ask:01KB1810AK0000000000000001', 'ask:01KB1810AK0000000000000002'];
const RIGHT: Reading[] = [
  { who: "the app's list", log_pos: 40, counts: [1, 1], asks: [OPEN] },
  { who: 'deep', log_pos: 40, counts: countsIn('Needs you\n  Which header colour?  needs you  shop\n1 session\n1 ask needs you\n'), asks: undefined },
  { who: 'deep status --json', log_pos: 40, counts: undefined, asks: [OPEN] },
];
const set = (i: number, r: Partial<Reading>): Reading[] => RIGHT.map((x, j) => (j === i ? { ...x, ...r } : x));

describe('judges', () => {
  test('oneFailures passes 1 at one log position with the open ask alone', () => {
    expect(oneFailures(RIGHT, OPEN, DONE)).toEqual([]);
  });

  test('oneFailures fails a count of the asks the hub holds, closed ones included, naming the reader and the count', () => {
    expect(oneFailures(set(1, { counts: countsIn('3 asks need you') }), OPEN, DONE)).toEqual(['deep counts 3 (says "3 asks need you"), not 1: two asks are answered and one is open']);
    expect(oneFailures(set(0, { counts: [0] }), OPEN, DONE).join()).toMatch(/^the app's list counts 0 /);
    expect(oneFailures(set(1, { counts: [1, 2] }), OPEN, DONE).join()).toMatch(/^deep counts 2 /);
    expect(oneFailures(set(1, { counts: [] }), OPEN, DONE).join()).toMatch(/deep says no count/);
  });

  test('oneFailures fails readers at different log positions, or one with none', () => {
    expect(oneFailures(set(0, { log_pos: 41 }), OPEN, DONE).join()).toMatch(/different log positions: the app's list at 41, deep at 40/);
    expect(oneFailures(set(1, { log_pos: undefined }), OPEN, DONE).join()).toMatch(/^deep gives no log position/);
  });

  test('oneFailures fails a list that keeps an answered ask, drops the open one, or adds one, naming the ask', () => {
    expect(oneFailures(set(0, { asks: [OPEN, DONE[0]!] }), OPEN, DONE)).toEqual([`the app's list still lists the answered ask ${DONE[0]}`]);
    expect(oneFailures(set(2, { asks: [] }), OPEN, DONE)).toEqual([`deep status --json lacks the open ask's row ${OPEN}`]);
    expect(oneFailures(set(0, { asks: [OPEN, 'ask:X'] }), OPEN, DONE).join()).toMatch(/never raised: ask:X/);
    expect(oneFailures(set(0, { asks: [OPEN, OPEN] }), OPEN, DONE).join()).toMatch(/more than once/);
  });

  test('countsIn reads the count sentence as the app writes it', () => {
    expect(countsIn('1 ask needs you')).toEqual([1]);
    expect(countsIn('3 asks need you')).toEqual([3]);
    expect(countsIn('needs you: 1')).toEqual([]);
  });
});
