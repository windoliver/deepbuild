// #1056.c717b851: "With no record present, the two-GPU clause is BLOCKED with one unblock ask, asked once (invariant 4),
// never PASS."
//
// This Mac's records of #464's three fixtures with a two-GPU clause (`grid`, `tables`, `puff`: 40 frames between them),
// written by `index_record`, and no record from another GPU family. `cross_index` over all three is BLOCKED with exactly
// one unblock ask, naming the machine it needs, not one per fixture or per frame; each fixture compared alone is BLOCKED
// with that same ask, so the clauses that read these records put one question to a person between them (invariant 4:
// never the same question twice). None of these is PASS. At the base `deep-gpu` has no `index_record` or `cross_index`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC2, FIXTURES_464, blockedWithOneAsk, crossIndex, makeRecords, requireGpu, useGpu, useOut } from './helpers.ts';

const bin = useGpu();
const out = useOut();

describe(`${AC2} no second GPU's record: BLOCKED with one unblock ask, asked once, never PASS`, () => {
  it(`${AC2} with only this GPU's records of #464's three pixel fixtures, cross_index is BLOCKED with exactly one unblock ask naming the machine, each fixture alone asks that same question, and none is PASS`, () => {
    requireGpu();
    const mine = makeRecords(bin(), join(out(), 'mine'), FIXTURES_464);
    const all = crossIndex(bin(), out(), mine.map((r) => r.path), 'the three fixtures with no second GPU\'s record');
    const ask = blockedWithOneAsk(all, 'the three fixtures with no second GPU\'s record');
    expect(JSON.stringify(ask), 'the ask names the machine it needs').toMatch(/apple\d+|\bM\d+\b|reference Mac/);
    for (const rec of mine) {
      const alone = blockedWithOneAsk(crossIndex(bin(), out(), [rec.path], `${rec.fixture} alone`), `${rec.fixture} with no second GPU's record`);
      expect(alone['ask'], `${rec.fixture} alone asks the same question as the three together, so a person is asked once`).toBe(ask['ask']);
    }
  });
});
