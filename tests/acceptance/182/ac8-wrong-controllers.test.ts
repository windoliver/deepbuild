// Criterion 8: a test backend whose character controller climbs a 0.4 m step with a step height of 0.35 m fails the
// step fixture, naming the body, the step and the height it reached; and one that ignores snap fails the snap fixture,
// naming the first step it read airborne.
//
// The fixtures are the behavior kit's `character/step` and `character/snap` (README: Fixture names), which pass on
// Rapier (the test build); the test backends are `--backend steps_too_high` and `--backend ignores_snap`. Each failure's
// fields are checked against a bake of the fixture's own world and track on the same test backend.
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, bake, charactersIn, characterStates, fixtureOf, fixturesOf, isObject, kitReport, KIT, num, obj, physics,
  prebuild, resultOf, show, statesOf, str, type FixtureData, type JsonObject, type TestBackend,
} from './helpers.ts';

prebuild(['test']);

/** The fixture's world baked on its track over its steps on `backend`, `body`'s states. */
function baked(f: FixtureData, body: string, backend: TestBackend): ReturnType<typeof statesOf> {
  const [reply] = physics([bake(f.world, f.steps, { track: f.track, read: [body] })], { backend });
  return statesOf(reply!, body, `${f.name} baked on ${backend}`);
}
const numbersIn = (text: string): number[] => [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
function staticIn(w: JsonObject, id: string): boolean {
  const b = obj(w['bodies'], 'bodies')[id];
  return isObject(b) && b['kind'] === 'static';
}

describe(`${AC[8]} the step and snap fixtures fail a controller that climbs too high or ignores snap`, () => {
  test(`${AC[8]} a controller climbing a 0.4 m step under a 0.35 m step height (--backend steps_too_high) fails character/step, naming the body, the step and the height it reached`, () => {
    const [fixtures, kit] = physics([{ call: 'behavior_fixtures' }, KIT], { build: 'test' });
    const f = fixtureOf(fixturesOf(fixtures!, 'behavior_fixtures'), 'character/step', 'the interface');
    expect(resultOf(kitReport(kit!, 'the kit on Rapier'), 'character/step', 'Rapier').result, 'character/step passes on Rapier').toBe('pass');
    const r = resultOf(kitReport(physics([KIT], { backend: 'steps_too_high' })[0]!, 'the kit on steps_too_high'), 'character/step', 'steps_too_high');
    expect(r.result, `character/step fails on steps_too_high: ${show(r.raw)}`).toBe('fail');
    const characters = charactersIn(f.world, 'character/step\'s world');
    const body = str(r.raw['body'], 'the failure\'s body');
    const obstacle = str(r.raw['obstacle'], 'the failure\'s obstacle (the step)');
    const height = num(r.raw['height'], 'the failure\'s height');
    expect(characters.has(body), `the failure names a character body of the fixture's world (${[...characters.keys()].join(', ')}): ${body}`).toBe(true);
    expect(staticIn(f.world, obstacle), `the failure names a static body of the fixture's world as the step: ${obstacle}`).toBe(true);
    expect(Math.abs(height - 0.4), `the height it reached, ${height} m, is the 0.4 m step's within 0.02 m`).toBeLessThanOrEqual(0.02);
    expect(r.what, `the failure's text names the body ${body}`).toContain(body);
    expect(r.what, `the failure's text names the step ${obstacle}`).toContain(obstacle);
    expect(numbersIn(r.what).some((n) => Math.abs(n - height) <= 0.01), `the failure's text names the height ${height}: ${r.what}`).toBe(true);
    const states = baked(f, body, 'steps_too_high');
    const rise = Math.max(...states.map((s) => s.pos[1])) - states[0]!.pos[1];
    expect(Math.abs(rise - height), `the height named, ${height} m, is what the body's lowest point rose in the fixture's own bake on steps_too_high (${rise} m), within 0.02 m`).toBeLessThanOrEqual(0.02);
  }, TIMEOUT);

  test(`${AC[8]} a controller that ignores snap (--backend ignores_snap) fails character/snap, naming the first step it read airborne`, () => {
    const [fixtures, kit] = physics([{ call: 'behavior_fixtures' }, KIT], { build: 'test' });
    const f = fixtureOf(fixturesOf(fixtures!, 'behavior_fixtures'), 'character/snap', 'the interface');
    expect(resultOf(kitReport(kit!, 'the kit on Rapier'), 'character/snap', 'Rapier').result, 'character/snap passes on Rapier').toBe('pass');
    const r = resultOf(kitReport(physics([KIT], { backend: 'ignores_snap' })[0]!, 'the kit on ignores_snap'), 'character/snap', 'ignores_snap');
    expect(r.result, `character/snap fails on ignores_snap: ${show(r.raw)}`).toBe('fail');
    const body = str(r.raw['body'], 'the failure\'s body');
    const step = num(r.raw['step'], 'the failure\'s step');
    expect(charactersIn(f.world, 'character/snap\'s world').has(body), `the failure names a character body of the fixture's world: ${body}`).toBe(true);
    const chars = characterStates(baked(f, body, 'ignores_snap'), `${body} on ignores_snap`);
    const first = chars.findIndex((c, k) => k >= 1 && !c.grounded);
    expect(first, `${body} reads airborne in the fixture's own bake on ignores_snap`).toBeGreaterThan(0);
    expect(step, `the failure names the first step ${body} read airborne`).toBe(first);
    expect(new RegExp(`\\b${first}\\b`).test(r.what), `the failure's text names step ${first}: ${r.what}`).toBe(true);
  }, TIMEOUT);
});
