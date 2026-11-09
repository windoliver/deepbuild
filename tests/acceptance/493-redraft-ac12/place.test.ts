// AC12 #493.c0595506: A shot's framing puts the kept items' center at its place within 0.5 px.
//
// Through `deep-motion eval` with `project` (README: The surface under test). The kept items' center is the center of
// their union bound (Camera camera@1: framing: "the target offset that puts their center at place"; Shot: the fit "sized
// to the union of their evaluated bounds"); a pad widens that bound evenly, so its center doesn't move. The kept items
// here stand still, so the union is the boxes' own bounds, worked out from the document. The place is a fraction of the
// safe frame (`fit.place`: "as fractions of the safe frame"; Document envelope: `safe: f32, u = 24`), in px of the
// document's size. To read where that center lands through the binary's own projection, each film carries an unkept
// marker, `mid`, a 1 mm box (3D) or a 1 u rect (2D) centred on the union's center, and the test reads `projected.mid
// .center`. A hold shot shows its framed pose at every frame, so the frames read here are the framing's.
// Four framings: perspective at the default place; two boxes at [0.3, 0.6] under `safe: 60`; a rolled shot at [0.6, 0.4];
// a 2D page of two rects at [0.25, 0.65] with fill 0.5. Each union's center lies off the camera's own aim, so a shot
// that doesn't frame misses.
// No upstream test (oracle page: only criterion 11 is mapped).
import { describe, it } from 'vitest';
import {
  AC, F60, TIMEOUT, box3d, camera2d, camera3d, evalOk, film, fl, none, projOf, rect, safeFrame, shot, useMotion,
  type JsonObject, type V3,
} from './helpers.ts';

const motion = useMotion();

const TRANSPORT: JsonObject = { span: '2s', frame_rate: '60/1' };
/** Frames across the 2 s hold shot, its last 60 fps frame included. */
const TIMES = [0, fl(0.5), fl(1), fl(1.5), 119 * F60];

