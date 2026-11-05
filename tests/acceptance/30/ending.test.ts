// AC7, the run's half: a check stopped at its deadline keeps the output it wrote, its exit cause and its test count
// so far, and ends overran (a failed run); one cut short by a hub restart (the hub aborting its runs as it goes
// down) keeps the same and ends stopped; a check that crashes on its own ends failed. How those runs make the
// claim's verdict (a failed run, INCONCLUSIVE never PASS or FAIL) is the gate runner's (#29), in claims.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { alive, command, openWorld, outputOf, project, recording, VITEST, waitFor, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** What the slow suite wrote before it hung: two tests done, the second naming its process. */
function keptSoFar(r: CommandRun): void {
  const stored = outputOf(r);
  expect(stored, 'the output the first test wrote').toMatch(/first done/);
  expect(stored, 'the output the second test wrote').toMatch(/second done in \d+/);
  expect(r.testsRun, 'the tests that ran before the run was cut short').toBe(2);
}
const workerPid = (checkout: string): number => {
  const marker = join(checkout, 'progress/second.done');
  return existsSync(marker) ? Number(readFileSync(marker, 'utf8')) : 0;
};

describe('AC7 #30.b213a878 a check stopped at its deadline or by a hub restart keeps its output, exit cause and test count so far; one that crashes on its own is a failed run', () => {
  it('AC7 a check still running at its deadline is stopped through host@1 and ends overran, keeping its output, its exit cause and the 2 tests it ran; nothing of it is left running', async () => {
    const checkout = project('slow');
    const { host, calls } = recording(world.sup);
    const deadline = 25_000;
    const started = Date.now();
    const r = await runCommandCheck(command(host, checkout, VITEST, { deadline }));
    const took = Date.now() - started;
    expect(r.outcome, outputOf(r).slice(0, 1500)).toBe('overran');
    expect(r.exit?.cause, 'its exit cause').toBe('deadline');
    keptSoFar(r);
    expect(took, 'the run ended soon after its deadline').toBeLessThan(deadline + 15_000);
    expect(calls.filter((c) => c.run === r.run).map((c) => c.call), 'the deadline stopped it through host@1').toContain('signal');
    const pid = workerPid(checkout);
    if (!pid) throw Error('BLOCKED: the suite\'s second test left no progress marker in its checkout, so its process can\'t be found');
    await waitFor(() => !alive(pid), 10_000, `the run's test process ${pid} to be gone`);
  }, 180_000);

  it('AC7 a check cut short by a hub restart, whose stop the hub signals as it goes down, ends stopped, keeping its output, its exit cause and the 2 tests it ran', async () => {
    const checkout = project('slow');
    const stop = new AbortController();
    const running = runCommandCheck(command(world.sup, checkout, VITEST, { deadline: 120_000, stop: stop.signal }));
    await waitFor(() => workerPid(checkout) || undefined, 60_000, 'the slow suite\'s second test (its progress marker in the checkout)');
    stop.abort();
    const r = await running;
    expect(r.outcome, outputOf(r).slice(0, 1500)).toBe('stopped');
    expect(r.exit?.cause, 'its exit cause').toBe('stop');
    keptSoFar(r);
    const pid = workerPid(checkout);
    await waitFor(() => !alive(pid), 10_000, `the run's test process ${pid} to be gone`);
  }, 180_000);

  it('AC7 a check whose test process crashes on its own (SIGKILL from inside a test) ends failed, keeping its output and how it ended', async () => {
    const r = await runCommandCheck(command(world.sup, project('crash'), VITEST));
    expect(r.outcome, outputOf(r).slice(0, 1500)).toBe('failed');
    expect(r.exit?.cause, 'it ended on its own').toBe('exit');
    expect(r.exit?.code === 0 && r.exit.signal === null, 'a crash never reads as a clean exit').toBe(false);
    expect(outputOf(r).trim().length, 'the output the tool wrote about the crash').toBeGreaterThan(0);
  }, 180_000);
});
