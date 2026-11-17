// Criterion 1: the body (radius 0.3 m, half height 0.6 m, slope limit 45°, step height 0.35 m), sent along +x at
// 2 m/s for 5 s at 120 Hz by a logic item's move from 1 m before the foot of a 30° ramp that rises 2 m to a flat top
// 6 m long, ends grounded on the top with its lowest point 2.00 m above the floor within 0.02 m; at a 50° ramp its
// lowest point never rises more than 0.05 m above where it started; with slope limit 25° the 30° ramp stops it too, so
// a body that ignores its own limit fails.
//
// The move is the entry the logic item `walker` fires (the world's input `walk` takes `on: {logic: "walker"}`), on the
// bake's track as derived entries are kept (README: Readings). The wrong program is `--planted slope_limit_ignored`.
import { describe, test } from 'vitest';
import {
  AC, HERO, TIMEOUT, bake, caught, characterStates, characterWorld, heroBody, heroInputs, lowest, named, none, physics,
  prebuild, ramp, run, slab, standing, statesOf, walk, type JsonObject, type Runner,
} from './helpers.ts';

prebuild(['shipped']);
const FOOT = 1;
const STEPS = 600;

/** The ramp of `angle`° rising 2 m from x = 1 to a flat top 6 m long; the body's axis at x = 0, standing on the floor. */
function rampWorld(angle: number, slope: number): { w: JsonObject; crest: number } {
  const crest = FOOT + run(2, angle);
  const w = characterWorld({
    statics: { floor: slab(-5, FOOT, -1, 0), ramp: ramp(FOOT, 0, crest, 2), top: slab(crest, crest + 6, -1, 2) },
    movers: { [HERO]: heroBody([0, standing(0), 0], { slope, step: 0.35 }) },
    inputs: heroInputs({ logic: 'walker' }),
  });
  return { w, crest };
}

/** Everything wrong with the three runs against the criterion's numbers, each failure naming its ramp and limit. */
function slopeFailures(r: Runner): string[] {
  const climb = rampWorld(30, 45);
  const steep = rampWorld(50, 45);
  const low = rampWorld(30, 25);
  const track = [walk(0, [2, 0, 0])];
  const replies = physics([climb.w, steep.w, low.w].map((w) => bake(w, STEPS, { track, read: [HERO] })), r);
  const out: string[] = [];
  const s = statesOf(replies[0]!, HERO, 'the 30° ramp under 45°');
  const end = s[STEPS]!;
  const endC = characterStates([end], 'the 30° ramp under 45°')[0]!;
  if (!endC.grounded) out.push(`30° ramp under 45°: after 5 s the body isn't grounded`);
  if (!(end.pos[0] > climb.crest && end.pos[0] < climb.crest + 6)) out.push(`30° ramp under 45°: after 5 s its axis is at x ${end.pos[0]}, not over the top (x ${climb.crest.toFixed(4)} to ${(climb.crest + 6).toFixed(4)})`);
  if (Math.abs(lowest(end) - 2) > 0.02) out.push(`30° ramp under 45°: after 5 s its lowest point is ${lowest(end).toFixed(4)} m above the floor, not 2.00 within 0.02`);
  for (const [label, reply] of [['50° ramp under 45°', replies[1]!], ['30° ramp under 25°', replies[2]!]] as const) {
    const states = statesOf(reply, HERO, label);
    const start = lowest(states[0]!);
    const k = states.findIndex((x) => lowest(x) - start > 0.05);
    if (k >= 0) out.push(`${label}: its lowest point rises ${(lowest(states[k]!) - start).toFixed(4)} m above where it started at step ${k}, more than 0.05 m: the ramp didn't stop it`);
  }
  return out;
}

describe(`${AC[1]} a 45° limit climbs the 30° ramp and stops at a 50° one, and a 25° limit stops at 30°`, () => {
  test(`${AC[1]} under 45° the body ends grounded on the 30° ramp's top 2.00 m up within 0.02 m; the 50° ramp and, under 25°, the 30° ramp keep its lowest point within 0.05 m of its start`, () => {
    none(slopeFailures({}), 'rapier3d');
  }, TIMEOUT);

  test(`${AC[1]} a body that ignores its own limit (--planted slope_limit_ignored) climbs the 30° ramp under 25° and fails`, () => {
    const failures = slopeFailures({ planted: 'slope_limit_ignored' });
    caught(failures, 'the body that ignores its own slope limit');
    named(failures, ['30° ramp under 25°'], 'the planted body\'s failure');
  }, TIMEOUT);
});
