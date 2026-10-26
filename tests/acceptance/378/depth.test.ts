// #378.29d4b8e6: a fixture with surfaces 0.5 m apart at 5 km shows no depth fighting, and no part of the
// city is clipped by a far plane.
// fixtures/city-depth.json, under a camera with a 0.1 m near distance and no far distance set: two pairs of
// faces 0.5 m apart at 5 km (the near face listed first in pair A and last in pair B, so neither draw order
// can stand in for depth), a post 1.5 m away, and twelve blocks from 12 m to 24.6 km. Read from the frame's
// object-ID target and its final frame, against the test's own pinhole projection of the fixture. The
// planted forward-Z run is depth-redraft.test.ts's (README: Blind redrafts that replaced first drafts). At
// the base `deep-gpu` answers the view3d call with bad_input.
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, fixture, fixturePath, frameAt, frontFace, look, num, project, readIds, readPng, requireGpu, runGpu, useBins, useOut, view3d, view3Reply,
  type Ids, type Image, type JsonObject, type Pinhole, type V3,
} from './helpers.ts';

const bins = useBins([GPU_BIN]);
const out = useOut();
const DOC = fixture('city-depth.json');
const SIZE = DOC['size'] as [number, number];
const items = DOC['items'] as Record<string, JsonObject>;
const camParams = items['cam']!['params'] as JsonObject;
const CAM: Pinhole = { position: camParams['position'] as V3, target: camParams['target'] as V3, fov: num(camParams['fov'], 'fov'), size: SIZE };
const boxOf = (id: string): { center: V3; size: V3 } => ({ center: (items[id]!['at'] as JsonObject)['pos'] as V3, size: (items[id]!['params'] as JsonObject)['size'] as V3 });
const PAIRS = [{ near: 'a-near', far: 'a-far' }, { near: 'b-near', far: 'b-far' }];
const BLOCKS = Object.keys(items).filter((id) => id.startsWith('city-')).sort();

type Rect = [number, number, number, number];
const inset = ([x0, y0, x1, y1]: Rect, by: number): Rect => [Math.ceil(x0 + by), Math.ceil(y0 + by), Math.floor(x1 - by), Math.floor(y1 - by)];
const inside = ([x0, y0, x1, y1]: Rect, x: number, y: number): boolean => x >= x0 && x < x1 && y >= y0 && y < y1;

/** Every failure of the depth fixture in one frame's ID target, each naming the item and where. */
function depthProblems(ids: Ids, what: string): string[] {
  const problems: string[] = [];
  for (const { near, far } of PAIRS) {
    const n = boxOf(near); const f = boxOf(far);
    const nearRect = frontFace(CAM, n.center, n.size);
    const farRect = frontFace(CAM, f.center, f.size);
    const core = inset(nearRect, 3); const ringOuter = inset(farRect, 3); const ringHole = inset(nearRect, -3);
    let wrongNear = 0; let firstNear = ''; let wrongRing = 0; let firstRing = '';
    for (let y = ringOuter[1]; y < ringOuter[3]; y++) for (let x = ringOuter[0]; x < ringOuter[2]; x++) {
      const id = ids.at(x, y);
      if (inside(core, x, y)) {
        if (id !== near) { wrongNear++; if (!firstNear) firstNear = `(${x}, ${y}) shows ${id ?? 'nothing'}`; }
      } else if (!inside(ringHole, x, y) && id !== far) { wrongRing++; if (!firstRing) firstRing = `(${x}, ${y}) shows ${id ?? 'nothing'}`; }
    }
    if (wrongNear) problems.push(`${what}: depth fighting at 5 km: ${wrongNear} pixels inside ${near}'s face don't show ${near}, 0.5 m in front of ${far} (first ${firstNear})`);
    if (wrongRing) problems.push(`${what}: ${wrongRing} pixels of ${far}'s face around ${near} don't show ${far} (first ${firstRing})`);
  }
  for (const id of ['post', ...BLOCKS]) {
    const b = boxOf(id);
    const [x0, y0, x1, y1] = frontFace(CAM, b.center, b.size);
    const [cx, cy] = [Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2)];
    const distance = Math.round(-b.center[2]);
    let missing = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (ids.at(cx + dx, cy + dy) !== id) missing++;
    if (missing) problems.push(`${what}: ${id}, ${distance} m away, is clipped or hidden: ${missing} of the 25 pixels around its projected centre (${cx}, ${cy}) don't show it (it shows ${ids.count.get(id) ?? 0} pixels in all)`);
  }
  return problems;
}

