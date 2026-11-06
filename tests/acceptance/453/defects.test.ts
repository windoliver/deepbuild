// AC3 (#453.e9d7118c): "Each defect kind has a planted fixture that reports exactly its count with the face or edge
// IDs, and a clean twin that reports zero" (the issue's proof: "Each defect kind's planted fixture reporting its
// exact count and IDs, beside its clean twin")
//
// asserts: for each of the six defect kinds, in one run, its planted fixture (gltf.ts `DEFECT_FIXTURES`) reports
// exactly its count of that kind with exactly its IDs (`defectFailures`), and its clean twin reports every count 0
// with no IDs and passes (`cleanFailures`). Only the planted kind is read on a planted fixture, since one defect
// can imply another (a fin's other two edges are boundary edges; a backwards face's edges are inconsistent). IDs
// are README's: a face `<primitive>:<triangle>`, a welded vertex its first member `<primitive>:<vertex>`, an edge
// its two welded vertices. fixtures.test.ts checks each fixture holds exactly what it is named for. Planted:
// `vertex_fans_skipped` fails naming non_manifold_vertices.

import { describe, it } from 'vitest';
import { AC, cleanFailures, defectFailures, failsNaming, judge, none, the, useBuild, useEvidence, type Case } from './helpers.ts';
import { DEFECT_FIXTURES } from './gltf.ts';

const build = useBuild();
const evidence = useEvidence();

const CASES: Case[] = DEFECT_FIXTURES.flatMap((f) => [
  { name: `${f.kind}: ${f.what}`, spec: { prims: [f.planted] } },
  { name: `${f.kind}: its clean twin`, spec: { prims: [f.clean] } },
]);

describe("AC3 each defect kind's planted fixture reports exactly its count and IDs, beside its clean twin reporting zero", () => {
  for (const f of DEFECT_FIXTURES) {
    it(`${AC[3]} ${f.kind}: ${f.what} reports ${f.ids.length} naming ${f.ids.join(', ')}; its clean twin reports zero`, () => {
      const j = judge(build.bin(), evidence(), CASES);
      none(defectFailures(the(j, `${f.kind}: ${f.what}`), f.kind, f.ids), `${f.kind}'s planted fixture`);
      none(cleanFailures(the(j, `${f.kind}: its clean twin`)), `${f.kind}'s clean twin`);
    });
  }

  it(`${AC[3]} a planted check that never looks at a vertex's fans fails, naming non_manifold_vertices`, () => {
    const f = DEFECT_FIXTURES.find((x) => x.kind === 'non_manifold_vertices')!;
    const j = judge(build.bin(), evidence(), CASES, 'vertex_fans_skipped');
    failsNaming(defectFailures(the(j, `${f.kind}: ${f.what}`), f.kind, f.ids), ['non_manifold_vertices'], 'the check that skips vertex fans');
  });
});
