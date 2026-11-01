// AC19, the run's half: for a check with a numeric contract (#28), the runner reads from the tool's own report, per
// output, how many elements were compared and the largest error, never from the test's printed output; a value the
// report doesn't give is missing, never complete. The claim's INVALID naming the output, and its twin counting, are
// the gate runner's (#29), in claims.test.ts; the timing check's flushed repeats are #87's, in blocked.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import type { NumericContract } from '../../../packages/verdicts/src/index.ts';
import { command, openWorld, outputOf, project, VITEST, type World } from './helpers.ts';
import { countsFromPrintedOutput, silentReportAsComplete } from './wrong.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const SIZE = 4_096_000;
const CONTRACT: NumericContract = {
  reference: { precision: 'fp64' },
  accumulate: 'fp32',
  tolerances: [{ output: 'out', size: SIZE, atol: 1e-3, rtol: 1e-4, unit: '1' }],
  twin: { accumulate: 'fp16' },
  assert: 'matmul matches the reference',
};
type Mode = 'sample' | 'full' | 'silent';
const contractRun = (mode: Mode): Promise<CommandRun> =>
  runCommandCheck(command(world.sup, project('contract'), VITEST, { env: { CONTRACT_MODE: mode }, contract: CONTRACT }));

/** The criterion's assertion on one run: the count and largest error the report gave for `out`, or missing. */
function readFromReport(r: CommandRun, mode: Mode): void {
  const out = r.contract?.find((c) => c.output === 'out');
  expect(out, `the record has output out (contract: ${JSON.stringify(r.contract)})`).toBeDefined();
  expect(out!.size).toBe(SIZE);
  if (mode === 'silent') {
    expect(out!.compared, 'output out: the report gave no count, so it is missing, never complete').toBeNull();
    expect(out!.largest_error, 'output out: the report gave no largest error, so it is missing').toBeNull();
  } else {
    expect(out!.compared, `output out: the elements compared, from the report (${mode})`).toBe(mode === 'sample' ? SIZE / 100 : SIZE);
    expect(out!.largest_error, 'output out: the largest error, from the report').toBe(0.00025);
  }
}

describe('AC19 #30.aebc2446 a contract check\'s compared counts and largest error come from the report, per output; a value it doesn\'t give is missing', () => {
  it('AC19 a test that compares a 1% sample, 40,960 of out\'s 4,096,000 elements, records 40,960 though it prints that it compared all of them', async () => {
    const r = await contractRun('sample');
    expect(outputOf(r)).toMatch(/compared 4096000 of 4096000 elements of out/);
    readFromReport(r, 'sample');
  }, 180_000);

  it('AC19 its twin, which compares all 4,096,000, records 4,096,000', async () => {
    readFromReport(await contractRun('full'), 'full');
  }, 180_000);

  it('AC19 a report that gives no count or largest error for out records both as missing', async () => {
    const r = await contractRun('silent');
    expect(r.outcome, outputOf(r).slice(0, 800)).toBe('passed');
    readFromReport(r, 'silent');
  }, 180_000);

  it('AC19 (wrong program) a runner that reads the counts from the test\'s printed output records 4,096,000 for the sample and fails this test, naming out', async () => {
    const wrong = countsFromPrintedOutput(await contractRun('sample'));
    expect(() => readFromReport(wrong, 'sample')).toThrow(/output out/);
  }, 180_000);

  it('AC19 (wrong program) a runner that takes a silent report as complete fails this test, naming out', async () => {
    const wrong = silentReportAsComplete(await contractRun('silent'));
    expect(() => readFromReport(wrong, 'silent')).toThrow(/output out/);
  }, 180_000);
});
