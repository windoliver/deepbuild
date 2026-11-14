// #1935.ac062d91: "On uv1, two charts laid 30% over each other report `uv_overlap` 0.3 within 0.01 and fail
// `uv_overlap_max: 0`, naming both charts. A planted reading that computes overlap from chart bounding boxes reports
// overlap on two interlocking L-shaped charts that don't touch, and fails this test"
//
// Fixtures (gltf.ts), each one mesh of flat sheets, one chart per sheet in both UV sets, at 512 px/m in uv1:
//   - `overlapPair`: two 520 × 800 px charts whose uv1 share a 240 px strip: 240 × 800 of the 800 × 800 px they
//     cover, a share of 0.3. In uv0 they sit 124 px apart.
//   - `lPair`: two L charts, L2 in L1's notch, 32 px from it everywhere in uv1; L2's bounding box lies inside L1's.
//
// asserts: with `{kind: geometry.shading, uv_when: always, resolution: 1024, uv_overlap_max: 0}`, in one run,
//   - the pair laid 30% over: uv1's `uv_overlap` is 0.3 within 0.01, the requirement FAILs with an error on the item
//     that names uv_overlap, and uv1's `ids.uv_overlap` names exactly both charts, `0:0` and `0:2`;
//   - the L pair: uv1's `uv_overlap` is 0 and the requirement PASSes;
//   - under the planted `uv_overlap_from_boxes`, the L pair's uv1 `uv_overlap` is above 0, so the L pair's
//     assertion above fails on it, naming uv_overlap.
// Wrong programs: the base, which has no UV readings; overlap read from uv0 (0 on the 30% pair); overlap over each
// chart's own area or the unit square rather than the covered area; the bounding-box reading (the plant).
import { describe, expect, it } from 'vitest';
import { PLANT, TIMEOUT, UV_INPUT, failsNaming, failsOn, idsFailures, judge, nearFailures, none, passesOn, reading, the, useBuild, useFolders, type Case, type Judged } from './helpers.ts';
import { lPair, overlapPair } from './gltf.ts';

/** The criterion's ID: `#1935.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1935.ac062d91';
const bin = useBuild();
const folder = useFolders();

const OVER = overlapPair();
const LS = lPair();
const CHECK = { ...UV_INPUT, uv_overlap_max: 0 };
const OVER_NAME = 'two charts laid 30% over each other';
const L_NAME = "two interlocking L charts that don't touch";
const CASES: Case[] = [
  { name: OVER_NAME, prim: OVER.prim, check: CHECK },
  { name: L_NAME, prim: LS.prim, check: CHECK },
];

/** uv1's overlap 0.3 within 0.01, FAIL on uv_overlap, both charts named. */
const overFailures = (j: Judged): string[] => [
  ...nearFailures(j, 'uv.uv1.uv_overlap', 0.3, 0.01),
  ...failsOn(j, 'uv_overlap'),
  ...idsFailures(j, 'uv.uv1.ids.uv_overlap', OVER.charts),
];

/** uv1's overlap 0 and PASS. Each failure names uv_overlap. */
function lFailures(j: Judged): string[] {
  const { value, failures } = reading(j, 'uv.uv1.uv_overlap');
  if (value !== undefined && value !== 0) failures.push(`${j.name}: uv.uv1.uv_overlap is ${value}, not 0`);
  return [...failures, ...passesOn(j, 'uv_overlap')];
}

describe(`${ID} uv1's overlap is the share of covered area two charts cover`, () => {
  it(`${ID} two charts laid 30% over each other report uv_overlap 0.3 and fail uv_overlap_max: 0 naming both; two interlocking L charts that don't touch report none, and the planted bounding-box reading fails that`, () => {
    const j = judge(bin(), folder(), CASES);
    none([...overFailures(the(j, OVER_NAME)), ...lFailures(the(j, L_NAME))], 'uv1 overlap on the pair laid 30% over and on the L pair');

    // The wrong program the criterion names: it reports overlap on the L pair, so the L pair's assertion fails on it.
    const planted = the(judge(bin(), folder(), CASES, PLANT), L_NAME);
    const { value } = reading(planted, 'uv.uv1.uv_overlap');
    expect(value, `the planted ${PLANT} reports overlap on the L pair`).toBeGreaterThan(0);
    failsNaming(lFailures(planted), ['uv_overlap'], `the planted ${PLANT} on the L pair`);
  }, TIMEOUT);
});
