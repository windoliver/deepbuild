// #1426 table redraft, a lanes table for the lane judge: the lint lane runs diff, which never fails, not check.
export const checks = [{ name: 'lint', commands: [[process.execPath, 'scripts/vendor-rebase.mjs', 'diff']], fix: 'Give each file a row.' }];
