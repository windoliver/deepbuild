// AC2 #468.75d393c7: A lens's field of view and exposure match their closed forms (fov = 2·atan(sensor ÷ 2f); EV100 =
// log2(N² ÷ t) − log2(ISO ÷ 100)) to 1e-6.
//
// Through `deep-gpu run`'s `view3d` (#378) with #429's `evaluate`: a camera with a `lens` and no `fov` (Camera
// `camera@1`: lens), one frame each, and the evaluated value of `items/cam/params/fov` (degrees across the frame's wider
// side, as the core's camera holds it) and of `items/cam/params/exposure` under `exposure: from_lens` (EV100) read off
// the frame's `values` (Assumed surface 1).
//
// Fields of view: each lens's fitted sensor side spans the frame's wider side, so the core's fov is 2·atan(side ÷ 2f):
// 50 mm on [36, 24] fit wider across a 3:2 frame; 24 mm fit horizontal across 16:9; 135 mm fit vertical on a portrait
// 9:16 frame (24 mm over its height); 35 mm with the sensor and fit left at their defaults ([36, 24], wider); and 85 mm on
// a [24.89, 18.66] sensor, fit wider, on 4:3. Exposure: `aperture`, `shutter` and `iso` left at their defaults (f/5.6,
// 180°, ISO 100) at 24 fps; f/2.8, 90°, ISO 800 at 30 fps; f/11, 270°, ISO 50 at 60 fps, with t = angle ÷ (360 × the
// frame rate), the frame rate the document's `transport.frame_rate` and the call's `fps`. Each within 1e-6 of its
// closed form (degrees; EV).
//
// Wrong programs: the base (no lens: refused, or the authored fields read back); a fov across the wrong side or from
// the focal length alone; an exposure from the shutter's speed without the angle, or from a fixed frame rate; ISO
// counted the wrong way.
import { describe, it } from 'vitest';
import {
  AC, DARK_SKY, box, ev100OfLens, frameAt, framesOf, fovOfLens, lensCamera, none, num, requireMetal, runGpu, sceneDoc, unlit, useGpu, useOut, valueAt,
  view3d, writeJson, type JsonObject, type Lens,
} from './helpers.ts';

const ID = AC[2];
const bin = useGpu();
const out = useOut();
const TOL = 1e-6;

interface FovCase { name: string; lens: Lens; size: [number, number]; side: number }
const FOVS: FovCase[] = [
  { name: '50 mm, [36, 24], wider, 3:2', lens: { focal_length: 50, sensor: [36, 24], fit: 'wider' }, size: [1440, 960], side: 36 },
  { name: '24 mm, [36, 24], horizontal, 16:9', lens: { focal_length: 24, sensor: [36, 24], fit: 'horizontal' }, size: [1920, 1080], side: 36 },
  { name: '135 mm, [36, 24], vertical, 9:16', lens: { focal_length: 135, sensor: [36, 24], fit: 'vertical' }, size: [1080, 1920], side: 24 },
  { name: '35 mm, sensor and fit by default, 3:2', lens: { focal_length: 35 }, size: [1500, 1000], side: 36 },
  { name: '85 mm, [24.89, 18.66], wider, 4:3', lens: { focal_length: 85, sensor: [24.89, 18.66], fit: 'wider' }, size: [1600, 1200], side: 24.89 },
];
interface EvCase { name: string; params: JsonObject; fStop: number; angle: number; iso: number; rate: number }
const EVS: EvCase[] = [
  { name: 'f/5.6, 180°, ISO 100 by default, 24 fps', params: {}, fStop: 5.6, angle: 180, iso: 100, rate: 24 },
  { name: 'f/2.8, 90°, ISO 800, 30 fps', params: { aperture: { f_stop: 2.8 }, shutter: { angle: 90 }, iso: 800 }, fStop: 2.8, angle: 90, iso: 800, rate: 30 },
  { name: 'f/11, 270°, ISO 50, 60 fps', params: { aperture: { f_stop: 11 }, shutter: { angle: 270 }, iso: 50 }, fStop: 11, angle: 270, iso: 50, rate: 60 },
];

function lensDoc(name: string, size: [number, number], lens: Lens, more: JsonObject, rate: number): JsonObject {
  return sceneDoc(name, size, {
    cam: lensCamera([0, 1, 6], [0, 1, 0], lens, more), sky: DARK_SKY, grey: unlit([0.5, 0.5, 0.5]),
    cube: box([1, 1, 1], [0, 1, 0], 'grey'),
  }, { transport: { span: '1s', frame_rate: [rate, 1] } });
}
/** Each document's one evaluated value at `path`, frame 0, in one process. */
function evaluated(docs: { doc: JsonObject; size: [number, number]; fps: number }[], path: string): number[] {
  const dir = out();
  const replies = runGpu(bin(), dir, docs.map(({ doc, size, fps }, k) => view3d({ doc: writeJson(dir, `lens-${k}`, doc), size, fps, evaluate: [path] })));
  return replies.map((r, k) => {
    const what = String(docs[k]!.doc['id']);
    return num(valueAt(frameAt(framesOf(r, what), 0, what), path, what), `${what}: ${path}`);
  });
}

describe(`${ID} a lens's field of view and exposure in closed form`, () => {
  it(`${ID} the field of view is 2·atan(sensor ÷ 2f) of the fitted side, to 1e-6`, () => {
    requireMetal();
    const got = evaluated(FOVS.map((c, k) => ({ doc: lensDoc(`fov-${k}`, c.size, c.lens, {}, 24), size: c.size, fps: 24 })), 'items/cam/params/fov');
    const failures: string[] = [];
    FOVS.forEach((c, k) => {
      const want = fovOfLens(c.side, c.lens.focal_length);
      console.log(`${ID} ${c.name}: fov ${got[k]} against 2·atan(${c.side} ÷ ${2 * c.lens.focal_length}) = ${want} (off ${Math.abs(got[k]! - want).toExponential(2)})`);
      if (!(Math.abs(got[k]! - want) <= TOL)) failures.push(`${c.name}: fov ${got[k]}° is not ${want}° within 1e-6`);
    });
    none(failures, `${ID}: the lens's field of view`);
  });

  it(`${ID} exposure from_lens is log2(N² ÷ t) − log2(ISO ÷ 100) with t = angle ÷ (360 × frame rate), to 1e-6`, () => {
    requireMetal();
    const got = evaluated(EVS.map((c, k) => ({ doc: lensDoc(`ev-${k}`, [960, 640], { focal_length: 50 }, { exposure: 'from_lens', ...c.params }, c.rate), size: [960, 640], fps: c.rate })), 'items/cam/params/exposure');
    const failures: string[] = [];
    EVS.forEach((c, k) => {
      const want = ev100OfLens(c.fStop, c.angle, c.iso, c.rate);
      console.log(`${ID} ${c.name}: EV100 ${got[k]} against ${want} (off ${Math.abs(got[k]! - want).toExponential(2)})`);
      if (!(Math.abs(got[k]! - want) <= TOL)) failures.push(`${c.name}: EV100 ${got[k]} is not ${want} within 1e-6`);
    });
    none(failures, `${ID}: exposure from the lens`);
  });
});
