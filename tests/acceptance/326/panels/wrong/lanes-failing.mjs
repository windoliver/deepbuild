// #326 AC4, wrong lane table: the lane runs a guard that fails the app as it stands (it flags the reader).
export const checks = [
  { name: 'lint', commands: [[process.execPath, 'tests/acceptance/326/panels/wrong/flags-reader.mjs']], fix: 'Fix it.' },
];
