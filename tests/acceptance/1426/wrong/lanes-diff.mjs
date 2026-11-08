// #1426, wrong lanes: the lint lane runs diff, which fails nothing.
export const checks = [{ name: 'lint', commands: [[process.execPath, 'tests/acceptance/1426/wrong/check-control.mjs', 'diff']], fix: 'x' }];
