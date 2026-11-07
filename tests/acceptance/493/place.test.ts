// AC12 #493.c0595506: A shot's framing puts the kept items' center at its place within 0.5 px.
//
// Through `deep-motion eval` with `project`: `place` is a fraction of the safe frame (Camera camera@1: framing; the safe
// frame is `safe` u in from each edge, 1 u a px at the document's size). Four shots: in perspective one kept box at the
// default place and at [0.3, 0.6] under `safe: 60`; two kept boxes at [0.65, 0.4], their center read through a marker
// at the union's center that isn't kept; and a 2D page with two kept rects at [0.25, 0.7], where the projection is
// affine, so the union's center is the center of their projected boxes. A framer that places the center on the whole
// frame rather than the safe frame, or one item's center rather than the union's, misses.
import { describe, it } from 'vitest';
import {
  AC, TIMEOUT, box3d, camera2d, camera3d, evalOk, film, frames60, none, projOf, rect, safeFrame, shot, useMotion, type JsonObject,
} from './helpers.ts';

const motion = useMotion();
const TIMES = frames60(0, 1);

/** The place in px of the document's safe frame. */
function placePx(doc: JsonObject, place: [number, number]): [number, number] {
  const [x0, y0, x1, y1] = safeFrame(doc);
  return [x0 + place[0] * (x1 - x0), y0 + place[1] * (y1 - y0)];
}

describe(`${AC[12]} framing puts the kept items' center at its place`, () => {
  it(`${AC[12]} in perspective and on a 2D page, with one kept item and with two, the kept items' center lands at the shot's place within 0.5 px at every frame`, () => {
    const cases: { name: string; doc: JsonObject; place: [number, number]; probe: string | [string, string] }[] = [
      { name: 'one box, default place', place: [0.5, 0.5], probe: 'crate', doc: film('place-default', [camera3d(), box3d('crate', [0.7, 0.2, -0.4], [0.5, 0.8, 0.6])], { shots: { s: shot(0, 1, { frame: { keep: ['crate'] } }) } }) },
      { name: 'one box at [0.3, 0.6], safe 60', place: [0.3, 0.6], probe: 'crate', doc: film('place-off', [camera3d(), box3d('crate', [0.7, 0.2, -0.4], [0.5, 0.8, 0.6])], { safe: 60, shots: { s: shot(0, 1, { frame: { keep: ['crate'], place: [0.3, 0.6] } }) } }) },
      {
        name: 'two boxes at [0.65, 0.4]', place: [0.65, 0.4], probe: 'mid',
        doc: film('place-two', [camera3d({ orbit: { azimuth: 30, elevation: 20, distance: 10 } }), box3d('left', [-1, 0, 0], 0.6), box3d('right', [1.5, 1, -0.5], 0.4), box3d('mid', [0.3, 0.5, -0.25], 0.001)],
          { shots: { s: shot(0, 1, { frame: { keep: ['left', 'right'], place: [0.65, 0.4] } }) } }),
      },
      {
        name: '2D page, two rects at [0.25, 0.7]', place: [0.25, 0.7], probe: ['a', 'b'],
        doc: film('place-2d', [camera2d([1280, 720]), rect('a', [100, 100, 200, 120], 'accent'), rect('b', [700, 300, 160, 240], 'ink')],
          { shots: { s: shot(0, 1, { frame: { keep: ['a', 'b'], place: [0.25, 0.7] } }) } }, { span: '4s' }, [1280, 720]),
      },
    ];
    const failures: string[] = [];
    for (const c of cases) {
      const want = placePx(c.doc, c.place);
      const a = evalOk(motion.bin(), { doc: c.doc, times: TIMES, project: typeof c.probe === 'string' ? [c.probe] : c.probe }, c.name);
      for (const f of a.frames) {
        let got: [number, number];
        if (typeof c.probe === 'string') got = projOf(f, c.probe, c.name).center;
        else {
          const [p, q] = c.probe.map((id) => projOf(f, id, c.name).box);
          got = [(Math.min(p![0], q![0]) + Math.max(p![2], q![2])) / 2, (Math.min(p![1], q![1]) + Math.max(p![3], q![3])) / 2];
        }
        const off = Math.hypot(got[0] - want[0], got[1] - want[1]);
        if (!(off <= 0.5)) failures.push(`${c.name}: at ${f.t} flicks the kept items' center is at (${got[0].toFixed(3)}, ${got[1].toFixed(3)}) px, ${off.toFixed(3)} px from the place (${want[0]}, ${want[1]})`);
      }
    }
    none(failures, 'the framing\'s place');
  }, TIMEOUT);
});
