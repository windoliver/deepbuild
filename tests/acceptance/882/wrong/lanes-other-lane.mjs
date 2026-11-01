// #882 AC2, wrong lane table: the guard runs in a lane other than lint.
export const checks = [
  { name: 'lint', commands: [[process.execPath, 'scripts/repo-rules.mjs']], fix: 'Fix it.' },
  { name: 'colors', commands: [[process.execPath, 'tests/acceptance/882/wrong/lint-control.mjs']], fix: 'Fix it.' },
];
