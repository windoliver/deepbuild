// #12 AC2: a deliberately failing test makes `scripts/preflight` exit non-zero.
//
// The fixture's change adds one vitest test that fails on purpose, beside the fixture's passing tests. Every other
// check passes, so a non-zero exit is that test's doing.
import { afterAll, expect, it } from 'vitest';
import { AC2, MINUTE, declaredPreflightBudget, fixture, makeBox, needNode, passed, preflight, removeBoxes, report, shown, started } from './helpers.ts';

afterAll(removeBoxes, 10 * MINUTE);

const FAILING = `import { expect, it } from 'vitest';

it('fails on purpose', () => {
  expect(1 + 1, 'deliberately failing test').toBe(3);
});
`;

it(`${AC2} a deliberately failing test makes scripts/preflight exit non-zero`, () => {
  needNode(AC2);
  const box = makeBox('ac2');
  fixture(box, {
    budgets: { base: { tasks: [] }, change: { preflight: declaredPreflightBudget(), tasks: [] } },
    change: { 'tests/deliberately-failing.test.ts': FAILING },
  });
  const ran = preflight(box, 10 * MINUTE);
  const unit = report(ran.out, 'unit');
  expect(unit?.state, `${AC2} the unit lane fails on the deliberately failing test: ${shown(ran)}`).toBe('FAIL');
  // Every other check lane passed, so the exit is the failing test's.
  const others = started(ran.out).filter((lane) => lane !== 'unit' && lane !== 'perf' && !passed(ran.out, lane));
  expect(others, `${AC2} no lane but unit (and perf, which waits for the checks) fails: ${shown(ran)}`).toEqual([]);
  expect(ran.status, `${AC2} scripts/preflight exits non-zero with a deliberately failing test: ${shown(ran)}`).not.toBe(0);
}, 15 * MINUTE);
