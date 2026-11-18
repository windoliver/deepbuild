// Criterion 16: the body (1.8 m tall) with `crouch: {height: 1.0}`, walking +x at 2 m/s toward a slab whose underside
// is 1.2 m above the floor: standing, it stops within its offset plus 1 mm of the slab's face; crouched, it passes
// beneath; with crouch let go under the slab it reads `crouched` true until the tall capsule fits past the slab's far
// edge and stands at that first step; a planted controller that stands on release overlaps the slab by 0.6 m and fails,
// naming the step; and a crouch height of 0.5 m is refused, naming the field.
//
// The slab spans x 2 to 4 (its face at 2, its far edge at 4); the body's axis starts at x 0. The body's frame stays the
// tall capsule's whether crouched or not, so its lowest point is its frame less 0.9 m and the tall capsule's top that
// plus 1.8 m (README). The tall capsule fits where its axis is at least its radius past the far edge. The release is
// stamped 150 (axis near x 2.5, under the slab). "Stands at that first step" is read as no later than two steps after the
// first state whose pose lets the tall capsule fit (README: Readings). The wrong program is
// `--planted crouch_stands_on_release`.
import { describe, expect, test } from 'vitest';
import {
  AC, HERO, OFFSET, RADIUS, TIMEOUT, arr, bake, caught, check, characterStates, characterWorld, entry, heroBody, isObject,
  lowest, named, none, physics, prebuild, show, slab, standing, statesOf, walk, type JsonObject, type Runner, type State,
} from './helpers.ts';

prebuild(['shipped']);
const FACE = 2;
const FAR = 4;
const UNDER = 1.2;
const TALL = 1.8;
const CROUCH = 1.0;
const RELEASE = 150;

const crouchWorld = (height = CROUCH): JsonObject => characterWorld({
  statics: { floor: slab(-5, 10, -1, 0), slab: slab(FACE, FAR, UNDER, 3) },
  movers: { [HERO]: heroBody([0, standing(0), 0], { crouch: height }) },
});
const crouchOn = (step: number, on: boolean): JsonObject => entry(step, 'crouch', { on });
/** How far a capsule `height` tall at state `s` reaches into the slab: up past its underside, where its axis is under it. */
function overlap(s: State, height: number): number {
  const across = s.pos[0] + RADIUS > FACE && s.pos[0] - RADIUS < FAR;
  return across ? lowest(s) + height - UNDER : -Infinity;
}
function crouchedOf(states: State[], what: string): boolean[] {
  return characterStates(states, what).map((c, k) => {
    expect(typeof c.crouched, `${what}: state ${k}'s crouched is a bool`).toBe('boolean');
    return c.crouched as boolean;
  });
}
/** The release judge: never standing where the tall capsule overlaps the slab, and standing by two steps after it first fits. */
function releaseFailures(r: Runner): string[] {
  const [reply] = physics([bake(crouchWorld(), 360, { track: [walk(0, [2, 0, 0]), crouchOn(0, true), crouchOn(RELEASE, false)], read: [HERO] })], r);
  const states = statesOf(reply!, HERO, 'the release under the slab');
  const crouched = crouchedOf(states, 'the release under the slab');
  const out: string[] = [];
  if (!(states[RELEASE]!.pos[0] > FACE - RADIUS && states[RELEASE]!.pos[0] < FAR + RADIUS)) out.push(`at the release (step ${RELEASE}) the body isn't under the slab: x ${states[RELEASE]!.pos[0]}`);
  const stood = crouched.findIndex((c, k) => k > RELEASE && !c);
  for (let k = RELEASE + 1; k < states.length; k++) {
    const o = overlap(states[k]!, TALL);
    if (!crouched[k] && o > 0.001) { out.push(`it stands at step ${k}, where the tall capsule overlaps the slab by ${o.toFixed(3)} m`); break; }
  }
  const fits = states.findIndex((s, k) => k > RELEASE && s.pos[0] - RADIUS >= FAR);
  if (fits < 0) out.push('the tall capsule never fits past the slab\'s far edge');
  else if (stood < 0 || stood > fits + 2) out.push(`the tall capsule first fits at step ${fits}, but it stands at step ${stood < 0 ? 'none' : stood}`);
  return out;
}

describe(`${AC[16]} a crouch capsule passes under a low slab and stands only where the tall one fits`, () => {
  test(`${AC[16]} standing it stops at the slab's face; crouched it passes beneath; let go under the slab it stands at the first step the tall capsule fits; a crouch height of 0.5 m is refused`, () => {
    const [standingRun, crouchedRun, refused] = physics([
      bake(crouchWorld(), 240, { track: [walk(0, [2, 0, 0])], read: [HERO] }),
      bake(crouchWorld(), 300, { track: [walk(0, [2, 0, 0]), crouchOn(0, true)], read: [HERO] }),
      check(crouchWorld(0.5)),
    ]);
    const out: string[] = [];
    const s = statesOf(standingRun!, HERO, 'standing');
    const gap = FACE - (s[240]!.pos[0] + RADIUS);
    if (Math.abs(gap) > OFFSET + 0.001) out.push(`standing, its front ends ${gap.toFixed(5)} m from the slab's face, not within its offset plus 1 mm`);
    const c = statesOf(crouchedRun!, HERO, 'crouched');
    const cc = crouchedOf(c, 'crouched');
    const under = c.map((x, k) => (k >= 1 && (overlap(x, CROUCH) > 0.001 || (overlap(x, TALL) > 0 && !cc[k])) ? k : -1)).filter((k) => k >= 0);
    if (under.length) out.push(`crouched, it meets the slab or stands under it at steps ${under.slice(0, 8).join(', ')}`);
    if (!(c[300]!.pos[0] - RADIUS > FAR)) out.push(`crouched, its axis ends at x ${c[300]!.pos[0]}, not past the slab's far edge`);
    out.push(...releaseFailures({}));
    const issues = arr(refused!['issues'] ?? [], 'the 0.5 m crouch\'s issues').filter(isObject);
    if (!issues.some((i) => i['severity'] === 'error' && /^bodies\/hero\/character\/crouch(\/height)?$/.test(String(i['path'])))) out.push(`a crouch height of 0.5 m isn't refused naming the field: ${show(issues)}`);
    none(out, 'rapier3d');
  }, TIMEOUT);

  test(`${AC[16]} a controller that stands on release (--planted crouch_stands_on_release) overlaps the slab by 0.6 m and fails, naming the step`, () => {
    const failures = releaseFailures({ planted: 'crouch_stands_on_release' });
    caught(failures, 'the controller that stands on release');
    named(failures, [`it stands at step ${RELEASE + 1}`], 'its failure names the step');
    const by = Number(/overlaps the slab by (\d+\.\d+) m/.exec(failures.join(' '))?.[1]);
    expect(Math.abs(by - 0.6), `it overlaps the slab by 0.6 m (it reads ${by})`).toBeLessThanOrEqual(0.05);
  }, TIMEOUT);
});
