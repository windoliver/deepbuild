// #464.8dfec0d8: "`vignette {color: ink, inner: 0.45, outer: 1, amount: 0.7, aspect: frame}` over a flat white 1920 ×
// 1080 frame leaves every pixel within 0.45 of the normalised radius unchanged, puts each corner 70% of the way to ink
// within 1 code value, never brightens outward along a ray, and gives equal values at 0.8 on the long and short
// half-axes within 1 code value; grain at rate 0, and grain at 24 Hz under reduced motion, give the same pixels at t = 0
// and t = 3.7 s on a still scene; a planted vignette measured in pixels from the centre and a planted grain seeded from
// t each fail, naming the pixel or the frame"
//
// The normalised radius under `aspect: frame` is r = hypot((x − W/2) ÷ (W/2), (y − H/2) ÷ (H/2)) at a pixel's centre, 1
// on each half-axis's end, so points at 0.8 on the long and short half-axes share r = 0.8 (README: Readings). "70% of
// the way to ink" is in code values: 255 + 0.7 × (ink − 255) per channel, ink #1b1d22. A ray is walked pixel by pixel
// from the centre at every 3°. Grain stills: a still flat grey frame at 10 fps, frames 0 and 37 (t = 3.7 s) each opened
// cold, with grain at rate 0, and at 24 Hz under `reduced_motion: true`, have one pixel hash each; grain at 24 Hz played
// normally changes between them, and grain shows (frame 0 differs from no grain). Planted: `vignette_pixels` (r in
// pixels from the centre over the short half-axis) and `grain_from_t` (grain seeded from t, ignoring rate and reduced
// motion).
import { describe, expect, it } from 'vitest';
import {
  AC, INK, type Image, type JsonObject, type Planted, failsNaming, film2d, flat, frameAt, look2d, none, pixel, readFinal, requireGpu, runGpu, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();
const W = 1920; const H = 1080;
const VIGNETTE: JsonObject = { vignette: { color: 'ink', inner: 0.45, outer: 1, amount: 0.7, aspect: 'frame' } };

function vignetteFailures(img: Image): string[] {
  const problems: string[] = [];
  const r = (x: number, y: number): number => Math.hypot((x + 0.5 - W / 2) / (W / 2), (y + 0.5 - H / 2) / (H / 2));
  let changed = 0; let first = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (r(x, y) > 0.45) continue;
    const p = pixel(img, x, y);
    if (p[0] !== 255 || p[1] !== 255 || p[2] !== 255) { changed++; if (!first) first = `pixel (${x}, ${y}) at r ${r(x, y).toFixed(3)} is ${p.join(', ')}`; }
  }
  if (changed) problems.push(`${changed} pixels within 0.45 of the normalised radius changed; first: ${first}`);
  const corner = INK.map((v) => 255 + 0.7 * (v - 255));
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]] as const) {
    const p = pixel(img, x, y);
    if ([0, 1, 2].some((c) => Math.abs(p[c]! - corner[c]!) > 1)) problems.push(`corner pixel (${x}, ${y}) is ${p.join(', ')}, not 70% of the way to ink (${corner.map((v) => v.toFixed(1)).join(', ')}) within 1 code value`);
  }
  const value = (x: number, y: number): number => { const p = pixel(img, x, y); return p[0] + p[1] + p[2]; };
  for (let deg = 0; deg < 360; deg += 3) {
    const a = (deg * Math.PI) / 180;
    let last = Infinity; let lastAt = '';
    for (let s = 0; ; s++) {
      const x = Math.floor(W / 2 + s * Math.cos(a)); const y = Math.floor(H / 2 + s * Math.sin(a));
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      const v = value(x, y);
      if (v > last) { problems.push(`along the ray at ${deg}°, pixel (${x}, ${y}) is brighter (${v}) than ${lastAt} (${last}) nearer the centre`); break; }
      last = v; lastAt = `pixel (${x}, ${y})`;
    }
  }
  // At 0.8 of each half-axis: the 2 × 2 pixels around the point, averaged.
  const at = (cx: number, cy: number): { name: string; v: number[] } => {
    const xs = [Math.floor(cx - 0.5), Math.floor(cx - 0.5) + 1]; const ys = [Math.floor(cy - 0.5), Math.floor(cy - 0.5) + 1];
    const v = [0, 1, 2].map((c) => xs.flatMap((x) => ys.map((y) => pixel(img, x, y)[c]!)).reduce((s, q) => s + q, 0) / 4);
    return { name: `pixel (${xs[0]}, ${ys[0]})`, v };
  };
  const points = [at(W / 2 + 0.8 * W / 2, H / 2), at(W / 2 - 0.8 * W / 2, H / 2), at(W / 2, H / 2 + 0.8 * H / 2), at(W / 2, H / 2 - 0.8 * H / 2)];
  for (const p of points.slice(1)) {
    const off = Math.max(...[0, 1, 2].map((c) => Math.abs(p.v[c]! - points[0]!.v[c]!)));
    if (off > 1) problems.push(`at 0.8 of the half-axes, ${p.name} (${p.v.map((v) => v.toFixed(1)).join(', ')}) differs from ${points[0]!.name} on the long half-axis (${points[0]!.v.map((v) => v.toFixed(1)).join(', ')}) by ${off.toFixed(1)} code values`);
  }
  if (points[0]!.v[0]! >= 255) problems.push(`at 0.8 of the long half-axis, ${points[0]!.name} isn't darkened, so the vignette doesn't reach it`);
  return problems;
}

