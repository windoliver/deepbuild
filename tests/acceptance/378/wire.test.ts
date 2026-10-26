// #378.9c0b9845: a wire with per-point width draws in strip, segment and loop modes, and a label set to stay
// upright stays upright while the camera orbits.
// fixtures/wires.json: one six-point wire with per-point widths 6, 18, 6, 18, 6 and 30 px, drawn three times
// in an orthographic view (40 px per m): as a strip, as segments and as a loop. Read from the object-ID
// target: each drawn segment's thickness at 30%, 50% and 70% along it is the widths of its two points
// interpolated, within 1.5 px; each segment the mode leaves out shows no wire. The modes are each other's
// twins: the three wires draw different segment sets, so a mode drawn as another fails.
// fixtures/upright.json: two labels reading FFFF in 1.5 m type, one `facing: upright` (red) and one
// `facing: camera` (green), under an orthographic camera at 60° elevation that orbits at 90° a second for
// 4 s. Read from the final frame every 8th frame: the upright label's baseline stays level, its size and the
// way it reads (where its ink sits in its box) hold through the orbit and match the camera-facing label's,
// and its height is cos 60° of the camera-facing label's, since it turns about +Y only. The camera-facing
// label is the check's twin: it fails the upright check on its height. At the base `deep-gpu` answers the
// view3d call with bad_input.
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, fixture, fixturePath, frameAt, greenness, ink, look, readIds, readPng, redness, requireGpu, runGpu, useBins, useOut, view3d, view3Reply,
  type Ids, type Ink, type JsonObject,
} from './helpers.ts';

const bins = useBins([GPU_BIN]);
const out = useOut();

// ---- wires
const WIRES = fixture('wires.json');
const WSIZE = WIRES['size'] as [number, number];
const witems = WIRES['items'] as Record<string, JsonObject>;
const PX_PER_M = WSIZE[0] / 20;
const toPx = ([x, y]: number[]): [number, number] => [WSIZE[0] / 2 + PX_PER_M * x!, WSIZE[1] / 2 - PX_PER_M * y!];
const MODES = { 'wire-strip': 'strip', 'wire-segments': 'segments', 'wire-loop': 'loop' } as const;
type WireId = keyof typeof MODES;
/** The segments a mode draws over n points, as index pairs (Marks in 3D: lines). */
function drawn(mode: 'strip' | 'segments' | 'loop', n: number): [number, number][] {
  if (mode === 'segments') return Array.from({ length: Math.floor(n / 2) }, (_, k) => [2 * k, 2 * k + 1]);
  const strip = Array.from({ length: n - 1 }, (_, k): [number, number] => [k, k + 1]);
  return mode === 'loop' ? [...strip, [n - 1, 0]] : strip;
}
const FRACTIONS = [0.3, 0.5, 0.7];

/** The wire's thickness through point m, across the segment's direction, from the ID target. */
function thickness(ids: Ids, id: string, m: [number, number], dir: [number, number]): number {
  const n: [number, number] = [-dir[1], dir[0]];
  const hit = (t: number): boolean => ids.at(m[0] + n[0] * t, m[1] + n[1] * t) === id;
  if (!hit(0)) return 0;
  let lo = 0; let hi = 0;
  while (lo > -40 && hit(lo - 0.25)) lo -= 0.25;
  while (hi < 40 && hit(hi + 0.25)) hi += 0.25;
  return hi - lo + 0.25;
}

/** Every failure of one wire against a mode: segments missing, too thin or too thick, or drawn where the mode draws none. */
function wireProblems(ids: Ids, id: WireId, mode: 'strip' | 'segments' | 'loop', what: string): string[] {
  const p = witems[id]!['params'] as JsonObject;
  const points = (p['points'] as number[][]).map(toPx);
  const widths = p['width'] as number[];
  const want = drawn(mode, points.length);
  const problems: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const a = points[i]!; const b = points[j]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const isDrawn = want.some(([s, e]) => s === i && e === j);
    for (const f of FRACTIONS) {
      const m: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const t = thickness(ids, id, m, dir);
      if (isDrawn) {
        const w = widths[i]! + (widths[j]! - widths[i]!) * f;
        if (Math.abs(t - w) > 1.5) problems.push(`${what}: segment ${i}→${j} at ${f * 100}% along is ${t.toFixed(2)} px thick, not ${w.toFixed(1)} px (the widths of points ${i} and ${j}, ${widths[i]} and ${widths[j]}, interpolated)`);
      } else if (t > 0) problems.push(`${what}: segment ${i}→${j}, which ${mode} doesn't draw, shows the wire at ${f * 100}% along`);
    }
  }
  return problems;
}

// ---- the upright label
const UPRIGHT = fixture('upright.json');
const USIZE = UPRIGHT['size'] as [number, number];
const camOrbit = ((UPRIGHT['items'] as Record<string, JsonObject>)['cam']!['params'] as JsonObject)['orbit'] as JsonObject;
const COS_ELEVATION = Math.cos(((camOrbit['elevation'] as number) * Math.PI) / 180);
const FRAMES = 240;
const CAPTURED = Array.from({ length: FRAMES / 8 }, (_, k) => k * 8);

