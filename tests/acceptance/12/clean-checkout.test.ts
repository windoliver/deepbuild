// #12 AC1: `npm install` succeeds on a clean checkout, and `scripts/preflight` there needs no other setup: it exits 0
// when every lane passes and the checks fit their budget; a preflight that exits 0 with a lane failed, blocked or unrun
// fails this test.
//
// A clean checkout of this one (the files git lists, nothing it ignores) gets a real `npm install`. Then this
// checkout's `scripts/preflight` runs in a fixture whose node_modules is that fresh install and nothing else: no
// built package, no target/, no `deep` on PATH. Its lanes have small real workloads (README.md, The fixture). It runs
// twice: with every lane passing, and with one lane's check blocked, as a check whose tool is missing reads.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  AC1, MINUTE, cleanInstall, declaredPreflightBudget, fixture, makeBox, needNode, notPassing, passed, plant, preflight, removeBoxes, report, shown, started,
} from './helpers.ts';

afterAll(removeBoxes, 10 * MINUTE);

const NAMED = ['typecheck', 'lint', 'unit', 'parity quick', 'perf'];

it(`${AC1} npm install succeeds on a clean checkout, and scripts/preflight there exits 0 only when every lane ran and passed within the preflight budget`, () => {
  needNode(AC1);
  const box = makeBox('ac1');
  const { clean, install } = cleanInstall(box, 10 * MINUTE);
  expect(install.status, `${AC1} npm install exits 0 on a clean checkout: ${shown(install)}`).toBe(0);
  for (const tool of ['typescript/bin/tsc', 'vitest/vitest.mjs'])
    expect(existsSync(join(clean, 'node_modules', tool)), `${AC1} npm install on a clean checkout installs ${tool}`).toBe(true);

  fixture(box, {
    from: clean,
    modules: join(clean, 'node_modules'),
    budgets: { base: { tasks: [] }, change: { preflight: declaredPreflightBudget(clean), tasks: [] } },
  });

  // Every lane passes.
  const green = preflight(box, 10 * MINUTE);
  expect(green.status, `${AC1} with every lane passing and the checks within budget, scripts/preflight exits 0: ${shown(green)}`).toBe(0);
  expect(notPassing(green.out), `${AC1} a preflight that exits 0 reports no lane or check below PASS: ${shown(green)}`).toEqual([]);
  const ran = started(green.out);
  for (const lane of NAMED) expect(ran, `${AC1} the ${lane} lane runs: ${shown(green)}`).toContain(lane);
  const unpassed = ran.filter((lane) => !passed(green.out, lane));
  expect(unpassed, `${AC1} every lane that a preflight exiting 0 started reads PASS: ${shown(green)}`).toEqual([]);
  expect(green.out, `${AC1} the checks fit the preflight budget: ${shown(green)}`).not.toMatch(/^FAIL preflight budget/m);
  // The unit lane ran the fixture's tests under both runners, so no lane passed without running.
  for (const marker of ['vitest-ran', 'node-test-ran'])
    expect(existsSync(join(box.repo, marker)), `${AC1} the unit lane ran the fixture's ${marker === 'vitest-ran' ? 'vitest' : 'node --test'} test: ${shown(green)}`).toBe(true);

  // One lane's check is blocked: its tool is missing, as the check says.
  plant(box, [{ tool: 'cargo', has: ['fmt'], out: 'BLOCKED rustfmt: the fixture toolchain has no rustfmt component', exit: 1 }]);
  const held = preflight(box, 10 * MINUTE);
  expect(report(held.out, 'lint'), `${AC1} the blocked lint lane is reported below PASS: ${shown(held)}`).toBeDefined();
  expect(held.status, `${AC1} a preflight with a lane blocked exits non-zero: ${shown(held)}`).not.toBe(0);
}, 15 * MINUTE);