interface Box3 { id: string; pos: V3; size: number }
/** The union bound's center of boxes centred on their positions. */
function center3(boxes: Box3[]): V3 {
  const lo = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.pos[k]! - b.size / 2)));
  const hi = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.pos[k]! + b.size / 2)));
  return [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
}
type Rect = { id: string; box: [number, number, number, number] };
/** The union bound's center of rects `[x, y, w, h]` at the origin. */
function center2(rects: Rect[]): [number, number] {
  const x0 = Math.min(...rects.map((r) => r.box[0])); const y0 = Math.min(...rects.map((r) => r.box[1]));
  const x1 = Math.max(...rects.map((r) => r.box[0] + r.box[2])); const y1 = Math.max(...rects.map((r) => r.box[1] + r.box[3]));
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** The place in px: a fraction of the safe frame of the document's size. */
function placePx(doc: JsonObject, place: [number, number]): [number, number] {
  const [x0, y0, x1, y1] = safeFrame(doc);
  return [x0 + place[0] * (x1 - x0), y0 + place[1] * (y1 - y0)];
}

/** Every frame's projected `mid` center against the place, within 0.5 px; failures name the shot and the frame. */
function placed(doc: JsonObject, shotId: string, place: [number, number], what: string): string[] {
  const a = evalOk(motion.bin(), { doc, times: TIMES, project: ['mid'] }, what);
  const want = placePx(doc, place);
  const failures: string[] = [];
  for (const f of a.frames) {
    const c = projOf(f, 'mid', what).center;
    const miss = Math.hypot(c[0] - want[0], c[1] - want[1]);
    if (!(miss <= 0.5)) failures.push(`shot ${shotId} at ${f.t} flicks: the kept items' center lands at (${c[0]}, ${c[1]}) px, ${miss} px from its place (${want[0]}, ${want[1]})`);
  }
  return failures;
}

describe('AC12: a shot\'s framing puts the kept items\' center at its place', () => {
  it(`${AC[12]} perspective, one box: its center at the default place [0.5, 0.5] within 0.5 px at every frame`, () => {
    {
      const boxes: Box3[] = [{ id: 'crate', pos: [1.2, 0.4, -0.7], size: 0.8 }];
      const mid = center3(boxes);
      const doc = film('place-default', [camera3d({ orbit: { azimuth: 120, elevation: 25, distance: 10 } }), ...boxes.map((b) => box3d(b.id, b.pos, b.size)), box3d('mid', mid, 0.001)], {
        shots: { look: shot(0, 2, { frame: { keep: ['crate'] } }) },
      }, TRANSPORT);
      none(placed(doc, 'look', [0.5, 0.5], 'one box at the default place'), 'the kept items\' center at its place within 0.5 px');
    }
  }, TIMEOUT);

  it(`${AC[12]} perspective, two boxes: their union's center at [0.3, 0.6] of a 60 u safe frame within 0.5 px at every frame`, () => {
    {
      const boxes: Box3[] = [{ id: 'left', pos: [-1.5, 0.2, 0.5], size: 0.6 }, { id: 'right', pos: [1.0, -0.4, -1.2], size: 1.2 }];
      const mid = center3(boxes);
      const doc = film('place-two', [camera3d({ orbit: { azimuth: 30, elevation: 20, distance: 12 } }), ...boxes.map((b) => box3d(b.id, b.pos, b.size)), box3d('mid', mid, 0.001)], {
        safe: 60,
        shots: { pair: shot(0, 2, { frame: { keep: ['left', 'right'], place: [0.3, 0.6] } }) },
      }, TRANSPORT);
      none(placed(doc, 'pair', [0.3, 0.6], 'two boxes at [0.3, 0.6], safe 60'), 'the kept items\' center at its place within 0.5 px');
    }
  }, TIMEOUT);

  it(`${AC[12]} perspective, a rolled shot: the union's center at [0.6, 0.4] of the frame as drawn within 0.5 px at every frame`, () => {
    {
      const boxes: Box3[] = [{ id: 'post', pos: [0.5, 1.0, 0.3], size: 0.5 }, { id: 'sign', pos: [-0.6, 0.2, 0.9], size: 0.4 }];
      const mid = center3(boxes);
      const doc = film('place-rolled', [camera3d({ orbit: { azimuth: -40, elevation: 15, distance: 9 } }), ...boxes.map((b) => box3d(b.id, b.pos, b.size)), box3d('mid', mid, 0.001)], {
        shots: { dutch: shot(0, 2, { roll: 20, frame: { keep: ['post', 'sign'], place: [0.6, 0.4] } }) },
      }, TRANSPORT);
      none(placed(doc, 'dutch', [0.6, 0.4], 'a rolled shot at [0.6, 0.4]'), 'the kept items\' center at its place within 0.5 px');
    }
  }, TIMEOUT);

  it(`${AC[12]} a 2D page: two rects' union center at [0.25, 0.65] with fill 0.5 within 0.5 px at every frame`, () => {
    {
      const size: [number, number] = [1920, 1080];
      const rects: Rect[] = [{ id: 'note', box: [300, 200, 160, 90] }, { id: 'chart', box: [900, 500, 240, 300] }];
      const [cx, cy] = center2(rects);
      const doc = film('place-page', [camera2d(size), ...rects.map((r) => rect(r.id, r.box)), rect('mid', [cx - 0.5, cy - 0.5, 1, 1])], {
        shots: { page: shot(0, 2, { frame: { keep: ['note', 'chart'], place: [0.25, 0.65], fill: 0.5 } }) },
      }, TRANSPORT, size);
      none(placed(doc, 'page', [0.25, 0.65], 'a 2D page at [0.25, 0.65]'), 'the kept items\' center at its place within 0.5 px');
    }
  }, TIMEOUT);
});
