// AC10, the run's half: a spec check written by hand as `pnpm test || true`, over a suite with one failing test,
// is a run that names its mask `|| true` and never passes, while the same check as a bare `pnpm test` fails on that
// test. The criterion names pnpm; the same rule holds for the package script npm runs, which this machine has, so
// that variant runs too. The claim's INVALID ("exit status masked by `|| true`") and FAIL are the gate's (#29), in claims.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { command, needPnpm, openWorld, outputOf, project, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** The criterion's assertion on the masked check's run: the mask named, the run never passed. */
function namesTheMask(r: CommandRun): void {
  expect(r.mask, `the run names the mask (outcome ${r.outcome})`).toMatch(/\|\| true/);
  expect(r.outcome, 'a masked check never passes').not.toBe('passed');
}
/** The bare check's run: the suite's failing test fails it. */
function failsOnTheTest(r: CommandRun): void {
  expect(r.mask).toBeNull();
  expect(r.outcome, outputOf(r).slice(0, 1500)).toBe('failed');
  expect(r.testsRun).toBe(2);
  expect(r.failures.map((f) => f.test).join(' | ')).toMatch(/applies the discount/);
}

for (const tool of ['pnpm', 'npm'] as const) {
  const gate = tool === 'pnpm' ? needPnpm : () => undefined;
  describe(`AC10 #30.9c363cec a spec check written by hand as \`${tool} test || true\` names its mask and never passes; the bare \`${tool} test\` fails`, () => {
    it(`AC10 \`${tool} test || true\` over a suite with one failing test names the mask \`|| true\` and doesn't pass`, async () => {
      gate();
      namesTheMask(await runCommandCheck(command(world.sup, project('npm-script'), `${tool} test || true`)));
    }, 180_000);

    it(`AC10 the same check as a bare \`${tool} test\` fails on the failing test`, async () => {
      gate();
      failsOnTheTest(await runCommandCheck(command(world.sup, project('npm-script'), `${tool} test`)));
    }, 180_000);

    it(`AC10 (wrong program) a runner that judges only the exit code passes \`${tool} test || true\` and fails this test`, async () => {
      gate();
      const r = await runCommandCheck(command(world.sup, project('npm-script'), `${tool} test || true`, { plant: 'exit-code-only' }));
      if (r.exit?.code !== 0) throw Error(`BLOCKED: the planted runner didn't run the masked command to a clean exit (exit ${JSON.stringify(r.exit)}), so the wrong program wasn't shown`);
      expect(r.outcome, 'the planted runner passes the masked check').toBe('passed');
      expect(() => namesTheMask(r)).toThrow(/mask|passes/);
    }, 180_000);
  });
}
