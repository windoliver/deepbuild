// A vitest reporter for the proof lanes (#569): one JSON line per finished test, as the node reporter
// writes them, to the file DEEP_PROOF_VITEST_REPORT names. Unlike vitest's JSON report, it keeps the
// cause a failure wraps, such as the assertion a fast-check property failed on, and each skip's note.
import { closeSync, openSync, writeSync } from 'node:fs';
import { innermost, thrown } from './proof-reporter.mjs';

const nameOf = (task) => {
  const names = [];
  for (let at = task; at && at.type !== 'module'; at = at.parent) names.unshift(at.name);
  return names.join(' › ');
};
const shown = (cause) => {
  const error = cause && innermost(cause);
  return error && { name: error.name, code: error.code, message: String(error.message ?? ''), stack: String(error.stack ?? ''), thrown: thrown(error) };
};

export default class {
  // A full disk cuts a write short at a block and refuses the rest, so what didn't land waits here and goes first
  // in the next write: a record finishes where it stopped, and the next never runs on from part of it.
  unwritten = Buffer.alloc(0);

  write(row) {
    this.unwritten = Buffer.concat([this.unwritten, Buffer.from(`${JSON.stringify(row)}\n`)]);
    let fd;
    try {
      fd = openSync(process.env.DEEP_PROOF_VITEST_REPORT, 'a');
      while (this.unwritten.length) this.unwritten = this.unwritten.subarray(writeSync(fd, this.unwritten));
    } catch {} finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  onTestCaseResult(test) {
    const { state, errors, note } = test.result();
    this.write({ type: { passed: 'pass', failed: 'fail' }[state] ?? 'skip', file: test.module.moduleId, name: nameOf(test), note, error: shown(errors?.[0]) });
  }

  // A file that failed on its imports, or a suite on a hook, fails outside its tests, whose rows read only as skipped.
  // An error no test caught, such as an unhandled rejection, fails the run outside every test. The end record lands
  // only after everything before it, so a report without one may be missing a result.
  onTestRunEnd(modules, unhandled) {
    for (const module of modules ?? []) for (const source of [module, ...module.children.allSuites()]) for (const error of source.errors()) this.write({ type: 'fail', file: module.moduleId, name: nameOf(source) || '(file)', error: shown(error) });
    for (const error of unhandled ?? []) this.write({ type: 'unhandled', message: `${error?.name ?? 'Error'}: ${error?.message ?? error}` });
    this.write({ type: 'end' });
    if (this.unwritten.length) throw new Error(`${process.env.DEEP_PROOF_VITEST_REPORT} lost ${this.unwritten.length} bytes of results it couldn't write`);
  }
}
