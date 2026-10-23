// The command check kind's Vitest reporter (#30): one JSON line per test that ran, per file that failed to load and
// per error outside any test, written to the file the runner names, so testsRun, each attempt, each failure's place
// and kind, and a numeric contract's counts come from the tool's own report, never from its printed output. It ends
// with a trailer counting its lines, so the runner can tell a report the suite truncated.
import { openSync, writeSync } from 'node:fs';

// Opened once, appending: each line is written as its test ends, so a run stopped at its deadline keeps its count so far.
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

/** An error as the report carries it: its class, message and stack, and the frames Vitest parsed and source-mapped. */
const errorOf = (e) => ({
  name: typeof e?.name === 'string' ? e.name : null,
  message: String(e?.message ?? e),
  stack: typeof e?.stack === 'string' ? e.stack : null,
  frames: Array.isArray(e?.stacks) ? e.stacks.map((f) => ({ file: f.file, line: f.line })) : [],
});

export default class DeepCheckReporter {
  // The runner's preload moves the clock of the processes it loads into; a vm pool runs tests in a context of its
  // own, with a Date of its own, and browser mode runs them in a browser, so a run whose clock should be ahead can't pass there.
  onInit(vitest) {
    // A run that writes snapshots takes its expected values from what the program gives: it can't pass.
    const update = vitest?.config?.snapshotOptions?.updateSnapshot;
    if (update && update !== 'none') write({ type: 'run:error', file: null, errors: [{ name: 'Error', message: `snapshots are written, not compared (updateSnapshot ${update})`, stack: null, frames: [] }] });
    // A run that replays the blob reports of earlier runs runs nothing.
    const merged = vitest?.config?.mergeReports;
    if (merged) write({ type: 'run:error', file: null, errors: [{ name: 'Error', message: `results replayed from earlier runs, not run (mergeReports ${merged})`, stack: null, frames: [] }] });
    // Type tests are judged from tsc's incremental build info, which the checkout holds: errors it leaves out never show.
    const configs = [vitest?.config, ...(vitest?.projects ?? []).map((p) => p?.config)];
    if (configs.some((c) => c?.typecheck?.enabled)) write({ type: 'run:error', file: null, errors: [{ name: 'Error', message: 'type tests are judged from tsc\'s build info in the checkout (typecheck)', stack: null, frames: [] }] });
    // Vite's dependency optimizer reuses bundles from its cache in the checkout, checked only against the lockfile and
    // the config: code no source holds. A run that bundles afresh (optimizeDeps.force) may use it.
    const servers = [vitest?.vite, ...(vitest?.projects ?? []).map((p) => p?.vite)];
    const cached = servers.flatMap((s) => Object.entries(s?.environments ?? {})).find(([, e]) => e?.depsOptimizer && e.config?.optimizeDeps?.force !== true);
    if (cached) write({ type: 'run:error', file: null, errors: [{ name: 'Error', message: `dependencies bundled from Vite's cache (optimizeDeps of ${cached[0]})`, stack: null, frames: [] }] });
    if (!Number(process.env.DEEP_CHECK_CLOCK_MS ?? 0)) return;
    const vm = configs.some((c) => c?.browser?.enabled) ? 'browser' : configs.map((c) => c?.pool).find((p) => typeof p === 'string' && p.startsWith('vm'));
    if (vm) write({ type: 'run:error', file: null, errors: [{ name: 'Error', message: `the clock wasn't moved ahead: the ${vm} pool runs tests with a clock of its own`, stack: null, frames: [] }] });
  }

  onTestCaseResult(test) {
    const result = test.result();
    // A skipped or pending test didn't run.
    if (result.state !== 'passed' && result.state !== 'failed') return;
    write({
      type: result.state === 'passed' ? 'test:pass' : 'test:fail', name: test.fullName, file: test.module.moduleId,
      // Each retry is an attempt: a test that passed on its retry failed every attempt before it.
      retries: test.diagnostic()?.retryCount ?? 0, errors: (result.errors ?? []).map(errorOf), meta: test.meta(),
    });
  }

  onTestRunEnd(modules, unhandled) {
    for (const m of modules ?? []) for (const e of m.errors?.() ?? []) write({ type: 'file:fail', file: m.moduleId, errors: [errorOf(e)] });
    for (const e of unhandled ?? []) write({ type: 'run:error', file: null, errors: [errorOf(e)] });
    close();
  }
}
