// A vitest reporter for the proof lanes (#569): one JSON line per finished test, as the node reporter
// writes them, to the file DEEP_PROOF_VITEST_REPORT names. Unlike vitest's JSON report, it keeps the
// cause a failure wraps, such as the assertion a fast-check property failed on.
import { appendFileSync } from 'node:fs';
import { innermost, thrown } from './proof-reporter.mjs';

export default class {
  onTestCaseResult(test) {
    const names = [];
    for (let task = test; task && task.type !== 'module'; task = task.parent) names.unshift(task.name);
    const { state, errors } = test.result();
    const error = errors?.[0] && innermost(errors[0]);
    appendFileSync(process.env.DEEP_PROOF_VITEST_REPORT, `${JSON.stringify({
      type: { passed: 'pass', failed: 'fail' }[state] ?? 'skip', file: test.module.moduleId, name: names.join(' › '),
      error: error && { name: error.name, code: error.code, message: String(error.message ?? ''), stack: String(error.stack ?? ''), thrown: thrown(error) },
    })}\n`);
  }

  // An error no test caught, such as an unhandled rejection, fails the run outside every test.
  onTestRunEnd(modules, unhandled) {
    for (const error of unhandled ?? []) appendFileSync(process.env.DEEP_PROOF_VITEST_REPORT, `${JSON.stringify({ type: 'unhandled', message: `${error?.name ?? 'Error'}: ${error?.message ?? error}` })}\n`);
  }
}
