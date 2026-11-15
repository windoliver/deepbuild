// Oracle lane for #540's criteria 2 (#540.88ffa39f) and 3 (#540.c9bfe882): an upstream engine's camera tests, pinned
// at ed1daf0bf001b61586d9930840f2f1394092c079 (README: Sources), re-expressed against our point control's entries.
//
// Upstream, `tests/scene/test_camera_3d.cpp` lines 291 to 373 ("Project ray"): a camera at the origin with no
// rotation, looking along −Z, on a 400 × 200 view; orthographic with size 5 (the view 10 × 5 m), near 0.5, or
// perspective with a 120° field of view across the view's height, near 0.5. At the view's centre (200, 100), its top
// left (0, 0) and its bottom right (400, 200), the ray's origin is (0, 0, −0.5), (−5, 2.5, −0.5) and (5, −2.5, −0.5)
// (orthographic) or the eye (perspective), and its normal is (0, 0, −1) (orthographic), or (0, 0, −1),
// normalize(−√3, √3 ÷ 2, −0.5) and normalize(√3, −√3 ÷ 2, −0.5) (perspective). Lines 131 to 216 ("Position queries",
// is_position_behind): a point in front of the perspective camera is not behind it, one behind it is.
//
// Ours: the same views as `camera@1` items (an orthographic view width 10 m; a perspective field of view across the
// wider side, 2 atan(2√3), which is the upstream frustum: half-width 2√3 at distance 1 where its half-height is √3), a
// point control `aim` on a level plane, and a press at each of the three positions; the entry's stored ray (origin and
// unit direction) must be upstream's within 1e-9. Behind: the perspective presses' planes y = 1 and y = −1. The top
// left ray climbs, so it meets y = 1 ahead of the eye at (−2, 1, −1 ÷ √3), a point not behind the camera, and y = −1
// only behind it; the bottom right ray the other way round. A ground point is written only ahead (criterion 3).
import { describe, it } from 'vitest';
import {
  AC, DOC, Script, TIMEOUT, binOf, entriesOf, entryName, fmt, none, off, perspective, orthographic, pointControl, prebuild, presented, runShow, scenario,
  scene, show, unit, useTemp, valueOf, type JsonObject, type Pose, type V2, type V3,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const SIZE: V2 = [400, 200];
const AT: { name: string; p: V2 }[] = [{ name: 'the centre', p: [200, 100] }, { name: 'the top left', p: [0, 0] }, { name: 'the bottom right', p: [400, 200] }];
const R3 = Math.sqrt(3);
const ORTHO: Pose = { eye: [0, 0, 0], target: [0, 0, -1], size: SIZE, viewWidth: 10, near: 0.5 };
const PERSP: Pose = { eye: [0, 0, 0], target: [0, 0, -1], size: SIZE, fov: (2 * Math.atan(2 * R3) * 180) / Math.PI };
/** Upstream's expected rays, by position. */
const ORTHO_RAYS: { origin: V3; dir: V3 }[] = [{ origin: [0, 0, -0.5], dir: [0, 0, -1] }, { origin: [-5, 2.5, -0.5], dir: [0, 0, -1] }, { origin: [5, -2.5, -0.5], dir: [0, 0, -1] }];
const PERSP_RAYS: { origin: V3; dir: V3 }[] = [{ origin: [0, 0, 0], dir: [0, 0, -1] }, { origin: [0, 0, 0], dir: unit([-R3, R3 / 2, -0.5]) }, { origin: [0, 0, 0], dir: unit([R3, -R3 / 2, -0.5]) }];
/** The ground each press writes: none where the ray is level or meets the plane only behind the eye. */
const UP_GROUND: (V3 | null)[] = [null, [-2, 1, -1 / R3], null];
const DOWN_GROUND: (V3 | null)[] = [null, null, [2, -1, -1 / R3]];

const doc = (title: string, cam: JsonObject, y: number): JsonObject => scene(title, SIZE, { cam }, { controls: { aim: pointControl('Aim', { on: { plane: { y } } }) } }, ['scene3d', 'input']);
const DOCS = [
  { id: DOC(201), name: 'the orthographic view', doc: doc('#540 oracle orthographic', orthographic(ORTHO, 1000), -1), rays: ORTHO_RAYS, ground: [null, null, null] as (V3 | null)[] },
  { id: DOC(202), name: 'the perspective view over y = 1', doc: doc('#540 oracle perspective up', perspective(PERSP, 0.5, 1000), 1), rays: PERSP_RAYS, ground: UP_GROUND },
  { id: DOC(203), name: 'the perspective view over y = −1', doc: doc('#540 oracle perspective down', perspective(PERSP, 0.5, 1000), -1), rays: PERSP_RAYS, ground: DOWN_GROUND },
];

describe(`${AC[2]} / ${AC[3]} the upstream camera tests: the screen ray at the view's centre and corners, and nothing behind the eye`, () => {
  it(`${AC[2]} / ${AC[3]} each press stores upstream's ray origin and direction, orthographic and perspective, and a ground point only ahead of the eye`, () => {
    const s = new Script();
    for (const d of DOCS) s.present(d.id, d.doc);
    const presses = DOCS.map((_, i) => { s.panel = `p${i + 1}`; return AT.map((a) => s.click(a.p)); });
    const r = runShow(binOf(), scenario(temp(), DOCS.map((d) => ({ id: d.id, size: SIZE })), s.calls), 'the camera oracle');
    DOCS.forEach((d, i) => presented(r[i]!, d.name));
    const failures: string[] = [];
    DOCS.forEach((d, i) => AT.forEach((a, j) => {
      const e = entriesOf(r, presses[i]![j]!, 'aim').find((x) => valueOf(x).phase === 'press');
      const what = `${d.name}, the press at ${a.name} ${fmt(a.p, 0)}`;
      if (!e) { failures.push(`${what}: no press entry (${show(r[presses[i]![j]![0]]!['appended'] ?? null)})`); return; }
      const v = valueOf(e);
      const want = d.rays[j]!;
      if (!v.ray || off(v.ray.origin, want.origin) > 1e-9 || off(v.ray.dir, want.dir) > 1e-9) failures.push(`${what}: ${entryName(e)} stores ray ${show(v.ray)}, not upstream's origin ${fmt(want.origin, 6)} and normal ${fmt(want.dir, 6)}`);
      const g = d.ground[j]!;
      if (g === null ? v.ground !== null : !v.ground || off(v.ground, g) > 1 / 1024) failures.push(`${what}: ${entryName(e)} writes ground ${v.ground ? fmt(v.ground, 6) : 'none'}, not ${g ? fmt(g, 6) : 'none'} (a point behind the camera is never met)`);
    }));
    none(failures, 'the camera oracle\'s presses');
  }, TIMEOUT);
});
