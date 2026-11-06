// AC5 (#453.c8592e0f): "A 48 × 24 quad torus, triangulated, reports a quad_ratio of at least 0.95 and passes with a
// skin; an icosphere of 1,280 near-equilateral triangles reports under 0.7, and with a skin fails naming the ratio
// and its unpaired triangles with a remesh in quad mode as the fix, while with no skin it reports its ratio and
// passes"
//
// asserts: the torus (gltf.ts `torus`: 48 × 24 quads, each split along one diagonal, seam rows repeated) reports
// 2,304 triangles on 1,152 welded vertices and a quad_ratio of at least 0.95, and passes, with a skin at its bind
// pose and without. The icosphere (`icosphere`: the icosahedron split in four three times, 1,280 triangles)
// reports a quad_ratio under 0.7 with and without a skin. With a skin at its bind pose it is FAIL with an error
// `loop.quad_ratio` whose `actual` names its quad_ratio, its unpaired count and up to 64 unpaired triangle IDs,
// as its result does, and whose `fix` names a remesh job in quad mode; with no skin it reports its ratio, raises
// no loop.quad_ratio and passes. Planted: `quad_fails_rigid` fails naming quad_ratio; `pair_ignores_corners`
// fails naming loop.quad_ratio. README (Readings) says why "under 0.7" has a test of its own.

import { describe, expect, it } from 'vitest';
import { AC, ITEM, MAX_IDS, brief, cleanFailures, failedWith, failsNaming, judge, none, the, useBuild, useEvidence, weldFailures, type Case, type Judged, type Planted } from './helpers.ts';
import { BIND, icosphere, torus } from './gltf.ts';

const build = useBuild();
const evidence = useEvidence();

const ICO_TRIANGLES = 1280;
const QUAD_MIN = 0.85;
const CASES: Case[] = [
  { name: 'the torus', spec: { prims: [torus()] } },
  { name: 'the skinned torus', spec: { prims: [torus()], skin: { joint: BIND } } },
  { name: 'the icosphere', spec: { prims: [icosphere()] } },
  { name: 'the skinned icosphere', spec: { prims: [icosphere()], skin: { joint: BIND } } },
];
const judged = (planted?: Planted) => judge(build.bin(), evidence(), CASES, planted);

/** The torus: 2,304 triangles on 1,152 welded vertices, quad_ratio at least 0.95, PASS with no defect. */
function torusFailures(j: Judged): string[] {
  const r = j.result;
  const failures = [...weldFailures(j, 48 * 24), ...cleanFailures(j)];
  if (r?.triangles !== 2 * 48 * 24) failures.push(`${j.name}: triangles is ${String(r?.triangles)}, not 2,304`);
  if (!(typeof r?.quad_ratio === 'number' && r.quad_ratio >= 0.95)) failures.push(`${j.name}: quad_ratio is ${String(r?.quad_ratio)}, not at least 0.95`);
  return failures;
}

/** The icosphere with no skin: its ratio reported, no loop.quad_ratio, PASS. Each failure names quad_ratio. */
function rigidFailures(j: Judged): string[] {
  const r = j.result;
  const failures: string[] = [];
  if (r?.triangles !== ICO_TRIANGLES) failures.push(`${j.name}: triangles is ${String(r?.triangles)}, not 1,280 (quad_ratio unread)`);
  if (!(typeof r?.quad_ratio === 'number' && r.quad_ratio >= 0 && r.quad_ratio <= 1)) failures.push(`${j.name}: quad_ratio isn't reported as a ratio: ${String(r?.quad_ratio)}`);
  if (j.row?.issues.some((i) => i.code === 'loop.quad_ratio')) failures.push(`${j.name}: a mesh with no skin raised loop.quad_ratio on its quad_ratio`);
  if (j.row?.result !== 'PASS') failures.push(`${j.name}: with no skin it is ${String(j.row?.result)}, not PASS, at quad_ratio ${String(r?.quad_ratio)}: ${brief(j.row?.raw ?? null, 800)}`);
  return failures;
}

