// AC7 #493.5bfe22ba: With a shot framed by keep at 4.000 m from its target, push at its default amount puts the camera
// 4.600 m from the target on the shot's first frame and 4.000 m on its last, orbit at its default sweeps the azimuth
// from 15° before to 15° after the framed azimuth, a shot that glides in over 0.5 s starts at the previous shot's last
// pose within 1e-6 m and 1e-6 rad, and a channel on a pose path of a camera in a shot that isn't keyed is refused
// naming both.
//
// Through `deep-motion eval`. The framed distance D is whatever the keep fit gives (the answer's `shots.<id>.framed`,
// and a hold shot of the same keep, which must agree); push must start at 1.15 D and end on D (4.600 and 4.000 when D
// is 4.000), orbit must run from the framed azimuth − 15° to + 15°. The last 60 fps frame of a 2 s shot sits 1/60 s
// before its end, so it is read within 5e-4 of D, and the shot's end, which holds its last pose (README: Choices),
// within 1e-9.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, aimAngle, box3d, camera3d, channel, evalOk, evalOne, eyeAzimuth, film, fl, framedOf, frames60, maxDiff, mentions, none, norm,
  poseOf, rad, refused, rel, shot, show, sub, useMotion, wrap, type JsonObject, type Pose,
} from './helpers.ts';

const motion = useMotion();
const ITEMS = [camera3d(), box3d('crate', [0.3, 0.4, -0.2], [1.2, 0.8, 0.9])];
const keepDoc = (move: string, extra: JsonObject = {}): JsonObject => film(`keep-${move}`, ITEMS, { shots: { s: shot(0, 2, { move, frame: { keep: ['crate'] }, ...extra }) } }, { span: '3s' });
const TIMES = [...frames60(0, 2), fl(2)];

/** The framed pose: a hold shot of the same keep, which must equal the answer's `shots.s.framed`. */
function framed(): Pose {
  const a = evalOk(motion.bin(), { doc: keepDoc('hold'), times: [0, fl(1)] }, 'the hold shot');
  const hold = poseOf(a.frames[0]!, 'cam', 'the hold shot');
  const listed = framedOf(a, 's', 'the hold shot');
  expect(maxDiff(hold.position, listed.position), 'the hold shot sits on its framed pose').toBeLessThanOrEqual(1e-9);
  expect(maxDiff(poseOf(a.frames[1]!, 'cam', 'the hold shot').position, hold.position), 'a hold keeps its pose').toBe(0);
  return listed;
}

