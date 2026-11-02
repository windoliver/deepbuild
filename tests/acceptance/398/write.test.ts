// AC4: Writing a 3-term formula over 1.2 s gives each term 6/7 s, the terms starting at 0, 6/35 and 12/35 s
// (lag 0.2): at 0.15 s term 1's outline is 0.35 drawn within 0.01 with no fill; from 3/7 s its fill comes in while
// the outline turns into its stroke, and at 6/7 s it is filled with its own stroke; term 3 draws nothing before
// 12/35 s; and a planted write that fades fills in from the start fails the 0.15 s frame by the perceptual oracle.
//
// The expected values come from the formula source the Oracle page names, Manim CE's creation.py at a6d5cc02b4
// (Write's lag_ratio min(4 / n, 0.2); DrawBorderThenFill draws the outline over the first half of each unit's
// span, then interpolates to the filled shape) and Animation's lagged sub-alpha (full span 1 + (n − 1) × lag; unit
// k's progress clamp(α × full − k × lag, 0, 1)), with the design's linear progress: α = t ÷ 1.2 s.
import { describe, expect, it } from 'vitest';
import {
  codeDiff, countWhere, expectClean, f32Channel, flicks, interiorMask, paint, perceptualProblems, pixel, put, raster, rasterAt, role, same,
  scratch, solid, useRenderBinary, vectorDoc, vectorItem, type Image, type JsonObject, type Rgb, type Segment,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('write');

const N = 3;
const LAG = Math.min(4 / N, 0.2); // 0.2
const RUN = 1.2; // s
// So each term's span is RUN ÷ (1 + (N − 1) × LAG) = 6/7 s and term k starts at k × LAG × 6/7 s: 0, 6/35, 12/35 s;
// at 0.15 s term 1's progress is 0.175, its outline 0.35 drawn; it reaches 0.5 at 3/7 s and 1 at 6/7 s.
/** Term k's own progress at t seconds. */
const progress = (t: number, k: number): number => Math.min(1, Math.max(0, (t / RUN) * (1 + (N - 1) * LAG) - k * LAG));
/** The share of term k's outline drawn at t (the first half of its span draws it all). */
const drawn = (t: number, k: number): number => Math.min(1, 2 * progress(t, k));

// formula3.svg: three 125 u squares, each path starting at its top-left corner and running clockwise on screen,
// centrelines on pixel centres, filled #3366cc (role term) with their own 3 u #000000 stroke (role ink).
const SIDE = 125;
const PERIMETER = 4 * SIDE;
const X0 = [20.5, 170.5, 320.5];
const Y0 = 20.5;
const W = 460;
const H = 170;

/** The point at arc length s along term k's outline. */
function along(k: number, s: number): [number, number] {
  const x = X0[k]!; const e = Math.floor(s / SIDE); const r = s - e * SIDE;
  if (e === 0) return [x + r, Y0];
  if (e === 1) return [x + SIDE, Y0 + r];
  if (e === 2) return [x + SIDE - r, Y0 + SIDE];
  return [x, Y0 + SIDE - r];
}
const corners = (k: number): [number, number][] => [[X0[k]!, Y0], [X0[k]! + SIDE, Y0], [X0[k]! + SIDE, Y0 + SIDE], [X0[k]!, Y0 + SIDE]];
const outlineSegments = (k: number): Segment[] => corners(k).map((c, i) => { const d = corners(k)[(i + 1) % 4]!; return [c[0], c[1], d[0], d[1]]; });

/** The outline in its stroke paint (ink), not in the fill's paint. */
const isOutline = (c: Rgb): boolean => codeDiff(c, role('ink')) <= 64;

/** The share of term k's outline drawn, read from the pixels on its centreline at every 1 u from its start. */
function measuredDrawn(image: Image, k: number): { share: number; stray: string | null } {
  const samples = PERIMETER;
  const on = Array.from({ length: samples }, (_, i) => { const [x, y] = along(k, i + 0.5); return isOutline(pixel(image, x, y)); });
  let n = 0;
  while (n < samples && on[n]) n++;
  // Nothing past the drawn run (beyond 4 u of its end, and short of the last 4 u, which the start's stroke covers).
  const stray = on.findIndex((v, i) => v && i >= n + 4 && i < samples - 4);
  return { share: n / samples, stray: stray < 0 ? null : `term ${k + 1}'s outline is drawn at ${stray + 0.5} u along it, past its drawn run of ${n} u` };
}

/** Term k's inside, 7 px clear of its centreline. */
const inside = (k: number): [number, number, number, number] => [Math.floor(X0[k]!) + 7, Math.floor(Y0) + 7, Math.floor(X0[k]!) + SIDE - 6, Math.floor(Y0) + SIDE - 6];
/** Term k's region: its square with 6 px around it. */
const region = (k: number): [number, number, number, number] => [Math.floor(X0[k]!) - 6, Math.floor(Y0) - 6, Math.floor(X0[k]!) + SIDE + 7, Math.floor(Y0) + SIDE + 7];

function notGround(image: Image, [x0, y0, x1, y1]: [number, number, number, number]): number {
  return countWhere(image, x0, y0, x1, y1, (c) => !same(c, role('ground')));
}

/** How far term k's inside has filled, from the red channel (ground 255, term 51), and whether it is uniform. */
function fillOf(image: Image, k: number): { amount: number; spread: number } {
  const [x0, y0, x1, y1] = inside(k);
  let lo = Infinity; let hi = -Infinity;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const r = pixel(image, x, y)[0]; lo = Math.min(lo, r); hi = Math.max(hi, r); }
  const ground = role('ground')[0]; const term = role('term')[0];
  return { amount: (ground - (lo + hi) / 2) / (ground - term), spread: hi - lo };
}

