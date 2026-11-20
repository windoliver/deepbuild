// Criterion 1: in a new fixture, a box of friction 0.5 set at rest on a level static belt of friction 0.5 with
// `tangent_speed: 1` reaches 1 m/s along the belt's +X at v ÷ (μg) = 0.204 s within 2 steps, and at 2 s it has moved
// v·t − v² ÷ (2μg) = 1.898 m, within 1%. The belt's body never moves. A planted wrapper that leaves the hook out leaves
// the box at rest and fails, naming the fixture, the answer 1.898 m and the 0 m it read.
import { describe, expect, test } from 'vitest';
import {
  AC, LEVEL, MOVED, PLUS_X, PRINTED, RATE, REACH_LEVEL, REFERENCE, TIMEOUT, ask, bake, boxOf, carried, dataFailures, failFailures,
  fixtureNamed, kitCall, levelBelt, mm3, movedFailures, passFailures, prebuild, reachFailures, rowOf, show, stillFailures, travel,
  type Carried, type Fixture, type JsonObject, type KitResult,
} from './helpers.ts';

prebuild(['release']);
const AXIS = 'the belt\'s +X';
const PLANTED = 'belt_hook_left_out';

/** Everything wrong with the level belt's bake: the time its box reaches the belt's speed, how far it is carried, and the belt at rest. */
function judge(reply: JsonObject, c: Carried): string[] {
  return [...reachFailures(LEVEL, c, `along ${AXIS}`, REACH_LEVEL), ...movedFailures(LEVEL, c, AXIS, MOVED), ...stillFailures(LEVEL, reply)];
}
const shown = (c: Carried): string =>
  `reaches 1 m/s at ${c.reached === null ? 'no step' : `step ${c.reached} (${(c.reached / RATE).toFixed(3)} s)`}, worked ${REACH_LEVEL.toFixed(3)} s; moved ${mm3(c.along)} m at 2 s, worked ${MOVED.toFixed(3)} m`;

describe(`${AC[1]} a level static belt with tangent_speed 1 carries the box set at rest on it`, () => {
  test(`${AC[1]} the box reaches 1 m/s along the belt's +X at 0.204 s within 2 steps, has moved 1.898 m at 2 s within 1%, and the belt's body never moves`, () => {
    expect([REACH_LEVEL.toFixed(3), MOVED.toFixed(3)], 'v ÷ (μg) and v·t − v² ÷ (2μg), as the issue prints them').toEqual(['0.204', '1.898']);
    const run = ask([bake(levelBelt())]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const c = carried(run.replies[0]!, PLUS_X, 'the level belt with tangent_speed 1');
    expect(typeof c === 'string' ? c : '', `${LEVEL}: the first world bakes, a state of its box after each of 240 steps`).toBe('');
    console.log(`${LEVEL}: ${shown(c as Carried)}`);
    const failures = judge(run.replies[0]!, c as Carried);
    expect(failures, `${LEVEL} baked 2 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[1]} the behavior kit holds the new fixture ${LEVEL} once, the criterion's box and belt with 1.898 m and 1%, and ${REFERENCE} passes it, measuring what its own world's bake shows`, () => {
    const run = ask([{ call: 'behavior_fixtures' }, kitCall()]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const held = fixtureNamed(run.replies[0]!, LEVEL, 'behavior_fixtures');
    expect(typeof held === 'string' ? held : '', `the kit's data holds the new fixture ${LEVEL}`).toBe('');
    const f = held as Fixture;
    const failures = dataFailures(f, 1.898, PRINTED, '1.898 m');
    const read = rowOf(run.replies[1]!, LEVEL, 'behavior_kit');
    if (typeof read === 'string') failures.push(read);
    else {
      console.log(`${LEVEL}: measured ${String(read.measured)} m against ${String(read.answer)} m ${show(read.tolerance ?? null)} → ${read.result}`);
      failures.push(...passFailures(read, f, REFERENCE, MOVED));
      // The kit measures the bake, not its answer: the fixture's own world, baked here for 2 s, carries its box as far.
      const id = boxOf(f);
      if (id !== null && read.measured !== null) {
        const own = ask([bake(f.world, { read: [id] })]);
        expect(own.problem, `${own.what} answers`).toBe('');
        const far = travel(own.replies[0]!, id, `${LEVEL}'s own world baked 2 s`);
        if (typeof far === 'string') failures.push(far);
        else if (Math.abs(far - read.measured) > 1e-5) failures.push(`${LEVEL}: the kit measured ${read.measured} m; its own world baked here has moved ${id} ${far} m at 2 s`);
      }
    }
    expect(failures, `${LEVEL} in the kit's data and on ${REFERENCE}:\n  ${failures.join('\n  ')}`).toEqual([]);
    // The judge's own wrong answer: the same row measuring the 0 m of a box left at rest.
    expect(passFailures({ ...(read as KitResult), measured: 0 }, f, REFERENCE, MOVED).length, 'the pass judge catches a box left at rest').toBeGreaterThan(0);
  }, TIMEOUT);

  test(`${AC[1]} a planted wrapper that leaves the hook out (${PLANTED}) leaves the box at rest and fails, naming ${LEVEL}, the answer 1.898 m and the 0 m it read`, () => {
    const run = ask([bake(levelBelt()), kitCall()], { planted: PLANTED });
    expect(run.problem, `${run.what} answers: the planted wrapper runs`).toBe('');
    const [baked, report] = [run.replies[0]!, run.replies[1]!];
    const read = carried(baked, PLUS_X, `the level belt with tangent_speed 1 under ${PLANTED}`);
    expect(typeof read === 'string' ? read : '', `${PLANTED} leaves out the hook alone: it takes the first world and bakes it`).toBe('');
    const c = read as Carried;
    console.log(`planted ${PLANTED}: ${shown(c)}`);
    expect(Math.abs(c.along) < PRINTED, `${PLANTED} leaves the box at rest: at 2 s it has moved ${c.along} m along ${AXIS}, 0 m to the millimetre`).toBe(true);
    const failures = judge(baked, c);
    expect(failures.length, `${PLANTED}: the planted wrapper is caught (the judge finds nothing wrong with a box left at rest)`).toBeGreaterThan(0);
    expect(failures.some((x) => [LEVEL, '1.898 m', '0.000 m'].every((n) => x.includes(n))), `a failure names ${LEVEL}, the answer 1.898 m and the 0.000 m it read; failures:\n  ${failures.join('\n  ')}`).toBe(true);
    // The kit's own fail names them in its row: the fixture, the interface's answer and the 0 m it measured.
    const row = rowOf(report, LEVEL, `behavior_kit under ${PLANTED}`);
    expect(typeof row === 'string' ? row : '', `the kit's report under ${PLANTED} holds ${LEVEL} once`).toBe('');
    const r = row as KitResult;
    const kit = failFailures(r, r.backend);
    if (r.answer === null || Math.abs(r.answer - 1.898) > PRINTED) kit.push(`${LEVEL}'s fail names the answer ${show(r.answer)}, not 1.898 m`);
    if (r.measured === null || !(Math.abs(r.measured) < PRINTED)) kit.push(`${LEVEL}'s fail reads ${show(r.measured)} m, not the 0 m a box left at rest has moved`);
    expect(kit, `${LEVEL}'s row under ${PLANTED}:\n  ${kit.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
