// The command check kind's Jest reporter (#30): one JSON line per test that ran and per file that failed to run, in
// the format of the runner's Vitest reporter (vitest-reporter.mjs), written to the file the runner names, so testsRun,
// each attempt and each failure's place and kind come from Jest's own results, never from its printed output. It ends
// with a trailer counting its lines.
import { openSync, writeSync } from 'node:fs';

// The runner's preload hands over the file's name; the run's environment never holds it.
let fd = null;
try {
  const report = globalThis[Symbol.for('deepbuild.check.report')];
  if (typeof report === 'string') fd = openSync(report, 'a');
} catch { /* the runner's file; no report is no count */ }
let lines = 0;
let closed = false;
const write = (line) => {
  if (fd === null || closed) return;
  try {
    writeSync(fd, `${JSON.stringify(line)}\n`);
    lines += 1;
  } catch { /* the runner's file; a failed write loses one line */ }
};
const close = () => {
  if (fd === null || closed) return;
  closed = true;
  try {
    writeSync(fd, `${JSON.stringify({ deep: 'end', lines })}\n`);
  } catch { /* the runner's file */ }
};
process.on('exit', close);

/** A failure as the report carries it: an `expect` failure (it carries its matcher's result) is Jest's own assertion. */
const errorOf = (e, text) => ({
  name: e?.matcherResult ? 'JestAssertionError' : (typeof e?.name === 'string' ? e.name : null),
  message: String(e?.message ?? text ?? e),
  stack: typeof e?.stack === 'string' ? e.stack : (text ?? null),
  frames: [],
});

export default class DeepCheckJestReporter {
  constructor(globalConfig) {
    this.update = globalConfig?.updateSnapshot;
    this.filter = globalConfig?.testNamePattern;
  }


  // The runner's preload moves the clock of the processes it loads into; Jest runs each test file in a context with
  // a Date of its own, so a run whose clock should be ahead can't pass.
  onRunStart() {
    // A run that writes snapshots takes its expected values from what the program gives: it can't pass.
    if (this.update && this.update !== 'none') {
      write({ type: 'run:error', file: null, errors: [{ name: 'Error', message: `snapshots are written, not compared (updateSnapshot ${this.update})`, stack: null, frames: [] }] });
    }
    // A name filter leaves tests of a file out while the file still runs: the runner keeps it only when the check's command names it.
    if (this.filter) write({ type: 'run:error', file: null, filter: String(this.filter), errors: [{ name: 'Error', message: `tests left out by name (${this.filter}) that the check's command doesn't name`, stack: null, frames: [] }] });
    if (Number(process.env.DEEP_CHECK_CLOCK_MS ?? 0)) {
      write({ type: 'run:error', file: null, errors: [{ name: 'Error', message: 'the clock wasn\'t moved ahead: Jest runs tests with a clock of their own', stack: null, frames: [] }] });
    }
  }

  onTestResult(_test, result) {
    // Each file that ran, so the runner can list its tests from its source and find any that never ran.
    write({ type: 'file:ran', tool: 'jest', file: result.testFilePath, errors: [] });
    if (result.testExecError) write({ type: 'file:fail', file: result.testFilePath, errors: [errorOf(result.testExecError)] });
    for (const t of result.testResults ?? []) {
      // A skipped, pending or todo test didn't run.
      if (t.status !== 'passed' && t.status !== 'failed') continue;
      const errors = (t.failureMessages ?? []).map((text, i) => errorOf(t.failureDetails?.[i], text));
      // Each retry is an attempt: a test that passed on its retry failed every attempt before it.
      write({ type: t.status === 'passed' ? 'test:pass' : 'test:fail', name: t.fullName, file: result.testFilePath, retries: Math.max(0, (t.invocations ?? 1) - 1), errors });
    }
  }

  onRunComplete() {
    close();
  }
}
