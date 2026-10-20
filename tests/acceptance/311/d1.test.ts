import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ContractError, d1Digest, frozenDigests, frozenDrift, listSchemas, parseDigest,
} from '../../../packages/contracts/src/index.ts';
import type { Schema, SchemaEntry } from '../../../packages/contracts/src/index.ts';
import { clone, FIXTURES, fixture, setAt, sha256 } from './helpers.ts';

const expected = fixture('d1', 'expected.json') as { method: string; d1: string };
const METHOD = expected.method;
const method = (file = 'method.json'): Schema => fixture('d1', file) as Schema;
const fileBytes = (file: string) => readFileSync(join(FIXTURES, 'd1', file));

describe('AC21 d1 is the SHA-256 of a schema\'s RFC 8785 bytes, $refs inlined and annotations left out', () => {
  it('AC21 the planted method\'s d1 is the value computed before any digest code existed', () => {
    expect(d1Digest(method()), METHOD).toBe(expected.d1);
  });

  it('AC21 moving a definition into $defs keeps the digest; a digest over the file\'s bytes does not', () => {
    expect(d1Digest(method('method-defs.json')), `${METHOD} with mode moved into $defs`).toBe(expected.d1);
    // The planted twin: hashing the file's own bytes changes with the move, so it fails this criterion.
    expect(`d1:${sha256(fileBytes('method-defs.json'))}`, `${METHOD}: a file-bytes digest`).not.toBe(expected.d1);
  });

  it('AC21 reordering keys keeps the digest; a digest over the file\'s bytes does not', () => {
    expect(d1Digest(method('method-reordered.json')), `${METHOD} with its keys reordered`).toBe(expected.d1);
    expect(`d1:${sha256(fileBytes('method-reordered.json'))}`, `${METHOD}: a file-bytes digest`).not.toBe(expected.d1);
    expect(sha256(fileBytes('method-reordered.json'))).not.toBe(sha256(fileBytes('method.json')));
  });
});

describe('AC15 a reshape changes a method\'s d1, and a changed description does not', () => {
  const base = method();
  const reshapes: [string, Schema][] = [
    ['an enum value added', setAt(base, '/properties/mode/enum', ['watch', 'warn', 'block']) as Schema],
    ['a required field made optional', setAt(base, '/required', ['mode']) as Schema],
    ['additionalProperties turned on', setAt(base, '/additionalProperties', true) as Schema],
    ['a maximum raised', setAt(base, '/properties/limit/maximum', 11) as Schema],
  ];

  it.each(reshapes)('AC15 %s changes the digest', (reshape, schema) => {
    // A normalizer that drops enum, required or bounds keeps one digest and fails here, naming the reshape.
    expect(d1Digest(schema), `reshape: ${reshape}`).not.toBe(d1Digest(base));
    expect(d1Digest(schema), `reshape: ${reshape}`).toMatch(/^d1:[0-9a-f]{64}$/);
  });

  it('AC15 the four reshapes give four different digests', () => {
    expect(new Set(reshapes.map(([, s]) => d1Digest(s))).size).toBe(4);
  });

  it('AC15 a changed description, title, example or $comment keeps the digest', () => {
    const reworded = [
      setAt(base, '/description', 'Reworded entirely.'),
      setAt(base, '/properties/mode/description', 'What the guard does when it matches.'),
      setAt(base, '/title', 'renamed title'),
      setAt(base, '/properties/target/examples', ['release']),
      setAt(base, '/properties/limit/$comment', 'a different comment'),
    ] as Schema[];
    for (const schema of reworded) expect(d1Digest(schema)).toBe(d1Digest(base));
  });
});

describe('AC5 every frozen digest names its algorithm, and a digest without a known prefix fails the contract test', () => {
  it('AC5 every published schema has a frozen digest, each d1:<64 hex>, equal to its current d1', () => {
    const frozen = frozenDigests();
    const entries = listSchemas();
    expect(entries.length).toBeGreaterThan(0);
    for (const { name, schema } of entries) {
      expect(frozen[name], `${name} has a frozen digest`).toMatch(/^d1:[0-9a-f]{64}$/);
      expect(frozen[name], `${name}'s frozen digest is its d1`).toBe(d1Digest(schema));
    }
    expect(frozenDrift(entries, frozen)).toEqual([]);
  });

  it('AC5 parseDigest reads d1 and refuses any other algorithm prefix', () => {
    const hex = expected.d1.slice(3);
    expect(parseDigest(expected.d1)).toEqual({ algorithm: 'd1', hex });
    for (const bad of [hex, `sha256:${hex}`, `d2:${hex}`, `D1:${hex}`, `d1:${hex.toUpperCase()}`, `d1:${hex.slice(1)}`, `d1-${hex}`, '']) {
      expect(() => parseDigest(bad), `digest ${JSON.stringify(bad.slice(0, 12))}…`).toThrow(ContractError);
    }
  });

  it.each(['', 'sha256:', 'd2:', 'md5:'])('AC5 the contract test fails a frozen digest written with prefix %j, naming the method', (prefix) => {
    const entries = listSchemas();
    const name = entries[0]!.name;
    const frozen = { ...frozenDigests() };
    frozen[name] = `${prefix}${frozen[name]!.slice(3)}`;
    expect(frozenDrift(entries, frozen)).toEqual([name]);
  });
});

describe('Added Oct 9: changing a published shape without a new minor or a new name fails the build', () => {
  const entry = (schema: Schema): SchemaEntry => ({ name: METHOD, schema });

  it('a reshape under the same name drifts from its frozen digest, naming the method; a reworded description does not', () => {
    const frozen = { [METHOD]: d1Digest(method()) };
    expect(frozenDrift([entry(method())], frozen)).toEqual([]);
    expect(frozenDrift([entry(setAt(method(), '/description', 'reworded') as Schema)], frozen)).toEqual([]);
    expect(frozenDrift([entry(setAt(method(), '/properties/limit/maximum', 11) as Schema)], frozen)).toEqual([METHOD]);
    // A method with no frozen digest at all is a published shape nobody froze.
    expect(frozenDrift([{ name: 'planted.unfrozen@1', schema: clone(method()) }], frozen)).toEqual(['planted.unfrozen@1']);
  });
});
