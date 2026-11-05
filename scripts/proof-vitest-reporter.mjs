// A vitest reporter for the proof lanes (#569): one JSON line per finished test, as the node reporter
// writes them, to the file DEEP_PROOF_VITEST_REPORT names. Unlike vitest's JSON report, it keeps the
// cause a failure wraps, such as the assertion a fast-check property failed on.
import { closeSync, openSync, writeSync } from 'node:fs';
import { innermost, thrown } from './proof-reporter.mjs';

export default class {
  // A full disk cuts a write short at a block and refuses the rest, so what didn't land waits here and goes first
  // in the next write: a record finishes where it stopped, and the next never runs on from part of it.
  unwritten = Buffer.alloc(0);

  write(text) {
    this.unwritten = Buffer.concat([this.unwritten, Buffer.from(text)]);
    let fd;
    try {
      fd = openSync(process.env.DEEP_PROOF_VITEST_REPORT, 'a');
      while (this.unwritten.length) this.unwritten = this.unwritten.subarray(writeSync(fd, this.unwritten));
    } catch {} finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  onTestCaseResult(test) {
    const names = [];
    for (let task = test; task && task.type !== 'module'; task = task.parent) names.unshift(task.name);
    const { state, errors } = test.result();
    const error = errors?.[0] && innermost(errors[0]);
    this.write(`${JSON.stringify({
      type: { passed: 'pass', failed: 'fail' }[state] ?? 'skip', file: test.module.moduleId, name: names.join(' › '),
      error: error && { name: error.name, code: error.code, message: String(error.message ?? ''), stack: String(error.stack ?? ''), thrown: thrown(error) },
    })}\n`);
  }

  // An error no test caught, such as an unhandled rejection, fails the run outside every test. The end record lands
  // only after everything before it, so a report without one may be missing a result.
  onTestRunEnd(modules, unhandled) {
    for (const error of unhandled ?? []) this.write(`${JSON.stringify({ type: 'unhandled', message: `${error?.name ?? 'Error'}: ${error?.message ?? error}` })}\n`);
    this.write(`${JSON.stringify({ type: 'end' })}\n`);
    if (this.unwritten.length) throw new Error(`${process.env.DEEP_PROOF_VITEST_REPORT} lost ${this.unwritten.length} bytes of results it couldn't write`);
  }
}
