// AC9, the runs' half: a test the claim adds or changes runs five times inside the full suite, and once with the
// clock a month ahead, each run kept with its output; the test that fails only a month ahead fails that run alone,
// naming it, and a test that fails every run fails all six. Which tests a claim adds or changes, and the claim's
// INCONCLUSIVE or FAIL from these runs, are the gate runner's (#29), in blocked.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAddedTests, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { command, DAY, openWorld, outputOf, project, VITEST, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const ADDED = 'test/trial.test.ts';
const ALWAYS_FAILS = `import { expect, test } from 'vitest';

test('the trial is still open', () => {
  console.log(\`NOW \${Date.now()}\`);
  expect('closed').toBe('open');
});
`;
const trial = (extra: Record<string, string> = {}) => project('trial', { 'test/trial.json': JSON.stringify({ ends: Date.now() + 14 * DAY }), ...extra });
const nowOf = (r: CommandRun): number => Number(/NOW (\d+)/.exec(outputOf(r))?.[1] ?? NaN);
const named = (r: CommandRun): boolean => r.failures.some((f) => /the trial is still open/.test(f.test));

describe('AC9 #30.506a2ee0 a test the claim adds or changes runs five times inside the full suite, and once with the clock a month ahead', () => {
  it('AC9 five runs of the full suite on today\'s clock pass, and the run a month ahead fails the added test alone, naming it and keeping its output', async () => {
    const started = Date.now();
    const runs = await runAddedTests(command(world.sup, trial(), VITEST, { inputs: ['test/**'] }), [ADDED]);
    expect(runs, 'five runs and one with the clock a month ahead').toHaveLength(6);
    expect(new Set(runs.map((r) => r.run)).size, 'each run has a handle of its own').toBe(6);
    const today = runs.filter((r) => r.clock === 0);
    const ahead = runs.filter((r) => r.clock > 0);
    expect(today).toHaveLength(5);
    expect(ahead).toHaveLength(1);
    for (const r of today) {
      expect(r.outcome, outputOf(r).slice(0, 800)).toBe('passed');
      expect(r.testsRun, 'the full suite: the added test and the two others').toBe(3);
    }
    const month = ahead[0]!;
    expect(month.clock, 'about a month ahead, in ms').toBeGreaterThanOrEqual(28 * DAY);
    expect(month.clock).toBeLessThanOrEqual(31 * DAY);
    expect(month.outcome, outputOf(month).slice(0, 800)).toBe('failed');
    expect(named(month), `the failing run names the test (failures: ${month.failures.map((f) => f.test).join(', ')})`).toBe(true);
    expect(nowOf(month), 'the test saw the clock a month ahead').toBeGreaterThanOrEqual(started + 28 * DAY - DAY);
    expect(month.output.stdout.length + month.output.stderr.length, 'the failing run keeps its output').toBeGreaterThan(0);
    for (const r of today) expect(nowOf(r), 'the five runs saw today\'s clock').toBeLessThan(started + DAY);
  }, 600_000);

  it('AC9 a test the claim adds that fails every run fails all six, each naming it', async () => {
    const runs = await runAddedTests(command(world.sup, trial({ [ADDED]: ALWAYS_FAILS }), VITEST, { inputs: ['test/**'] }), [ADDED]);
    expect(runs).toHaveLength(6);
    for (const r of runs) {
      expect(r.outcome).toBe('failed');
      expect(named(r), `run ${r.run} (clock +${r.clock} ms) names the test`).toBe(true);
    }
  }, 600_000);
});