function vignette(planted?: Planted): string[] {
  requireGpu();
  const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(flat('white-464', [W, H]), look2d('vignette-464', {}, { finish: [VIGNETTE] }), { frames: 1, capture: [0] })], planted);
  return vignetteFailures(readFinal(out(), frameAt(r!, 0, 'the vignette'), 'the vignette'));
}

const GRAIN = (rate: number): JsonObject => ({ grain: { amount: '4%', size: '1px', tone: 'flat', rate } });
/** Frames 0 and 37 (t = 3.7 s at 10 fps) of a still grey frame, each opened cold, under each grain; failures name the frame. */
function grainStills(planted?: Planted): string[] {
  requireGpu();
  const doc = flat('still-464', [640, 360], 'grey');
  const looks: [string, JsonObject, JsonObject][] = [
    ['grain at rate 0', look2d('grain-still-464', { grey: '#767676' }, { finish: [GRAIN(0)] }), {}],
    ['grain at 24 Hz under reduced motion', look2d('grain-held-464', { grey: '#767676' }, { finish: [GRAIN(24)] }), { reduced_motion: true }],
    ['grain at 24 Hz', look2d('grain-moving-464', { grey: '#767676' }, { finish: [GRAIN(24)] }), {}],
    ['no grain', look2d('grain-none-464', { grey: '#767676' }, { finish: [] }), {}],
  ];
  const calls = looks.flatMap(([, look, extra]) => [0, 37].map((from) => film2d(doc, look, { fps: 10, from, frames: 1, ...extra })));
  const replies = runGpu(bins.bin('deep-gpu'), out(), calls, planted);
  const hash = (k: number, n: 0 | 37): string => frameAt(replies[k * 2 + (n === 0 ? 0 : 1)]!, n, `${looks[k]![0]} at frame ${n}`).pixel_hash;
  const problems: string[] = [];
  for (const k of [0, 1]) if (hash(k, 37) !== hash(k, 0)) problems.push(`${looks[k]![0]}: frame 37 (t = 3.7 s) differs from frame 0 (t = 0) on a still scene`);
  expect(hash(2, 37), 'grain at 24 Hz played normally changes between t = 0 and t = 3.7 s').not.toBe(hash(2, 0));
  for (const k of [0, 1]) expect(hash(k, 0), `${looks[k]![0]} shows: its frame 0 differs from the frame with no grain`).not.toBe(hash(3, 0));
  return problems;
}

describe(`${AC[5]} the vignette's normalised radius and amount, grain held still, and the planted twins`, () => {
  it(`${AC[5]} the vignette over flat white 1920 × 1080 leaves r ≤ 0.45 unchanged, takes the corners 70% to ink, never brightens outward, and matches at 0.8 on both half-axes`, () => {
    none(vignette(), `${AC[5]} the vignette`);
  });
  it(`${AC[5]} a planted vignette measured in pixels from the centre fails, naming the pixel`, () => {
    failsNaming(vignette('vignette_pixels'), [/pixel \(\d+, \d+\)/], `${AC[5]} the planted vignette_pixels`);
  });
  it(`${AC[5]} grain at rate 0, and grain at 24 Hz under reduced motion, give the same pixels at t = 0 and t = 3.7 s on a still scene`, () => {
    none(grainStills(), `${AC[5]} grain held still`);
  });
  it(`${AC[5]} a planted grain seeded from t fails, naming the frame`, () => {
    failsNaming(grainStills('grain_from_t'), ['frame 37'], `${AC[5]} the planted grain_from_t`);
  });
});
