// #2146 AC3: every schema's frozen digest in packages/contracts/digests.json is the digest of its schema. The file
// is read from disk, each published schema is hashed with d1Digest, and the two are compared name by name; the
// contract package's own reading (frozenDigests, frozenDrift) must agree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { d1Digest, frozenDigests, frozenDrift, listSchemas } from '../../../packages/contracts/src/index.ts';
import { REPO } from './helpers.ts';

describe('#2146.9b146cf0 AC3: Every schema\'s frozen digest in `packages/contracts/digests.json` is the digest of its schema', () => {
  it('#2146.9b146cf0 AC3: Every schema\'s frozen digest in `packages/contracts/digests.json` is the digest of its schema: no schema drifts, doctor.item among them', () => {
    const frozen = JSON.parse(readFileSync(join(REPO, 'packages', 'contracts', 'digests.json'), 'utf8')) as Record<string, string>;
    const entries = listSchemas();
    expect(entries.some((e) => e.name.startsWith('doctor.item@'))).toBe(true);
    const drifted = entries
      .map(({ name, schema }) => ({ name, frozen: frozen[name], digest: d1Digest(schema) }))
      .filter((e) => e.frozen !== e.digest)
      .map((e) => `${e.name} is frozen as ${e.frozen} and hashes to ${e.digest}`);
    expect(drifted).toEqual([]);
    expect(frozenDigests()).toEqual(frozen);
    expect(frozenDrift(entries, frozenDigests())).toEqual([]);
  });
});
