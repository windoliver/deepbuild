// #1426 added, a lanes table for the lane judge: the lint lane runs check, the control.
export const checks = [{ name: 'lint', commands: [[process.execPath, 'scripts/vendor-rebase.mjs', 'check']], fix: 'Give each file a row.' }];
