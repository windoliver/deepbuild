// #1935.4898a100: "A uv1 with one chart at half the others' texel density fails `texel: [480, 560]`, naming the
// chart. A uv1 packed into the lower-left quarter reports `uv_fill` 0.25 ± 0.01 and fails `uv_fill_min: 0.6`. Two
// charts 2 px apart at 1,024 px fail `min_gap_px: 4`, naming both; 6 px apart pass"
//
// Fixtures (gltf.ts), each one mesh of flat sheets, one chart per sheet in both UV sets:
//   - `texelQuad`: four 0.5 m square sheets, each a quarter of the mesh's area; in uv1 three at 520 px/m (260 px
//     squares) and sheet 2, chart `0:4`, at 260 px/m (130 px). In uv0 all four are at 520 px/m.
//   - `lowerLeftQuarter`: one 1 m square sheet whose uv1 is [0, 512]² px, the lower-left quarter; with 4 px of
//     padding dilation at 1,024 px the covered share is 516² ÷ 1,024² ≈ 0.2539. Its uv0 covers [64, 960]² px.
//   - `gapPair(2)` and `gapPair(6)`: two 440 × 896 px charts at 512 px/m, 2 px and 6 px apart in uv1, 80 px in uv0.
//
// asserts, in one run, each with `uv_when: always` and `resolution: 1024`:
//   - the half-density chart, with `texel: [480, 560]`: FAIL with an error on the item naming texel, and uv1's
//     `ids.texel` names exactly `0:4`;
//   - the lower-left quarter, with `padding: 4` and `uv_fill_min: 0.6`: uv1's `uv_fill` is 0.25 within 0.01, and
//     FAIL with an error naming uv_fill;
//   - 2 px apart, with `min_gap_px: 4`: uv1's `min_gap_px` is under 4, FAIL with an error naming min_gap_px, and
//     uv1's `ids.min_gap_px` names exactly both charts, `0:0` and `0:2`;
//   - 6 px apart, with `min_gap_px: 4`: uv1's `min_gap_px` is at least 4, and PASS.
// Wrong programs: the base, which has no UV readings; any reading taken from uv0 (all in band, fill 0.77, 80 px
// apart); texel density not in px/m at `resolution` (every chart, or none, out of band); fill over the charts'
// bounds or without the quarter's own area; a gap in UV units, not pixels.
import { describe, it } from 'vitest';
import { TIMEOUT, UV_INPUT, failsOn, idsFailures, judge, nearFailures, none, passesOn, reading, the, useBuild, useFolders, type Case, type Judged } from './helpers.ts';
import { HALF_SHEET, TEXEL_BAND, gapPair, lowerLeftQuarter, texelQuad } from './gltf.ts';

/** The criterion's ID: `#1935.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1935.4898a100';
const bin = useBuild();
const folder = useFolders();

const TEXEL = texelQuad();
const NEAR = gapPair(2);
const GAP_MIN = 4;
const CASES: Case[] = [
  { name: "one chart at half the others' texel density", prim: TEXEL.prim, check: { ...UV_INPUT, texel: [...TEXEL_BAND] } },
  { name: 'a uv1 packed into the lower-left quarter', prim: lowerLeftQuarter().prim, check: { ...UV_INPUT, padding: 4, uv_fill_min: 0.6 } },
  { name: 'two charts 2 px apart', prim: NEAR.prim, check: { ...UV_INPUT, min_gap_px: GAP_MIN } },
  { name: 'two charts 6 px apart', prim: gapPair(6).prim, check: { ...UV_INPUT, min_gap_px: GAP_MIN } },
];

/** uv1's smallest gap under, or at least, the threshold. The failure names min_gap_px. */
function gapFailures(j: Judged, under: boolean): string[] {
  const { value, failures } = reading(j, 'uv.uv1.min_gap_px');
  if (value !== undefined && (value < GAP_MIN) !== under) failures.push(`${j.name}: uv.uv1.min_gap_px is ${value}, ${under ? 'not under' : 'under'} ${GAP_MIN}`);
  return failures;
}

describe(`${ID} uv1's texel density, fill and gaps`, () => {
  it(`${ID} one chart at half the others' texel density fails texel naming it; a uv1 in the lower-left quarter reports uv_fill 0.25 and fails uv_fill_min: 0.6; two charts 2 px apart fail min_gap_px: 4 naming both, 6 px apart pass`, () => {
    const j = judge(bin(), folder(), CASES);
    const [texel, quarter, near, apart] = CASES.map((c) => the(j, c.name)) as [Judged, Judged, Judged, Judged];
    none([
      ...failsOn(texel, 'texel'),
      ...idsFailures(texel, 'uv.uv1.ids.texel', [TEXEL.charts[HALF_SHEET]!]),
      ...nearFailures(quarter, 'uv.uv1.uv_fill', 0.25, 0.01),
      ...failsOn(quarter, 'uv_fill'),
      ...gapFailures(near, true),
      ...failsOn(near, 'min_gap_px'),
      ...idsFailures(near, 'uv.uv1.ids.min_gap_px', NEAR.charts),
      ...gapFailures(apart, false),
      ...passesOn(apart, 'min_gap_px'),
    ], "uv1's texel density, fill and gaps");
  }, TIMEOUT);
});
