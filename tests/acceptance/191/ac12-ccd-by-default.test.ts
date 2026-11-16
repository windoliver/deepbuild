// Criterion 12: the 200 m/s sphere fixture authored with `ccd` unset expands with `ccd: true`, writes its first contact at
// step 6, and carries one assumption row naming the body and the reason. A ball rolling at 2 m/s keeps `ccd` off and
// carries no row. A planted recipe that leaves the flagged body's `ccd` off is refused at check, naming the body.
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, WALL_FAR, arr, bake, fastBallWorld, firstBetween, isObject, none, obj, one, physics, prebuild, rollingBallWorld,
  rowsOf, show, statesOf, type JsonObject,
} from './helpers.ts';

prebuild(['shipped']);

interface Expanded { world: JsonObject; assumptions: JsonObject[] }
function expanded(reply: JsonObject, what: string): Expanded {
  expect(reply['ok'], `${what}: the recipe expanded the world (call expand): ${show(reply)}`).toBe(true);
  return { world: obj(reply['world'], `${what}: world`), assumptions: arr(reply['assumptions'], `${what}: assumptions`).map((a, i) => obj(a, `${what}: assumptions[${i}]`)) };
}
const ccdOf = (w: JsonObject, id: string): unknown => obj(obj(w['bodies'], 'bodies')[id], `bodies.${id}`)['ccd'];

describe(`${AC[12]} a body physics.fast_body flags gets ccd on by default, shown as an assumption`, () => {
  test(`${AC[12]} the fast sphere with ccd unset expands with ccd: true and one assumption row naming the ball and the reason, and first touches the wall at step 6`, () => {
    const e = expanded(one({ call: 'expand', world: fastBallWorld(undefined) }), 'the fast ball');
    const failures: string[] = [];
    if (ccdOf(e.world, 'ball') !== true) failures.push(`the expanded ball's ccd is ${show(ccdOf(e.world, 'ball') as JsonObject)}, not true`);
    if (e.assumptions.length !== 1) failures.push(`${e.assumptions.length} assumption rows, one expected: ${show(e.assumptions)}`);
    const row = e.assumptions[0];
    if (row && (row['body'] !== 'ball' || typeof row['reason'] !== 'string' || !row['reason'].includes('physics.fast_body'))) failures.push(`the row doesn't name the ball and the reason (physics.fast_body): ${show(row)}`);
    none(failures, 'the expansion');
    const baked = one(bake(e.world, 120));
    const first = firstBetween(rowsOf(baked, 'the expanded fast ball'), 'contact_begin', 'ball', 'wall');
    expect(first?.step, 'the expanded ball first touches the wall at step 6 (0.04975 s), within one step').toBeGreaterThanOrEqual(5);
    expect(first!.step).toBeLessThanOrEqual(7);
    expect(statesOf(baked, 'ball', 'the expanded fast ball').every((s) => s.pos[0] <= WALL_FAR), 'the expanded ball never passes the wall\'s far face').toBe(true);
  }, TIMEOUT);

  test(`${AC[12]} a ball rolling at 2 m/s keeps ccd off and carries no assumption row`, () => {
    const e = expanded(one({ call: 'expand', world: rollingBallWorld() }), 'the rolling ball');
    expect(ccdOf(e.world, 'ball') === undefined || ccdOf(e.world, 'ball') === false, `the rolling ball keeps ccd off: ${show(ccdOf(e.world, 'ball') as JsonObject)}`).toBe(true);
    expect(e.assumptions, 'no assumption row for the rolling ball').toEqual([]);
  }, TIMEOUT);

  test(`${AC[12]} a planted recipe leaving the flagged ball's ccd off is refused at check, naming the ball`, () => {
    const [reply] = physics([{ call: 'expand', world: fastBallWorld(undefined) }], { planted: 'recipe_leaves_ccd_off' });
    expect(reply!['ok'], `the planted recipe's world is refused: ${show(reply)}`).toBe(false);
    const issues = arr(reply!['issues'], 'the refusal: issues').filter(isObject);
    expect(issues.some((i) => i['severity'] === 'error' && Array.isArray(i['ids']) && i['ids'].includes('ball')), `an error issue names the ball: ${show(issues)}`).toBe(true);
  }, TIMEOUT);
});
