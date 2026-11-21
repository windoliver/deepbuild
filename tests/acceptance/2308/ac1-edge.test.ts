// Criterion 1: in a new fixture at `step_rate: 480`, 4 substeps, `contact_hz: 240` and `length_unit: 0.01`, a cube of
// side 1 cm with friction 0 slides at 0.886 m/s toward the edge of a static table, the speed that crosses 4 sides while
// a free body falls one. It has dropped 0.5 mm before its centre is 1.6 sides past the edge. A planted wrapper that
// ignores `length_unit` has not dropped until 2.09 sides past and fails, naming the body and the step.
import { describe, expect, test } from 'vitest';
import {
  AC, CUBE, EDGE_MOST, TIMEOUT, ask, bake, edge, edgeRead, kitCall, kitFailures, prebuild, show, type Planted,
} from './helpers.ts';

prebuild(['release']);

const FIXTURE = edge();
const PLANTED: Planted = 'wrapper_ignores_length_unit';
/** The fixture's world baked for its own steps, the kit's data and the kit's report, down one process. */
const CALLS = [bake(FIXTURE.world, FIXTURE.steps, { read: [CUBE] }), { call: 'behavior_fixtures' }, kitCall()];
const sides = (x: number | null): string => (x === null ? 'never' : x.toFixed(2));

describe(`${AC[1]} the edge: a 1 cm cube sliding off a table at step_rate 480, contact_hz 240 and length_unit 0.01`, () => {
  test(`${AC[1]} the cube has dropped 0.5 mm before its centre is 1.6 sides past the edge, and the kit's ${FIXTURE.name} holds that world and passes on it`, () => {
    const run = ask(CALLS);
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = edgeRead(run.replies[0]!, FIXTURE.steps, 'the edge');
    if (read.step !== null) console.log(`the edge: the cube has dropped 0.5 mm at step ${read.step}, its centre ${sides(read.sides)} sides past the edge (before ${EDGE_MOST})`);
    const kit = kitFailures(run.replies[1]!, run.replies[2]!, FIXTURE, 'pass', read.measured, 'the behavior kit');
    const failures = [...read.failures, ...kit.failures];
    expect(failures, `the edge at step_rate 480, 4 substeps, contact_hz 240 and length_unit 0.01:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[1]} a planted wrapper that ignores length_unit has not dropped until 2.09 sides past and fails, naming the body and the step`, () => {
    const run = ask(CALLS, { planted: PLANTED });
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = edgeRead(run.replies[0]!, FIXTURE.steps, `the edge under ${PLANTED}`);
    if (read.step !== null) console.log(`planted ${PLANTED}: the cube has dropped 0.5 mm at step ${read.step}, its centre ${sides(read.sides)} sides past the edge`);
    expect(sides(read.sides), 'how many sides past the edge the cube\'s centre is when it has dropped 0.5 mm under the planted wrapper, as the issue prints it').toBe('2.09');
    expect(read.failures.length, 'the judge that passes the real program finds something wrong with the planted wrapper\'s bake').toBeGreaterThan(0);
    expect(read.failures.some((f) => f.startsWith(`${CUBE}:`) && f.includes(`step ${String(read.step)}`)), `a failure names the body and the step:\n  ${read.failures.join('\n  ')}`).toBe(true);
    // The fixture in the kit fails on the same wrapper, its row naming the body and the step.
    const kit = kitFailures(run.replies[1]!, run.replies[2]!, FIXTURE, 'fail', read.measured, `the behavior kit under ${PLANTED}`);
    if (kit.row && (kit.row.raw['body'] !== CUBE || kit.row.raw['step'] !== read.step)) kit.failures.push(`${FIXTURE.name}: the fail names body ${show(kit.row.raw['body'])} and step ${show(kit.row.raw['step'])}, not ${CUBE} and step ${String(read.step)}`);
    expect(kit.failures, `the kit's ${FIXTURE.name} under ${PLANTED}:\n  ${kit.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
