// AC17, the run's half: a suite whose tool retries a failed test inside one run counts every attempt the tool's
// report lists, so a test that fails and then passes on its retry shows both on the record; a tool whose report
// can't list attempts runs with its own retries off, by its flag, and the record says so. The claim's INCONCLUSIVE
// naming the test is the gate runner's (#29), in blocked.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { command, openWorld, outputOf, project, VITEST, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const TEST = 'settles the order';

/** The criterion's assertion on the retry suite's run: the failed attempt of the test is on the record. */
function everyAttemptCounted(r: CommandRun): void {
  const mine = r.attempts.filter((a) => a.test.includes(TEST)).map((a) => a.outcome);
  expect(mine, `the failed attempt of "${TEST}" is on the record (attempts: ${JSON.stringify(r.attempts)})`).toContain('failed');
  if (r.retries === null) {
    expect(mine, `the tool's report lists the passing retry of "${TEST}" too`).toContain('passed');
  } else {
    expect(r.retries, 'the flag that turned the tool\'s retries off').toMatch(/\S/);
    expect(r.failures.some((f) => f.test.includes(TEST)), `with retries off, "${TEST}" fails the run`).toBe(true);
  }
}

describe('AC17 #30.a06dc35a a tool\'s retries inside one run are counted attempt by attempt from its report, or turned off by its flag and recorded', () => {
  it(`AC17 a Vitest test that fails its first attempt and passes on its retry, "${TEST}", leaves its failed attempt on the record`, async () => {
    const r = await runCommandCheck(command(world.sup, project('retry'), VITEST));
    expect(Array.isArray(r.attempts)).toBe(true);
    expect(r.retries === null || typeof r.retries === 'string').toBe(true);
    everyAttemptCounted(r);
    expect(r.attempts.some((a) => a.test.includes('totals the order') && a.outcome === 'passed'), 'the other test\'s one attempt').toBe(true);
  }, 180_000);

  it(`AC17 (wrong program) a runner that reads only each test's last attempt passes the fixture test that fails once and passes on its retry, and fails this test, naming "${TEST}"`, async () => {
    const r = await runCommandCheck(command(world.sup, project('retry'), VITEST, { plant: 'last-attempt-only' }));
    if (r.outcome !== 'passed') throw Error(`BLOCKED: the planted runner didn't pass the retried test (outcome ${r.outcome}), so the wrong program wasn't shown: ${outputOf(r).slice(0, 800)}`);
    expect(() => everyAttemptCounted(r)).toThrow(new RegExp(TEST));
  }, 180_000);
});
