// AC5: "Each op matches its CPU reference within 0.01 u on its parity fixture (parity/2d/path-ops.scene), and a
// planted change in any op's output fails it"
//
// fixtures/parity/2d/path-ops.scene holds one item per op. Each op's CPU reference is computed here in f64 from the
// op's definition (Path: ops) and the reading this suite gives where the design leaves one (README: Readings):
//
// - trim 0.1..0.6 of `M 20 40 L 120 40 L 120 340` (400 u): the polyline from 40 u to 240 u along it;
// - round_corners 10 on a 100 u square: the square with quarter circles of radius 10 at its corners;
// - offset_path 10, miter, on an 80 u square: the 100 u square around it (a positive amount grows a closed path);
// - zigzag size 10, 5 ridges, corner, on a 200 u line: its ridges at 1/6 … 5/6 of its length, 10 u off it to
//   alternate sides (Lottie's zig zag), its ends at the line's ends along it;
// - pucker 0.5 (a bloat) on a 100 u square: Lottie's pucker and bloat, each vertex moved toward the centre (the
//   vertices' mean) by the amount and each handle away from it by the amount, so every edge becomes a cubic;
// - twist 30° about a 6-point star's centre: each point turned by 30° × (1 − d ÷ R), R the farthest point's
//   distance, so the outer vertices (R = 100) stay and the inner ones (40) turn 18°;
// - repeater of 3 copies 40 u apart: the triangle at 0, 40 and 80 u.
//
// Sub-paths are compared by their Hausdorff distance to the reference (both ways, sampled every 0.25 u), and the
// zig zag, the twist and the repeater by their vertices. The planted change is `moved:<op>`: that op's output moved
// 0.02 u along +x, just past the tolerance (README: Planted values). The fixtures' planted-fault twins (373's
// convention) are here too: each fails the check with exactly its code, naming its item.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, arr, batch, bezier, check, clone, dist, errorsOf, expectClean, expectRefused, firstDifference,
  fixture, flatten, hausdorff, inked, none, obj, paramsOf, pathAccepted, raster, rasterInput, scratch,
  useRenderBinary, vertices, type JsonObject, type PathFrame, type Pt,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('parity');
const DOC = fixture('path-ops.scene');
const TOL = 0.01;

const square = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

/** The rounded square [x0, x1] × [y0, y1] with corner radius r, as one closed polyline (arcs every 0.5°). */
function roundedSquare(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const out: Pt[] = [];
  const corners: [number, number, number][] = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]];
  for (const [cx, cy, from] of corners) for (let a = 0; a <= 90; a += 0.5) { const t = ((from + a) * Math.PI) / 180; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  out.push(out[0]!);
  return out;
}

