// #2365: splitting storage must not change the ingestion scrub's bytes.
import fc from 'fast-check';
import { expect, test } from 'vitest';
import { scrubPrefix, scrubText } from '../src/index.js';

test('line-aligned cuts preserve the whole-text scrub for generated adjacent masks, unicode and multiline values', () => {
  const pieces = [
    'safe words 🛒 一 résumé\n', 'a\nb\n', 'first-half\nsecond-half\n',
    '"password": {\n "a": "synthetic only"\n}\n',
    `-----BEGIN PRIVATE KEY-----\n${'synthetic-not-a-real-key'.repeat(8)}\n-----END PRIVATE KEY-----\n`,
    'PASSWORD=fixture\n', '"token":"fixture"\n', '\n',
  ];
  fc.assert(fc.property(fc.array(fc.constantFrom(...pieces), { minLength: 1, maxLength: 20 }), fc.integer({ min: 1, max: 80 }), (parts, target) => {
    const original = parts.join('');
    const held = ['first-half\nsecond-half', 'a\nb'];
    let remaining = Buffer.from(original), joined = '';
    while (remaining.length) {
      const next = scrubPrefix(remaining, held, target, true);
      expect(next.end, 'each final prefix advances by at least one complete line').toBeGreaterThan(0);
      joined += next.bytes.toString('utf8');
      remaining = remaining.subarray(next.end);
    }
    expect(joined).toBe(scrubText(original, { held }));
  }), { numRuns: 40, seed: 2365 });
});
