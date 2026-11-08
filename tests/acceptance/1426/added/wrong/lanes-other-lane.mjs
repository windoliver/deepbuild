// #1426 added, a lanes table for the lane judge: check runs in a lane other than lint.
export const checks = [{ name: 'lint', commands: [[process.execPath, 'scripts/repo-rules.mjs']], fix: 'Follow the rules.' }, { name: 'vendor', commands: [[process.execPath, 'scripts/vendor-rebase.mjs', 'check']], fix: 'Give each file a row.' }];
