// AC2: "A repeater with 3.5 copies draws four copies, the last at half its opacity, and copy k's transform equals
// the repeater's applied k times within 1e-6"
// AC17: "A repeater of a 24 × 60 u bar with at.rot 30° and partial: slide with out_cubic, at copies 2.5, draws three
// bars at full opacity, the third at 56.25° within 1e-6°, where fade draws it at 60° at half opacity; with lag
// 0.2057 s and a child scale wave of 1 ± 0.22 with period 2.35 s, copy k's scale equals the child's at t − k × 0.2057 s
// within 1e-9; a planted repeater that evaluates every copy at t draws all twelve at one scale and fails, naming the op"
//
// Through `path` (its `copies` and `subpaths`) and `raster`. The repeater's one-copy transform T is built here from
// its `at` (Units and axes: scale, rotate, add the position; pivot 0), and copy k's expected transform is T applied k
// times, in f64. The design doesn't say which way degrees turn, so each test reads the sense from copy 1 and holds
// it for every copy (README: Readings). "The child's scale" is the bar's length: its box height is a channel, held at
// 60 u with a wave modifier of amplitude 13.2 u (0.22 × 60) and period 2.35 s, so a copy's scale is its bar's
// longest side ÷ 60 (README: Readings).
import { describe, expect, it } from 'vitest';
import {
  FLICKS, IDENTITY, TIMEOUT, apply, dist, failsNaming, figure, fl, item, keyed, none, pathAt, pathFrames, pixel,
  power, raster, repeaterStep, rotationOf, scratch, useRenderBinary, vertices, type JsonObject, type PathFrame, type Pt,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('repeater');

// ---------------------------------------------------------------------------------------------------
// AC2

const STEP_AT = { pos: [60, 20] as Pt, rot: 10, scale: [0.9, 0.9] as Pt };
const TILE: Pt[] = [[0, 0], [20, 0], [20, 20], [0, 20]];
const tiles = figure('repeater-tiles', [260, 220], [
  item('tile', 'rect@1', 'a0', { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } }, ops: [{ repeater: { copies: 3.5, at: { pos: STEP_AT.pos, rot: STEP_AT.rot, scale: STEP_AT.scale } } }] }),
]);

/** The sense degrees turn in, read from copy 1's transform (its b entry). */
const senseOf = (f: PathFrame): 1 | -1 => ((f.copies?.[1]?.transform[1] ?? 0) >= 0 ? 1 : -1);

