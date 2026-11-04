// AC2 #421.fcae3a3c: An instance whose world transform has a negative determinant renders with its front faces out
// (parity/scene/mirrored-instance-winding.scene), and coplanar opaque ties draw the same way every frame.
//
// Winding: the parity fixture's `document` holds two boxes with a negative world determinant (`mirrored` by its own
// scale, `inherited` by its parent's), and its `reference` the same picture with every determinant positive. Drawn
// by #378's `view3d` (linear and object-ID targets), each mirrored box covers the same pixels as in the reference (at
// least 99.5% of its pixels agree) and shades them the same: at most 1% of its pixels differ from the reference by
// more than 2% in linear luminance, and its mean is within 1%. `--planted winding_ignores_determinant` (the twin the
// fixture names) fails, naming each mirrored box.
// Ties: two opaque slabs whose top faces are coplanar over a 1 × 2 m overlap, seen from two camera positions, with the
// slabs listed in either order (map order and order keys), while a far block moves, 4 frames each: in every frame,
// every pixel 3 px or more inside the overlap's projection shows one and the same slab, the same one in every frame,
// view and order. `--planted ties_by_submission` (opaque draws submitted in an order that alternates each frame, ties
// left to the depth test) fails.
// Wrong programs: a front face chosen without the determinant's sign (or from the local scale alone, which the
// inherited box catches); coplanar ties left to submission order or to rounding (z-fighting speckle).
import { describe, it } from 'vitest';
import {
  AC, PARITY_SCENE, PLAIN_LOOK, box, camera, failsNaming, requireMetal, fixture, frameAt, framesOf, material, none, obj, project, readIds, readLinear,
  runGpu, sessionDoc, str, useBins, useDir, view3dCall, writeJson,
  type GpuPlanted, type JsonObject, type Pinhole, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const lum = (c: [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The winding check on the parity fixture: failures as sentences naming the item. */
function windingProblems(bin: string, out: string, planted?: GpuPlanted): string[] {
  const scene = fixture(PARITY_SCENE);
  const size = scene['size'] as [number, number];
  const twin = obj(scene['twin'], 'the fixture\'s twin');
  const mirrored = (twin['fails'] as string[]).map((x) => str(x, 'a mirrored item'));
  const doc = writeJson(out, 'document', obj(scene['document'], 'the fixture\'s document'));
  const ref = writeJson(out, 'reference', obj(scene['reference'], 'the fixture\'s reference'));
  const call = (d: string): JsonObject => view3dCall({ doc: d, look: PLAIN_LOOK, size, frames: 1, capture: [0], targets: ['linear', 'ids'] });
  const [a, b] = runGpu(bin, out, [call(doc), call(ref)], planted);
  const fa = frameAt(framesOf(a!, 'the mirrored document'), 0, 'the mirrored document');
  const fb = frameAt(framesOf(b!, 'the reference'), 0, 'the reference');
  const [ia, ib] = [readIds(out, fa, 'mirrored: ids'), readIds(out, fb, 'reference: ids')];
  const [la, lb] = [readLinear(out, fa.linear, size, 'mirrored: linear'), readLinear(out, fb.linear, size, 'reference: linear')];
  const problems: string[] = [];
  for (const item of mirrored) {
    const want = ib.count.get(item) ?? 0;
    if (want < 2_000) { problems.push(`${item}: the reference shows only ${want} px of it; the fixture needs 2,000`); continue; }
    let agree = 0; let off = 0; let sumA = 0; let sumB = 0;
    for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      if (ib.at(x, y) !== item) continue;
      if (ia.at(x, y) !== item) continue;
      agree++;
      const [va, vb] = [lum(la.at(x, y)), lum(lb.at(x, y))];
      sumA += va; sumB += vb;
      if (Math.abs(va - vb) > 0.02 * Math.max(vb, 1e-6)) off++;
    }
    const meanA = sumA / Math.max(agree, 1); const meanB = sumB / Math.max(agree, 1);
    console.log(`${AC[2]}: ${item}: ${agree} of ${want} px agree; ${off} differ by over 2%; mean linear ${meanA.toFixed(4)} against ${meanB.toFixed(4)}`);
    if (agree < 0.995 * want) problems.push(`${item}: covers ${agree} of the reference's ${want} px (under 99.5%): not drawn with its front faces out`);
    if (off > 0.01 * agree) problems.push(`${item}: ${off} of ${agree} px differ from the reference by over 2% in linear luminance: not drawn with its front faces out`);
    if (Math.abs(meanA - meanB) > 0.01 * meanB) problems.push(`${item}: mean linear luminance ${meanA.toFixed(4)} against the reference's ${meanB.toFixed(4)}, off by over 1%`);
  }
  return problems;
}

const SIZE: [number, number] = [480, 360];
const CAMS: V3[] = [[-3, 4, 5], [3, 4, 5]];
/** Two slabs whose top faces are coplanar at y = 0 over x ∈ [−0.5, 0.5], z ∈ [−1, 1], and a far block a channel moves. */
function tiesDoc(position: V3, reversed: boolean): JsonObject {
  const slabs: Record<string, JsonObject> = {
    a: box([2, 0.2, 2], { pos: [-0.5, -0.1, 0] }, { material: 'warm' }),
    b: box([2, 0.2, 2], { pos: [0.5, -0.1, 0] }, { material: 'cool' }),
  };
  const ordered = reversed ? { b: slabs['b']!, a: slabs['a']! } : slabs;
  return sessionDoc('ties-421', SIZE, {
    cam: camera(position, [0, 0, 0]),
    warm: material({ base_color: [0.7, 0.4, 0.2, 1] }),
    cool: material({ base_color: [0.2, 0.4, 0.7, 1] }),
    ...ordered,
    mover: box([0.4, 0.4, 0.4], { pos: [0, 0.2, -4] }, { material: 'warm' }),
    sun: { kind: 'light.sun@1', params: { illuminance: 1000 }, at: { rot: [-60, 30, 0] } },
  }, { channels: { lift: { target: 'items/mover/at/pos/1', type: 'f32', keys: { k0: { t: '0s', value: 0.2, interp: 'linear' }, k1: { t: '2s', value: 1.2, interp: 'linear' } } } } });
}
/** Pixels 3 px or more inside the projection of the overlap's top face. */
function overlapPixels(cam: Pinhole): [number, number][] {
  const quad = ([[-0.5, 0, -1], [0.5, 0, -1], [0.5, 0, 1], [-0.5, 0, 1]] as V3[]).map((p) => project(cam, p));
  let area = 0;
  for (let i = 0; i < 4; i++) { const [p, q] = [quad[i]!, quad[(i + 1) % 4]!]; area += p[0] * q[1] - q[0] * p[1]; }
  const sign = Math.sign(area);
  const out: [number, number][] = [];
  for (let y = 0; y < cam.size[1]; y++) for (let x = 0; x < cam.size[0]; x++) {
    const c: [number, number] = [x + 0.5, y + 0.5];
    let inside = true;
    for (let i = 0; i < 4 && inside; i++) {
      const [p, q] = [quad[i]!, quad[(i + 1) % 4]!];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const d = (sign * ((q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0]))) / len;
      if (d < 3) inside = false;
    }
    if (inside) out.push([x, y]);
  }
  return out;
}
/** The ties check: failures as sentences naming the view, the order and the frame. */
function tieProblems(bin: string, out: string, planted?: GpuPlanted): string[] {
  const runs: { what: string; cam: Pinhole; doc: string }[] = [];
  for (const [k, position] of CAMS.entries()) for (const reversed of [false, true]) {
    const what = `camera ${k === 0 ? 'left' : 'right'}, ${reversed ? 'b listed first' : 'a listed first'}`;
    runs.push({ what, cam: { position, target: [0, 0, 0], fov: 40, size: SIZE }, doc: writeJson(out, `ties-${k}-${reversed}`, tiesDoc(position, reversed)) });
  }
  const replies = runGpu(bin, out, runs.map((r) => view3dCall({ doc: r.doc, look: PLAIN_LOOK, size: SIZE, frames: 4, capture: 'every', targets: ['ids'] })), planted);
  const problems: string[] = [];
  const winners = new Set<string>();
  for (const [i, r] of runs.entries()) {
    const pixels = overlapPixels(r.cam);
    if (pixels.length < 1_000) { problems.push(`${r.what}: the overlap covers only ${pixels.length} px; the fixture needs 1,000`); continue; }
    for (const f of framesOf(replies[i]!, r.what)) {
      const ids = readIds(out, f, `${r.what}, frame ${f.frame}: ids`);
      const seen = new Map<string, number>();
      for (const [x, y] of pixels) { const id = ids.at(x, y) ?? 'nothing'; seen.set(id, (seen.get(id) ?? 0) + 1); }
      const shown = [...seen.entries()].map(([id, n]) => `${id} ${n} px`).join(', ');
      if (seen.size !== 1) problems.push(`${r.what}, frame ${f.frame}: the coplanar overlap shows ${shown}, not one slab`);
      for (const id of seen.keys()) winners.add(id);
    }
  }
  console.log(`${AC[2]}: the overlap showed ${[...winners].join(', ')}`);
  if (winners.size > 1) problems.push(`coplanar ties: the overlap shows ${[...winners].join(' and ')} across frames, views and orders, not the same slab every frame`);
  if (winners.size === 1 && ![...winners].every((w) => w === 'a' || w === 'b')) problems.push(`coplanar ties: the overlap shows ${[...winners].join('')}, not a slab`);
  return problems;
}

describe(`${AC[2]} mirrored instances render front faces out; coplanar opaque ties draw the same way every frame`, () => {
  it(`${AC[2]} ${PARITY_SCENE}: a box mirrored by its own scale and one mirrored by its parent's draw the reference's pixels and shading; the planted twin winding_ignores_determinant fails, naming both`, () => {
    requireMetal();
    const bin = bins.bin('deep-gpu');
    none(windingProblems(bin, dir()), 'the mirrored instances against the reference');
    failsNaming(windingProblems(bin, dir(), 'winding_ignores_determinant'), ['mirrored', 'inherited'], 'the planted winding_ignores_determinant');
  }, 1_800_000);

  it(`${AC[2]} two coplanar opaque slabs: one slab shows across the whole overlap in every frame, from both views and in both orders; the planted ties_by_submission fails`, () => {
    requireMetal();
    const bin = bins.bin('deep-gpu');
    none(tieProblems(bin, dir()), 'coplanar ties');
    failsNaming(tieProblems(bin, dir(), 'ties_by_submission'), ['coplanar'], 'the planted ties_by_submission');
  }, 1_800_000);
});
