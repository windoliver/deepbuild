// #464.1bc1fe40: "Scanlines: `screen: {kind: crt, scanlines: 240, curvature: 0}` over flat white at 1,080 lines draws
// 240 dark bands with a period of 4.5 ± 0.1 px, each band's centre within 0.25 px of its closed-form row"
// #464.2cb143dd: "Curvature: with `curvature: 0.1`, 25 grid points of a test chart land within 0.5 px of the barrel
// map's closed form and the frame's corners are masked; curvature 0 moves no pixel. Mask: `mask: aperture` repeats red,
// green and blue stripes every 3 device px within 0.1 px, each stripe passing only its own channel above 90% of white"
//
// Each screen names only the fields its criterion gives; a field left out is off (README: Readings). Frames are 1920 ×
// 1080 white, drawn by `film2d` at scale 1, so a frame pixel is a device pixel.
// Scanlines: the row profile (each row's mean over the frame) splits into dark bands, runs of rows below the midpoint
// of its brightest and darkest rows; each band's centre is its rows' darkness-weighted centroid (pixel centres y + 0.5,
// one row either side included). The closed form puts band k's centre at (k + 0.5) × 1080 ÷ 240, so all 240 lie whole
// in the frame.
// Curvature: the barrel map in normalised coordinates (q = (x − W/2) ÷ (W/2), (y − H/2) ÷ (H/2)): the frame point q shows
// the chart at q × (1 + k|q|²), so a chart point p lands where q × (1 + k|q|²) = p, solved in f64. The chart is 25 dots
// of radius 6 px at p ∈ {−0.8, −0.4, 0, 0.4, 0.8}²; each dot's darkness-weighted centroid within 14 px of where it
// should land must lie within 0.5 px. With k = 0.1 a corner shows the chart at 1.2, off it, so each corner's 4 × 4
// pixels are masked: under 10% of white. At curvature 0 every dot's centroid is where it is with no screen, within
// 0.05 px.
// Mask: over flat white, in every column exactly one channel is above 90% of white (229.5), cycling red, green, blue
// left to right; the red stripes' centres lie on one line of slope 3 px within 0.1 px.
import { describe, expect, it } from 'vitest';
import {
  AC, type Image, type JsonObject, circle, doc2d, film2d, flat, frameAt, look2d, none, pixel, readFinal, requireGpu, runGpu, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();
const W = 1920; const H = 1080;
const screen = (fields: JsonObject): JsonObject => look2d('screen-464', {}, { finish: [{ screen: { kind: 'crt', ...fields } }] });
const lum = (img: Image, x: number, y: number): number => { const p = pixel(img, x, y); return (p[0] + p[1] + p[2]) / 3; };

describe(`${AC[11]} scanlines on a CRT screen`, () => {
  it(`${AC[11]} 240 scanlines over flat white at 1,080 lines draw 240 dark bands, period 4.5 ± 0.1 px, each centre within 0.25 px of (k + 0.5) × 4.5`, () => {
    requireGpu();
    const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(flat('white-scan-464', [W, H]), screen({ scanlines: 240, curvature: 0 }), { frames: 1, capture: [0] })]);
    const img = readFinal(out(), frameAt(r!, 0, 'the scanlines'), 'the scanlines');
    const rows = Array.from({ length: H }, (_, y) => { let s = 0; for (let x = 0; x < W; x++) s += lum(img, x, y); return s / W; });
    const hi = Math.max(...rows); const lo = Math.min(...rows); const mid = (hi + lo) / 2;
    expect(hi - lo, `the rows aren't flat: brightest ${hi.toFixed(2)}, darkest ${lo.toFixed(2)}`).toBeGreaterThan(2);
    const centres: number[] = [];
    for (let y = 0; y < H; y++) {
      if (rows[y]! >= mid || (y > 0 && rows[y - 1]! < mid)) continue;
      let end = y; while (end + 1 < H && rows[end + 1]! < mid) end++;
      let sw = 0; let sy = 0;
      for (let j = Math.max(0, y - 1); j <= Math.min(H - 1, end + 1); j++) { const w = hi - rows[j]!; sw += w; sy += w * (j + 0.5); }
      centres.push(sy / sw);
    }
    expect(centres.length, `240 dark bands (found ${centres.length})`).toBe(240);
    const period = (centres.at(-1)! - centres[0]!) / 239;
    expect(Math.abs(period - 4.5), `the bands' period ${period.toFixed(3)} px is 4.5 ± 0.1`).toBeLessThanOrEqual(0.1);
    const off = centres.map((c, k) => ({ k, c, d: Math.abs(c - (k + 0.5) * 4.5) })).filter((b) => b.d > 0.25);
    none(off.map((b) => `band ${b.k}'s centre ${b.c.toFixed(3)} is ${b.d.toFixed(3)} px from row ${((b.k + 0.5) * 4.5).toFixed(2)}`), `${AC[11]} the bands`);
  });
});

