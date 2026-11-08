// #1426, wrong lanes: the lint lane skips a change to vendor/.
export const checks = [{ name: 'lint', commands: [[process.execPath, 'tests/acceptance/1426/wrong/check-control.mjs', 'check']], paths: ['crates/**'], fix: 'x' }];
