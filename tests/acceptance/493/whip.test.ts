// AC14 #493.e7031693: A 0.8 s whip with sweep 26° and angle 0 between two hold shots, at 60 fps with a 180° shutter,
// turns the outgoing yaw to 6.5° at 0.2 s and 26° at 0.4 s and the incoming from −26° to −6.5° at 0.6 s and 0° at 0.8 s
// within 1e-9°, at 130° per second at the swap; the frame at 0.4 s averages sub-samples from both sides and equals
// neither side's blurred frame alone; a planted whip that eases each half in and out turns at 0° per second at the swap,
// draws that frame without blur and fails, naming the transition.
//
// Through `deep-motion eval`. Shots `a` [0, 2 s) and `b` [2 s, 4 s) hold, each with its own pose; transition `whip`
// `{kind: "whip", whip: {angle: 0, sweep: 26}, span: "0.8s"}`, centred on the cut, so its window is [1.6 s, 2.4 s) and
// the swap is at 2 s. Yaw is the aim's heading against the side's own hold aim, positive turning right (angle 0). The
// eval line's look carries `motion_blur: {shutter_angle: 180, samples: 8}` (README: Choices), and a frame inside a
// declared move reports the sub-samples it averages as `cameras.cam.blur: [{t, shot, pose}]`. The plant is
// `whip_eases_halves`.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, aimPitch, aimYaw, arr, box3d, camera3d, evalOk, evalPlanted, failsNaming, film, fl, frames60, isObject, maxDiff, none, num,
  obj, poseFrom, poseOf, shot, str, useMotion, wrap, type Accepted, type JsonObject, type Pose,
} from './helpers.ts';

const motion = useMotion();
const DOC = film('whip', [camera3d(), box3d('left', [0, 0, 0], 1), box3d('right', [10, 0, 0], 1, 'ink')], {
  shots: {
    a: shot(0, 2, { target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0, distance: 6 } }),
    b: shot(2, 4, { target: [10, 0, 0], orbit: { azimuth: 40, elevation: 0, distance: 8 } }),
  },
  transitions: { whip: { from: 'a', to: 'b', kind: 'whip', whip: { angle: 0, sweep: 26 }, span: '0.8s' } },
});
const LOOK: JsonObject = { motion_blur: { shutter_angle: 180, samples: 8 } };
const D = FLICKS / 1000;
const TIMES = [fl(1), fl(3), ...frames60(1.6, 2.45), fl(2) - 1, fl(2) - D, fl(2) - 2 * D].sort((x, y) => x - y);

/** The closed form: in_quad over the first half to +26°, out_quad over the second from −26°. */
function expected(t: number): number {
  const s = (t - fl(1.6)) / fl(0.4);
  if (t < fl(1.6) || t >= fl(2.4)) return 0;
  if (t < fl(2)) return 26 * s * s;
  const u = s - 1; return -26 + 26 * (1 - (1 - u) * (1 - u));
}

function whipFailures(a: Accepted): string[] {
  const at = (t: number): Pose => poseOf(a.frames[TIMES.indexOf(t)]!, 'cam', 'the whip');
  const holdA = at(fl(1)); const holdB = at(fl(3));
  const failures: string[] = [];
  for (const t of TIMES) {
    if (t === fl(1) || t === fl(3)) continue;
    const p = at(t); const own = t < fl(2) ? holdA : holdB;
    const yaw = wrap(aimYaw(p) - aimYaw(own));
    if (!(Math.abs(yaw - expected(t)) <= 1e-9)) failures.push(`transition whip: at ${t / FLICKS} s the yaw is ${yaw}°, not ${expected(t)}°`);
    if (!(Math.abs(aimPitch(p) - aimPitch(own)) <= 1e-9) || maxDiff(p.position, own.position) > 1e-9) failures.push(`transition whip: at ${t / FLICKS} s the camera moves or pitches, not only turns`);
  }
  const rate = (wrap(aimYaw(at(fl(2) - D)) - aimYaw(holdA)) - wrap(aimYaw(at(fl(2) - 2 * D)) - aimYaw(holdA))) / 0.001;
  if (!(Math.abs(rate - 130) <= 1)) failures.push(`transition whip: the turn at the swap runs at ${rate}°/s, not 130°/s`);
  const swap = a.frames[TIMES.indexOf(fl(2))]!;
  const blur = obj(swap.cameras['cam'], 'cameras.cam at 2 s')['blur'];
  const samples = Array.isArray(blur) ? blur.filter(isObject) : [];
  const sides = samples.map((s) => ({ shot: typeof s['shot'] === 'string' ? s['shot'] : '', t: typeof s['t'] === 'number' ? s['t'] : NaN, pose: s['pose'] }));
  const fromA = sides.filter((s) => s.shot === 'a'); const fromB = sides.filter((s) => s.shot === 'b');
  if (!(fromA.length > 0 && fromB.length > 0)) failures.push(`transition whip: the frame at the swap averages ${sides.length} sub-samples, ${fromA.length} from a and ${fromB.length} from b, not both sides`);
  for (const s of sides) if (!(Math.abs(s.t - fl(2)) <= FLICKS / 240 + 1)) failures.push(`transition whip: a sub-sample at ${s.t} lies outside the 180° shutter about 2 s`);
  if (fromA.length && fromB.length) {
    const ya = fromA.map((s) => wrap(aimYaw(poseFrom(s.pose, 'a sub-sample')) - aimYaw(holdA)));
    const yb = fromB.map((s) => wrap(aimYaw(poseFrom(s.pose, 'a sub-sample')) - aimYaw(holdB)));
    if (!(Math.min(...ya) > 24 && Math.max(...yb) < -24)) failures.push(`transition whip: the sub-samples' yaws ${JSON.stringify(ya)} and ${JSON.stringify(yb)} aren't the two sides of the swap`);
  }
  return failures;
}

describe(`${AC[14]} a whip turns away, swaps at its fastest, and blurs across the swap`, () => {
  it(`${AC[14]} the 0.8 s whip turns the outgoing yaw to 6.5° and 26° and the incoming from −26° to −6.5° and 0° within 1e-9°, at 130°/s at the swap, and the frame at the swap averages sub-samples from both sides`, () => {
    const a = evalOk(motion.bin(), { doc: DOC, times: TIMES, look: LOOK }, 'the whip');
    for (const [s, want] of [[1.8, 6.5], [2.2, -6.5], [2.4, 0]] as [number, number][]) expect(expected(fl(s)), `the closed form reads ${want}° at ${s} s`).toBeCloseTo(want, 12);
    expect(TIMES.includes(fl(2)), 'the swap is a 60 fps frame').toBe(true);
    none(whipFailures(a), 'the whip');
    const swap = arr(obj(a.frames[TIMES.indexOf(fl(2))]!.cameras['cam'], 'cam')['blur'], 'cameras.cam.blur at 2 s');
    expect(swap.map((s) => str(obj(s, 'a sub-sample')['shot'], 'its shot')).length, 'the shutter takes 8 sub-samples').toBe(8);
    expect(num(obj(swap[0], 'a sub-sample')['t'], 't'), 'sub-sample times are flicks').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[14]} a planted whip that eases each half in and out turns at 0°/s at the swap, draws that frame without blur and fails, naming the transition`, () => {
    failsNaming(whipFailures(evalPlanted(motion.bin(), { doc: DOC, times: TIMES, look: LOOK, planted: 'whip_eases_halves' }, 'the planted whip')), ['transition whip'], 'the whip check on the plant');
  }, TIMEOUT);
});