/** Where a chart point lands under the barrel map, in frame pixels. */
function lands(px: number, py: number, k: number): [number, number] {
  const p = Math.hypot(px, py);
  let s = p;
  for (let i = 0; i < 50; i++) s -= (s * (1 + k * s * s) - p) / (1 + 3 * k * s * s);
  const f = p === 0 ? 1 : s / p;
  return [W / 2 + px * f * (W / 2), H / 2 + py * f * (H / 2)];
}
const GRID = [-0.8, -0.4, 0, 0.4, 0.8];
const CHART = doc2d('chart-464', [W, H], GRID.flatMap((u, i) => GRID.map((v, j) => circle(`dot-${i}-${j}`, `a${i}${j}`, [W / 2 + u * (W / 2), H / 2 + v * (H / 2)], 6, 'ink'))));
/** The darkness-weighted centroid of the dot within 14 px of (x, y). */
function centroid(img: Image, x: number, y: number): [number, number] {
  let sw = 0; let sx = 0; let sy = 0;
  for (let j = Math.floor(y - 14); j <= Math.ceil(y + 14); j++) for (let i = Math.floor(x - 14); i <= Math.ceil(x + 14); i++) {
    if (i < 0 || j < 0 || i >= W || j >= H || Math.hypot(i + 0.5 - x, j + 0.5 - y) > 14) continue;
    const w = Math.max(0, 1 - lum(img, i, j) / 255); sw += w; sx += w * (i + 0.5); sy += w * (j + 0.5);
  }
  return sw > 0 ? [sx / sw, sy / sw] : [NaN, NaN];
}

describe(`${AC[12]} the CRT's curvature and its aperture mask`, () => {
  it(`${AC[12]} with curvature 0.1 the chart's 25 dots land within 0.5 px of the barrel map and the corners are masked; at curvature 0 no dot moves`, () => {
    requireGpu();
    const [bent, straight, plain] = runGpu(bins.bin('deep-gpu'), out(), [
      film2d(CHART, screen({ curvature: 0.1 }), { frames: 1, capture: [0] }),
      film2d(CHART, screen({ curvature: 0 }), { frames: 1, capture: [0] }),
      film2d(CHART, look2d('chart-464', {}, { finish: [] }), { frames: 1, capture: [0] }),
    ]);
    const img = (r: JsonObject | undefined, what: string): Image => readFinal(out(), frameAt(r!, 0, what), what);
    const b = img(bent, 'curvature 0.1'); const s = img(straight, 'curvature 0'); const p = img(plain, 'no screen');
    const problems: string[] = [];
    for (const u of GRID) for (const v of GRID) {
      const [ex, ey] = lands(u, v, 0.1);
      const [mx, my] = centroid(b, ex, ey);
      const d = Math.hypot(mx - ex, my - ey);
      if (!(d <= 0.5)) problems.push(`curvature 0.1: the dot at chart (${u}, ${v}) lands at (${mx.toFixed(2)}, ${my.toFixed(2)}), ${d.toFixed(2)} px from the barrel map's (${ex.toFixed(2)}, ${ey.toFixed(2)})`);
      const [sx, sy] = centroid(s, W / 2 + u * (W / 2), H / 2 + v * (H / 2));
      const [px, py] = centroid(p, W / 2 + u * (W / 2), H / 2 + v * (H / 2));
      if (!(Math.hypot(sx - px, sy - py) <= 0.05)) problems.push(`curvature 0: the dot at chart (${u}, ${v}) moved from (${px.toFixed(3)}, ${py.toFixed(3)}) to (${sx.toFixed(3)}, ${sy.toFixed(3)})`);
    }
    for (const [cx, cy] of [[0, 0], [W - 4, 0], [0, H - 4], [W - 4, H - 4]] as const) {
      let s2 = 0; for (let j = cy; j < cy + 4; j++) for (let i = cx; i < cx + 4; i++) s2 += lum(b, i, j);
      if (s2 / 16 > 25.5) problems.push(`curvature 0.1: the corner at (${cx}, ${cy}) isn't masked (mean ${(s2 / 16).toFixed(1)} of 255)`);
    }
    none(problems, `${AC[12]} curvature`);
  });

  it(`${AC[12]} mask: aperture repeats red, green and blue stripes every 3 device px within 0.1 px, each passing only its own channel above 90% of white`, () => {
    requireGpu();
    const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(flat('white-mask-464', [W, H]), screen({ mask: 'aperture' }), { frames: 1, capture: [0] })]);
    const img = readFinal(out(), frameAt(r!, 0, 'the aperture mask'), 'the aperture mask');
    const problems: string[] = [];
    const channelOf: number[] = [];
    for (let x = 0; x < W; x++) {
      const m = [0, 1, 2].map((c) => { let s = 0; for (let y = 0; y < H; y++) s += pixel(img, x, y)[c]!; return s / H; });
      const above = [0, 1, 2].filter((c) => m[c]! > 229.5);
      if (above.length !== 1) { problems.push(`column ${x} passes ${above.length} channels above 90% of white (${m.map((v) => v.toFixed(1)).join(', ')})`); channelOf.push(-1); } else channelOf.push(above[0]!);
    }
    for (let x = 1; x < W; x++) if (channelOf[x - 1]! >= 0 && channelOf[x]! >= 0 && channelOf[x] !== channelOf[x - 1] && channelOf[x] !== (channelOf[x - 1]! + 1) % 3) problems.push(`column ${x} passes channel ${channelOf[x]} after ${channelOf[x - 1]}, not red, green, blue in turn`);
    const reds: number[] = [];
    for (let x = 0; x < W; x++) if (channelOf[x] === 0 && channelOf[x - 1] !== 0) { let e = x; while (channelOf[e + 1] === 0) e++; reds.push((x + e + 1) / 2); }
    expect(reds.length, `red stripes across the frame (${reds.length})`).toBeGreaterThan(600);
    reds.forEach((c, k) => { const d = Math.abs(c - (reds[0]! + 3 * k)); if (d > 0.1) problems.push(`red stripe ${k} centres at ${c.toFixed(2)}, ${d.toFixed(2)} px off every 3 px from ${reds[0]!.toFixed(2)}`); });
    none(problems, `${AC[12]} the aperture mask`);
  });
});
