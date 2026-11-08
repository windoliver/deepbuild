// AC16 #493.54b680f8: A 2 s push with roll 21° draws the horizon at 21° within 0.01° at every 60 fps frame while the
// distance eases from 4.6 m to 4.0 m, and a 0.8 s glide from it into a level shot turns the roll the shortest way to 0°;
// a planted shot that writes roll 0 draws the push level and fails, naming the shot.
//
// Through `deep-motion eval` with `project`. Shot `dutch` [0, 2 s) pushes onto a level pose 4 m from its target with
// `roll: 21`; shot `level` [2 s, 4 s) holds the same pose with roll 0 and `join: {glide: {span: "0.8s"}}`. The horizon is
// the line through two markers far out at eye height, 1,000 m down the aim and 300 m to each side; its angle on screen
// is read from their projected centers. The glide's roll is the pose's `roll`. The plant is `shot_writes_roll_0`.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, box3d, camera3d, evalOk, evalPlanted, failsNaming, film, fl, frames60, none, norm, poseOf, projOf, rel, shot, sub, useMotion, wrap,
  type Accepted,
} from './helpers.ts';

const motion = useMotion();
const POSE = { target: [0, 1.5, 0], orbit: { azimuth: 0, elevation: 0, distance: 4 } };
const DOC = film('dutch', [camera3d(), box3d('crate', [0, 1.5, 0], 0.8), box3d('h-left', [-300, 1.5, -1000], 4, 'ink'), box3d('h-right', [300, 1.5, -1000], 4, 'ink')], {
  shots: { dutch: shot(0, 2, { move: 'push', ...POSE, roll: 21 }), level: shot(2, 4, { ...POSE, roll: 0, join: { glide: { span: '0.8s' } } }) },
});
const PUSH = frames60(0, 2);
const GLIDE = frames60(2, 3);

/** The horizon's angle on screen at each push frame, and the check; failures name the shot. */
function horizonFailures(a: Accepted): string[] {
  const failures: string[] = []; let sign = 0;
  PUSH.forEach((t, i) => {
    const l = projOf(a.frames[i]!, 'h-left', 'the push').center; const r = projOf(a.frames[i]!, 'h-right', 'the push').center;
    const angle = (Math.atan2(r[1] - l[1], r[0] - l[0]) * 180) / Math.PI;
    if (!(Math.abs(Math.abs(angle) - 21) <= 0.01)) failures.push(`shot dutch: at ${t / FLICKS} s the horizon draws at ${angle}°, not 21°`);
    if (sign === 0) sign = Math.sign(angle); else if (Math.sign(angle) !== sign) failures.push(`shot dutch: at ${t / FLICKS} s the horizon tilts the other way`);
  });
  return failures;
}

describe(`${AC[16]} a shot's roll holds under its move, and a glide turns it the shortest way`, () => {
  it(`${AC[16]} the push with roll 21° draws the horizon at 21° within 0.01° at every 60 fps frame while its distance eases from 4.6 m to 4.0 m`, () => {
    const a = evalOk(motion.bin(), { doc: DOC, times: [...PUSH, fl(2)], project: ['h-left', 'h-right'] }, 'the Dutch push');
    const d = a.frames.map((f) => { const p = poseOf(f, 'cam', 'the push'); return norm(sub(p.position, p.target)); });
    const failures = horizonFailures(a);
    if (!(rel(d[0]!, 4.6) <= 1e-9)) failures.push(`the push starts ${d[0]} m from its target, not 4.6 m`);
    if (!(rel(d[d.length - 1]!, 4) <= 1e-9)) failures.push(`the push ends ${d[d.length - 1]} m from its target, not 4.0 m`);
    for (let i = 1; i < d.length; i++) if (d[i]! > d[i - 1]! + 1e-12) failures.push(`the push backs off at frame ${i}`);
    none(failures, 'the Dutch push');
  }, TIMEOUT);

  it(`${AC[16]} a 0.8 s glide from the push into a level shot turns the roll the shortest way from 21° to 0°`, () => {
    const a = evalOk(motion.bin(), { doc: DOC, times: GLIDE }, 'the glide');
    const rolls = a.frames.map((f) => wrap(poseOf(f, 'cam', 'the glide').roll));
    const failures: string[] = [];
    if (!(Math.abs(rolls[0]! - 21) <= 1e-6)) failures.push(`the glide starts at roll ${rolls[0]}°, not 21°`);
    rolls.forEach((r, i) => {
      if (!(r >= -0.01 && r <= 21.01)) failures.push(`at ${GLIDE[i]! / FLICKS} s the roll is ${r}°, off the short way between 21° and 0°`);
      if (i > 0 && r > rolls[i - 1]! + 1e-12) failures.push(`at ${GLIDE[i]! / FLICKS} s the roll turns back to ${r}°`);
      if (GLIDE[i]! >= fl(2.8) && !(Math.abs(r) <= 1e-9)) failures.push(`at ${GLIDE[i]! / FLICKS} s, after the glide, the roll is ${r}°, not 0°`);
    });
    expect(rolls.some((r) => r > 1 && r < 20), 'the roll turns through the glide').toBe(true);
    none(failures, 'the glide\'s roll');
  }, TIMEOUT);

  it(`${AC[16]} a planted shot that writes roll 0 draws the push level and fails, naming the shot`, () => {
    failsNaming(horizonFailures(evalPlanted(motion.bin(), { doc: DOC, times: [...PUSH, fl(2)], project: ['h-left', 'h-right'], planted: 'shot_writes_roll_0' }, 'the planted shot')), ['shot dutch'], 'the horizon check on the plant');
  }, TIMEOUT);
});
