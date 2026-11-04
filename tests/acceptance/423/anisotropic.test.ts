// AC5 #423.4457ae69: A floor viewed 80° from its normal carries stripes 2 texels wide that run toward the horizon. On
// the row where one pixel spans one texel across them, its footprint is 1 ÷ cos 80° ≈ 5.76 texels long, and a CPU
// reference that filters that footprint along its long axis keeps their Michelson contrast at 1. With the default
// `filter_taps` the frame keeps at least 0.8 of it at 32 sampled pixels on that row, while a planted map sampled at
// anisotropy 1 takes mip log2 5.76 ≈ 2.5, where the 4-texel period averages to grey, reads under 0.1 and fails,
// naming the map.
//
// The floor is a slab whose top is y = 0, with uv0 planar about y (Builder: uv, at the base: u along z, v along x)
// and an unlit material whose base color map is made here: 64 × 64 texels, rows alternating white and black every 2
// texels, so the stripes run along z, toward the horizon. The camera stands 1 m up looking along −z, pitched 10°
// down, fov 40° on a 512 × 512 frame, so the ray through the frame's centre meets the floor 80° from its normal,
// 1 ÷ cos 80° m away. The texel is sized so one pixel there spans one texel across the stripes: s = (1 ÷ cos 80°) ÷
// focal, uv_scale = 64 s. The test picks the row whose centre pixel's footprint across is nearest one texel, takes
// the 32 pixels about the centre column, and for each unprojects its footprint onto the floor: across about 1
// texel, along about 5.76. The CPU reference averages the base level (bilinear, repeat, sRGB decoded) along that
// long axis at each pixel and keeps the 32 values' Michelson contrast (max − min) ÷ (max + min) at 1 (within
// 0.01). The frame's linear target at the same 32 pixels keeps at least 0.8 of it with the look's default
// `filter_taps` (8). `--planted anisotropy_one` reads under 0.1 and fails, naming the map.
// Wrong programs: the base (no maps: the floor is one color); a sampler without anisotropy, or one whose taps are
// fewer than the footprint's ratio needs (the planted one); a sampler that picks the mip by the long axis.
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN_LOOK, STRIPES_CAM, STRIPE_TEXEL, STRIPE_TEXELS, failsNaming, frame0, lum, none, onFloor, readLinear, requireMetal, runGpu, stripeWhite, stripesFloor,
  useDir, useGpu, view3dCall,
  type Planted, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const CAM = STRIPES_CAM;
const SIZE = CAM.size;
const TEXELS = STRIPE_TEXELS;
const S = STRIPE_TEXEL;
const white = stripeWhite;
const MAP = 'items/stripes/params/maps/base_color';

/** The base level, bilinear with repeat, sRGB decoded (0 → 0, 255 → 1), at texel coordinate t across the stripes. */
function texture(t: number): number {
  const at = t - 0.5; const i = Math.floor(at); const f = at - i;
  const v = (k: number): number => (white(((k % TEXELS) + TEXELS) % TEXELS) ? 1 : 0);
  return v(i) * (1 - f) + v(i + 1) * f;
}
/** World x (across the stripes) and z (along them) of a floor point, in texels. */
const texel = (p: V3): [number, number] => [p[0] / S, p[2] / S];
const michelson = (v: number[]): number => (Math.max(...v) - Math.min(...v)) / (Math.max(...v) + Math.min(...v));

/** The row nearest one texel across at the centre column, and its 32 pixels about the centre. */
function sampled(): { row: number; xs: number[]; along: number } {
  let row = 0; let best = Infinity;
  for (let y = SIZE[1] / 2 - 8; y < SIZE[1] / 2 + 8; y++) {
    const across = Math.abs(texel(onFloor(CAM, SIZE[0] / 2 + 1, y + 0.5))[0] - texel(onFloor(CAM, SIZE[0] / 2, y + 0.5))[0]);
    if (Math.abs(across - 1) < best) { best = Math.abs(across - 1); row = y; }
  }
  const [a, b] = [texel(onFloor(CAM, SIZE[0] / 2 + 0.5, row)), texel(onFloor(CAM, SIZE[0] / 2 + 0.5, row + 1))];
  return { row, xs: Array.from({ length: 32 }, (_, i) => SIZE[0] / 2 - 16 + i), along: Math.hypot(a[0] - b[0], a[1] - b[1]) };
}
/** The CPU reference at pixel (x, y): the base level averaged along the footprint's long axis. */
function reference(x: number, y: number): number {
  const [top, bottom] = [texel(onFloor(CAM, x + 0.5, y)), texel(onFloor(CAM, x + 0.5, y + 1))];
  let sum = 0; const n = 64;
  for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; sum += texture(top[0] + (bottom[0] - top[0]) * t); }
  return sum / n;
}

function filtering(out: string, planted?: Planted): { problems: string[]; contrast: number } {
  const floor = stripesFloor(out);
  const { replies } = runGpu(bin(), out, [view3dCall({ doc: floor.doc, look: PLAIN_LOOK, size: SIZE, targets: ['linear'], assets: floor.assets })], planted);
  const lin = readLinear(out, frame0(replies[0]!, 'the stripes floor'), SIZE, 'the stripes floor: linear');
  const { row, xs, along } = sampled();
  const ref = michelson(xs.map((x) => reference(x, row)));
  const got = michelson(xs.map((x) => lum(lin.at(x, row))));
  console.log(`${AC[5]}${planted ? ` (planted ${planted})` : ''}: row ${row}, footprint ${along.toFixed(3)} texels long (an isotropic mip of ${Math.log2(along).toFixed(2)}); Michelson contrast: CPU reference ${ref.toFixed(4)}, frame ${got.toFixed(4)}`);
  const problems: string[] = [];
  if (Math.abs(along - 1 / Math.cos((80 * Math.PI) / 180)) > 0.1) problems.push(`the fixture's footprint is ${along.toFixed(3)} texels long, not 5.76`);
  if (Math.abs(ref - 1) > 0.01) problems.push(`the CPU reference's Michelson contrast is ${ref.toFixed(4)}, not 1`);
  if (!(got >= 0.8 * ref)) problems.push(`${MAP}: the frame keeps a Michelson contrast of ${got.toFixed(4)} on row ${row}, under 0.8 of the reference's ${ref.toFixed(4)}`);
  return { problems, contrast: got };
}

describe(`${AC[5]} anisotropic filtering keeps stripes toward the horizon`, () => {
  it(`${AC[5]} at 80° from the floor's normal the frame keeps at least 0.8 of the CPU reference's contrast with the default filter_taps; the planted anisotropy_one reads under 0.1 and fails, naming the map`, () => {
    requireMetal();
    none(filtering(dir()).problems, 'anisotropic filtering');
    const planted = filtering(dir(), 'anisotropy_one');
    expect(planted.contrast, 'the planted anisotropy_one, at mip log2 5.76, reads the 4-texel period as grey: a contrast under 0.1').toBeLessThan(0.1);
    failsNaming(planted.problems, [MAP], 'the planted anisotropy_one');
  }, 1_800_000);
});
