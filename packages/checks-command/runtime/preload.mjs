// Loaded into every Node process of a command check's run through NODE_OPTIONS, before check.kind@1's read tracer
// (#314). In Vitest's or Jest's own process it asks the tool for the runner's report, by adding the runner's reporter to its
// command line, however the command reached Vitest (directly, or through a package script), and hands the reporter
// its file outside the environment, which then drops it: no worker, no test and no Vitest a test starts learns where
// the report is from its environment. When the runner asks for it, it moves the process's clock ahead, as a test the
// claim adds runs once with the clock a month ahead.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let entry = '';
try {
  entry = realpathSync(process.argv[1] ?? '');
} catch { /* no script: node -e, or a REPL */ }
const report = process.env.DEEP_CHECK_REPORT;
const reporter = (name) => fileURLToPath(new URL(name, import.meta.url));
// Each tool's own process, by its entry script: the runner's reporter joins the tool's default one. Each transforms
// afresh: a cache in the checkout, which only a checksum of its own guards, would run code no source holds.
const tool = entry.endsWith('/vitest/vitest.mjs') ? ['--no-fsModuleCache', '--reporter=default', `--reporter=${reporter('vitest-reporter.mjs')}`]
  : /\/jest(-cli)?\/bin\/jest\.js$/.test(entry) ? ['--watchman=false', '--no-cache', '--reporters=default', `--reporters=${reporter('jest-reporter.mjs')}`] : null;
if (report && tool) {
  globalThis[Symbol.for('deepbuild.check.report')] = report;
  delete process.env.DEEP_CHECK_REPORT;
  process.argv.push(...tool);
}

const shift = Number(process.env.DEEP_CHECK_CLOCK_MS ?? 0);
if (shift) {
  const Real = Date;
  // Called without `new`, Date gives the time as text, as the real one does; constructed, a Date of the moved clock.
  function Shifted(...args) {
    if (!new.target) return new Real(Real.now() + shift).toString();
    return Reflect.construct(Real, args.length ? args : [Real.now() + shift], new.target);
  }
  Object.setPrototypeOf(Shifted, Real);
  Shifted.prototype = Real.prototype;
  Shifted.now = () => Real.now() + shift;
  globalThis.Date = Shifted;
}
