// The fixtures themselves, with no product run: each glTF this suite writes holds exactly what its criterion and
// its name say, read back from the GLB bytes and measured by reference.ts (the design's definitions on the
// fixture's own positions). These carry no criterion alone; each is tagged with the criterion whose fixture it
// checks, so a wrong fixture fails here before it can make a product test pass or fail for the wrong reason.

import { describe, expect, it } from 'vitest';
import { AC } from './helpers.ts';
import { BIND, DEFECT_FIXTURES, TURNED, cross, cubeLines, dracoCube, glb, icosphere, indexedCube, len, seamCube, sliverBox, sub, torus, type Prim, type Quat, type Spec, type V3 } from './gltf.ts';
import { analyse, type Report } from './reference.ts';

type Json = Record<string, unknown>;

/** A GLB's JSON chunk, after checking its header and chunk layout (glTF 2.0 §4.4). */
function readGlb(bytes: Buffer): Json {
  expect(bytes.toString('ascii', 0, 4), 'GLB magic').toBe('glTF');
  expect(bytes.readUInt32LE(4), 'glTF version').toBe(2);
  expect(bytes.readUInt32LE(8), 'GLB length').toBe(bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.readUInt32LE(16), 'first chunk is JSON').toBe(0x4e4f534a);
  const binAt = 20 + jsonLength;
  expect(bytes.readUInt32LE(binAt + 4), 'second chunk is BIN').toBe(0x004e4942);
  expect(binAt + 8 + bytes.readUInt32LE(binAt), 'the chunks fill the file').toBe(bytes.length);
  return JSON.parse(bytes.toString('utf8', 20, binAt)) as Json;
}

const nothingBut = (r: Report, kind?: keyof Report['ids']) => {
  for (const [k, ids] of Object.entries(r.ids)) if (k !== kind) expect(ids, `no ${k}`).toEqual([]);
};

/** A unit quaternion's rotation matrix (row-major 3 × 3). */
const rotation = ([x, y, z, w]: Quat): number[][] => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
];

