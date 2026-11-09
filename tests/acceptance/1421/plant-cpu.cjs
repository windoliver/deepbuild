// Preload for a perf run (node -r): plants the CPU line of the first /usr/bin/time report perf makes
// itself, which in these fixtures is the merge base's check run (the checkout's own run is the
// observation passed in, and no fixture adds tests of its own). PLANT_CPU=zero makes that report's CPU
// line read exactly `cpu_s=0.00 0.00`, as GNU time prints a start under its 10 ms resolution;
// PLANT_CPU=drop removes the line, as a report with no CPU reading; any other value leaves the report
// as measured. PLANT_MARK records what was
// planted, so a test can tell its plant landed.
const childProcess = require('node:child_process');
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');

const mode = process.env.PLANT_CPU;
const mark = process.env.PLANT_MARK;
const checkout = fs.realpathSync(process.cwd());
let planted = false;
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = function (file, args, options) {
  const result = spawnSync.call(this, file, args, options);
  const output = Array.isArray(args) ? args.indexOf('-o') : -1;
  const cwd = options?.cwd ? fs.realpathSync(String(options.cwd)) : checkout;
  if (planted || file !== '/usr/bin/time' || output < 0 || cwd === checkout) return result;
  planted = true;
  const report = args[output + 1];
  const before = fs.readFileSync(report, 'utf8');
  const after = mode === 'zero' ? before.replace(/^cpu_s=.*$/m, 'cpu_s=0.00 0.00') : mode === 'drop' ? before.replace(/^cpu_s=.*\n?/m, '') : before;
  fs.writeFileSync(report, after);
  if (mark) fs.writeFileSync(mark, JSON.stringify({ mode, cwd, before, after }));
  return result;
};
syncBuiltinESMExports();
