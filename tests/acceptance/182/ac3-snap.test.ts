// Criterion 3: walking down a 20° ramp at 3 m/s it reads grounded at every step with snap 0.2 m, and airborne on at
// least one step with snap 0.
//
// The body (criterion 1's) stands on a flat top 1 m before the crest of a 20° ramp falling 10 m, and walks along +x
// at 3 m/s for 2 s: over the crest and 5 m down the ramp. "Every step" is each state after a step, 1 to 240.
import { describe, test } from 'vitest';
import {
  AC, HERO, TIMEOUT, bake, characterStates, characterWorld, heroBody, none, physics, prebuild, rampDown, run, slab, standing,
  statesOf, walk, type JsonObject,
} from './helpers.ts';

prebuild(['shipped']);
const TOP = 10;
const STEPS = 240;

function descentWorld(snap: number): JsonObject {
  const foot = run(TOP, 20);
  return characterWorld({
    statics: { top: slab(-4, 0, -1, TOP), ramp: rampDown(0, 0, foot, TOP), floor: slab(foot, foot + 10, -1, 0) },
    movers: { [HERO]: heroBody([-1, standing(TOP), 0], { slope: 45, step: 0.35, snap }) },
  });
}

describe(`${AC[3]} snap to ground keeps the body grounded down a 20° ramp`, () => {
  test(`${AC[3]} down a 20° ramp at 3 m/s: grounded after every step with snap 0.2 m, airborne after at least one with snap 0`, () => {
    const track = [walk(0, [3, 0, 0])];
    const [snapped, loose] = physics([descentWorld(0.2), descentWorld(0)].map((w) => bake(w, STEPS, { track, read: [HERO] })));
    const out: string[] = [];
    const a = statesOf(snapped!, HERO, 'snap 0.2 m');
    const ca = characterStates(a, 'snap 0.2 m');
    if (!(a[STEPS]!.pos[0] > 2)) out.push(`snap 0.2 m: after 2 s its axis is at x ${a[STEPS]!.pos[0]}, not 2 m down the ramp`);
    const airborne = ca.map((c, k) => (k >= 1 && !c.grounded ? k : -1)).filter((k) => k >= 0);
    if (airborne.length) out.push(`snap 0.2 m: airborne after steps ${airborne.slice(0, 10).join(', ')}${airborne.length > 10 ? ', …' : ''}`);
    const cb = characterStates(statesOf(loose!, HERO, 'snap 0'), 'snap 0');
    if (!cb.some((c, k) => k >= 1 && !c.grounded)) out.push('snap 0: grounded after every step, never airborne');
    none(out, 'rapier3d');
  }, TIMEOUT);
});
