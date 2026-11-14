// #12 AC4: `scripts/preflight` runs its checks as named lanes (typecheck, lint, unit, parity quick, perf), keeps going
// after a lane fails, and reports every failing lane with its first error and the fix it names, exiting non-zero if
// any failed.
//
// The fixture's change breaks four lanes at once, each with two errors in order: a real type error twice over in the
// fixture package (typecheck), rustfmt's check (lint), two failing vitest tests (unit), and the workspace build
// (parity quick). The first lane fails, so every later one must still run, and perf, which waits for the checks, must
// say it didn't measure them.
import { afterAll, expect, it } from 'vitest';
import { AC4, MINUTE, declaredPreflightBudget, fixture, makeBox, needNode, passed, plant, preflight, ranLog, removeBoxes, report, shown, started } from './helpers.ts';

afterAll(removeBoxes, 10 * MINUTE);

const BROKEN = `export const first: number = 'typecheck first';
export const second: number = 'typecheck second';
`;
const FAILING = `import { expect, it } from 'vitest';

it('first failing test', () => {
  expect(1 + 1).toBe(3);
});

it('second failing test', () => {
  expect(2 + 2).toBe(5);
});
`;

// Each failing lane: what its first error holds, and what only its second does.
const PLANTED: [lane: string, first: RegExp, second: RegExp][] = [
  ['typecheck', /broken\.ts\(1,/, /broken\.ts\(2,/],
  ['lint', /lint first error/, /lint second error/],
  // A failing test's first error: its name or its assertion, as the runner prints them.
  ['unit', /first failing test|expected 2 to be 3/, /second failing test|expected 4 to be 5/],
  ['parity quick', /parity first error/, /parity second error/],
];

it(`${AC4} scripts/preflight runs typecheck, lint, unit, parity quick and perf as lanes, keeps going after a failure, reports each failing lane with its first error and fix, and exits non-zero`, () => {
  needNode(AC4);
  const box = makeBox('ac4');
  fixture(box, {
    budgets: { base: { tasks: [] }, change: { preflight: declaredPreflightBudget(), tasks: [] } },
    change: { 'packages/fixture/src/broken.ts': BROKEN, 'tests/deliberately-failing.test.ts': FAILING },
  });
  plant(box, [
    { tool: 'cargo', has: ['fmt'], out: 'error: lint first error: src/main.rs is not formatted\nerror: lint second error: src/lib.rs is not formatted', exit: 1 },
    { tool: 'cargo', has: ['build', '--workspace'], err: 'error[E0425]: parity first error: cannot find value `one` in this scope\nerror[E0425]: parity second error: cannot find value `two` in this scope', exit: 101 },
  ]);
  const ran = preflight(box, 10 * MINUTE);

  // The named lanes, each started.
  const lanes = started(ran.out);
  for (const lane of ['typecheck', 'lint', 'unit', 'parity quick', 'perf']) expect(lanes, `${AC4} scripts/preflight runs a lane named ${lane}: ${shown(ran)}`).toContain(lane);

  // It keeps going: the lanes after the first failing one ran their checks, and every lane it started ends in a result.
  const commands = ranLog(box).map(({ tool, args }) => `${tool} ${args.join(' ')}`);
  expect(commands.some((command) => /^cargo fmt\b/.test(command)), `${AC4} the lint lane's check ran after typecheck failed: ${shown(ran)}`).toBe(true);
  expect(commands.some((command) => /^cargo build\b.*--workspace/.test(command)), `${AC4} the parity quick lane's build ran after earlier lanes failed: ${shown(ran)}`).toBe(true);
  const unfinished = lanes.filter((lane) => !passed(ran.out, lane) && !report(ran.out, lane));
  expect(unfinished, `${AC4} every lane the preflight started reads PASS or is reported: ${shown(ran)}`).toEqual([]);

  // Every failing lane is reported with its first error, not a later one, and the fix it names.
  for (const [lane, first, second] of PLANTED) {
    const found = report(ran.out, lane);
    expect(found?.state, `${AC4} the ${lane} lane is reported as FAIL: ${shown(ran)}`).toBe('FAIL');
    expect(found?.text, `${AC4} the ${lane} lane's report names its first error: ${shown(ran)}`).toMatch(first);
    expect(found?.text, `${AC4} the ${lane} lane's report names its first error, not a later one: ${shown(ran)}`).not.toMatch(second);
    expect(found?.text, `${AC4} the ${lane} lane's report names the fix: ${shown(ran)}`).toMatch(/^\s+Fix: \S/m);
  }
  const perf = report(ran.out, 'perf');
  expect(perf, `${AC4} perf, unmeasured since the checks failed, is reported: ${shown(ran)}`).toBeDefined();
  expect(perf?.text, `${AC4} perf's report names the fix: ${shown(ran)}`).toMatch(/^\s+Fix: \S/m);

  expect(ran.status, `${AC4} scripts/preflight exits non-zero when any lane failed: ${shown(ran)}`).not.toBe(0);
}, 15 * MINUTE);