describe('the fixtures hold what they are named for', () => {
  it(`${AC[1]} fixture: the seam cube has 24 vertices that weld to 8 only within the tolerance; two faces backwards are its only flipped faces while its winding sums outward`, () => {
    const cube = seamCube();
    expect(cube.positions.length).toBe(24);
    expect(cube.indices!.length).toBe(36);
    const r = analyse([cube]);
    expect(r.welded).toBe(8);
    nothingBut(r);
    expect(analyse([cube], 0).welded, 'its seam copies are not equal, so exact equality would not weld them').toBe(24);
    const back = analyse([seamCube([8, 10])]);
    expect(back.ids.flipped_faces.sort()).toEqual(['0:10', '0:8']);
    expect(back.signedVolume, 'its summed winding still points outward (2/3 m³)').toBeCloseTo(2 / 3, 6);
  });

  it(`${AC[2]} fixture: the sliver's area is 1e-14 of its box's bounds diagonal squared and its only defect; at 1e-10 none; the inward cube is closed at −1 m³ with no face flipped`, () => {
    const s = sliverBox(1e-14);
    expect(s.area / s.diagonal2).toBeGreaterThan(0.99e-14);
    expect(s.area / s.diagonal2).toBeLessThan(1.01e-14);
    expect(s.area).toBeGreaterThan(1e-12);
    const r = analyse([s.prim]);
    expect(r.ids.degenerate_faces).toEqual([`0:${s.sliver}`]);
    nothingBut(r, 'degenerate_faces');
    const t = sliverBox(1e-10);
    expect(t.area / t.diagonal2).toBeGreaterThan(0.99e-10);
    nothingBut(analyse([t.prim]));
    const inward = analyse([indexedCube([0, 0, 0], 1, { inward: true })]);
    nothingBut(inward);
    expect(inward.signedVolume).toBeCloseTo(-1, 6);
    expect(analyse([indexedCube()]).signedVolume).toBeCloseTo(1, 6);
  });

  for (const f of DEFECT_FIXTURES) {
    it(`${AC[3]} fixture: ${f.kind}: ${f.what} holds exactly ${f.ids.join(', ')}; its clean twin holds no defect`, () => {
      const r = analyse([f.planted]);
      expect([...r.ids[f.kind]].sort()).toEqual([...f.ids].sort());
      nothingBut(analyse([f.clean]));
    });
  }

  it(`${AC[4]} fixture: the Draco primitive is required, undecodable and has no buffer view of its own; the line primitive is mode 1; the skinned cube's joint is off its bind pose only when turned`, () => {
    const draco = readGlb(glb({ prims: [indexedCube(), dracoCube()] }));
    expect(draco['extensionsRequired']).toEqual(['KHR_draco_mesh_compression']);
    const prims = ((draco['meshes'] as Json[])[0]!['primitives'] as Json[]);
    const accessors = draco['accessors'] as Json[];
    const p1 = prims[1]!;
    expect((p1['extensions'] as Json)['KHR_draco_mesh_compression']).toBeDefined();
    for (const a of [(p1['attributes'] as Json)['POSITION'], p1['indices']]) expect(accessors[a as number]!['bufferView'], 'a Draco accessor has no buffer view').toBeUndefined();
    const lines = readGlb(glb({ prims: [indexedCube(), cubeLines()] }));
    expect(((lines['meshes'] as Json[])[0]!['primitives'] as Json[])[1]!['mode']).toBe(1);
    nothingBut(analyse([indexedCube()]));
    for (const [joint, away] of [[TURNED, true], [BIND, false]] as const) {
      const file = readGlb(glb({ prims: [indexedCube()], skin: { joint } }));
      const nodes = file['nodes'] as Json[];
      expect(nodes[0]!['skin']).toBe(0);
      const skin = (file['skins'] as Json[])[0]!;
      expect(skin['joints']).toEqual([1]);
      // The inverse bind matrix is the identity, so the joint is at its bind pose exactly when its own world rotation is.
      const R = rotation(nodes[1]!['rotation'] as Quat);
      const off = Math.max(...R.flatMap((row, i) => row.map((v, k) => Math.abs(v - (i === k ? 1 : 0)))));
      expect(off > 1e-6, `joint ${JSON.stringify(joint)} away from its bind pose`).toBe(away);
    }
  });

  it(`${AC[5]} fixture: the torus is 48 × 24 quads in 2,304 triangles, closed and clean, its quads all paired back; the icosphere is 1,280 near-equilateral triangles, closed and clean`, () => {
    const t: Prim = torus();
    const r = analyse([t]);
    expect(r.triangles).toBe(2304);
    expect(r.welded).toBe(1152);
    nothingBut(r);
    expect(r.signedVolume).toBeGreaterThan(0);
    expect(r.quadRatio).toBeGreaterThanOrEqual(0.95);
    const ico = icosphere();
    const q = analyse([ico]);
    expect(q.triangles).toBe(1280);
    expect(q.welded).toBe(642);
    nothingBut(q);
    expect(q.signedVolume).toBeGreaterThan(0);
    const I = ico.indices!;
    for (let k = 0; k < I.length; k += 3) {
      const [a, b, c] = [I[k]!, I[k + 1]!, I[k + 2]!].map((i) => ico.positions[i]!) as [V3, V3, V3];
      const sides = [len(sub(b, c)), len(sub(c, a)), len(sub(a, b))];
      expect(Math.max(...sides) / Math.min(...sides), `triangle ${k / 3} is near-equilateral`).toBeLessThan(1.25);
      expect(len(cross(sub(b, a), sub(c, a)))).toBeGreaterThan(0);
    }
    for (const spec of [{ prims: [t], skin: { joint: BIND } }, { prims: [ico], skin: { joint: BIND } }] as Spec[]) {
      const file = readGlb(glb(spec));
      const attrs = (((file['meshes'] as Json[])[0]!['primitives'] as Json[])[0]!['attributes'] as Json);
      expect(Object.keys(attrs)).toEqual(expect.arrayContaining(['JOINTS_0', 'WEIGHTS_0']));
    }
  });
});
