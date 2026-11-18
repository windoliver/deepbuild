// Criterion 10: the character body's grounded and sliding are interface rules: a capsule held 0.04 m above a floor
// reads grounded and one 0.07 m above doesn't; walking up a 30° ramp under a 45° limit reads sliding false and standing
// on a 50° slope reads it true; a test backend whose ground distance is 0.001 m fails the 0.04 m fixture.
//
// The rules are read twice: from bakes of this suite's own worlds (the capsule held by gravity_scale 0 with its lowest
// point 0.04 m and 0.07 m above the floor, criterion 1's 30° ramp walked at 2 m/s, the capsule set on a 50° slope 0.01 m
// off it), and as the behavior kit's fixtures `character/grounded_0.04`, `character/grounded_0.07`,
// `character/sliding_30` and `character/sliding_50` (README: Fixture names). The test backend is
// `--backend ground_distance_1mm`.
import { describe, expect, test } from 'vitest';
import {
  AC, HALF_HEIGHT, HERO, KIT, OFFSET, RADIUS, RULE_FIXTURES, TIMEOUT, bake, caught, characterStates, characterWorld, heroBody,
  heroInputs, kitReport, named, none, physics, prebuild, ramp, resultOf, run, show, slab, standing, statesOf, walk,
  type JsonObject, type Runner, type Vec3,
} from './helpers.ts';

prebuild(['test']);

const hover = (h: number): JsonObject => characterWorld({
  statics: { floor: slab(-5, 5, -1, 0) },
  movers: { [HERO]: heroBody([0, h + HALF_HEIGHT + RADIUS, 0], { gravityScale: 0 }) },
});
const rampUp = (): JsonObject => characterWorld({
  statics: { floor: slab(-5, 1, -1, 0), ramp: ramp(1, 0, 1 + run(2, 30), 2), top: slab(1 + run(2, 30), 7 + run(2, 30), -1, 2) },
  movers: { [HERO]: heroBody([0, standing(0), 0], { slope: 45, step: 0.35 }) },
  inputs: heroInputs({ logic: 'walker' }),
});
/** A 50° slope rising from the origin along +x; the capsule's lower sphere 0.01 m off it at x = 4. */
function steep(): JsonObject {
  const a = (50 * Math.PI) / 180;
  const top = 6 * Math.tan(a);
  const n: Vec3 = [-Math.sin(a), Math.cos(a), 0];
  const p: Vec3 = [4, 4 * Math.tan(a), 0];
  const sphere = p.map((x, i) => x + n[i]! * (RADIUS + OFFSET));
  return characterWorld({
    statics: { floor: slab(-5, 10, -2, -1), slope: ramp(0, 0, 6, top) },
    movers: { [HERO]: heroBody([sphere[0]!, sphere[1]! + HALF_HEIGHT, 0], { slope: 45 }) },
  });
}

/** Everything wrong with the four rules on this suite's worlds. */
function ruleFailures(r: Runner): string[] {
  const [low, high, up, slide] = physics([
    bake(hover(0.04), 60, { read: [HERO] }), bake(hover(0.07), 60, { read: [HERO] }),
    bake(rampUp(), 600, { track: [walk(0, [2, 0, 0])], read: [HERO] }), bake(steep(), 60, { read: [HERO] }),
  ], r);
  const out: string[] = [];
  const steps = (reply: JsonObject, what: string): ReturnType<typeof characterStates> => characterStates(statesOf(reply, HERO, what), what);
  const off = steps(low!, '0.04 m').map((c, k) => (k >= 1 && !c.grounded ? k : -1)).filter((k) => k >= 0);
  if (off.length) out.push(`held 0.04 m above the floor: airborne after steps ${off.slice(0, 8).join(', ')}`);
  const on = steps(high!, '0.07 m').map((c, k) => (k >= 1 && c.grounded ? k : -1)).filter((k) => k >= 0);
  if (on.length) out.push(`held 0.07 m above the floor: grounded after steps ${on.slice(0, 8).join(', ')}`);
  const sliding = steps(up!, 'up the 30° ramp').map((c, k) => (k >= 1 && c.sliding ? k : -1)).filter((k) => k >= 0);
  if (sliding.length) out.push(`walking up the 30° ramp under 45°: sliding after steps ${sliding.slice(0, 8).join(', ')}`);
  const still = steps(slide!, 'on the 50° slope').map((c, k) => (k >= 10 && !c.sliding ? k : -1)).filter((k) => k >= 0);
  if (still.length) out.push(`standing on the 50° slope: not sliding after steps ${still.slice(0, 8).join(', ')}`);
  return out;
}

describe(`${AC[10]} grounded and sliding are the interface's rules`, () => {
  test(`${AC[10]} held 0.04 m above a floor reads grounded and 0.07 m doesn't; up a 30° ramp under 45° sliding is false and on a 50° slope true; the kit's four rule fixtures pass on Rapier`, () => {
    none(ruleFailures({ build: 'test' }), 'rapier3d');
    const k = kitReport(physics([KIT], { build: 'test' })[0]!, 'the kit on Rapier (test build)');
    for (const f of RULE_FIXTURES) expect(resultOf(k, f, 'Rapier').result, `${f} passes on Rapier: ${show(resultOf(k, f, 'Rapier').raw)}`).toBe('pass');
  }, TIMEOUT);

  test(`${AC[10]} a test backend whose ground distance is 0.001 m (--backend ground_distance_1mm) fails the 0.04 m fixture`, () => {
    const failures = ruleFailures({ backend: 'ground_distance_1mm' });
    caught(failures, 'the 0.001 m ground distance');
    named(failures, ['0.04 m'], 'its failure');
    const r = resultOf(kitReport(physics([KIT], { backend: 'ground_distance_1mm' })[0]!, 'the kit on ground_distance_1mm'), 'character/grounded_0.04', 'ground_distance_1mm');
    expect(r.result, `character/grounded_0.04 fails on ground_distance_1mm: ${show(r.raw)}`).toBe('fail');
    expect(r.what, 'the fail names the backend and the fixture').toContain('ground_distance_1mm');
    expect(r.what, 'the fail names the fixture').toContain('character/grounded_0.04');
  }, TIMEOUT);
});