/** Lottie's bloat of a closed polygon by `a`: v' = v + (c − v)a; each handle (at its vertex on a line) h' = v − (c − v)a. */
function bloated(poly: Pt[], a: number): Pt[] {
  const n = poly.length;
  const c: Pt = [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  const v = poly.map((p) => [p[0] + (c[0] - p[0]) * a, p[1] + (c[1] - p[1]) * a] as Pt);
  const h = poly.map((p) => [p[0] - (c[0] - p[0]) * a, p[1] - (c[1] - p[1]) * a] as Pt);
  const out: Pt[] = [v[0]!];
  for (let i = 0; i < n; i++) {
    const seg: Pt[] = [v[i]!, h[i]!, h[(i + 1) % n]!, v[(i + 1) % n]!];
    for (let k = 1; k <= 512; k++) out.push(bezier(seg, k / 512));
  }
  return out;
}

/** Each expected point has an output point within the tolerance, and the counts agree. */
function pointSetFailures(got: Pt[], want: Pt[], what: string): string[] {
  const failures: string[] = [];
  if (got.length !== want.length) failures.push(`${what}: ${got.length} vertices, not ${want.length}`);
  for (const w of want) {
    const d = Math.min(...got.map((g) => dist(g, w)));
    if (!(d <= TOL)) failures.push(`${what}: no vertex within ${TOL} u of (${w[0].toFixed(3)}, ${w[1].toFixed(3)}); the nearest is ${d.toFixed(4)} u away`);
  }
  return failures;
}

const traced = (f: PathFrame): Pt[][] => f.subpaths.map((sp) => flatten(sp, 512));

function hausdorffFailures(f: PathFrame, reference: Pt[][], what: string): string[] {
  const h = hausdorff(traced(f), reference);
  return h.d <= TOL ? [] : [`${what}: ${h.d.toFixed(4)} u from its reference (${h.side}, at (${h.at[0].toFixed(2)}, ${h.at[1].toFixed(2)}))`];
}

/** Each op's reference check over its item's frame. */
const OPS: { op: string; item: string; failures: (f: PathFrame) => string[] }[] = [
  { op: 'trim', item: 'trim', failures: (f) => hausdorffFailures(f, [[[60, 40], [120, 40], [120, 180]]], 'trim 0.1..0.6') },
  { op: 'round_corners', item: 'round', failures: (f) => hausdorffFailures(f, [roundedSquare(160, 40, 260, 140, 10)], 'round_corners 10') },
  { op: 'offset_path', item: 'offset', failures: (f) => hausdorffFailures(f, [square(300, 50, 400, 150)], 'offset_path 10, miter') },
  {
    op: 'zigzag', item: 'zigzag', failures: (f) => {
      const failures: string[] = [];
      if (f.subpaths.length !== 1) return [`zigzag: ${f.subpaths.length} sub-paths, not 1`];
      const sp = f.subpaths[0]!;
      if (!sp.verbs.every((v) => v === 'M' || v === 'L')) failures.push(`zigzag with corner points draws straight lines, got ${sp.verbs.join(' ')}`);
      const v = vertices(sp);
      if (v.length !== 7) return [...failures, `zigzag: ${v.length} vertices, not 7 (its ends and 5 ridges)`];
      const side = Math.sign(v[1]![1] - 100) || 1;
      for (let j = 1; j <= 5; j++) {
        const want: Pt = [440 + (200 * j) / 6, 100 + side * (j % 2 ? 10 : -10)];
        if (!(dist(v[j]!, want) <= TOL)) failures.push(`zigzag ridge ${j} is at (${v[j]![0].toFixed(3)}, ${v[j]![1].toFixed(3)}), not (${want[0].toFixed(3)}, ${want[1]})`);
      }
      if (!(Math.abs(v[0]![0] - 440) <= TOL) || !(Math.abs(v[6]![0] - 640) <= TOL)) failures.push(`zigzag's ends are at x = ${v[0]![0]} and ${v[6]![0]}, not 440 and 640`);
      return failures;
    },
  },
  { op: 'pucker', item: 'pucker', failures: (f) => hausdorffFailures(f, [bloated([[680, 40], [780, 40], [780, 140], [680, 140]], 0.5)], 'pucker 0.5') },
  {
    op: 'twist', item: 'twist', failures: (f) => {
      if (f.subpaths.length !== 1) return [`twist: ${f.subpaths.length} sub-paths, not 1`];
      const got = vertices(f.subpaths[0]!);
      const attempt = (sense: number): string[] => pointSetFailures(got, Array.from({ length: 12 }, (_, k) => {
        const outer = k % 2 === 0;
        const a = ((-90 + 30 * k + (outer ? 0 : sense * 18)) * Math.PI) / 180;
        const r = outer ? 100 : 40;
        return [860 + r * Math.cos(a), 280 + r * Math.sin(a)] as Pt;
      }), 'twist 30°');
      const cw = attempt(1); const ccw = attempt(-1);
      return cw.length <= ccw.length ? cw : ccw;
    },
  },
  {
    op: 'repeater', item: 'repeater', failures: (f) => {
      if (f.subpaths.length !== 3) return [`repeater: ${f.subpaths.length} sub-paths, not 3`];
      return f.subpaths.flatMap((sp, k) => pointSetFailures(vertices(sp), [[160, 260], [190, 260], [175, 230]].map(([x, y]) => [x! + 40 * k, y!] as Pt), `repeater copy ${k}`));
    },
  },
];

/** Every op's item in one `path` process, with an optional planted value. */
function frames(planted?: string): Map<string, PathFrame> {
  const lines = OPS.map((o) => ({ doc: DOC, item: o.item, look: { light: { ground: [255, 255, 255], ink: [0, 0, 0] } }, ...(planted ? { planted } : {}) }));
  const outs = batch('path', lines);
  return new Map(OPS.map((o, i) => [o.item, pathAccepted(outs[i], [0], `${o.item}${planted ? ` (${planted})` : ''}`)[0]!]));
}

describe('AC5 each path op against its CPU reference on parity/2d/path-ops.scene', () => {
  it('AC5 every op matches its CPU reference within 0.01 u', () => {
    expectClean(DOC, 'path-ops.scene');
    const got = frames();
    none(OPS.flatMap((o) => o.failures(got.get(o.item)!)), 'the ops against their references');
    // The references are not loose: each is more than 0.01 u from its op's input, which a no-op would draw.
    expect(hausdorff([[[60, 40], [120, 40], [120, 180]]], [[[20, 40], [120, 40], [120, 340]]]).d, 'the trim\'s reference is not its input').toBeGreaterThan(1);
  }, TIMEOUT);

  for (const o of OPS) {
    it(`AC5 a planted change in ${o.op}'s output (moved:${o.op}) fails its reference`, () => {
      const planted = frames(`moved:${o.op}`);
      expect(o.failures(planted.get(o.item)!).length, `${o.op} moved 0.02 u fails its reference within 0.01 u`).toBeGreaterThan(0);
    }, TIMEOUT);
  }
});

/** The fixtures and their planted-fault twins (373's convention: the check refuses each with exactly its code). */
interface Parity { name: string; code: string; item: string; path: string; plant: (doc: JsonObject) => void }
const FIXTURES: Parity[] = [
  { name: 'path-ops.scene', code: 'out_of_range', item: 'zigzag', path: 'items/zigzag/params/ops/0/ridges', plant: (doc) => { obj(obj(arr(paramsOf(doc, 'zigzag')['ops'], 'ops')[0], 'op')['zigzag'], 'zigzag')['ridges'] = 257; } },
  {
    name: 'loader.film', code: 'out_of_range', item: 'loader', path: 'items/loader/params/ops',
    plant: (doc) => { const ops = arr(paramsOf(doc, 'loader')['ops'], 'ops'); while (ops.length < 9) ops.push({ round_corners: { radius: 2 } }); },
  },
  { name: 'burst.film', code: 'out_of_range', item: 'burst', path: 'items/burst/params/ops/1/copies', plant: (doc) => { obj(obj(arr(paramsOf(doc, 'burst')['ops'], 'ops')[1], 'op')['repeater'], 'repeater')['copies'] = 65; } },
];

describe('AC5 the parity fixtures and their planted-fault twins', () => {
  for (const f of FIXTURES) {
    it(`AC5 ${f.name}: the same raster in two processes; its twin fails with ${f.code} at ${f.path}, naming ${f.item}`, () => {
      const doc = fixture(f.name);
      expectClean(doc, f.name);
      const a = raster(dir, doc, `${f.name} (process A)`);
      const b = raster(dir, doc, `${f.name} (process B)`);
      expect(inked(a.image), `${f.name} draws its marks`).toBeGreaterThan(200);
      expect(firstDifference(a.image, b.image), `${f.name}: two processes draw the same raster`).toBeNull();
      const planted = clone(doc);
      f.plant(planted);
      const errors = errorsOf(check(planted));
      expect([...new Set(errors.map((e) => e.code))], `${f.name}'s twin fails with exactly its code`).toEqual([f.code]);
      expect(errors.some((e) => e.ids.includes(f.item) && e.path === f.path), `${f.name}'s twin names ${f.item} at ${f.path}: ${JSON.stringify(errors.map((e) => [e.ids, e.path]))}`).toBe(true);
      expectRefused('raster', rasterInput(dir, planted), f.code, `${f.name}'s twin is refused by the check`);
    }, TIMEOUT);
  }

  it('a path line that is not JSON, lacks its document or item, or names an unknown planted value is bad_input with no panic', () => {
    const lines = batch('path', ['not json', { item: 'trim' }, { doc: DOC }, { doc: DOC, item: 'trim', planted: 'no_such_fault' }, { doc: DOC, item: 'trim', planted: 'moved:boolean' }]);
    lines.forEach((r, i) => expect(r, `path line ${i}`).toEqual({ ok: false, code: 'bad_input' }));
  }, TIMEOUT);
});
