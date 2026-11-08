// AC19 #493.55c15e8b: A camera with kick {at: [1.000 s], by: 2 px, s: 180 ms, hz: 30} in a 320 × 180 indexed look
// offsets the view by whole target pixels, at most 2 in x and in y, nonzero at some sampled time in [1.000, 1.180) s and
// zero outside it, the same at 24, 60 and 144 fps and by seeking; a second kick 60 ms later keeps their sum within 2 px;
// under reduced motion the offset is 0; and a planted kick that draws a fresh random offset each frame gives two offsets
// at one t across 24 and 60 fps and fails, naming the camera.
//
// Through `deep-motion eval`, with the eval line's `look` an indexed look@1 of 320 × 180 target pixels (README:
// Choices). A 2D page of 1280 × 720 u under a hold shot on camera `cam`: a target pixel is 4 u. The offset is the kicked
// camera's target less the same document's without the kick, in target pixels. Samples: every millisecond of
// [0.9 s, 1.3 s) and every 60 fps frame of [0 s, 3 s). Reduced motion is the eval line's `view.reduced_motion`. The
// plant is `kick_fresh_per_frame`.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, accepted, atRate, camera2d, commonFrames, evalAll, evalOk, evalPlanted, failsNaming, film, fl, frames60, none, poseOf,
  rect, shot, useMotion, type Accepted, type JsonObject,
} from './helpers.ts';

const motion = useMotion();
const SIZE: [number, number] = [1280, 720];
const INDEXED: JsonObject = { id: 'pixel', format: 1, basis: { indexed: { size: [320, 180] } } };
const PX = 1280 / 320;
const KICK = { by: 2, s: '0.18s', hz: 30 };
const doc = (kicks: string[] | null): JsonObject => film('kick', [
  camera2d(SIZE, kicks ? { kick: [{ at: kicks, ...KICK }] } : {}), rect('back', [0, 0, 1280, 720], 'ground'), rect('block', [500, 300, 280, 120], 'accent'),
], { shots: { hold: shot(0, 3, { target: [640, 360, 0], view_width: 1280 }) } }, { span: '3s' }, SIZE);
const MS = Array.from({ length: 400 }, (_, i) => fl(0.9) + (i * FLICKS) / 1000);
const SAMPLES = [...new Set([...MS, ...frames60(0, 3)])].sort((a, b) => a - b);
const GRID = commonFrames(0, 3);
/** Four kicks apart, for the checks across frame rates: twelve shared frames inside a kick, three at each kick's start. */
const MANY = ['1s', '1.5s', '2s', '2.5s'];

/** The offset at each frame, in target pixels: the kicked camera's target less the unkicked one's. */
function offsets(kicked: Accepted, still: Accepted): [number, number][] {
  return kicked.frames.map((f, i) => {
    const a = poseOf(f, 'cam', 'kicked').target; const b = poseOf(still.frames[i]!, 'cam', 'still').target;
    return [(a[0] - b[0]) / PX, (a[1] - b[1]) / PX];
  });
}
function run(kicks: string[] | null, times: number[], view?: JsonObject): Accepted {
  return evalOk(motion.bin(), { doc: doc(kicks), times, look: INDEXED, ...(view ? { view } : {}) }, `kicks ${JSON.stringify(kicks)}`);
}
/** The check across frame rates: one offset at each t; failures name the camera. */
function rateFailures(byRate: Accepted[], rates: number[]): string[] {
  return GRID.flatMap((t, i) => byRate.slice(1).flatMap((a, r) => (JSON.stringify(poseOf(a.frames[i]!, 'cam', 'kick').target) === JSON.stringify(poseOf(byRate[0]!.frames[i]!, 'cam', 'kick').target)
    ? [] : [`camera cam: at ${t / FLICKS} s the kick at ${rates[r + 1]} fps offsets the view differently than at ${rates[0]} fps`])));
}

