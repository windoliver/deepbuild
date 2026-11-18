// Criterion 1: a world at `step_rate: 120` and `substeps: 4` with `solver.contact_hz: 81` is refused at check, naming
// the field, 81 and the bound 80, and with 80 it is accepted. At `substeps: 1` a written 30 is refused, naming the bound
// 20. A planted check that holds contacts to a quarter, as it holds joints, accepts 110 Hz at 4 substeps and fails,
// naming the field.
import { describe, expect, test } from 'vitest';
import {
  AC, FIELD, TIMEOUT, acceptFailures, caught, check, named, none, physics, prebuild, refusalFailures, show, stackWorld,
} from './helpers.ts';

prebuild(['release']);

const at = (substeps: number, contactHz: number) => check(stackWorld(5, { substeps, contactHz }));

describe(`${AC[1]} solver.contact_hz above (step_rate × substeps) ÷ 6 is refused at check`, () => {
  test(`${AC[1]} at 120 Hz and 4 substeps, 81 is refused naming ${FIELD}, 81 and the bound 80, and 80 is accepted`, () => {
    const [over, on, baked] = physics([at(4, 81), at(4, 80), { call: 'bake', world: stackWorld(5, { contactHz: 80 }), steps: 1, read: [] }]);
    console.log(`81 Hz at 4 substeps: ${show(over!['issues'])}`);
    none(refusalFailures(over!, 81, 80, '81 Hz at 120 Hz and 4 substeps'), 'the refusal of 81 Hz at 4 substeps');
    none(acceptFailures(on!, '80 Hz at 120 Hz and 4 substeps'), '80 Hz at 4 substeps');
    expect(baked!['ok'], `the world at 80 Hz bakes: ${show(baked)}`).toBe(true);
  }, TIMEOUT);

  test(`${AC[1]} at 120 Hz and 1 substep, a written 30 is refused naming ${FIELD}, 30 and the bound 20`, () => {
    const [over] = physics([at(1, 30)]);
    console.log(`30 Hz at 1 substep: ${show(over!['issues'])}`);
    none(refusalFailures(over!, 30, 20, '30 Hz at 120 Hz and 1 substep'), 'the refusal of 30 Hz at 1 substep');
  }, TIMEOUT);

  test(`${AC[1]} 110 Hz at 4 substeps is refused naming the bound 80; a planted check holding contacts to a quarter accepts it and fails, naming ${FIELD}`, () => {
    const what = '110 Hz at 120 Hz and 4 substeps';
    const [twin] = physics([at(4, 110)], 'contact_hz_quarter');
    none(refusalFailures(physics([at(4, 110)])[0]!, 110, 80, what), 'the refusal of 110 Hz at 4 substeps');
    none(acceptFailures(twin!, `${what} under the planted check`), 'the planted check accepts 110 Hz, under its quarter of 480, 120 Hz');
    const failures = refusalFailures(twin!, 110, 80, `${what} under the planted check`);
    console.log(`planted contact_hz_quarter: ${failures.join('; ')}`);
    caught(failures, 'the planted check that holds contacts to a quarter');
    named(failures, [FIELD], 'the planted check that holds contacts to a quarter');
  }, TIMEOUT);
});
