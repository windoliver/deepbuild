// What a run records: AC2, a suite that runs zero tests is a run that ran nothing (its INVALID is the claim's,
// blocked.test.ts); AC3, the exit code, the output and the test count, counted for Vitest, Jest, pytest and go
// test; AC15, the count is read from the reporter file the runner asked for, so a test that prints a summary of
// its own changes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { command, needGo, needJest, needPytest, openWorld, outputOf, project, sha256, VITEST, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const RUN_OUTCOMES = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'];

/** A suite of three tests with one failing, as each tool reports it: three counted, the run failed, its exit kept. */
function threeOneFailing(r: CommandRun, failing: RegExp): void {
  expect(r.outcome, outputOf(r)).toBe('failed');
  expect(r.testsRun, 'the tests the tool ran').toBe(3);
  expect(r.exit?.code, 'the tool\'s exit code').not.toBe(0);
  expect(r.exit?.code, 'the tool\'s exit code').toBeTypeOf('number');
  expect(r.failures.length).toBe(1);
  expect(r.failures[0]!.test).toMatch(failing);
}

describe('AC2 #30.5f9be4a0 a suite that runs zero tests is INVALID', () => {
  it('AC2 a Vitest suite whose every test is skipped exits 0 and runs nothing: the run is ran_nothing with 0 tests, never passed', async () => {
    const r = await runCommandCheck(command(world.sup, project('skipped'), VITEST));
    expect(r.exit?.code, `the tool itself exits clean: ${outputOf(r)}`).toBe(0);
    expect(r.outcome).toBe('ran_nothing');
    expect(r.testsRun).toBe(0);
    expect(r.failures).toEqual([]);
  }, 180_000);
});

describe('AC3 #30.9a95469b exit code, output and test count are recorded with the run', () => {
  it('AC3 a Vitest run records its exit code, its output with the digest of what is stored, and its test count; the result is a run outcome, never a verdict', async () => {
    const r = await runCommandCheck(command(world.sup, project('counts'), VITEST));
    threeOneFailing(r, /applies the bulk discount/);
    expect(r.exit?.code).toBe(1);
    expect(r.exit?.cause).toBe('exit');
    expect(outputOf(r), 'the output the suite wrote').toMatch(/cart says hello/);
    expect(r.output.sha256.stdout, 'the digest is of the stored stdout').toBe(sha256(r.output.stdout));
    expect(r.output.sha256.stderr, 'the digest is of the stored stderr').toBe(sha256(r.output.stderr));
    expect(RUN_OUTCOMES).toContain(r.outcome);
    expect('verdict' in r, 'a check runner returns a run outcome, never a verdict').toBe(false);
    expect(r.run).toMatch(/^run:[0-9A-Za-z]+$/);
  }, 180_000);

  it('AC3 a Jest run of three tests, one failing, records 3 tests from the tool\'s report', async () => {
    needJest();
    const r = await runCommandCheck(command(world.sup, project('jest-counts'), 'node_modules/.bin/jest'));
    threeOneFailing(r, /applies the bulk discount/);
  }, 180_000);

  it('AC3 a pytest run of three tests, one failing on its assert and one on an AttributeError, records 3 tests from the tool\'s report', async () => {
    needPytest();
    const r = await runCommandCheck(command(world.sup, project('pytest-cart'), 'python3 -m pytest'));
    expect(r.testsRun).toBe(3);
    expect(r.outcome).toBe('failed');
    expect(r.exit?.code).toBe(1);
    expect(r.failures.map((f) => f.test).sort().join(' ')).toMatch(/test_coupon.*test_total/);
  }, 180_000);

  it('AC3 a go test run of three tests, one failing on t.Errorf, records 3 tests from the tool\'s report', async () => {
    needGo();
    const r = await runCommandCheck(command(world.sup, project('go-counts'), 'go test ./...'));
    threeOneFailing(r, /TestDiscount/);
    expect(r.failures[0]).toMatchObject({ file: 'cart_test.go', line: 19, assertion: true });
  }, 180_000);
});

describe('AC15 #30.c91cfcd8 a Vitest test that prints "Tests 12 passed (12)" while the suite runs 3 records 3, from the reporter file the runner requested', () => {
  it('AC15 the suite of 3 tests, one of which prints a summary claiming 12, records 3', async () => {
    const r = await runCommandCheck(command(world.sup, project('printed-count'), VITEST));
    expect(outputOf(r), 'the printed claim is in the output').toMatch(/Tests {2}12 passed \(12\)/);
    expect(r.outcome).toBe('passed');
    expect(r.testsRun, 'the count from the reporter file, not the printed line').toBe(3);
  }, 180_000);
});
