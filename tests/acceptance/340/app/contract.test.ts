// AC6's contract side: `app` joins user.ask's `from`, an extensible set, as a minor of user.ask@1, so #303's and
// #311's schemas on the verdict spine stay as they are (the issue's Scope). The earlier minor is the base commit's
// user.ask@1 (fixtures/user.ask@1.base.json, from fe593280). @deepbuild/conformance's contractStep is the check a
// minor may take under one name; the d1 digests are the contracts' own (`d1Digest`).

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { d1Digest, getSchema, listSchemas, type Schema } from '../../../../packages/contracts/src/index.ts';
import { contractStep } from '../../../../packages/conformance/src/index.ts';
import { AC6, FIXTURES, readJson, type Line } from './helpers.ts';

const before = readJson(join(FIXTURES, 'user.ask@1.base.json')) as Schema;
const fromOf = (schema: Schema): Line => ((schema.properties as Line).data as Line).properties.from as Line;

describe(`${AC6} app joins user.ask's from as a minor of user.ask@1`, () => {
  it(`${AC6} user.ask@1's from lists app beside unknown, still marked extensible, and the request ID is an optional field`, () => {
    const now = getSchema('user.ask@1');
    const from = fromOf(now);
    expect(from.enum, `${AC6} user.ask@1's from must list app, the origin of words DeepBuild delivers from the app; it lists ${JSON.stringify(from.enum)}`).toContain('app');
    expect(from.enum, `${AC6} user.ask@1's from keeps unknown, what an earlier reader takes app for`).toContain('unknown');
    expect(from['x-closure']?.mark, `${AC6} user.ask@1's from stays an extensible set`).toBe('extensible');
    const data = (now.properties as Line).data as Line;
    expect(data.properties.request?.type, `${AC6} user.ask@1's data must list request, the note's delivery request ID, as a string (README: New: data.request)`).toBe('string');
    expect(data.required, `${AC6} the request ID is optional: a typed prompt carries none`).not.toContain('request');
  });

  it(`${AC6} the contract step from the base commit's user.ask@1 to the current one finds no breaking change, and no user.ask@2 is published`, () => {
    const changes = contractStep([{ name: 'user.ask@1', schema: before }], [{ name: 'user.ask@1', schema: getSchema('user.ask@1') }]);
    expect(changes, `${AC6} adding app to user.ask@1 must be a minor: the contract step names no break`).toEqual([]);
    expect(listSchemas().map((e) => e.name).filter((name) => name.startsWith('user.ask@')), `${AC6} user.ask keeps its major`).toEqual(['user.ask@1']);
  });

  it(`${AC6} #303's and #311's schemas on the verdict spine are as they were at the base commit`, () => {
    const base = readJson(join(FIXTURES, 'spine-digests.base.json')).digests as Record<string, string>;
    for (const [name, digest] of Object.entries(base)) {
      expect(d1Digest(getSchema(name)), `${AC6} ${name} stays as it is: its d1 digest must be the base commit's`).toBe(digest);
    }
  });
});
