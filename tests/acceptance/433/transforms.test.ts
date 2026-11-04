// AC3: "Against a pinned release of the reference library, an object written through the pack with rotation (30°,
// 45°, 60°) in the library's default order, position (10, 0, 0) m, pivot (1, 0, 0) m and scale (2, 1, 0.5) has the
// library's world matrix within 1e-9 per coefficient, reading our angles (51.8766°, −7.2862°, 69.1188°); a planted
// pack that copies the angles as written misses by 1.668 in one coefficient (0.834 in the rotation, times the x
// scale of 2), and one that copies the position puts the pivot at x = 10 m instead of 11 m, each failing, naming
// the item and the field. A camera of vertical field of view 50° expands to fov 79.3169° at 16:9 and 50° at 9:16,
// and a camera given a rotation of (0°, 30°, 0°) and no target looks along (−0.5, 0, −0.866); a planted pack that
// widens the portrait camera to 29.395° or looks along +Z fails"
//
// The object is a familiar box (1 m, the library's default, centred on its origin) named `crate`. Its world matrix
// is read as the matrix its item applies to the library's own box: the `world` of its one built item times the map
// from the library's box onto that item's mesh (helpers: effectiveWorld). The library's matrixWorld is
// reference.ts's port of Matrix4.compose and Object3D.updateMatrix's pivot step at the pin. Our angles are the
// derived item's `at.rot`. Each failure names `crate` and the field it comes from: `rotation` for a rotation-and-
// scale coefficient (`scale` when a column's length is off), `position` where the pivot lands. The cameras are
// familiar perspective cameras with the library's vertical `fov` 50 and an `aspect` equal to their document's frame,
// read from the camera@1 each expands to: its `fov` and the direction from its `position` to its `target`.

