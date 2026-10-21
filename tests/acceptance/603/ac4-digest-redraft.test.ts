// Blind redraft of one #603 AC4 test (see AC4-DIGEST-REDRAFT.md): agent.stop@1 stays frozen at the base's
// shape and digest, agent.stop@2 gets a frozen digest of its own, and no published schema drifts from its
// frozen digest.

import { describe, expect, it } from 'vitest';
import { d1Digest, fixtures, frozenDigests, frozenDrift, getSchema, listSchemas } from '../../../packages/contracts/src/index.ts';
import { BASE_V1_DIGEST, V1, V2, clone, expectAccepted, expectPublished, expectRefused, isObject } from './helpers.ts';

describe('AC4 the catalogue lists both versions, and agent.stop@1 stays frozen', () => {
  it('AC4 agent.stop@1 keeps its schema and frozen digest from the base; agent.stop@2 has a frozen digest of its own; nothing drifts', () => {
    const frozen = frozenDigests();

    // "agent.stop@1 kept in the catalogue and its digest frozen": still published, its frozen digest is the
    // base's, and its schema still hashes to that digest (d1 leaves out annotations, so a reworded
    // description is allowed; any change to the shape is not).
    expectPublished(V1);
    expect(frozen[V1], `${V1}'s frozen digest is the base's`).toBe(BASE_V1_DIGEST);
    expect(d1Digest(getSchema(V1)), `${V1}'s schema still hashes to the base's frozen digest`).toBe(BASE_V1_DIGEST);

    // The same, through the validator: a stop as the base's agent.stop@1 shaped it still validates as
    // version 1, and version 1 still refuses the fields version 2 adds. A wrong program that widened @1
    // in place (or routed @1 to @2's schema) fails here.
    const [base] = fixtures(V1);
    expect(isObject(base) && isObject(base.data), `${V1} has a published fixture`).toBe(true);
    if (!isObject(base) || !isObject(base.data)) return;
    expectAccepted(V1, base, `${V1}'s published stop`);
    const widened = clone(base);
    widened.data = { ...clone(base.data), cause: 'unknown', usage: null };
    expectRefused(V1, widened, '/data/cause', `${V1} doesn't take version 2's cause`);
    expectRefused(V1, widened, '/data/usage', `${V1} doesn't take version 2's usage`);

    // "this is agent.stop@2": published, with a frozen digest that is its own schema's d1, not @1's.
    expectPublished(V2);
    expect(Object.keys(frozen), `${V2} has a frozen digest`).toContain(V2);
    expect(frozen[V2], `${V2}'s frozen digest is its schema's d1`).toBe(d1Digest(getSchema(V2)));
    expect(frozen[V2], `${V2}'s frozen digest is its own, not ${V1}'s`).not.toBe(BASE_V1_DIGEST);

    // "as every other kind's is": every published schema, both versions included, matches its frozen digest.
    expect(frozenDrift(listSchemas(), frozen), 'published schemas whose frozen digest is missing or no longer their d1').toEqual([]);
  });
});
