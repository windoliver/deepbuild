// #378.29d4b8e6 (blind redraft of depth.test.ts's second test; C2-REDRAFT.md): a fixture with surfaces
// 0.5 m apart at 5 km shows no depth fighting, and no part of the city is clipped by a far plane.
// The first draft's planted run drew city-depth.json, whose faces all face the camera square on: each face
// has one depth over all its pixels, so under the forward-Z mutant whether a near face shows came down to
// one rounding per face, and on Metal both near faces rounded in front. Depth fighting is per-pixel
// rounding, which needs depth that changes across a face. fixtures/city-depth-oblique.json is
// city-depth.json turned 36.87° (sin 0.6) about the camera's vertical axis: every centre projects where it
// did, the boxes stay axis-aligned, so each pair's faces stand oblique to the view, their depth changing by
// 180 m across a near face, still 0.5 m apart along their normal with the near face's centre 5 km deep.
// The right program must show each near face whole in both draw orders there too (the control that makes
// the mutant's failure mean something), and `--planted forward_z` (the README's mutant, unchanged) must
// fail the same check, naming a fighting pair and both blocks past its 10 km far plane as clipped. Read
// from the object-ID target. At the base `deep-gpu` answers the view3d call with bad_input.
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, fixture, fixturePath, frameAt, look, num, project, readIds, requireGpu, runGpu, useBins, useOut, view3d, view3Reply,
  type Ids, type JsonObject, type Pinhole, type V3,
} from './helpers.ts';

const bins = useBins([GPU_BIN]);
const out = useOut();
const NAME = 'city-depth-oblique.json';
const DOC = fixture(NAME);
const SIZE = DOC['size'] as [number, number];
const items = DOC['items'] as Record<string, JsonObject>;
const camParams = items['cam']!['params'] as JsonObject;
const CAM: Pinhole = { position: camParams['position'] as V3, target: camParams['target'] as V3, fov: num(camParams['fov'], 'fov'), size: SIZE };
const boxOf = (id: string): { center: V3; size: V3 } => ({ center: (items[id]!['at'] as JsonObject)['pos'] as V3, size: (items[id]!['params'] as JsonObject)['size'] as V3 });
const PAIRS = [{ near: 'a-near', far: 'a-far' }, { near: 'b-near', far: 'b-far' }];
const BLOCKS = Object.keys(items).filter((id) => id.startsWith('city-')).sort();
const PLANTED_FAR = 10_000; // the forward_z mutant's far plane (README: Planted programs)

type P2 = [number, number];
/** A box's +Z face (the face toward a camera on its +Z side): its four corners, in order round the face. */
function frontCorners(id: string): V3[] {
  const { center: [x, y, z], size: [w, h, d] } = boxOf(id);
  const f = z + d / 2;
  return [[x - w / 2, y + h / 2, f], [x + w / 2, y + h / 2, f], [x + w / 2, y - h / 2, f], [x - w / 2, y - h / 2, f]];
}
const projected = (corners: V3[]): P2[] => corners.map((c) => { const [x, y] = project(CAM, c); return [x, y]; });
/** True when q is inside the convex quad by at least `by` px from every edge (a negative `by` dilates it). */
function inQuad(quad: P2[], [qx, qy]: P2, by: number): boolean {
  let area = 0;
  for (let i = 0; i < quad.length; i++) { const [ax, ay] = quad[i]!; const [bx, by2] = quad[(i + 1) % quad.length]!; area += ax * by2 - bx * ay; }
  const sign = Math.sign(area);
  return quad.every(([ax, ay], i) => {
    const [bx, by2] = quad[(i + 1) % quad.length]!;
    const len = Math.hypot(bx - ax, by2 - ay);
    return (sign * ((bx - ax) * (qy - ay) - (by2 - ay) * (qx - ax))) / len >= by;
  });
}
/** The frame rect [x0, y0, x1, y1] holding all eight corners of a box, projected. */
function boxRect(id: string): [number, number, number, number] {
  const { center: [x, y, z], size: [w, h, d] } = boxOf(id);
  const ps: P2[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { const [px, py] = project(CAM, [x + (sx * w) / 2, y + (sy * h) / 2, z + (sz * d) / 2]); ps.push([px, py]); }
  return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];
}

/** Every failure of the oblique depth fixture in one frame's ID target, each naming the item and where. */
function depthProblems(ids: Ids, what: string): string[] {
  const problems: string[] = [];
  for (const { near, far } of PAIRS) {
    const nearQuad = projected(frontCorners(near));
    const farQuad = projected(frontCorners(far));
    let wrongNear = 0; let firstNear = ''; let wrongRing = 0; let firstRing = ''; let cored = 0;
    const xs = farQuad.map((p) => p[0]); const ys = farQuad.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      const centre: P2 = [x + 0.5, y + 0.5];
      const id = ids.at(x, y);
      if (inQuad(nearQuad, centre, 3)) {
        cored++;
        if (id !== near) { wrongNear++; if (!firstNear) firstNear = `(${x}, ${y}) shows ${id ?? 'nothing'}`; }
      } else if (inQuad(farQuad, centre, 3) && !inQuad(nearQuad, centre, -3) && id !== far) { wrongRing++; if (!firstRing) firstRing = `(${x}, ${y}) shows ${id ?? 'nothing'}`; }
    }
    expect(cored, `${near}'s face, inset 3 px, covers pixels to check`).toBeGreaterThan(500);
    if (wrongNear) problems.push(`${what}: depth fighting at 5 km: ${wrongNear} of ${cored} pixels inside ${near}'s face don't show ${near}, 0.5 m in front of ${far} (first ${firstNear})`);
    if (wrongRing) problems.push(`${what}: ${wrongRing} pixels of ${far}'s face around ${near} don't show ${far} (first ${firstRing})`);
  }
  for (const id of ['post', ...BLOCKS]) {
    const [px, py, depth] = project(CAM, boxOf(id).center);
    const [cx, cy] = [Math.floor(px), Math.floor(py)];
    let missing = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (ids.at(cx + dx, cy + dy) !== id) missing++;
    if (missing) problems.push(`${what}: ${id}, ${Math.round(depth)} m away, is clipped or hidden: ${missing} of the 25 pixels around its projected centre (${cx}, ${cy}) don't show it (it shows ${ids.count.get(id) ?? 0} pixels in all)`);
  }
  return problems;
}

