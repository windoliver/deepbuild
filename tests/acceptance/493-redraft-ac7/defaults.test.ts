// AC7 #493.5bfe22ba: With a shot framed by keep at 4.000 m from its target, push at its default amount puts the camera
// 4.600 m from the target on the shot's first frame and 4.000 m on its last, orbit at its default sweeps the azimuth from
// 15° before to 15° after the framed azimuth, a shot that glides in over 0.5 s starts at the previous shot's last pose
// within 1e-6 m and 1e-6 rad, and a channel on a pose path of a camera in a shot that isn't keyed is refused naming both.
//
// Through `deep-motion eval` (README: The surface under test). "Framed by keep at 4.000 m": the tests don't pin the keep
// fit's formula. A fit sized to a box's bounds at fixed angles, pad, fill and place is similar under scaling (a box s
// times larger frames at s times the distance), so the suite reads the framed distance D1 of a unit box once, scales the
// box by 4 ÷ D1, and checks the shot is then framed at 4.000 m. A shot's frames are the document's 60 fps frames inside
// [start, end): its first at start, its last at end − 1/60 s. The previous shot's last pose is the pose it shows at its
// end, read at the flick before the next shot starts.
// No upstream test (oracle page: only criterion 11 is mapped).
import { describe, expect, it } from 'vitest';
import {
  AC, F60, TIMEOUT, box3d, camera3d, channel, deg, dot, eyeAzimuth, evalOk, evalOne, fl, film, framedOf, mentions, norm, poseOf,
  rad, refused, shot, show, sub, useMotion, wrap, type JsonObject, type Pose, type V3,
} from './helpers.ts';

const motion = useMotion();

/** The 60 fps document all these films run at: 4 s. */
const TRANSPORT: JsonObject = { span: '4s', frame_rate: '60/1' };
/** The kept box at unit size, off the camera's own target so a framing that ignores keep shows. */
const CRATE_AT: V3 = [0.3, 0.2, -0.4];
const crate = (s: number): JsonObject => box3d('crate', [CRATE_AT[0] * s, CRATE_AT[1] * s, CRATE_AT[2] * s], s);
/** A film with one perspective camera (orbit 45°, 30°, 10 m; fov 40°) and the kept crate at scale `s`. */
const keepFilm = (id: string, s: number, shots: JsonObject, extra: JsonObject = {}): JsonObject =>
  film(id, [camera3d(), crate(s)], { shots, ...extra }, TRANSPORT);

/** Euclidean distance between two points. */
const dist = (a: V3, b: V3): number => norm(sub(a, b));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** The angle between two directions in radians, from atan2 of the cross product's length and the dot product: well
 * conditioned for nearly parallel vectors, where acos of the dot is not. */
const between = (a: V3, b: V3): number => Math.atan2(norm(cross(a, b)), dot(a, b));
/** The aim, target − position. */
const aimOf = (p: Pose): V3 => sub(p.target, p.position);

/** The box scale at which the keep fit frames the crate at 4 m: the unit box's framed distance D1, then 4 ÷ D1. */
function scaleFor4m(bin: string): number {
  const probe = evalOk(bin, { doc: keepFilm('keep-probe', 1, { probe: shot(0, 2, { frame: { keep: ['crate'] } }) }), times: [0] }, 'the unit box framed by keep');
  const framed = framedOf(probe, 'probe', 'the unit box framed by keep');
  const d1 = dist(framed.position, framed.target);
  expect(d1 > 0 && Number.isFinite(d1), `the unit box's framed distance is a positive length, got ${d1}`).toBe(true);
  return 4 / d1;
}
/** The precondition: the shot is framed by keep at 4.000 m from its target. */
function framedAt4m(framed: Pose, what: string): void {
  const d = dist(framed.position, framed.target);
  expect(Math.abs(d - 4), `${what}: framed by keep at 4.000 m from its target, got ${d} m`).toBeLessThanOrEqual(5e-4);
}

const FIRST = 0;
const LAST = 119 * F60; // the last 60 fps frame of a shot over [0 s, 2 s)

