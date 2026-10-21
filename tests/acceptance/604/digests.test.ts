// AC3: the seven digests are refrozen and no other digest changes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { d1Digest, frozenDigests, getSchema, listSchemas, sha256Hex } from '../../../packages/contracts/src/index.ts';
import { BASE, HERE, NARROWED, REPO } from './helpers.ts';

/** `git show f346706:packages/contracts/digests.json`, copied byte for byte into the fixture. */
const BASE_TEXT = readFileSync(join(HERE, 'fixtures', 'base-digests.json'), 'utf8');
const BASE_SHA256 = '81ab279480d03efac35b432264c93c45260793607b71dd75e0c0332f02b90fce';
const before = JSON.parse(BASE_TEXT) as Record<string, string>;
const now = (): Record<string, string> => JSON.parse(readFileSync(join(REPO, 'packages', 'contracts', 'digests.json'), 'utf8')) as Record<string, string>;
const SEVEN = NARROWED.map((k) => k.name);

describe(`AC3 the seven digests are refrozen and no other digest changes (against ${BASE})`, () => {
  it('AC3 the base copy is the base commit\'s digests.json', () => {
    expect(sha256Hex(new TextEncoder().encode(BASE_TEXT)), 'fixtures/base-digests.json is the base\'s file').toBe(BASE_SHA256);
    for (const name of SEVEN) expect(before[name], `${name} has a base digest`).toMatch(/^d1:[0-9a-f]{64}$/);
  });

  it('AC3 digests.json names the same schemas as on the base, and the package reads that file', () => {
    expect(Object.keys(now()).sort(), 'schema names in digests.json').toEqual(Object.keys(before).sort());
    expect(frozenDigests(), 'frozenDigests() is digests.json').toEqual(now());
  });

  it.each(SEVEN.map((name) => [name]))('AC3 %s is refrozen: its digest changed and is the d1 of its current schema', (name) => {
    const frozen = now()[name];
    // An entry left as it was (the schema not narrowed, or not refrozen) fails here.
    expect(frozen, `${name}: still the base digest`).not.toBe(before[name]);
    expect(frozen, `${name}: the frozen digest is its current schema's d1`).toBe(d1Digest(getSchema(name)));
  });

  it('AC3 every other entry is byte-identical to the base, and its schema still has that digest', () => {
    const current = now();
    const others = Object.keys(before).filter((name) => !SEVEN.includes(name));
    expect(others.length, 'the base has digests other than the seven').toBe(Object.keys(before).length - SEVEN.length);
    // A refrozen extra entry (another schema reshaped and refrozen) fails here, naming it.
    const changed = others.filter((name) => current[name] !== before[name]);
    expect(changed, 'entries other than the seven that changed').toEqual([]);
    const reshaped = listSchemas().filter(({ name }) => others.includes(name) && d1Digest(getSchema(name)) !== before[name]).map((e) => e.name);
    expect(reshaped, 'schemas other than the seven whose d1 changed').toEqual([]);
  });
});