function drawIds(planted?: 'forward_z'): Ids {
  const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: fixturePath(NAME), look: look(), size: SIZE, targets: ['ids'], capture: [0] })], planted ? { planted } : {});
  const v = view3Reply(reply!, planted ? `the planted ${planted} run` : 'the oblique city-depth fixture');
  return readIds(out(), frameAt(v, 0, 'the oblique city-depth fixture'), 'frame 0\'s object-ID target');
}

describe('#378.29d4b8e6 a fixture with surfaces 0.5 m apart at 5 km shows no depth fighting, and no part of the city is clipped by a far plane (redraft)', () => {
  it('#378.29d4b8e6 with the faces 0.5 m apart at 5 km oblique to the view, so their depth changes across each face, the right program shows each near face whole in both draw orders and every block, and a planted forward-Z depth buffer with a far plane at 10 km (--planted forward_z) fights there and clips the farthest blocks, and the check names them (redraft)', () => {
    // The fixture is what the criterion asks, with depth that changes across every face of a pair: a near
    // distance of 0.1 m and no far distance; each pair's faces axis-aligned (no rot), 0.5 m apart along
    // their normal (+Z), the near face's centre 5 km deep, its corners more than 150 m apart in depth; the
    // near face listed first in pair A and last in pair B; blocks past 20 km; every item inside the frame
    // and nothing else drawn over a pair.
    expect(camParams['near'], 'the camera\'s near distance').toBe(0.1);
    expect(camParams['far'], 'no far distance is set (auto, from bounds)').toBeUndefined();
    const order = Object.keys(items);
    expect(order.indexOf('a-near') < order.indexOf('a-far') && order.indexOf('b-near') > order.indexOf('b-far'), 'pair A lists its near face first, pair B last').toBe(true);
    for (const { near, far } of PAIRS) {
      const n = boxOf(near); const f = boxOf(far);
      for (const id of [near, far]) expect((items[id]!['at'] as JsonObject)['rot'], `${id} is axis-aligned: its front face is a plane of constant z`).toBeUndefined();
      expect([n.center[0], n.center[1]], `${far} sits straight behind ${near}`).toEqual([f.center[0], f.center[1]]);
      const gap = (n.center[2] + n.size[2] / 2) - (f.center[2] + f.size[2] / 2);
      expect(gap, `${near}'s face is 0.5 m in front of ${far}'s, along their normal`).toBeCloseTo(0.5, 6);
      const faceCentre: V3 = [n.center[0], n.center[1], n.center[2] + n.size[2] / 2];
      expect(project(CAM, faceCentre)[2], `${near}'s face centre is 5 km deep`).toBeCloseTo(5000, 3);
      const depths = frontCorners(near).map((c) => project(CAM, c)[2]);
      expect(Math.max(...depths) - Math.min(...depths), `${near}'s face is oblique: its depth changes across it by more than 150 m`).toBeGreaterThan(150);
      const fr = boxRect(far);
      for (const other of ['post', ...BLOCKS, ...PAIRS.flatMap((p) => [p.near, p.far])].filter((id) => id !== near && id !== far)) {
        const o = boxRect(other);
        const apart = o[0] > fr[2] + 4 || o[2] < fr[0] - 4 || o[1] > fr[3] + 4 || o[3] < fr[1] - 4;
        expect(apart, `${other} is drawn clear of ${far}'s face`).toBe(true);
      }
    }
    expect(Math.max(...BLOCKS.map((id) => project(CAM, boxOf(id).center)[2])), 'the farthest block\'s depth').toBeGreaterThan(20_000);
    expect(BLOCKS.filter((id) => project(CAM, boxOf(id).center)[2] > PLANTED_FAR).length, 'blocks past the mutant\'s far plane').toBeGreaterThan(0);
    for (const id of ['post', ...BLOCKS, ...PAIRS.flatMap((p) => [p.near, p.far])]) {
      const [x, y] = project(CAM, boxOf(id).center);
      expect(x > 20 && x < SIZE[0] - 20 && y > 20 && y < SIZE[1] - 20, `${id} projects inside the frame (${x.toFixed(1)}, ${y.toFixed(1)})`).toBe(true);
    }
    requireGpu();

    // The right program passes the check here: it reads this fixture's geometry right.
    expect(depthProblems(drawIds(), 'the clean run'), 'the oblique depth fixture in the object-ID target').toEqual([]);

    // The mutant fails it, naming a fighting pair and the blocks past its far plane.
    const problems = depthProblems(drawIds('forward_z'), 'forward_z');
    expect(problems.some((p) => /depth fighting at 5 km: .* (a|b)-near/.test(p)), `the check sees the fighting, naming the pair: ${problems.join('\n')}`).toBe(true);
    for (const id of BLOCKS.filter((b) => project(CAM, boxOf(b).center)[2] > PLANTED_FAR)) {
      expect(problems.some((p) => p.includes(`${id},`) && p.includes('clipped')), `the check names ${id}, past the planted far plane: ${problems.join('\n')}`).toBe(true);
    }
  }, 600_000);
});
