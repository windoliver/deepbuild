// AC4: a check result that read float GPU work says machines: same, and one marked any reads only CPU data or exact
// GPU work.
//
// Check results are the requirement rows of #403's `verdict`. The checks are the core's `document.validate` (CPU
// data only) and the three check kinds of this suite's test canvas module `test.machines` (README: Cargo feature
// `test-machines`): one reads only items' params on the CPU, one reads an array a float GPU operator wrote, and
// one reads an array an exact (integer-only) GPU operator wrote, through a readback. Each row must carry the
// machines and the determinism class of what it read; a program that marks every row any fails on the float
// check, and one that marks every row same fails on the CPU and exact ones.
import { describe, expect, it } from 'vitest';
import { ALPHA, DOC, MACHINES, type JsonObject, arr, board, brief, claimHandle, obj, presented, reqHandle, run, scenario, show, useBuilds, useEvidence } from './helpers.ts';

const builds = useBuilds([MACHINES]);
const evidence = useEvidence();

const CLAIM = claimHandle(4);
const swatch = (id: string, name: string, x: number, order: string): JsonObject =>
  ({ id, kind: 'test.machines.swatch@1', name, order, params: { box: [x, 16, 48, 48] } });
const SWATCHES = board('Swatches', [320, 120], [swatch('s1', 'Swatch 1', 16, 'a0'), swatch('s2', 'Swatch 2', 80, 'a1')], {
  requires: { modules: { 'test.machines': '^1' } },
});
/** Each check, and what its result must say. */
const CHECKS: { kind: string; machines: 'any' | 'same'; determinism: 'exact' | 'same_machine'; read: string }[] = [
  { kind: 'document.validate', machines: 'any', determinism: 'exact', read: 'CPU data only' },
  { kind: 'test.machines.cpu', machines: 'any', determinism: 'exact', read: 'CPU data only' },
  { kind: 'test.machines.float', machines: 'same', determinism: 'same_machine', read: 'float GPU work' },
  { kind: 'test.machines.exact', machines: 'any', determinism: 'exact', read: 'exact GPU work through a readback' },
];

describe('AC4 a check result that read float GPU work says machines: same, and one marked any reads only CPU data or exact GPU work', () => {
  it('AC4 every check result says the machines and determinism class of what it read', () => {
    const requirements = CHECKS.map((c, i) => ({ id: reqHandle(i + 1), check: { kind: c.kind } }));
    const [shown, verdict] = run(builds.bin(MACHINES), scenario(evidence(), { [DOC.a]: null }, [
      show(DOC.a, SWATCHES),
      { call: 'verdict', claim: CLAIM },
    ], { claims: { [CLAIM]: { session: ALPHA.id, deliverables: [DOC.a], requirements } } }));
    presented(shown!, 'the swatches');
    const rows = arr(verdict!['requirements'], `the verdict's requirement rows (${brief(verdict, 1500)})`).map((r) => obj(r, 'a requirement row'));
    CHECKS.forEach((c, i) => {
      const row = rows.find((r) => r['id'] === reqHandle(i + 1));
      expect(row, `a row for ${c.kind}`).toBeDefined();
      expect({ machines: row!['machines'], determinism: row!['determinism'] }, `${c.kind}, which read ${c.read} (${brief(row)})`)
        .toEqual({ machines: c.machines, determinism: c.determinism });
    });
  });
});
