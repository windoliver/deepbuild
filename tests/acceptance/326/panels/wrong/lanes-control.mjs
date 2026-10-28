// #326 AC4, the control lane table: a lane of checks, run on every change, runs the control guard.
export const checks = [
  { name: 'lint', commands: [[process.execPath, 'tests/acceptance/326/panels/wrong/control.mjs']], fix: 'Fix it.' },
];
