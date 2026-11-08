// #1426 table redraft, a lanes table for the lane judge: the lint lane runs check only on a change to the script.
export const checks = [{ name: 'lint', paths: ['scripts/**'], commands: [[process.execPath, 'scripts/vendor-rebase.mjs', 'check']], fix: 'Give each file a row.' }];
