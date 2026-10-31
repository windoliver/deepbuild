// #882 AC2, wrong lane table: the lint lane points the guard at a fixture, not the checkout.
export const checks = [
  { name: 'lint', commands: [[process.execPath, 'tests/acceptance/882/wrong/lint-control.mjs', '--root', 'tests/acceptance/882/fixtures/app']], fix: 'Fix it.' },
];
