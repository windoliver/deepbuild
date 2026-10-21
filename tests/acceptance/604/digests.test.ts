// AC3: the seven digests are refrozen and no other digest changes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { d1Digest, frozenDigests, getSchema, listSchemas, sha256Hex } from '../../../packages/contracts/src/index.ts';
import { BASE, HERE, NARROWED, REPO } from './helpers.ts';

/** `git show f346706:packages/contracts/digests.json`, copied byte for byte into the fixture. */
const BASE_FIXTURE = join(HERE, 'fixtures', 'base-digests.json');
const BASE_SHA256 = '81ab279480d03efac35b432264c93c45260793607b71dd75e0c0332f02b90fce';

/** The shipped file, read as a file: the thing the issue says is refrozen. */
const DIGESTS_FILE = join(REPO, 'packages', 'contracts', 'digests.json');

/** The seven kinds whose writer pattern the fix narrows, by their `name@major` as digests.json keys them. */
const SEVEN: readonly string[] = NARROWED.map((n) => n.name);

// Scope reading: "no other digest changes" is read against the base's entries. An entry that
// did not exist at the base (a schema added since) is neither a refreeze nor a change, so the
// current file may name more schemas than the base's 67 and the key sets are not compared.
// A base entry that is missing now is a change, and fails naming it.

const D1 = /^d1:[0-9a-f]{64}$/;

describe(`AC3: the seven digests are refrozen and no other digest changes (base ${BASE})`, () => {
  const baseBytes = readFileSync(BASE_FIXTURE);
  const base = JSON.parse(baseBytes.toString('utf8')) as Record<string, string>;
  const current = JSON.parse(readFileSync(DIGESTS_FILE, 'utf8')) as Record<string, string>;
  const baseNames = Object.keys(base);
  const others = baseNames.filter((name) => !SEVEN.includes(name));

  it('the base fixture is the base commit\'s digests.json, byte for byte', () => {
    expect(sha256Hex(new Uint8Array(baseBytes))).toBe(BASE_SHA256);
    expect(baseNames).toHaveLength(67);
  });

  it('the seven are all base entries, and the base has sixty others', () => {
    expect(SEVEN).toHaveLength(7);
    expect(SEVEN.filter((name) => !(name in base))).toEqual([]);
    for (const name of SEVEN) expect(base[name], `${name}: base digest`).toMatch(D1);
    expect(others).toHaveLength(60);
  });

  it('every base entry still exists in the shipped file', () => {
    const removed = baseNames.filter((name) => !(name in current));
    expect(removed, 'base entries missing from digests.json').toEqual([]);
  });

  it('every base entry still names a published schema', () => {
    const published = new Set(listSchemas().map((entry) => entry.name));
    const gone = baseNames.filter((name) => !published.has(name));
    expect(gone, 'base schemas no longer published').toEqual([]);
  });

  describe('the seven are refrozen', () => {
    it.each(SEVEN.map((name) => [name]))('%s has a new d1 digest', (name) => {
      expect(current[name], `${name}: no entry in digests.json`).toMatch(D1);
      expect(current[name], `${name}: digest unchanged from the base`).not.toBe(base[name]);
    });

    it.each(SEVEN.map((name) => [name]))('%s is frozen at the digest of its schema as it now is', (name) => {
      expect(current[name], `${name}: digests.json differs from d1Digest(getSchema())`).toBe(
        d1Digest(getSchema(name)),
      );
    });
  });

  describe('no other digest changes', () => {
    it('every other base entry is byte-identical to its base value', () => {
      const changed = others.filter((name) => current[name] !== base[name]);
      expect(changed, 'digests changed outside the seven').toEqual([]);
    });

    it('every other schema still digests to its base value, so none was reshaped', () => {
      const reshaped = others.filter((name) => d1Digest(getSchema(name)) !== base[name]);
      expect(reshaped, 'schemas reshaped outside the seven').toEqual([]);
    });
  });

  it('frozenDigests() is the file', () => {
    expect(frozenDigests(), 'frozenDigests() differs from digests.json').toEqual(current);
  });
});
