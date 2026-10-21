// AC3 of #604: the seven narrowed kinds' entries in packages/contracts/digests.json are refrozen (differ from the base and
// equal d1Digest of the schema now), every entry the base had is unchanged and still matches its schema, and frozenDigests()
// reads that file. "No other digest changes" is read as base entries unchanged; a schema added since the base is allowed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { d1Digest, frozenDigests, getSchema, sha256Hex } from '../../../packages/contracts/src/index.ts';
import { BASE, HERE, NARROWED, REPO } from './helpers.ts';

const BASE_SHA256 = '81ab279480d03efac35b432264c93c45260793607b71dd75e0c0332f02b90fce';
const baseBytes = readFileSync(join(HERE, 'fixtures', 'base-digests.json'));
const base = JSON.parse(baseBytes.toString('utf8')) as Record<string, string>;
const current = JSON.parse(readFileSync(join(REPO, 'packages', 'contracts', 'digests.json'), 'utf8')) as Record<string, string>;
const narrowed = new Set(NARROWED.map((k) => k.name));

describe('AC3: the seven digests are refrozen and no other digest changes', () => {
  it(`AC3 fixture is ${BASE}'s digests.json, byte for byte`, () => {
    expect(sha256Hex(new Uint8Array(baseBytes)), 'fixtures/base-digests.json drifted from the base').toBe(BASE_SHA256);
  });

  // Fails on: a narrowed digest left at its base value, or refrozen to something but the schema's current digest.
  for (const { name } of NARROWED) {
    it(`AC3 ${name} is refrozen: differs from the base and equals its schema's digest now`, () => {
      expect(current[name], `${name} has no entry in digests.json`).toBeTypeOf('string');
      expect(current[name], `${name} still carries its base digest; it was not refrozen`).not.toBe(base[name]);
      expect(current[name], `${name}'s frozen digest is not d1Digest of its schema now`).toBe(d1Digest(getSchema(name)));
    });
  }

  // Fails on: an unrelated base digest altered in the file, a base name dropped, or an unrelated schema reshaped.
  for (const name of Object.keys(base).filter((n) => !narrowed.has(n))) {
    it(`AC3 ${name} is unchanged: same digest as the base, and its schema still matches`, () => {
      expect(current[name], `${name} was in digests.json at the base and is missing now`).toBeTypeOf('string');
      expect(current[name], `${name}'s digest changed from the base's value`).toBe(base[name]);
      expect(d1Digest(getSchema(name)), `${name}'s schema was reshaped; its digest no longer matches the frozen one`).toBe(base[name]);
    });
  }

  // Fails on: frozenDigests() not reading digests.json (a stale copy, a hardcoded table, or an entry it misses).
  it('AC3 frozenDigests() reads packages/contracts/digests.json', () => {
    const frozen = frozenDigests();
    for (const name of Object.keys(current)) expect(frozen[name], `frozenDigests()[${name}] differs from digests.json`).toBe(current[name]);
    expect(Object.keys(frozen).sort(), 'frozenDigests() names differ from digests.json').toEqual(Object.keys(current).sort());
  });
});
