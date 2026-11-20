// AC6 #971.a3ad5af8: A 3840 × 2160 render, downsampled 2 × 2 by box filter, matches the 1920 × 1080 render of the same
// frame within 0.02 in OKLab at 99% of pixels; a planted pyramid with fixed level sizes misses at 4K and fails, naming
// the share of pixels off.
//
// The temple (helpers.ts `templeDoc`, every part on whole pixels at both sizes) is drawn under filmic at 1920 × 1080
// and at 3840 × 2160, with `local: {strength: 0.5}` and without. Each final PNG is decoded to linear light; the 4K one
// is averaged over each 2 × 2 block (the box filter); both go to OKLab, and a pixel matches when the two colours lie
// within 0.02 of each other (README: Readings). At least 99% of the 2,073,600 pixels must match.
//
// Two things are held first. The fixture itself agrees across the two sizes: without `local`, the 4K render
// downsampled matches the 1080p one by the same measure, so a miss is the local tone map's. And a program that leaves
// the frame alone agrees across sizes too, so `local` must show in the measure the criterion uses: at 1080p, more than
// 1% of pixels lie more than 0.02 in OKLab from the render without `local`. At the base the look's `local` is read by
// nothing and that guard fails. `--planted local_pyramid_fixed_levels` builds at 3840 × 2160 the levels it builds at
// 1920 × 1080 (README: Planted programs); the same check fails on it, naming the share of pixels off.
import { describe, expect, it } from 'vitest';
import { writeJson, type JsonObject } from '../418/helpers.ts';
import {
  AC, FULL, HALF, TIMEOUT, UHD, drawn, finalPng, frame, linearOf, lookWith, none, requireGpu, runGpu, shareApart, templeDoc, useGpu, useOut, view3d,
  type Planted, type Size,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const WITHIN = 0.02;
const SHARE = 0.99;
const percent = (share: number): string => `${(100 * share).toFixed(2)}%`;

/** The temple's final picture at `size` as linear light at 1920 × 1080, with `local: {strength: 0.5}` or without. */
function pictures(sides: { size: Size; local: boolean }[], planted?: Planted): Float64Array[] {
  const doc = writeJson(out(), 'temple.json', templeDoc('temple-sizes'));
  const calls = sides.map((s): JsonObject => view3d({ doc, look: lookWith('filmic', s.local ? HALF : undefined), size: s.size, targets: ['final'], capture: [0] }));
  return runGpu(bin(), out(), calls, planted).map((reply, k) => {
    const s = sides[k]!;
    const what = `the temple at ${s.size[0]} × ${s.size[1]} ${s.local ? 'with local {strength: 0.5}' : 'without local'}`;
    return linearOf(finalPng(out(), frame(drawn(reply, what), 0, what), what), s.size, s.size[0] === UHD[0], what);
  });
}
/** The criterion's check: what is wrong when fewer than 99% of pixels match, naming the share of pixels off. */
function sizesDisagree(down: Float64Array, full: Float64Array): string[] {
  const off = shareApart(down, full, WITHIN);
  return off <= 1 - SHARE ? [] : [`${percent(off)} of pixels are off: the 3840 × 2160 render, downsampled 2 × 2, lies more than ${WITHIN} in OKLab from the 1920 × 1080 render there, and at most ${percent(1 - SHARE)} may`];
}

describe(`${AC[6]} a 4K render and a 1080p render of the same frame agree`, () => {
  it(`${AC[6]} with local {strength: 0.5} changing the frame, the 3840 × 2160 render downsampled 2 × 2 by box filter matches the 1920 × 1080 render within 0.02 in OKLab at 99% of pixels`, () => {
    requireGpu();
    const [plainFull, localFull, plainDown, localDown] = pictures([{ size: FULL, local: false }, { size: FULL, local: true }, { size: UHD, local: false }, { size: UHD, local: true }]);
    none(sizesDisagree(plainDown!, plainFull!), 'the fixture agrees across the two sizes without local');
    const changed = shareApart(localFull!, plainFull!, WITHIN);
    expect(changed, `the guard: local {strength: 0.5} changes the 1080p frame by more than ${WITHIN} in OKLab at more than 1% of pixels (it does at ${percent(changed)}), so two sizes that agree are not two frames left alone`).toBeGreaterThan(1 - SHARE);
    const off = shareApart(localDown!, localFull!, WITHIN);
    console.log(`${AC[6]}: local changes ${percent(changed)} of the 1080p frame's pixels; the 4K render downsampled is off at ${percent(off)}`);
    none(sizesDisagree(localDown!, localFull!), 'the 3840 × 2160 render, downsampled 2 × 2, matches the 1920 × 1080 render at 99% of pixels');
  }, TIMEOUT);

  it(`${AC[6]} planted local_pyramid_fixed_levels (the pyramid's levels don't follow the output size) misses at 4K and fails, naming the share of pixels off`, () => {
    requireGpu();
    const [localFull, localDown] = pictures([{ size: FULL, local: true }, { size: UHD, local: true }], 'local_pyramid_fixed_levels');
    const failures = sizesDisagree(localDown!, localFull!);
    console.log(`${AC[6]}: under the planted pyramid: ${failures[0] ?? 'the two sizes agree'}`);
    expect(failures.length, 'the check fails on the planted program').toBeGreaterThan(0);
    expect(failures[0], 'the failure names the share of pixels off').toMatch(/^\d+\.\d{2}% of pixels are off/);
  }, TIMEOUT);
});
