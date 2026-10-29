// #326 AC4, wrong lane table: the lane points the guard at a folder that isn't the checkout.
export const checks = [
  { name: 'lint', commands: [[process.execPath, 'tests/acceptance/326/panels/wrong/control.mjs', '--root', 'tests/acceptance/326/panels/fixtures']], fix: 'Fix it.' },
];