describe('AC7: default moves and the glide from a shot framed at 4 m, and pose channels', () => {
  it(`${AC[7]} push at its default amount: 4.600 m from the target on the first frame, 4.000 m on the last`, () => {
    const bin = motion.bin();
    const s = scaleFor4m(bin);
    const a = evalOk(bin, { doc: keepFilm('push-default', s, { push: shot(0, 2, { move: 'push', frame: { keep: ['crate'] } }) }), times: [FIRST, LAST] }, 'the push');
    const framed = framedOf(a, 'push', 'the push');
    framedAt4m(framed, 'the push');
    const d = dist(framed.position, framed.target);
    const [first, last] = a.frames.map((f) => poseOf(f, 'cam', 'the push'));
    const d0 = dist(first!.position, framed.target);
    const d1 = dist(last!.position, framed.target);
    // u = 0 on the first frame: (1 + 0.15) × the framed distance, as the design's default reads.
    expect(Math.abs(d0 - 1.15 * d), `the push's first frame is 1.15 × the framed distance ${d} m from the target, got ${d0} m`).toBeLessThanOrEqual(1e-9 * d);
    expect(Math.abs(d0 - 4.6), `the push's first frame is 4.600 m from the target, got ${d0} m`).toBeLessThanOrEqual(5e-4);
    expect(Math.abs(d1 - 4.0), `the push's last frame is 4.000 m from the target, got ${d1} m`).toBeLessThanOrEqual(5e-4);
  }, TIMEOUT);

  it(`${AC[7]} orbit at its default sweeps the azimuth from 15° before to 15° after the framed azimuth`, () => {
    const bin = motion.bin();
    const s = scaleFor4m(bin);
    const a = evalOk(bin, { doc: keepFilm('orbit-default', s, { spin: shot(0, 2, { move: 'orbit', frame: { keep: ['crate'] } }) }), times: [FIRST, LAST] }, 'the orbit');
    const framed = framedOf(a, 'spin', 'the orbit');
    framedAt4m(framed, 'the orbit');
    const az = eyeAzimuth(framed);
    // The eye's azimuth about the framed target (Camera camera@1: azimuth 0 puts the eye on +Z of the target).
    const about = (p: Pose): number => deg(Math.atan2(p.position[0] - framed.target[0], p.position[2] - framed.target[2]));
    const [first, last] = a.frames.map((f) => poseOf(f, 'cam', 'the orbit'));
    const off0 = wrap(about(first!) - az);
    const off1 = wrap(about(last!) - az);
    expect(Math.abs(off0 - -15), `the orbit's first frame is 15° before the framed azimuth ${az}°, got ${off0}° from it`).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(off1 - 15), `the orbit's last frame is 15° after the framed azimuth ${az}°, got ${off1}° from it`).toBeLessThanOrEqual(1e-3);
  }, TIMEOUT);

  it(`${AC[7]} a shot that glides in over 0.5 s starts at the previous shot's last pose within 1e-6 m and 1e-6 rad`, () => {
    const bin = motion.bin();
    const s = scaleFor4m(bin);
    // The incoming shot's own pose is far from the outgoing one's, so a cut can't pass for a glide.
    const target: V3 = [2, 1, -3];
    const orbit = { azimuth: -60, elevation: 15, distance: 7 };
    const doc = keepFilm('glide-in', s, {
      push: shot(0, 2, { move: 'push', frame: { keep: ['crate'] } }),
      settle: shot(2, 4, { target, orbit, join: { glide: { span: '0.5s' } } }),
    });
    const lastOut = fl(2) - 1; // the flick before the incoming shot starts: the outgoing shot's last pose
    const times = [lastOut, fl(2), fl(2.25), fl(2.5), fl(3)];
    const a = evalOk(bin, { doc, times }, 'the glide');
    framedAt4m(framedOf(a, 'push', 'the glide'), 'the outgoing push');
    const [out, start, mid, landed, later] = a.frames.map((f) => poseOf(f, 'cam', 'the glide'));
    const failures: string[] = [];
    const posGap = dist(start!.position, out!.position);
    const tgtGap = dist(start!.target, out!.target);
    const aimGap = between(aimOf(start!), aimOf(out!));
    const rollGap = Math.abs(rad(wrap(start!.roll - out!.roll)));
    if (!(posGap <= 1e-6)) failures.push(`shot settle at 2 s: the position is ${posGap} m from the previous shot's last`);
    if (!(tgtGap <= 1e-6)) failures.push(`shot settle at 2 s: the target is ${tgtGap} m from the previous shot's last`);
    if (!(aimGap <= 1e-6)) failures.push(`shot settle at 2 s: the aim is ${aimGap} rad from the previous shot's last`);
    if (!(rollGap <= 1e-6)) failures.push(`shot settle at 2 s: the roll is ${rollGap} rad from the previous shot's last`);
    expect(failures, `the glide starts at the previous shot's last pose:\n  ${failures.join('\n  ')}\nat 2 s: ${show(start!.raw)}\nbefore: ${show(out!.raw)}`).toEqual([]);
    // It glides over 0.5 s onto its own pose: from 2.5 s the shot's explicit pose, mid-glide neither end.
    const el = rad(orbit.elevation); const azr = rad(orbit.azimuth);
    const eye: V3 = [target[0] + orbit.distance * Math.cos(el) * Math.sin(azr), target[1] + orbit.distance * Math.sin(el), target[2] + orbit.distance * Math.cos(el) * Math.cos(azr)];
    for (const [p, when] of [[landed!, '2.5 s'], [later!, '3 s']] as const) {
      expect(dist(p.position, eye), `the incoming shot's own eye ${JSON.stringify(eye)} by ${when}, got ${show(p.raw)}`).toBeLessThanOrEqual(1e-6);
      expect(dist(p.target, target), `the incoming shot's own target by ${when}, got ${show(p.raw)}`).toBeLessThanOrEqual(1e-6);
    }
    expect(dist(mid!.position, out!.position), `mid-glide (2.25 s) the camera has left the previous pose: ${show(mid!.raw)}`).toBeGreaterThan(1e-3);
    expect(dist(mid!.position, eye), `mid-glide (2.25 s) the camera hasn't reached its own pose: ${show(mid!.raw)}`).toBeGreaterThan(1e-3);
  }, TIMEOUT);

  it(`${AC[7]} a channel on a pose path of a camera in a shot that isn't keyed is refused naming both`, () => {
    const bin = motion.bin();
    const pose = { target: [0, 0, 0], orbit: { azimuth: 45, elevation: 30, distance: 10 } };
    const doc = (id: string, path: string, shotFields: JsonObject): JsonObject => film(id, [camera3d()], {
      shots: { 'held-shot': shot(0, 4, shotFields) },
      channels: { 'nudge-x': channel(path, [[0, 0], [2, 2]]) },
    }, TRANSPORT);
    for (const path of ['items/cam/params/target/0', 'items/cam/params/orbit/azimuth']) {
      const r = refused(evalOne(bin, { doc: doc('pose-channel', path, pose), times: [0, fl(1)] }), `a channel on ${path} in an unkeyed shot`);
      expect(mentions(r, 'nudge-x'), `the refusal names the channel nudge-x: ${show(r)}`).toBe(true);
      expect(mentions(r, 'held-shot'), `the refusal names the shot held-shot: ${show(r)}`).toBe(true);
    }
    // Keyed, the camera's own channel writes its pose: accepted, the target's x on the channel (1 at 1 s).
    const a = evalOk(bin, { doc: doc('pose-channel-keyed', 'items/cam/params/target/0', { keyed: true }), times: [fl(1)] }, 'the same channel in a keyed shot');
    const p = poseOf(a.frames[0]!, 'cam', 'the keyed shot');
    expect(Math.abs(p.target[0] - 1), `in a keyed shot the channel writes the camera's target x, 1 at 1 s: ${show(p.raw)}`).toBeLessThanOrEqual(1e-9);
  }, TIMEOUT);
});