/** The final frame's median RGB over a rect's pixels. */
function median(image: Image, [x0, y0, x1, y1]: Rect): [number, number, number] {
  const ch: number[][] = [[], [], []];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) ch[c]!.push(image.rgba[(y * image.width + x) * 4 + c]!);
  return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]!) as [number, number, number];
}
/** No fighting in the final frame: every pixel of a near face is nearer in color to that face than to the far face around it. */
function colorProblems(image: Image, what: string): string[] {
  const problems: string[] = [];
  for (const { near, far } of PAIRS) {
    const n = boxOf(near); const f = boxOf(far);
    const core = inset(frontFace(CAM, n.center, n.size), 3);
    const farRect = frontFace(CAM, f.center, f.size);
    const ring: Rect = [Math.ceil(farRect[0] + 3), Math.ceil(farRect[1] + 3), Math.floor(core[0] - 6), Math.floor(farRect[3] - 3)]; // the far face's left strip
    const mn = median(image, core); const mf = median(image, ring);
    const d = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    if (d(mn, mf) < 40) { problems.push(`${what}: ${near} and ${far} draw nearly one color (${mn} and ${mf}), so the frame can't show which is in front`); continue; }
    let off = 0;
    for (let y = core[1]; y < core[3]; y++) for (let x = core[0]; x < core[2]; x++) {
      const o = (y * image.width + x) * 4;
      const px = [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
      if (d(px, mf) <= d(px, mn)) off++;
    }
    if (off) problems.push(`${what}: depth fighting at 5 km: ${off} pixels inside ${near}'s face draw ${far}'s color`);
  }
  return problems;
}

function draw(planted?: 'forward_z'): { ids: Ids; final: Image } {
  const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: fixturePath('city-depth.json'), look: look(), size: SIZE, targets: ['final', 'ids'], capture: [0] })], planted ? { planted } : {});
  const v = view3Reply(reply!, planted ? `the planted ${planted} run` : 'the city-depth fixture');
  const f = frameAt(v, 0, 'the city-depth fixture');
  return { ids: readIds(out(), f, 'frame 0\'s object-ID target'), final: readPng(out(), f.final, 'frame 0\'s final frame') };
}

describe('#378.29d4b8e6 a fixture with surfaces 0.5 m apart at 5 km shows no depth fighting, and no part of the city is clipped by a far plane', () => {
  it('#378.29d4b8e6 in the object-ID target and the final frame, each near face wins over the face 0.5 m behind it in both draw orders, and the post at 1.5 m and every block out to 24.6 km draw at their projected places', () => {
    // The fixture is what the criterion asks: faces 0.5 m apart at 5 km, a near distance of 0.1 m, no far
    // distance, blocks out to 24.6 km, all inside the frame.
    expect(camParams['near'], 'the camera\'s near distance').toBe(0.1);
    expect(camParams['far'], 'no far distance is set (auto, from bounds)').toBeUndefined();
    for (const { near, far } of PAIRS) {
      const n = boxOf(near); const f = boxOf(far);
      const gap = (n.center[2] + n.size[2] / 2) - (f.center[2] + f.size[2] / 2);
      expect(gap, `${near}'s face is 0.5 m in front of ${far}'s`).toBeCloseTo(0.5, 9);
      expect(-(n.center[2] + n.size[2] / 2), `${near}'s face is 5 km away`).toBeCloseTo(5000, 6);
    }
    expect(Math.max(...BLOCKS.map((id) => -boxOf(id).center[2])), 'the farthest block').toBeGreaterThan(20_000);
    for (const id of ['post', ...BLOCKS, ...PAIRS.flatMap((p) => [p.near, p.far])]) {
      const b = boxOf(id);
      const [x, y] = project(CAM, b.center);
      expect(x > 20 && x < SIZE[0] - 20 && y > 20 && y < SIZE[1] - 20, `${id} projects inside the frame (${x.toFixed(1)}, ${y.toFixed(1)})`).toBe(true);
    }
    requireGpu();
    const { ids, final } = draw();
    expect(depthProblems(ids, 'the clean run'), 'the depth fixture in the object-ID target').toEqual([]);
    expect(colorProblems(final, 'the clean run'), 'the depth fixture in the final frame').toEqual([]);
  }, 600_000);
});
