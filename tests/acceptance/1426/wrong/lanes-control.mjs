// #1426, the control: the lint lane runs check.
export const checks = [{ name: 'lint', commands: [[process.execPath, 'tests/acceptance/1426/wrong/check-control.mjs', 'check']], fix: 'x' }];