const src = put(dir, 'formula3.svg');
const COLORS = { '#000000': 'ink', '#3366cc': 'term' };
const writing: JsonObject = vectorDoc('ac4-write', [W, H], [vectorItem('f', { src, size: [W, H], colors: COLORS, alt: 'a + b + c', write_on: { progress: 0, order: 'term' } })], {
  write: f32Channel('items/f/params/write_on/progress', [[0, 0], [RUN, 1]]),
});
const still: JsonObject = vectorDoc('ac4-still', [W, H], [vectorItem('f', { src, size: [W, H], colors: COLORS, alt: 'a + b + c' })]);

/** The analytic 0.15 s frame: the ground, and term 1's outline drawn 0.35 of the way in ink, 3 u wide. */
function reference015(): Image {
  const image = solid(W, H, role('ground'));
  const length = drawn(0.15, 0) * PERIMETER;
  const segments = outlineSegments(0);
  paint(image, (x, y) => {
    for (let i = 0; i < segments.length; i++) {
      const upTo = Math.min(SIDE, length - i * SIDE);
      if (upTo <= 0) break;
      const [ax, ay, bx, by] = segments[i]!;
      const dx = (bx - ax) / SIDE; const dy = (by - ay) / SIDE;
      const t = Math.max(0, Math.min(upTo, (x - ax) * dx + (y - ay) * dy));
      if (Math.hypot(ax + dx * t - x, ay + dy * t - y) <= 1.5) return role('ink');
    }
    return null;
  });
  return image;
}

/** The 0.15 s comparison's interior: every pixel farther than 7.5 u from term 1's centreline (an outline up to 12 u wide, plus 1.5 px). */
const interior015 = (): Uint8Array => interiorMask(W, H, outlineSegments(0), 7.5);

const at = (s: number): number => flicks(Math.round(s * 1000), 1000);

