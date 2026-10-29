// #326 AC4, wrong lane table: the lane runs only when the guard itself changes, so a change that plants a
// module in the app skips it.
export const checks = [
  { name: 'record reader', paths: ['tests/acceptance/326/panels/wrong/**'], commands: [[process.execPath, 'tests/acceptance/326/panels/wrong/control.mjs']], fix: 'Fix it.' },
];
