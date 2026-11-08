// AC17 #493.f3a08e63: A 2.9 s pan with by 24° and angle 270 (a tilt up) onto a framed pitch of 21° starts with the aim
// at −3° pitch and ends at 21°, with the azimuth equal to the framed azimuth at every frame within 1e-9°; a planted pan
// that ignores the angle turns the azimuth by 24° and fails, naming the shot.
//
// Through `deep-motion eval`. Shot `tilt` [0, 2.9 s), `move: pan, by: 24, angle: 270`, onto an explicit pose whose eye
// sits 21° below its target (orbit elevation −21°), so the framed aim pitches up 21°. The pitch is the aim's
// (target − position) angle above level; the azimuth is the eye's about the target (camera@1's convention). The shot's
// end holds its last pose (README: Choices). The plant is `pan_ignores_angle`.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, aimPitch, box3d, camera3d, evalOk, evalPlanted, eyeAzimuth, failsNaming, film, fl, framedOf, frames60, maxDiff, none, poseOf, shot,
  useMotion, wrap, type Accepted,
} from './helpers.ts';

const motion = useMotion();
const DOC = film('tilt', [camera3d(), box3d('tower', [0, 4, 0], [1, 8, 1]), box3d('base', [0, 0, 0], 2, 'ink')], {
  shots: { tilt: shot(0, 2.9, { move: 'pan', by: 24, angle: 270, target: [0, 2, 0], orbit: { azimuth: 30, elevation: -21, distance: 6 } }) },
});
const TIMES = [...frames60(0, 2.9), fl(2.9)];

function tiltFailures(a: Accepted): string[] {
  const framed = framedOf(a, 'tilt', 'the tilt'); const az = eyeAzimuth(framed);
  const failures: string[] = [];
  const poses = a.frames.map((f) => poseOf(f, 'cam', 'the tilt'));
  const first = aimPitch(poses[0]!); const last = aimPitch(poses[poses.length - 1]!);
  if (!(Math.abs(first + 3) <= 1e-9)) failures.push(`shot tilt: the aim starts at ${first}° pitch, not −3°`);
  if (!(Math.abs(last - 21) <= 1e-9)) failures.push(`shot tilt: the aim ends at ${last}° pitch, not 21°`);
  poses.forEach((p, i) => {
    const off = wrap(eyeAzimuth(p) - az);
    if (!(Math.abs(off) <= 1e-9)) failures.push(`shot tilt: at ${TIMES[i]! / FLICKS} s the azimuth is ${off}° off the framed azimuth`);
    if (maxDiff(p.position, framed.position) > 1e-9) failures.push(`shot tilt: at ${TIMES[i]! / FLICKS} s the camera moves; a pan turns the aim about the camera`);
  });
  return failures;
}

describe(`${AC[17]} a pan at 270° tilts up onto the framed aim, keeping the azimuth`, () => {
  it(`${AC[17]} the 2.9 s pan by 24° at angle 270 starts at −3° pitch, ends at 21°, and keeps the framed azimuth at every frame within 1e-9°`, () => {
    const a = evalOk(motion.bin(), { doc: DOC, times: TIMES }, 'the tilt');
    expect(Math.abs(aimPitch(framedOf(a, 'tilt', 'the tilt')) - 21), 'the framed aim pitches up 21°').toBeLessThanOrEqual(1e-9);
    none(tiltFailures(a), 'the tilt');
  }, TIMEOUT);

  it(`${AC[17]} a planted pan that ignores the angle turns the azimuth by 24° and fails, naming the shot`, () => {
    const a = evalPlanted(motion.bin(), { doc: DOC, times: TIMES, planted: 'pan_ignores_angle' }, 'the planted pan');
    const off = Math.abs(wrap(eyeAzimuth(poseOf(a.frames[0]!, 'cam', 'plant')) - eyeAzimuth(framedOf(a, 'tilt', 'plant'))));
    expect(Math.abs(off - 24), `the plant starts ${off}° off the framed azimuth, about 24°`).toBeLessThanOrEqual(1e-6);
    failsNaming(tiltFailures(a), ['shot tilt'], 'the tilt check on the plant');
  }, TIMEOUT);
});
