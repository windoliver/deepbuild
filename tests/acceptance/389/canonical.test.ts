import { describe, expect, it } from 'vitest';
import { apply, batch, useBinary, canonical, expectCanonical, fixture, permuteKeys, Rng, SEEDS, sha256 } from './helpers.ts';
import type { JsonObject, JsonValue } from './helpers.ts';

const FIVE = fixture<JsonObject>('doc-five.json');
const CANON = fixture<{ bytes: string; sha256: string }>('doc-five.canonical.json');
const PERMUTED = fixture<JsonObject>('doc-five.permuted.json');
const HISTORIES = fixture<{ start: JsonObject; writer: string; histories: Record<string, JsonValue[]> }>('histories.json');

useBinary();

describe('AC9 the kernel fixture gives the canonical bytes and SHA-256 of a five-item document', () => {
  it('AC9 the fixture\'s SHA-256 is the hash of its own bytes, written before the canonicalizer ran', () => {
    // The fixture is held to itself first, then the binary to the fixture; the binary is built above.
    expect(sha256(CANON.bytes)).toBe(CANON.sha256);
    expect(CANON.bytes.normalize('NFC')).toBe(CANON.bytes);
    expect(canonical(FIVE).sha256.length).toBe(64);
  });

  it('AC9 the canonicalizer writes the fixture\'s bytes: maps by ID, keys by code point, defaults out, shortest floats, NFC, no whitespace', () => {
    const out = canonical(FIVE);
    // A planted canonicalizer that writes every float with 17 digits fails here, naming the first field
    // whose number text differs (such as /items/sign/params/height or /data/ratio).
    expectCanonical(out.bytes, CANON.bytes, 'doc-five');
    expect(out.sha256).toBe(CANON.sha256);
  });

  it('AC9 the file with its keys permuted gives the same revision hash', () => {
    const out = canonical(PERMUTED);
    expectCanonical(out.bytes, CANON.bytes, 'doc-five.permuted');
    expect(out.sha256).toBe(CANON.sha256);
    // And 50 seeded permutations of every object's keys, maps included.
    const rng = new Rng(SEEDS.permute);
    const docs: JsonValue[] = [];
    for (let i = 0; i < 50; i++) docs.push({ doc: permuteKeys(FIVE, rng) });
    const outs = batch(['canonical'], docs);
    outs.forEach((o, i) => expect((o as JsonObject)['sha256'], `permutation ${i}`).toBe(CANON.sha256));
  });

  it.each(Object.keys(HISTORIES.histories))('AC9 patch history %s reaches the fixture\'s content and its revision hash', (name) => {
    const out = apply(HISTORIES.start, HISTORIES.writer, HISTORIES.histories[name]!);
    expect(out.outcome, `history ${name}: ${JSON.stringify(out.issues)}`).toBe('applied');
    expectCanonical(canonical(out.doc).bytes, CANON.bytes, `history ${name}`);
    expect(out.hash, `history ${name}: revision hash`).toBe(CANON.sha256);
  });

  it('AC9 the canonical bytes are a fixed point: canonicalizing the canonical document gives the same bytes', () => {
    const out = canonical(JSON.parse(CANON.bytes) as JsonObject);
    expectCanonical(out.bytes, CANON.bytes, 'fixed point');
  });
});
