// #1556's wrong programs and controls (README: Wrong programs). They carry no criterion tag and pass at the base on
// purpose: each wrong program must fail its judge with its own message, and each control must pass the same judge, so
// a failure on the real replica or the real lint lane is the program's, not the test's. Runs on macOS and Linux.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  cleanup, clickSetUp, judgeFailing, judgeLint, judgeSlow, lintCommands, makeHome, narrowed, NODE, plant, plantIsFormatted, PLANT_FILE, runLint, scratchCopy, TWINS,
  type LintRun,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const rejects = async (judged: Promise<void> | (() => void), message: RegExp) => {
  let error: unknown;
  try { await (typeof judged === 'function' ? judged() : judged); } catch (e) { error = e; }
  expect(error, 'the judge must reject this wrong program').toBeDefined();
  expect(String((error as Error).message)).toMatch(message);
};

describe('#1556 (wrong programs and controls) the click\'s judges', () => {
  it('#1556 (control right) setup off the UI thread passes both judges', async () => {
    judgeSlow(await clickSetUp(makeHome('slow'), { twin: 'right' }));
    judgeFailing(await clickSetUp(makeHome('failing'), { twin: 'right' }));
  }, 60_000);

  it('#1556 (wrong program blocking) the base\'s logic, which draws none for 3 s, fails naming the frame within 100 ms', async () => {
    const c = await clickSetUp(makeHome('slow'), { twin: 'blocking' });
    expect(c.frames[0]!.ms).toBeGreaterThanOrEqual(2900);
    await rejects(async () => judgeSlow(c), /must draw a frame within 100 ms of the click; its first frame after the click came at \d{4,} ms/);
  }, 60_000);

  it('#1556 (wrong program late) a first frame at 150 ms fails', async () => {
    await rejects(async () => judgeSlow(await clickSetUp(makeHome('slow'), { twin: 'late' })), /must draw a frame within 100 ms of the click/);
  }, 60_000);

  it('#1556 (wrong program no-working) frames on time that don\'t show it\'s working fail', async () => {
    await rejects(async () => judgeSlow(await clickSetUp(makeHome('slow'), { twin: 'no-working' })), /must show it's working/);
  }, 60_000);

  it('#1556 (wrong program draws-then-blocks) one working frame, then the UI thread held, fails', async () => {
    await rejects(async () => judgeSlow(await clickSetUp(makeHome('slow'), { twin: 'draws-then-blocks' })), /drew no frame from \d+ ms to \d{4,} ms after the click while setup ran/);
  }, 60_000);

  it('#1556 (wrong program early-line) the one line before setup ends fails', async () => {
    await rejects(async () => judgeSlow(await clickSetUp(makeHome('slow'), { twin: 'early-line' })), /must show it's working|before the planted deep setup \(3 s\) could have ended/);
  }, 60_000);

  it('#1556 (wrong program drops-error) a failing setup shown without its error line fails', async () => {
    await rejects(async () => judgeFailing(await clickSetUp(makeHome('failing'), { twin: 'drops-error' })), /must still show its one-line error/);
  }, 60_000);

  it('#1556 (wrong program error-two-lines) the error over two lines fails', async () => {
    await rejects(async () => judgeFailing(await clickSetUp(makeHome('failing'), { twin: 'error-two-lines' })), /must show its error in one line/);
  }, 60_000);

  it('#1556 (wrong program blocking) a failing setup shown by the base\'s logic still passes the error judge: criterion 2 is the error, not the timing', async () => {
    judgeFailing(await clickSetUp(makeHome('failing'), { twin: 'blocking' }));
  }, 60_000);
});

describe('#1556 (wrong programs and controls) the lint\'s judge', () => {
  const at = (command: string, code: number | null, output: string): LintRun => ({ command: command.split(' '), code, output });
  const LINE = 1120;

  it('#1556 (control) a clippy-style failure naming the file and line passes; a format check naming it does not count', () => {
    judgeLint([at('cargo clippy -p deep-app', 101, `error: use of a disallowed method \`std::process::Command::output\`\n    --> ${PLANT_FILE}:${LINE}:5\n`)], PLANT_FILE, LINE);
    judgeLint([at('node scripts/repo-rules.mjs', 1, `FAIL blocking-call: /tmp/da1556-x/repo/${PLANT_FILE}:${LINE} runs a process on the UI thread`)], PLANT_FILE, LINE);
    expect(() => judgeLint([at('cargo fmt --all -- --check', 1, `Diff in ${PLANT_FILE}:${LINE}:`)], PLANT_FILE, LINE)).toThrow(/must fail the lint lane, naming the line/);
  });

  it('#1556 (wrong programs) a lane that names another line, the file only, or passes, fails; a plant that doesn\'t compile is INVALID', () => {
    expect(() => judgeLint([at('cargo clippy', 101, `--> ${PLANT_FILE}:${LINE + 1}:5`)], PLANT_FILE, LINE)).toThrow(/naming the line/);
    expect(() => judgeLint([at('cargo clippy', 101, `--> ${PLANT_FILE}:${LINE}0:5`)], PLANT_FILE, LINE)).toThrow(/naming the line/);
    expect(() => judgeLint([at('cargo clippy', 101, `error in ${PLANT_FILE}`)], PLANT_FILE, LINE)).toThrow(/naming the line/);
    expect(() => judgeLint([at('cargo clippy', 0, `warning: disallowed method\n --> ${PLANT_FILE}:${LINE}:5`)], PLANT_FILE, LINE)).toThrow(/naming the line/);
    expect(() => judgeLint([at('cargo clippy', 101, `error[E0425]: cannot find function\n --> ${PLANT_FILE}:${LINE}:5`)], PLANT_FILE, LINE)).toThrow(/^INVALID/);
  });

  it('#1556 (control and wrong programs) planted lint commands over the planted scratch copy, through the same runner', async () => {
    const dest = scratchCopy();
    const line = plant(dest);
    plantIsFormatted(dest);
    const lint = (mode: string) => [[NODE, join(TWINS, 'grep-lint.mjs'), mode]];
    judgeLint(await runLint(dest, lint('right'), PLANT_FILE, line), PLANT_FILE, line);
    for (const mode of ['off-by-one', 'file-only', 'warns']) {
      await rejects(async () => judgeLint(await runLint(dest, lint(mode), PLANT_FILE, line), PLANT_FILE, line), /must fail the lint lane, naming the line/);
    }
  }, 300_000);

  it('#1556 (control clippy) a clippy setting banning Command::output, planted beside the plant, fails the lane\'s narrowed clippy naming the line', async () => {
    const dest = scratchCopy();
    const line = plant(dest);
    writeFileSync(join(dest, 'clippy.toml'), 'disallowed-methods = [{ path = "std::process::Command::output", reason = "blocks the UI thread (#1556 control)" }]\n');
    const clippy = narrowed(lintCommands(dest)).filter((c) => c[0] === 'cargo' && c[1] === 'clippy');
    expect(clippy.length, 'the lint lane runs clippy').toBe(1);
    judgeLint(await runLint(dest, clippy, PLANT_FILE, line), PLANT_FILE, line);
  }, 3_600_000);
});
