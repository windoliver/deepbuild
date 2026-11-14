// #1901.95394721: a key input held in a struct with padding keys by its declared fields, never its memory.
//
// The `padded_key` call (README) builds the binary's padded fixture twice, the same field values each
// time and its padding bytes filled from two seeded random sources, and keys each build as the core keys
// a content key's input. Both builds must give one content key, while their bytes differ only in padding
// (so the padding really was filled differently), and fixture fields drawn from another seed must give
// another key (so the key reads the fields). The wrong program, `--planted key_hashes_raw_bytes`, keys the
// struct's raw bytes: its two keys differ, and the same comparison fails, naming the struct. The base has
// no `padded_key`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PLANTED_RAW_KEY, buildShow, differing, keyFailures, onlyPaddingDiffers, paddedCall, paddedOf, run, scenario, useTemp, type Padded,
} from './helpers.ts';

const ID = '#1901.95394721';
const temp = useTemp();
/** Fixture fields from seed 1, padding from two seed pairs; then fields from seed 2. */
const CASES: [number, [number, number]][] = [[1, [1901, 2]], [1, [7, 42]], [2, [1901, 2]]];

describe(`${ID} a padded fixture built twice with its padding from two seeded random sources gives one content key; a key over its raw bytes gives two and fails, naming the struct`, () => {
  it(`${ID} the fixture's two builds differ only in padding and give the same content key, other padding seeds give that key again and other fields another; with ${PLANTED_RAW_KEY} the two builds give two keys and the comparison fails, naming the struct`, () => {
    const dir = temp();
    const bin = buildShow(dir, 'full');
    const replies = run(bin, scenario(join(dir, 'evidence'), CASES.map(([f, s]) => paddedCall(f, s))));
    const clean = replies.map((r, i) => paddedOf(r, CASES[i]![0], CASES[i]![1], `padded_key ${JSON.stringify(CASES[i])}`));
    const [first, otherPadding, otherFields] = clean as [Padded, Padded, Padded];
    console.log(`${ID} ${first.struct} (${first.size} bytes, padding at ${first.padding.join(', ')}): ${clean.map((p) => `fields ${p.fields}, seeds ${p.seeds.join('/')}: ${p.keys.join(' ')}`).join('; ')}`);
    for (const p of clean) {
      expect(p.struct, 'every call keys the one fixture').toBe(first.struct);
      expect(onlyPaddingDiffers(p), `fields ${p.fields}, seeds ${p.seeds.join(' and ')}: the two builds are one value with other padding`).toEqual([]);
      expect(keyFailures(p), `fields ${p.fields}, seeds ${p.seeds.join(' and ')}: one value built twice gives one content key`).toEqual([]);
    }
    expect(otherPadding.keys[0], 'padding from two other seeds gives the same key').toBe(first.keys[0]);
    expect(differing(otherFields.raw[0], first.raw[0]).some((i) => !first.padding.includes(i)), 'fields drawn from seed 2 are other values than from seed 1').toBe(true);
    expect(otherFields.keys[0], 'other field values give another key: the key reads the declared fields').not.toBe(first.keys[0]);

    // The wrong program: a key over the struct's raw bytes gives two keys and fails, naming the struct.
    const [planted] = run(bin, scenario(join(dir, 'evidence-planted'), [paddedCall(...CASES[0]!)]), ['--planted', PLANTED_RAW_KEY]);
    const p = paddedOf(planted, ...CASES[0]!, `padded_key with ${PLANTED_RAW_KEY}`);
    console.log(`${ID} ${PLANTED_RAW_KEY}: ${p.struct}: ${p.keys.join(' ')}`);
    expect(onlyPaddingDiffers(p), `with ${PLANTED_RAW_KEY}, the two builds are still one value with other padding`).toEqual([]);
    expect(p.keys[0], `with ${PLANTED_RAW_KEY}, the two builds give two keys`).not.toBe(p.keys[1]);
    const failures = keyFailures(p);
    expect(failures.length, `with ${PLANTED_RAW_KEY}, the comparison fails`).toBe(1);
    expect(failures[0], `the failure names the struct ${first.struct}`).toContain(`${first.struct}:`);
  }, 7_200_000);
});
