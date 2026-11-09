// #1426, wrong lanes: the lint lane runs a check that never fails.
export const checks = [{ name: 'lint', commands: [[process.execPath, 'tests/acceptance/1426/wrong/check-always-pass.mjs', 'check']], fix: 'x' }];