describe('AC2 a fractional repeater', () => {
  it('AC2 a repeater with 3.5 copies has four copies, the last at half its opacity, and copy k\'s transform is the repeater\'s applied k times within 1e-6', () => {
    const f = pathAt(tiles, 'tile', 'the 3.5-copy repeater');
    expect(f.copies, 'a repeater\'s frame lists its copies').toBeDefined();
    const copies = f.copies!;
    expect(copies.length, '⌈3.5⌉ = 4 copies').toBe(4);
    const step = repeaterStep(STEP_AT.pos, STEP_AT.rot, STEP_AT.scale, senseOf(f));
    const failures: string[] = [];
    copies.forEach((c, k) => {
      const want = power(step, k);
      const off = Math.max(...want.map((w, j) => Math.abs((c.transform[j] ?? NaN) - w)));
      if (!(off <= 1e-6)) failures.push(`copy ${k}'s transform ${JSON.stringify(c.transform)} is ${off} from T^${k} = ${JSON.stringify(want)}`);
      const opacity = k < 3 ? 1 : 0.5;
      if (!(Math.abs(c.opacity - opacity) <= 1e-6)) failures.push(`copy ${k}'s opacity is ${c.opacity}, not ${opacity}`);
    });
    none(failures, 'the copies against T^k and their opacities');
    expect(power(step, 0), 'copy 0 is the item itself').toEqual(IDENTITY);

    // Its sub-paths: one square per copy, in copy order, each T^k of the tile.
    expect(f.subpaths.length, 'four squares').toBe(4);
    f.subpaths.forEach((sp, k) => {
      const got = vertices(sp);
      const want = TILE.map((p) => apply(power(step, k), p));
      expect(got.length, `copy ${k} has four corners`).toBe(4);
      for (const w of want) expect(Math.min(...got.map((g) => dist(g, w))), `copy ${k} has the corner T^${k}(${w.map((v) => v.toFixed(3)).join(', ')})`).toBeLessThanOrEqual(1e-3);
    });
    expect(f.segments, 'the 3.5-copy repeater builds ⌈3.5⌉ × 4 = 16 segments').toBe(16);
  }, TIMEOUT);

  it('AC2 the four copies draw where they are, three in full and the last at half opacity, and no fifth', () => {
    const f = pathAt(tiles, 'tile', 'the 3.5-copy repeater');
    const step = repeaterStep(STEP_AT.pos, STEP_AT.rot, STEP_AT.scale, senseOf(f));
    const { image } = raster(dir, tiles, 'the 3.5-copy repeater');
    const failures: string[] = [];
    for (let k = 0; k < 5; k++) {
      const c = apply(power(step, k), [10, 10]);
      const got = pixel(image, c[0], c[1]);
      // Ink at 0.5 over white composites to 127.5 in sRGB-encoded space (canvas core: Conventions).
      const ok = k < 3 ? got.every((v) => v === 0) : k === 3 ? got.every((v) => v >= 126 && v <= 129) : got.every((v) => v === 255);
      if (!ok) failures.push(`copy ${k}'s centre (${c[0].toFixed(1)}, ${c[1].toFixed(1)}) reads ${JSON.stringify(got)}, not ${k < 3 ? 'ink' : k === 3 ? 'ink at half opacity, about 127.5' : 'the ground (there is no fifth copy)'}`);
    }
    none(failures, 'the copies\' pixels');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC17

function bars(repeater: JsonObject, extra: JsonObject = {}): JsonObject {
  return figure('repeater-bars', [300, 300], [
    item('bar', 'rect@1', 'a0', { box: [-12, -60, 24, 60], paint: { fill: { role: 'ink' } }, ops: [{ repeater: { at: { rot: 30 }, ...repeater } }] }, { at: { pos: [150, 150, 0] } }),
  ], extra);
}
/** The out_cubic ease (Penner's): 1 − (1 − u)³. */
const outCubic = (u: number): number => 1 - (1 - u) ** 3;

describe('AC17 partial copies and lag', () => {
  it('AC17 at copies 2.5, partial: slide with out_cubic draws three bars at full opacity, the third at 56.25° within 1e-6°', () => {
    const f = pathAt(bars({ copies: 2.5, partial: 'slide', ease: 'out_cubic' }), 'bar', 'the sliding repeater');
    const copies = f.copies ?? [];
    expect(copies.length, '⌈2.5⌉ = 3 bars').toBe(3);
    const third = 30 + 30 * outCubic(0.5); // the last copy slides from copy 1's 30° to its own 60°, eased: 56.25°
    expect(third).toBe(56.25);
    const failures: string[] = [];
    [0, 30, third].forEach((deg, k) => {
      const c = copies[k]!;
      const got = Math.abs(rotationOf(c.transform));
      if (!(Math.abs(got - deg) <= 1e-6)) failures.push(`bar ${k} is at ${got}°, not ${deg}°`);
      if (!(Math.abs(c.opacity - 1) <= 1e-6)) failures.push(`bar ${k}'s opacity is ${c.opacity}, not 1 (slide keeps the last bar opaque)`);
    });
    none(failures, 'the sliding bars');
  }, TIMEOUT);

  it('AC17 at copies 2.5, partial: fade draws the third bar at 60° at half opacity', () => {
    const f = pathAt(bars({ copies: 2.5, partial: 'fade' }), 'bar', 'the fading repeater');
    const copies = f.copies ?? [];
    expect(copies.length, '⌈2.5⌉ = 3 bars').toBe(3);
    const failures: string[] = [];
    [[0, 1], [30, 1], [60, 0.5]].forEach(([deg, opacity], k) => {
      const c = copies[k]!;
      const got = Math.abs(rotationOf(c.transform));
      if (!(Math.abs(got - deg!) <= 1e-6)) failures.push(`bar ${k} is at ${got}°, not ${deg}°`);
      if (!(Math.abs(c.opacity - opacity!) <= 1e-6)) failures.push(`bar ${k}'s opacity is ${c.opacity}, not ${opacity}`);
    });
    none(failures, 'the fading bars');
  }, TIMEOUT);

  // The lag: 12 copies 30° apart, copy k's content at t − k × 0.2057 s; 0.2057 s is 145,141,920 flicks exactly.
  const LAG = fl(0.2057);
  const OP = 'items/bar/params/ops/0 (the repeater)';
  const waving = bars({ copies: 12, lag: '0.2057s' }, {
    transport: { span: '10s' },
    channels: { 'bar-length': keyed('items/bar/params/box/3', [[0, 60]], 'hold', { modifiers: [{ wave: { amplitude: 13.2, period: 2.35 } }] }) },
  });
  const TIMES = [fl(3), fl(3.5), fl(4.25)];
  /** The child's scale at t flicks, from the issue's wave: 1 + 0.22 sin(2π t ÷ 2.35 s). */
  const scaleAt = (t: number): number => 1 + 0.22 * Math.sin((2 * Math.PI * (t / FLICKS)) / 2.35);
  /** A bar's scale: its longest side ÷ 60 (its sides are 24 u and 60 × scale, scale ≥ 0.78). */
  const barScale = (f: PathFrame, k: number): number => {
    const v = vertices(f.subpaths[k]!);
    return Math.max(...v.map((p, i) => dist(p, v[(i + 1) % v.length]!))) / 60;
  };

  function lagFailures(frames: PathFrame[], children: Map<number, number>): string[] {
    const failures: string[] = [];
    frames.forEach((f) => {
      if ((f.copies ?? []).length !== 12 || f.subpaths.length !== 12) { failures.push(`at ${f.t} flicks ${OP} draws ${(f.copies ?? []).length} copies and ${f.subpaths.length} sub-paths, not 12`); return; }
      for (let k = 0; k < 12; k++) {
        const at = f.t - k * LAG;
        if (f.copies![k]!.t !== at) failures.push(`at ${f.t} flicks copy ${k} of ${OP} evaluates at ${f.copies![k]!.t}, not t − ${k} × lag = ${at}`);
        const got = barScale(f, k);
        const want = scaleAt(at);
        if (!(Math.abs(got - want) <= 1e-9)) failures.push(`at ${f.t} flicks copy ${k} of ${OP} has scale ${got}, not the wave's ${want} at t − ${k} × 0.2057 s (off ${Math.abs(got - want)})`);
        const child = children.get(at);
        if (child !== undefined && !(Math.abs(got - child) <= 1e-9)) failures.push(`at ${f.t} flicks copy ${k} of ${OP} has scale ${got}, not the child's own ${child} at ${at} flicks`);
      }
    });
    return failures;
  }

  /** The child's own scale at each copy's time: the first copy (k = 0) of a frame at that time. */
  function childScales(): Map<number, number> {
    const at = [...new Set(TIMES.flatMap((t) => Array.from({ length: 12 }, (_, k) => t - k * LAG)))].sort((a, b) => a - b);
    const frames = pathFrames({ doc: waving, item: 'bar', times: at }, 'the bar alone at each copy\'s time');
    return new Map(frames.map((f) => [f.t, barScale(f, 0)]));
  }

  it('AC17 with lag 0.2057 s and a child scale wave of 1 ± 0.22 with period 2.35 s, copy k\'s scale equals the child\'s at t − k × 0.2057 s within 1e-9', () => {
    const children = childScales();
    for (const [t, s] of children) expect(Math.abs(s - scaleAt(t)), `the child's scale at ${t} flicks is the wave's`).toBeLessThanOrEqual(1e-9);
    const frames = pathFrames({ doc: waving, item: 'bar', times: TIMES }, 'the lagging repeater');
    none(lagFailures(frames, children), 'each copy against the child at t − k × lag');
    // Copy k is also turned k × 30° (its repeater transform), whatever its content's time.
    for (const f of frames) {
      for (let k = 0; k < 12; k++) {
        const want = Math.abs(rotationOf(power(repeaterStep([0, 0], 30, [1, 1], 1), k)));
        expect(Math.abs(Math.abs(rotationOf(f.copies![k]!.transform)) - want), `copy ${k} at ${f.t} flicks is turned ${k} × 30°`).toBeLessThanOrEqual(1e-6);
      }
    }
  }, TIMEOUT);

  it('AC17 a planted repeater that evaluates every copy at t draws all twelve at one scale and fails, naming the op', () => {
    const children = childScales();
    const frames = pathFrames({ doc: waving, item: 'bar', times: TIMES, planted: 'repeater_evaluates_at_t' }, 'the planted repeater');
    for (const f of frames) {
      const scales = Array.from({ length: Math.min(12, f.subpaths.length) }, (_, k) => barScale(f, k));
      expect(Math.max(...scales) - Math.min(...scales), `under the plant all twelve bars at ${f.t} flicks have one scale`).toBeLessThanOrEqual(1e-12);
    }
    failsNaming(lagFailures(frames, children), ['items/bar/params/ops/0'], 'the planted repeater against the lag');
  }, TIMEOUT);
});
