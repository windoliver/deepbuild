// AC19, the timing check's half (#87): for a timing check, the runner reads from the tool's own report, per timed
// repeat, whether that repeat's caches were flushed, never from the test's printed output; a repeat the report
// leaves out is recorded as not flushed, never as flushed or cold. The numeric contract's counts are in
// contract.test.ts and the contract claim's INVALID in claims.test.ts. The claim's INVALID on an unflushed repeat,
// naming the repeat, is #87's verdict half and stays out of scope here: this file ends at the run record.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { command, openWorld, outputOf, project, VITEST, type World } from './helpers.ts';
import { flushedFromPrintedOutput, silentRepeatAsFlushed } from './wrong.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const REPEATS = 3;
const SILENT = 2;
type Mode = 'flushed' | 'silent' | 'printed';
const timingRun = (mode: Mode): Promise<CommandRun> =>
  runCommandCheck(command(world.sup, project('timing'), VITEST, { env: { TIMING_MODE: mode }, timing: { repeats: REPEATS } }));

/** The criterion's assertion on one run: each repeat recorded flushed as the report says, the silent one not flushed. */
function readFromReport(r: CommandRun, mode: Mode): void {
  expect(r.outcome, outputOf(r).slice(0, 800)).toBe('passed');
  expect(r.timing, `the record has one entry per timed repeat (timing: ${JSON.stringify(r.timing)})`).toBeDefined();
  expect(r.timing!.map((t) => t.repeat)).toEqual([1, 2, 3]);
  for (const t of r.timing!) {
    const silent = mode !== 'flushed' && t.repeat === SILENT;
    expect(t.flushed, silent ? `repeat ${t.repeat}: the report left out whether its caches were flushed, so it is not flushed, never flushed` : `repeat ${t.repeat}: the report says its caches were flushed`).toBe(!silent);
  }
}

describe('AC19 #30.aebc2446 a timing check\'s repeats are recorded flushed as the report says; a repeat the report leaves out is not flushed (the run\'s half; the claim\'s INVALID naming the repeat is #87\'s)', () => {
  it('AC19 a timing check whose report says each of its three repeats flushed its caches records all three as flushed', async () => {
    readFromReport(await timingRun('flushed'), 'flushed');
  }, 180_000);

  it('AC19 a timing check whose report leaves out whether repeat 2\'s caches were flushed records that repeat as not flushed, never cold or flushed, and the others as flushed', async () => {
    readFromReport(await timingRun('silent'), 'silent');
  }, 180_000);

  it('AC19 the record comes from the report file, never from printed output: the silent repeat printing "repeat 2: caches flushed" changes nothing', async () => {
    const r = await timingRun('printed');
    expect(outputOf(r)).toMatch(/repeat 2: caches flushed/);
    readFromReport(r, 'printed');
  }, 180_000);

  it('AC19 (wrong program) a runner that takes a silent repeat as flushed fails this test, naming repeat 2', async () => {
    const wrong = silentRepeatAsFlushed(await timingRun('silent'));
    expect(() => readFromReport(wrong, 'silent')).toThrow(/repeat 2/);
  }, 180_000);

  it('AC19 (wrong program) a runner that reads whether a repeat flushed from the test\'s printed output fails this test, naming repeat 2', async () => {
    const wrong = flushedFromPrintedOutput(await timingRun('printed'));
    expect(() => readFromReport(wrong, 'printed')).toThrow(/repeat 2/);
  }, 180_000);
});