describe(`${AC[19]} a camera kick: whole target pixels, bounded, seeded by time, dropped under reduced motion`, () => {
  it(`${AC[19]} a kick at 1 s offsets the view by whole target pixels, at most 2 in x and y, nonzero in [1.000, 1.180) s and zero outside it`, () => {
    const o = offsets(run(['1s'], SAMPLES), run(null, SAMPLES));
    const failures: string[] = []; let moved = false;
    o.forEach(([x, y], i) => {
      const t = SAMPLES[i]!; const inside = t >= fl(1) && t < fl(1.18);
      if (!(Number.isInteger(x) && Number.isInteger(y))) failures.push(`at ${t / FLICKS} s the offset (${x}, ${y}) isn't whole target pixels`);
      if (!(Math.abs(x) <= 2 && Math.abs(y) <= 2)) failures.push(`at ${t / FLICKS} s the offset (${x}, ${y}) passes 2 px`);
      if (!inside && (x !== 0 || y !== 0)) failures.push(`at ${t / FLICKS} s, outside the kick, the view is offset by (${x}, ${y})`);
      if (inside && (x !== 0 || y !== 0)) moved = true;
    });
    if (!moved) failures.push('the kick never offsets the view in [1.000, 1.180) s');
    none(failures, 'the kick');
  }, TIMEOUT);

  it(`${AC[19]} the kick gives the same offset at 24, 60 and 144 fps and by seeking`, () => {
    const rates = [24, 60, 144];
    const byRate = rates.map((fps) => evalOk(motion.bin(), { doc: atRate(doc(MANY), fps), times: GRID, look: INDEXED }, `the kicks at ${fps} fps`));
    const failures = rateFailures(byRate, rates);
    const play = run(MANY, GRID);
    evalAll(motion.bin(), GRID.map((t) => ({ doc: doc(MANY), times: [t], look: INDEXED }))).forEach((x, i) => {
      if (JSON.stringify(poseOf(accepted(x, [GRID[i]!], 'seek').frames[0]!, 'cam', 'seek').target) !== JSON.stringify(poseOf(play.frames[i]!, 'cam', 'play').target)) failures.push(`seeking to ${GRID[i]! / FLICKS} s offsets the view differently than playing`);
    });
    none(failures, 'the kick across rates and seeks');
  }, TIMEOUT);

  it(`${AC[19]} a second kick 60 ms later keeps their sum within 2 px`, () => {
    const times = MS.filter((t) => t >= fl(1) && t < fl(1.24));
    const o = offsets(run(['1s', '1.06s'], times), run(null, times));
    none(o.flatMap(([x, y], i) => (Math.abs(x) <= 2 && Math.abs(y) <= 2 ? [] : [`at ${times[i]! / FLICKS} s the two kicks offset the view by (${x}, ${y})`])), 'two overlapping kicks');
    expect(o.some(([x, y]) => x !== 0 || y !== 0), 'the two kicks offset the view').toBe(true);
  }, TIMEOUT);

  it(`${AC[19]} under reduced motion the kick's offset is 0`, () => {
    const rm = { reduced_motion: true };
    const o = offsets(run(['1s'], SAMPLES, rm), run(null, SAMPLES, rm));
    none(o.flatMap(([x, y], i) => (x === 0 && y === 0 ? [] : [`at ${SAMPLES[i]! / FLICKS} s under reduced motion the view is offset by (${x}, ${y})`])), 'the kick under reduced motion');
  }, TIMEOUT);

  it(`${AC[19]} a planted kick that draws a fresh random offset each frame gives two offsets at one t across 24 and 60 fps and fails, naming the camera`, () => {
    const rates = [24, 60];
    const byRate = rates.map((fps) => evalPlanted(motion.bin(), { doc: atRate(doc(MANY), fps), times: GRID, look: INDEXED, planted: 'kick_fresh_per_frame' }, `the plant at ${fps} fps`));
    failsNaming(rateFailures(byRate, rates), ['camera cam'], 'the rate check on the plant');
  }, TIMEOUT);
});
