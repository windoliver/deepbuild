// #882 AC2, wrong lane table: the guard runs only at release.
export const checks = [
  { name: 'lint', commands: [[process.execPath, 'scripts/repo-rules.mjs']], fix: 'Fix it.' },
];
export const releaseLanes = [
  { name: 'lint', commands: [[process.execPath, 'tests/acceptance/882/wrong/lint-control.mjs']], fix: 'Fix it.' },
];