interface Shape { w: number; h: number; rx: number; ry: number; angle: number }
const shape = (i: Ink): Shape => {
  const [x0, y0, x1, y1] = i.box;
  return { w: x1 - x0, h: y1 - y0, rx: (i.cx - x0) / (x1 - x0), ry: (i.cy - y0) / (y1 - y0), angle: i.angle };
};
/** A label that stays upright: level, the same size and reading the same way at every captured frame, and cos(elevation) of a camera-facing label's height. */
function uprightProblems(label: Shape[], facing: Shape[], what: string): string[] {
  const problems: string[] = [];
  const first = label[0]!;
  label.forEach((s, k) => {
    const at = `${what}, frame ${CAPTURED[k]}`;
    if (Math.abs(s.angle) > 4 || Math.abs(s.angle - first.angle) > 2) problems.push(`${at}: its baseline turns to ${s.angle.toFixed(2)}° (frame 0: ${first.angle.toFixed(2)}°)`);
    if (Math.abs(s.w - first.w) > 3 || Math.abs(s.h - first.h) > 2) problems.push(`${at}: its ink is ${s.w} × ${s.h} px, not frame 0's ${first.w} × ${first.h}`);
    if (Math.abs(s.rx - first.rx) > 0.06 || Math.abs(s.ry - first.ry) > 0.06) problems.push(`${at}: it reads another way (its ink's centre sits at ${s.rx.toFixed(2)}, ${s.ry.toFixed(2)} of its box; frame 0: ${first.rx.toFixed(2)}, ${first.ry.toFixed(2)})`);
    const f = facing[k]!;
    if (Math.abs(s.h - COS_ELEVATION * f.h) > 2.5) problems.push(`${at}: its height ${s.h} px isn't cos ${camOrbit['elevation']}° of the camera-facing label's ${f.h} px (${(COS_ELEVATION * f.h).toFixed(1)}): it doesn't turn about +Y only`);
    if (Math.abs(s.w - f.w) > 3) problems.push(`${at}: its width ${s.w} px isn't the camera-facing label's ${f.w} px`);
    if (Math.abs(s.rx - f.rx) > 0.06 || Math.abs(s.ry - f.ry) > 0.06) problems.push(`${at}: it reads another way than the camera-facing label (mirrored or upside down)`);
  });
  return problems;
}

describe('#378.9c0b9845 a wire with per-point width draws in strip, segment and loop modes, and a label set to stay upright stays upright while the camera orbits', () => {
  it('#378.9c0b9845 the wire draws exactly its mode\'s segments in strip, segments and loop modes, each as thick as its two points\' widths interpolated; each wire fails the other modes\' checks', () => {
    requireGpu();
    const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: fixturePath('wires.json'), look: look(), size: WSIZE, targets: ['ids'], capture: [0] })]);
    const f = frameAt(view3Reply(reply!, 'the wires fixture'), 0, 'the wires fixture');
    const ids = readIds(out(), f, 'frame 0\'s object-ID target');
    for (const [id, mode] of Object.entries(MODES) as [WireId, 'strip' | 'segments' | 'loop'][]) {
      expect(wireProblems(ids, id, mode, `${id} (${mode})`), `${id} draws in ${mode} mode`).toEqual([]);
      for (const other of ['strip', 'segments', 'loop'] as const) {
        if (other !== mode) expect(wireProblems(ids, id, other, `${id} as ${other}`).length, `${id} fails the ${other} check (the modes draw different segments)`).toBeGreaterThan(0);
      }
    }
  }, 600_000);

  it('#378.9c0b9845 while the camera orbits at 90° a second, the upright label stays level, keeps its size and reading, and is cos 60° of the camera-facing label\'s height; the camera-facing label fails the upright check', () => {
    requireGpu();
    const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: fixturePath('upright.json'), look: look(), size: USIZE, frames: FRAMES, fps: 60, targets: ['final'], capture: CAPTURED })]);
    const v = view3Reply(reply!, 'the upright fixture');
    const up: Shape[] = []; const facing: Shape[] = [];
    for (const n of CAPTURED) {
      const image = readPng(out(), frameAt(v, n, 'the upright fixture').final, `frame ${n}'s final frame`);
      const a = ink(image, redness); const b = ink(image, greenness);
      expect(a.mass, `frame ${n}: the upright label draws`).toBeGreaterThan(50);
      expect(b.mass, `frame ${n}: the camera-facing label draws`).toBeGreaterThan(50);
      up.push(shape(a)); facing.push(shape(b));
    }
    expect(facing[0]!.w / facing[0]!.h, 'the camera-facing label reads as a wide line of type').toBeGreaterThan(2);
    expect(uprightProblems(up, facing, 'the upright label'), 'the upright label through the orbit').toEqual([]);
    expect(uprightProblems(facing, facing, 'the camera-facing label').some((p) => p.includes('turn about +Y only')), 'the twin: a camera-facing label fails the upright check').toBe(true);
  }, 600_000);
});
