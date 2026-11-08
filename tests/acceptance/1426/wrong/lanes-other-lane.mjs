// #1426, wrong lanes: check runs in another lane.
export const checks = [{ name: 'unit', commands: [[process.execPath, 'tests/acceptance/1426/wrong/check-control.mjs', 'check']], fix: 'x' }];
checks.push({ name: 'lint', commands: [], fix: 'x' });