describe('AC4 write_on draws each term outline first, then its fill, the terms lagged by min(4 ÷ n, 0.2)', () => {
  it('AC4 at 0.15 s term 1\'s outline is 0.35 drawn within 0.01, from its start along its path, in its stroke paint, with no fill; terms 2 and 3 draw nothing', () => {
    expectClean(writing, dir, 'formula3.svg written on');
    const frame = raster(dir, writing, dir, at(0.15), 'the write at 0.15 s');
    const m = measuredDrawn(frame, 0);
    expect(Math.abs(m.share - 0.35), `term 1's outline is ${m.share} drawn`).toBeLessThanOrEqual(0.01);
    expect(m.stray, 'the drawn outline is one run from the path\'s start').toBeNull();
    const [x0, y0, x1, y1] = inside(0);
    expect(countWhere(frame, x0, y0, x1, y1, (c) => !same(c, role('ground'))), 'term 1 has no fill: its inside is the ground').toBe(0);
    expect(notGround(frame, region(1)), 'term 2 (starting at 6/35 s) draws nothing').toBe(0);
    expect(notGround(frame, region(2)), 'term 3 (starting at 12/35 s) draws nothing').toBe(0);
  });

  it('AC4 the 0.15 s frame passes the perceptual oracle against the analytic frame, and the planted write_fades_fills_from_start fails it', () => {
    const reference = reference015();
    const interior = interior015();
    const ours = raster(dir, writing, dir, at(0.15), 'the write at 0.15 s');
    expect(perceptualProblems('the write at 0.15 s', ours, reference, interior), 'our 0.15 s frame matches the analytic frame').toEqual([]);
    const planted = raster(dir, writing, dir, at(0.15), 'the planted write at 0.15 s', { planted: 'write_fades_fills_from_start' });
    const problems = perceptualProblems('the planted write at 0.15 s', planted, reference, interior);
    expect(problems.length, 'the planted write that fades fills in from the start fails the perceptual oracle').toBeGreaterThan(0);
    expect(problems.some((p) => p.startsWith('BLOCKED')), `it fails on its pixels, not the blank guard: ${problems.join('; ')}`).toBe(false);
    expect(fillOf(planted, 0).amount, 'the planted write shows fill inside term 1 at 0.15 s').toBeGreaterThan(0.02);
  });

  it('AC4 each term starts on time and draws at its own pace: terms 2 and 3 start at 6/35 and 12/35 s, and the drawn shares at 0.3, 0.42 and 0.6 s follow the 6/7 s span', () => {
    const times = [0.165, 0.19, 0.3, 0.34, 0.36, 0.42, 0.6];
    const frames = rasterAt(dir, writing, dir, times.map(at), 'the write');
    const byTime = new Map(times.map((t, i) => [t, frames[i]!]));
    expect(notGround(byTime.get(0.165)!, region(1)), 'term 2 draws nothing at 0.165 s, before 6/35 s').toBe(0);
    expect(notGround(byTime.get(0.19)!, region(1)), 'term 2 draws at 0.19 s, after 6/35 s').toBeGreaterThanOrEqual(10);
    for (const t of [0.3, 0.34]) expect(notGround(byTime.get(t)!, region(2)), `term 3 draws nothing at ${t} s, before 12/35 s`).toBe(0);
    expect(notGround(byTime.get(0.36)!, region(2)), 'term 3 draws at 0.36 s, after 12/35 s').toBeGreaterThanOrEqual(10);
    // Drawn shares while each outline is still drawing (its progress under 0.5): 0.3 s → 0.7, 0.3; 0.42 s → 0.98,
    // 0.58, 0.18; 0.6 s → term 3 at 0.6.
    const checks: [number, number][] = [[0.3, 0], [0.3, 1], [0.42, 0], [0.42, 1], [0.42, 2], [0.6, 2]];
    for (const [t, k] of checks) {
      const m = measuredDrawn(byTime.get(t)!, k);
      expect(Math.abs(m.share - drawn(t, k)), `at ${t} s term ${k + 1}'s outline is ${m.share} drawn, expected ${drawn(t, k)}`).toBeLessThanOrEqual(0.01);
      expect(m.stray).toBeNull();
    }
  });

  it('AC4 term 1\'s fill comes in from 3/7 s while its outline is whole, and at 6/7 s it is filled with its own stroke', () => {
    const times = [0.42, 3 / 7, 0.6, 0.75];
    const frames = rasterAt(dir, writing, dir, times.map((t, i) => (i === 1 ? flicks(3, 7) : at(t))), 'the write');
    const [f042, f37, f06, f075] = frames as [Image, Image, Image, Image];
    expect(fillOf(f042, 0).amount, 'no fill at 0.42 s, before 3/7 s').toBe(0);
    expect(fillOf(f37, 0).amount, 'no fill yet at 3/7 s').toBeLessThanOrEqual(0.01);
    expect(measuredDrawn(f37, 0).share, 'at 3/7 s the outline is whole').toBeGreaterThanOrEqual(0.99);
    const a06 = fillOf(f06, 0); const a075 = fillOf(f075, 0);
    expect(a06.amount, 'at 0.6 s the fill is coming in').toBeGreaterThan(0.1);
    expect(a075.amount, 'at 0.75 s it is further in').toBeGreaterThan(a06.amount + 0.05);
    expect(a075.amount, 'and not yet whole').toBeLessThan(0.97);
    expect(a06.spread, 'the fill comes in evenly over the term').toBeLessThanOrEqual(2);
    for (const [name, f] of [['0.6 s', f06], ['0.75 s', f075]] as const) expect(measuredDrawn(f, 0).share, `at ${name} the outline stays whole while it turns into the stroke`).toBeGreaterThanOrEqual(0.99);

    const done = raster(dir, writing, dir, flicks(6, 7), 'the write at 6/7 s');
    const plain = raster(dir, still, dir, 0, 'the formula with no write');
    const [rx0, ry0, rx1, ry1] = region(0);
    const crop = (img: Image): Image => {
      const w = rx1 - rx0; const h = ry1 - ry0; const out = solid(w, h, [0, 0, 0]);
      paint(out, (x, y) => pixel(img, rx0 + x, ry0 + y));
      return out;
    };
    const edges: Segment[] = [];
    for (const off of [-1.5, 1.5]) {
      const a = X0[0]! - rx0 - off; const b = Y0 - ry0 - off; const s = SIDE + 2 * off;
      edges.push([a, b, a + s, b], [a + s, b, a + s, b + s], [a + s, b + s, a, b + s], [a, b + s, a, b]);
    }
    const mask = interiorMask(rx1 - rx0, ry1 - ry0, edges, 1.5);
    expect(perceptualProblems('term 1 at 6/7 s against the formula drawn whole', crop(done), crop(plain), mask), 'at 6/7 s term 1 is the formula\'s own term: filled, with its own stroke').toEqual([]);
    expect(codeDiff(pixel(done, 80, 80), role('term')), 'filled in the term role').toBeLessThanOrEqual(1);
    expect(measuredDrawn(done, 0).share, 'with its whole stroke in ink').toBe(1);
  });
});
