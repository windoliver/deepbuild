// #2065: the persisted equality key stays bounded even when many individually valid open items are listed.
import { expect, it } from 'vitest';
import { freshCount, judgeStop } from '../src/index.js';

it('a large open-item list survives JSON recording and still stalls at the next unchanged stop', () => {
  const stop = { items: Array.from({ length: 12 }, (_, i) => `Open item ${i}: ${'x'.repeat(1000)}`), passing: ['unit'], runs: ['run:one'] };
  const first = freshCount();
  expect(judgeStop(first, stop)).toEqual({ sendBack: true, round: 1 });
  expect(first.last!.items.length, 'the comparison key fits the record text cap without dropping any item').toBeLessThanOrEqual(8192);
  const restored = { ...first, seen: new Set(first.seen), last: { ...JSON.parse(JSON.stringify(first.last)), passing: new Set(first.last!.passing) } };
  expect(judgeStop(restored, { ...stop, runs: ['run:two'] })).toEqual({ sendBack: false, stalled: 'two stops with the same open items' });
});