/** The skinned icosphere: FAIL with loop.quad_ratio naming the ratio and its unpaired triangles, a remesh in quad mode the fix. */
function skinnedFailures(j: Judged): string[] {
  const { failures, issue } = failedWith(j, 'loop.quad_ratio');
  const r = j.result;
  if (!r || typeof r.quad_ratio !== 'number' || typeof r.unpaired !== 'number') return [...failures, `${j.name}: no quad_ratio and unpaired in its result (loop.quad_ratio unread): ${brief(r?.raw ?? null, 600)}`];
  if (!(r.quad_ratio < QUAD_MIN)) failures.push(`${j.name}: quad_ratio ${r.quad_ratio} isn't under quad_min ${QUAD_MIN}, so loop.quad_ratio can't be its failure`);
  if (r.unpaired !== Math.round(ICO_TRIANGLES * (1 - r.quad_ratio))) failures.push(`${j.name}: unpaired ${r.unpaired} isn't 1,280 × (1 − quad_ratio ${r.quad_ratio}) (loop.quad_ratio)`);
  const listed = r.ids.unpaired ?? [];
  if (listed.length !== Math.min(MAX_IDS, r.unpaired) || new Set(listed).size !== listed.length) failures.push(`${j.name}: ids.unpaired lists ${listed.length} distinct of ${new Set(listed).size}, not ${Math.min(MAX_IDS, r.unpaired)} (loop.quad_ratio)`);
  for (const id of listed) {
    const m = /^0:(\d+)$/.exec(id);
    if (!m || Number(m[1]) >= ICO_TRIANGLES) failures.push(`${j.name}: unpaired ID ${id} is no triangle of primitive 0 (loop.quad_ratio)`);
  }
  if (issue) {
    const a = issue.actual;
    const actual = typeof a === 'object' && a !== null && !Array.isArray(a) ? a : {};
    if (actual['quad_ratio'] !== r.quad_ratio) failures.push(`${j.name}: loop.quad_ratio's actual names quad_ratio ${JSON.stringify(actual['quad_ratio'])}, not ${r.quad_ratio}`);
    if (actual['unpaired'] !== r.unpaired) failures.push(`${j.name}: loop.quad_ratio's actual names unpaired ${JSON.stringify(actual['unpaired'])}, not ${r.unpaired}`);
    if (JSON.stringify(actual['ids']) !== JSON.stringify(listed)) failures.push(`${j.name}: loop.quad_ratio's actual names the unpaired triangles ${brief(actual['ids'] ?? null, 300)}, not the result's ${brief(listed, 300)}`);
    const fix = JSON.stringify(issue.fix ?? null);
    if (!/remesh/i.test(fix) || !/quad/i.test(fix)) failures.push(`${j.name}: loop.quad_ratio's fix ${fix} names no remesh in quad mode`);
  }
  if (j.verdict === 'PASS') failures.push(`${j.name}: the claim is PASS (loop.quad_ratio)`);
  return failures;
}

describe('AC5 the quad ratio: the torus pairs back into quads; the icosphere does not, and fails only with a skin', () => {
  it(`${AC[5]} the 48 × 24 quad torus, triangulated, reports a quad_ratio of at least 0.95 and passes with a skin, and without`, () => {
    const j = judged();
    none(torusFailures(the(j, 'the skinned torus')), 'the skinned torus');
    none(torusFailures(the(j, 'the torus')), 'the torus');
  });

  it(`${AC[5]} the icosphere of 1,280 near-equilateral triangles reports a quad_ratio under 0.7, with a skin and without`, () => {
    const j = judged();
    for (const name of ['the icosphere', 'the skinned icosphere']) {
      const r = the(j, name).result;
      expect(r?.quad_ratio, `${name}'s quad_ratio is under 0.7: ${brief(r?.raw ?? null, 400)}`).toBeLessThan(0.7);
    }
  });

  it(`${AC[5]} with a skin the icosphere fails naming the ratio and its unpaired triangles with a remesh in quad mode as the fix; with no skin it reports its ratio and passes`, () => {
    const j = judged();
    none(skinnedFailures(the(j, 'the skinned icosphere')), 'the skinned icosphere');
    none(rigidFailures(the(j, 'the icosphere')), 'the icosphere');
    expect(the(j, 'the icosphere').row?.results.some((r) => r.item === ITEM), 'the rigid icosphere still has its result').toBe(true);
  });

  it(`${AC[5]} a planted check that fails a mesh with no skin on its ratio fails, naming quad_ratio`, () => {
    failsNaming(rigidFailures(the(judged('quad_fails_rigid'), 'the icosphere')), ['quad_ratio'], 'the check that fails a rigid mesh on its ratio');
  });

  it(`${AC[5]} a planted pairing that ignores the corners fails, naming loop.quad_ratio`, () => {
    failsNaming(skinnedFailures(the(judged('pair_ignores_corners'), 'the skinned icosphere')), ['loop.quad_ratio'], 'the pairing without the corner limit');
  });
});
