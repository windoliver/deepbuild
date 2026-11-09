// AC15 #493.44160e6c: A 6 s push with shake {by: 1.6°, hz: 2, roll: 1.6°} draws, at 10,000 random times, the push's
// pose turned by the shake's offset and never more than 1.6° from it in aim or roll; gives one pose at each t at 24, 60
// and 144 fps and by seeking; gives the same offsets in two documents for one shot ID and different ones for two IDs; a
// planted shake that draws a new random offset each frame gives two poses at one t across 24 and 60 fps and fails,
// naming the shot.
//
// Through `deep-motion eval`. Shot `jolt` [0, 6 s) pushes onto an explicit level pose with `shake: {by: 1.6, hz: 2,
// roll: 1.6}`; the push's own pose is the same document without the shake. "Turned by" reads: the same position and
// target distance, the aim within 1.6° of the push's (the angle between the two aims; README: Choices) and the roll
// within 1.6°, with the shake moving both somewhere. "One pose at each t" is the same flick in documents at 24, 60 and
// 144 fps, bit for bit, at the times all three have a frame on, and each such time seeked alone. The plant is
// `shake_fresh_per_frame`.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, accepted, aimAngle, atRate, box3d, camera3d, clone, commonFrames, evalAll, evalOk, evalPlanted, failsNaming, film, maxDiff, none,
  norm, poseOf, rel, seededTimes, shot, sub, useMotion, wrap, type Accepted, type JsonObject,
} from './helpers.ts';

const motion = useMotion();
const POSE = { target: [0, 1, 0], orbit: { azimuth: 20, elevation: 0, distance: 5 } };
const SHAKE = { by: 1.6, hz: 2, roll: 1.6 };
const doc = (id: string, shotId: string, shake: boolean): JsonObject => film(id, [camera3d(), box3d('crate', [0, 1, 0], 1), box3d('post', [3, 0.5, -2], 0.4, 'ink')], {
  shots: { [shotId]: shot(0, 6, { move: 'push', ...POSE, ...(shake ? { shake: SHAKE } : {}) }) },
}, { span: '6s' });
const SHAKEN = doc('shake', 'jolt', true);
const GRID = commonFrames(0, 6);

/** The criterion's frame-rate check: one pose at each t at 24, 60 and 144 fps; failures name the shot. */
function rateFailures(byRate: Accepted[], rates: number[]): string[] {
  const failures: string[] = [];
  GRID.forEach((t, i) => {
    const base = JSON.stringify(byRate[0]!.frames[i]!.cameras['cam']);
    byRate.slice(1).forEach((a, r) => { const other = JSON.stringify(a.frames[i]!.cameras['cam']); if (other !== base) failures.push(`shot jolt: at ${t / FLICKS} s the pose at ${rates[r + 1]} fps is ${other.slice(0, 160)}, at ${rates[0]} fps ${base.slice(0, 160)}`); });
  });
  return failures;
}

describe(`${AC[15]} a shake turns the push's pose by seeded noise of the shot's ID, bounded by its amount`, () => {
  it(`${AC[15]} at 10,000 random times the shaken push is the push turned by the shake, never more than 1.6° from it in aim or roll`, () => {
    const times = seededTimes(493_015, 10_000, 0, 6 * FLICKS);
    const [shaken, plain] = evalAll(motion.bin(), [{ doc: SHAKEN, times }, { doc: doc('shake', 'jolt', false), times }]).map((x, i) => accepted(x, times, i ? 'the push' : 'the shaken push'));
    const failures: string[] = []; let maxAim = 0; let maxRoll = 0;
    times.forEach((t, i) => {
      const s = poseOf(shaken!.frames[i]!, 'cam', 'shaken'); const p = poseOf(plain!.frames[i]!, 'cam', 'push');
      const turn = aimAngle(s, p); const roll = Math.abs(wrap(s.roll - p.roll));
      maxAim = Math.max(maxAim, turn); maxRoll = Math.max(maxRoll, roll);
      if (maxDiff(s.position, p.position) > 1e-9 || !(rel(norm(sub(s.target, s.position)), norm(sub(p.target, p.position))) <= 1e-9)) failures.push(`at ${t} flicks the shake moves the camera rather than turning it`);
      if (!(turn <= 1.6 + 1e-9)) failures.push(`at ${t} flicks the aim is ${turn}° from the push's`);
      if (!(roll <= 1.6 + 1e-9)) failures.push(`at ${t} flicks the roll is ${roll}° from the push's`);
    });
    expect(maxAim, 'the shake turns the aim').toBeGreaterThan(0.2);
    expect(maxRoll, 'the shake turns the roll').toBeGreaterThan(0.2);
    none(failures, 'the shaken push');
  }, TIMEOUT);

  it(`${AC[15]} the shaken push gives one pose at each t at 24, 60 and 144 fps, and seeking to each equals playing`, () => {
    const rates = [24, 60, 144];
    const byRate = rates.map((fps) => evalOk(motion.bin(), { doc: atRate(SHAKEN, fps), times: GRID }, `the shaken push at ${fps} fps`));
    const failures = rateFailures(byRate, rates);
    const poses = byRate[0]!.frames.map((f) => poseOf(f, 'cam', 'the shaken push at 24 fps'));
    expect(poses.some((p) => aimAngle(p, poses[0]!) > 0.1), 'the shake turns the aim across the shared frames').toBe(true);
    const seeks = evalAll(motion.bin(), GRID.map((t) => ({ doc: SHAKEN, times: [t] })));
    const play = evalOk(motion.bin(), { doc: SHAKEN, times: GRID }, 'the play');
    GRID.forEach((t, i) => { const s = JSON.stringify(accepted(seeks[i]!, [t], `the seek to ${t}`).frames[0]!.cameras['cam']); if (s !== JSON.stringify(play.frames[i]!.cameras['cam'])) failures.push(`seeking to ${t / FLICKS} s reads another pose than playing`); });
    none(failures, 'one pose at each t');
  }, TIMEOUT);

  it(`${AC[15]} the same shot ID gives the same offsets in two documents, and another ID different ones`, () => {
    const times = seededTimes(493_115, 200, 0, 6 * FLICKS);
    const other = clone(SHAKEN); other['id'] = 'shake-elsewhere'; other['title'] = '#493 the same shake in another document';
    const [one, two, three] = evalAll(motion.bin(), [{ doc: SHAKEN, times }, { doc: other, times }, { doc: doc('shake', 'jolt-2', true), times }]).map((x, i) => accepted(x, times, `document ${i}`));
    none(times.flatMap((t, i) => (JSON.stringify(one!.frames[i]!.cameras['cam']) === JSON.stringify(two!.frames[i]!.cameras['cam']) ? [] : [`at ${t} flicks shot jolt shakes differently in another document`])), 'one shot ID in two documents');
    expect(times.some((_, i) => aimAngle(poseOf(one!.frames[i]!, 'cam', 'jolt'), poseOf(three!.frames[i]!, 'cam', 'jolt-2')) > 1e-6), 'shots jolt and jolt-2 shake differently').toBe(true);
  }, TIMEOUT);

  it(`${AC[15]} a planted shake that draws a new random offset each frame gives two poses at one t across 24 and 60 fps and fails, naming the shot`, () => {
    const rates = [24, 60];
    const byRate = rates.map((fps) => evalPlanted(motion.bin(), { doc: atRate(SHAKEN, fps), times: GRID, planted: 'shake_fresh_per_frame' }, `the plant at ${fps} fps`));
    failsNaming(rateFailures(byRate, rates), ['shot jolt'], 'the frame-rate check on the plant');
  }, TIMEOUT);
});
