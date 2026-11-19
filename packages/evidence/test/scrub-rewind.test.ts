// #2365: moving a part boundary must re-check masks that precede the mask that moved it.
import { expect, test } from 'vitest';
import { scrubPrefix, scrubText } from '../src/index.js';

const marker = (end: string) => `-----${end} RSA ${'PRIVATE'} KEY-----`;
test('a backwards cut never splits an earlier multiline mask ending on the same line', () => {
  const lines = [
    `${marker('BEGIN')}\n`,
    `${'A'.repeat(64)}${marker('END')} x ${marker('BEGIN')}\n`,
    `${'B'.repeat(64)}\n`,
    `${marker('END')}\n`,
  ];
  const source = lines.join('');
  const target = lines.slice(0, 3).join('').length;
  let left = Buffer.from(source), joined = '';
  const parts: string[] = [];
  while (left.length) {
    const next = scrubPrefix(left, [], target, true);
    expect(next.end, 'a final prefix advances').toBeGreaterThan(0);
    parts.push(next.bytes.toString()); joined += parts.at(-1)!;
    left = left.subarray(next.end);
  }
  expect(parts.every((p) => !p.includes('A'.repeat(32)) && !p.includes('B'.repeat(32))), 'neither masked body reaches any part').toBe(true);
  expect(joined, 'parts are the same bytes as scrubbing both overlapping-line keys whole').toBe(scrubText(source));
});