describe(`${AC[7]} default move amounts, the glide in, and the pose a shot alone writes`, () => {
  it(`${AC[7]} push at its default comes in from 1.15 times the framed distance on the first frame and lands on it on the last, aimed at the framed target`, () => {
    const f = framed(); const D = norm(sub(f.position, f.target));
    const a = evalOk(motion.bin(), { doc: keepDoc('push'), times: TIMES }, 'the push');
    const d = a.frames.map((x) => { const p = poseOf(x, 'cam', 'the push'); return norm(sub(p.position, p.target)); });
    const failures: string[] = [];
    if (!(rel(d[0]!, 1.15 * D) <= 1e-9)) failures.push(`the first frame is ${d[0]} m from the target, not 1.15 × ${D} = ${1.15 * D} m (4.600 m for 4.000 m)`);
    if (!(rel(d[d.length - 2]!, D) <= 5e-4)) failures.push(`the last 60 fps frame is ${d[d.length - 2]} m from the target, not ${D} m to 5e-4`);
    if (!(rel(d[d.length - 1]!, D) <= 1e-9)) failures.push(`the shot's end is ${d[d.length - 1]} m from the target, not ${D} m`);
    a.frames.forEach((x) => { const p = poseOf(x, 'cam', 'the push'); if (maxDiff(p.target, f.target) > 1e-9 || aimAngle(p, f) > 1e-9) failures.push(`at ${x.t} flicks the push leaves the framed target or aim`); });
    for (let i = 1; i < d.length; i++) if (d[i]! > d[i - 1]! + 1e-12) failures.push(`the push backs off at ${a.frames[i]!.t} flicks`);
    none(failures, `the push (D = ${D} m)`);
  }, TIMEOUT);

  it(`${AC[7]} orbit at its default sweeps the azimuth from 15° before to 15° after the framed azimuth at the framed distance`, () => {
    const f = framed(); const D = norm(sub(f.position, f.target)); const az = eyeAzimuth(f);
    const a = evalOk(motion.bin(), { doc: keepDoc('orbit'), times: TIMES }, 'the orbit');
    const poses = a.frames.map((x) => poseOf(x, 'cam', 'the orbit'));
    const failures: string[] = [];
    const first = wrap(eyeAzimuth(poses[0]!) - az); const end = wrap(eyeAzimuth(poses[poses.length - 1]!) - az);
    if (!(Math.abs(first + 15) <= 1e-9)) failures.push(`the orbit starts ${first}° from the framed azimuth, not −15°`);
    if (!(Math.abs(end - 15) <= 1e-9)) failures.push(`the orbit ends ${end}° from the framed azimuth, not +15°`);
    poses.forEach((p, i) => { if (!(rel(norm(sub(p.position, p.target)), D) <= 1e-9)) failures.push(`at ${a.frames[i]!.t} flicks the orbit is ${norm(sub(p.position, p.target))} m out, not ${D} m`); });
    none(failures, 'the orbit');
  }, TIMEOUT);

  it(`${AC[7]} a shot that glides in over 0.5 s starts at the previous shot's last pose within 1e-6 m and 1e-6 rad, and is on its own pose by 0.5 s`, () => {
    const doc = film('glide', ITEMS, { shots: {
      from: shot(0, 1, { target: [1, 0, 0], orbit: { azimuth: 10, elevation: 20, distance: 6 } }),
      into: shot(1, 3, { target: [-1, 0.5, 0], orbit: { azimuth: 70, elevation: 35, distance: 9 }, roll: 12, join: { glide: { span: '0.5s' } } }),
    } }, { span: '3s' });
    const times = [fl(1) - 1, fl(1), fl(1.25), fl(1.5), fl(2)];
    const a = evalOk(motion.bin(), { doc, times }, 'the glide');
    const [last, first, mid, done, later] = a.frames.map((x) => poseOf(x, 'cam', 'the glide')) as [Pose, Pose, Pose, Pose, Pose];
    const own = framedOf(a, 'into', 'the glide');
    const failures: string[] = [];
    if (maxDiff(first.position, last.position) > 1e-6 || maxDiff(first.target, last.target) > 1e-6) failures.push(`the glide starts at ${JSON.stringify([first.position, first.target])}, not the previous shot's last pose ${JSON.stringify([last.position, last.target])}`);
    for (const k of ['azimuth', 'elevation', 'roll'] as const) if (Math.abs(rad(wrap(first[k] - last[k]))) > 1e-6) failures.push(`the glide starts with ${k} ${first[k]}°, not the previous shot's ${last[k]}°`);
    for (const [p, when] of [[done, '1.5 s'], [later, '2 s']] as [Pose, string][]) {
      if (maxDiff(p.position, own.position) > 1e-9 || maxDiff(p.target, own.target) > 1e-9 || Math.abs(p.roll - own.roll) > 1e-9) failures.push(`at ${when} the shot isn't on its own pose: ${JSON.stringify([p.position, p.target, p.roll])} vs ${JSON.stringify([own.position, own.target, own.roll])}`);
    }
    if (maxDiff(mid.position, last.position) < 1e-3 || maxDiff(mid.position, own.position) < 1e-3) failures.push('at 1.25 s the glide sits on one end, not between them');
    expect(maxDiff(last.position, own.position), 'the two shots\' poses differ').toBeGreaterThan(1);
    none(failures, 'the glide in');
  }, TIMEOUT);

  it(`${AC[7]} a channel on a pose path of a camera in a shot that isn't keyed is refused naming both, and accepted when the shot is keyed`, () => {
    const doc = (keyed: boolean): JsonObject => film('keyed', ITEMS, {
      shots: { 'held-shot': shot(0, 2, { target: [0, 0, 0], ...(keyed ? { keyed: true } : {}) }) },
      channels: { 'nudge-x': channel('items/cam/params/target/0', [[0, 0], [2, 1]]) },
    }, { span: '3s' });
    const answer = refused(evalOne(motion.bin(), { doc: doc(false), times: [0, fl(1)] }), 'the channel on the camera\'s target in an unkeyed shot');
    expect(mentions(answer, 'nudge-x') && mentions(answer, 'held-shot'), `the refusal names the channel and the shot: ${show(answer)}`).toBe(true);
    const keyed = evalOk(motion.bin(), { doc: doc(true), times: [fl(1)] }, 'the same channel in a keyed shot');
    expect(Math.abs(poseOf(keyed.frames[0]!, 'cam', 'the keyed shot').target[0] - 0.5), 'in a keyed shot the channel writes the target').toBeLessThanOrEqual(1e-9);
  }, TIMEOUT);
});
