import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalize, sha256Hex } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { HASHED_KINDS, isObject, KERNEL, sha256, utf8 } from './helpers.ts';

/** The same value with every object's keys in reverse order. */
function reversed(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(reversed);
  if (isObject(v)) return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed(v[k]!)]));
  return v;
}

describe('AC19 every hashed record is hashed over its RFC 8785 bytes', () => {
  it('AC19 the kernel fixture holds one record of each hashed kind', () => {
    expect(KERNEL.map((r) => r.kind)).toEqual(expect.arrayContaining(HASHED_KINDS));
    // The fixture's own hashes were computed before the encoder; they still match their canonical text.
    for (const r of KERNEL) expect(sha256(r.canonical), r.kind).toBe(r.sha256);
  });

  it.each(KERNEL.map((r) => [r.kind, r] as const))('AC19 %s: the TypeScript encoder gives the fixture\'s bytes and SHA-256', (kind, r) => {
    const bytes = canonicalize(JSON.parse(r.input) as JsonValue);
    expect(bytes).toBeInstanceOf(Uint8Array);
    // An encoder that sorts keys by code point instead of UTF-16 code units fails the package envelope,
    // whose keys are U+E000 and U+1F600.
    expect(utf8(bytes), `${kind}: RFC 8785 bytes`).toBe(r.canonical);
    expect(Buffer.from(bytes).equals(Buffer.from(r.canonical, 'utf8')), `${kind}: byte for byte`).toBe(true);
    expect(sha256Hex(bytes), `${kind}: SHA-256`).toBe(r.sha256);
  });

  it('AC19 keys U+E000 and U+1F600 sort by UTF-16 code units: U+1F600 (D83D DE00) first', () => {
    const text = utf8(canonicalize({ '': 1, '\u{1F600}': 2 }));
    expect(text, 'package envelope: UTF-16 order, not code point order').toBe('{"\u{1F600}":2,"":1}');
  });

  it.each(KERNEL.map((r) => [r.kind, r] as const))('AC19 %s with its keys permuted and whitespace added keeps its hash', (kind, r) => {
    const value = JSON.parse(r.input) as JsonValue;
    for (const text of [JSON.stringify(reversed(value), null, 2), JSON.stringify(reversed(value), null, '\t'), `\n ${JSON.stringify(value)} \n`]) {
      expect(sha256Hex(canonicalize(JSON.parse(text) as JsonValue)), kind).toBe(r.sha256);
    }
  });

  it('AC19 property: canonical bytes ignore key order and whitespace, read back to the same value, and are a fixed point', () => {
    const json = fc.jsonValue({ maxDepth: 4 }) as fc.Arbitrary<JsonValue>;
    fc.assert(fc.property(json, (value) => {
      const bytes = canonicalize(value);
      expect(canonicalize(reversed(value))).toEqual(bytes);
      const text = utf8(bytes);
      expect(/[\n\r]/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""'))).toBe(false);
      const back = JSON.parse(text) as JsonValue;
      expect(back).toEqual(JSON.parse(JSON.stringify(value)));
      expect(canonicalize(back)).toEqual(bytes);
    }), { numRuns: 1000, seed: 0x311_19 });
  });
});