import { describe, expect, it } from 'vitest';
import { AC, DOC, PACKS, SLOW, effectiveWorld, failsNaming, isObject, meshRows, none, num, oneOfKind, paramOf, runShow, scenario, sceneDoc, show, useDir, useShow, derivedOf, geometryCall, admitted, v3, type JsonObject, type ShowPlanted } from './helpers.ts';
import { THREE, apply, fmt, fmtV, oursAngles, oursFov, rotationOf, sub, threeForward, threeWorld, unit, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();

const POSITION: V3 = [10, 0, 0];
const ROTATION: V3 = [30, 45, 60];
const PIVOT: V3 = [1, 0, 0];
const SCALE: V3 = [2, 1, 0.5];
/** The criterion's angles, to the four decimals it gives them. */
const OURS: V3 = [51.8766, -7.2862, 69.1188];
const LOOK: V3 = [-0.5, 0, -0.866];

const crate: JsonObject = { kind: 'familiar.box@1', params: { position: POSITION, rotation: ROTATION, pivot: PIVOT, scale: SCALE } };
const camera = (aspect: number): JsonObject => ({ kind: 'familiar.perspective_camera@1', params: { fov: 50, aspect, position: [1, 2, 3], rotation: [0, 30, 0] } });

interface Run { wide: JsonObject; tall: JsonObject; geo: JsonObject }
function run(planted?: ShowPlanted): Run {
  const a = sceneDoc('A familiar object and a landscape camera', { crate, wide: camera(16 / 9) }, [PACKS.familiar], [1920, 1080]);
  const b = sceneDoc('A portrait camera', { tall: camera(9 / 16) }, [PACKS.familiar], [1080, 1920]);
  const [wide, geo, tall] = runShow(bin(), scenario(dir(), [DOC.a, DOC.b], [show(DOC.a, a), geometryCall(DOC.a), show(DOC.b, b)], [PACKS.familiar], planted));
  admitted(wide!, 'the landscape document');
  admitted(tall!, 'the portrait document');
  return { wide: wide!, tall: tall!, geo: geo! };
}

interface Crate { problems: string[]; worst: number; landing: V3 }
/** The object's world matrix against the library's, its pivot's landing and our angles; each failure names `crate` and the field. */
function crateCheck(r: Run): Crate {
  const rows = meshRows(r.geo, 'geometry of the landscape document');
  const built = derivedOf(r.wide, 'crate').filter((d) => rows.has(d.id));
  if (built.length !== 1) return { problems: [`crate: expands to ${built.length} built items (${derivedOf(r.wide, 'crate').map((d) => `${d.id} ${d.kind}`).join(', ') || 'none'}), not one`], worst: NaN, landing: [NaN, NaN, NaN] };
  const A = effectiveWorld(rows.get(built[0]!.id)!, [1, 1, 1]);
  const E = threeWorld(POSITION, ROTATION, SCALE, PIVOT);
  const out: string[] = [];
  let worst = 0;
  for (let j = 0; j < 3; j++) {
    const colLength = Math.hypot(A[0][j]!, A[1][j]!, A[2][j]!);
    const field = Math.abs(colLength - SCALE[j]!) > 1e-9 ? 'scale' : 'rotation';
    for (let i = 0; i < 3; i++) {
      const off = Math.abs(A[i]![j]! - E[i]![j]!);
      worst = Math.max(worst, off);
      if (!(off <= 1e-9)) out.push(`crate: ${field}: world[${i}][${j}] is ${fmt(A[i]![j]!, 9)}, the library's ${fmt(E[i]![j]!, 9)} (off by ${fmt(off, 4)})`);
    }
  }
  const landing = apply(A, PIVOT);
  const expected = apply(E, PIVOT);
  if ([0, 1, 2].some((k) => !(Math.abs(landing[k]! - expected[k]!) <= 1e-9))) {
    out.push(`crate: position: the pivot ${fmtV(PIVOT)} lands at ${fmtV(landing, 9)} m, the library's at ${fmtV(expected, 9)} m (x = ${fmt(landing[0], 9)} instead of ${fmt(expected[0], 9)})`);
  }
  for (let i = 0; i < 3; i++) {
    if (!(Math.abs(A[i]![3]! - E[i]![3]!) <= 1e-9)) out.push(`crate: world[${i}][3] is ${fmt(A[i]![3]!, 9)}, the library's ${fmt(E[i]![3]!, 9)}`);
  }
  const at = built[0]!.item['at'];
  const rot = isObject(at) && at['rot'] !== undefined ? v3(at['rot'], `${built[0]!.id}.at.rot`) : undefined;
  if (!rot || [0, 1, 2].some((k) => !(Math.abs(rot[k]! - OURS[k]!) <= 5e-5))) {
    out.push(`crate: rotation: our angles read ${rot ? fmtV(rot, 7) : 'nothing'} on ${built[0]!.id}, not ${fmtV(OURS, 7)}°`);
  }
  return { problems: out, worst, landing };
}

interface Cam { problems: string[]; fov: number; look: V3 }
/** A familiar camera's camera@1: its fov across the wider side and the way it looks; each failure names the camera. */
function cameraCheck(reply: JsonObject, id: string, expectedFov: number): Cam {
  const { found, problem } = oneOfKind(reply, id, 'camera@1');
  if (!found) return { problems: [problem!], fov: NaN, look: [NaN, NaN, NaN] };
  const out: string[] = [];
  const fov = num(paramOf(found, 'fov'), `${found.id}.params.fov`);
  if (!(Math.abs(fov - expectedFov) <= 1e-6)) out.push(`${id}: fov is ${fmt(fov, 7)}°, not ${fmt(expectedFov, 7)}° across the wider side`);
  const look = unit(sub(v3(paramOf(found, 'target'), `${found.id}.params.target`), v3(paramOf(found, 'position'), `${found.id}.params.position`)));
  const forward = threeForward([0, 30, 0]);
  if ([0, 1, 2].some((k) => !(Math.abs(look[k]! - forward[k]!) <= 1e-9))) out.push(`${id}: looks along ${fmtV(look)}, not the library's −Z turned (0°, 30°, 0°), ${fmtV(forward)}`);
  return { problems: out, fov, look };
}

const WIDE = oursFov(50, 16 / 9);

describe(`${AC[3]} transforms and cameras through the pack, against three.js ${THREE.version} (${THREE.commit.slice(0, 10)})`, () => {
  it(`${AC[3]} the object has the library's world matrix within 1e-9 with our angles (51.8766°, −7.2862°, 69.1188°), and the cameras expand to fov 79.3169° at 16:9 and 50° at 9:16, looking along (−0.5, 0, −0.866)`, () => {
    // The criterion's numbers are the reference's: our angles decompose the library's rotation, and the fov and look follow.
    const theirs = oursAngles(rotationOf(threeWorld(POSITION, ROTATION, SCALE, PIVOT), SCALE));
    expect([0, 1, 2].every((k) => Math.abs(theirs[k]! - OURS[k]!) <= 5e-5), `the library's rotation reads ${fmtV(theirs, 7)} in our order`).toBe(true);
    expect(fmt(WIDE, 6), 'the 16:9 fov').toBe('79.3169');
    expect(threeForward([0, 30, 0]).map((x) => Math.round(x * 1000) / 1000 + 0), 'the library\'s look').toEqual(LOOK);
    const r = run();
    none(crateCheck(r).problems, 'the familiar object against the library\'s matrixWorld');
    none(cameraCheck(r.wide, 'wide', WIDE).problems, 'the 16:9 camera');
    none(cameraCheck(r.tall, 'tall', 50).problems, 'the 9:16 camera');
  }, SLOW);

  it(`${AC[3]} the planted familiar_copies_angles misses by 1.668 in one coefficient and fails, naming crate and rotation`, () => {
    const c = crateCheck(run('familiar_copies_angles'));
    failsNaming(c.problems, ['crate', 'rotation'], 'the planted familiar_copies_angles');
    expect(Math.abs(c.worst - 1.668), `the largest miss is 1.668 (0.834 × the x scale of 2), got ${fmt(c.worst)}`).toBeLessThanOrEqual(5e-4);
  }, SLOW);

  it(`${AC[3]} the planted familiar_copies_position puts the pivot at x = 10 m instead of 11 m and fails, naming crate and position`, () => {
    const c = crateCheck(run('familiar_copies_position'));
    failsNaming(c.problems, ['crate', 'position'], 'the planted familiar_copies_position');
    expect(Math.abs(c.landing[0] - 10), `the pivot lands at x = 10 m, got ${fmt(c.landing[0])}`).toBeLessThanOrEqual(1e-9);
  }, SLOW);

  it(`${AC[3]} the planted familiar_widens_portrait widens the 9:16 camera to 29.395° and fails, naming it`, () => {
    const c = cameraCheck(run('familiar_widens_portrait').tall, 'tall', 50);
    failsNaming(c.problems, ['tall', 'fov'], 'the planted familiar_widens_portrait');
    expect(Math.abs(c.fov - 29.395), `the portrait fov is 29.395°, got ${fmt(c.fov)}`).toBeLessThanOrEqual(5e-4);
  }, SLOW);

  it(`${AC[3]} the planted familiar_looks_plus_z looks along +Z and fails, naming the camera`, () => {
    const c = cameraCheck(run('familiar_looks_plus_z').wide, 'wide', WIDE);
    failsNaming(c.problems, ['wide', 'looks along'], 'the planted familiar_looks_plus_z');
    expect(c.look.map((x) => Math.round(x * 1000) / 1000 + 0), 'it looks along the turned +Z').toEqual([0.5, 0, 0.866]);
  }, SLOW);
});
