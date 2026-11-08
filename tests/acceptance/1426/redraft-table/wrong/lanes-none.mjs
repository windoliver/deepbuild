// #1426 table redraft, a lanes table for the lane judge: the base's shape, a lint lane that never runs check.
export const checks = [{ name: 'lint', commands: [[process.execPath, 'scripts/repo-rules.mjs']], fix: 'Follow the rule.' }, { name: 'vendor', commands: [[process.execPath, 'scripts/vendor-rebase.mjs', 'check']], fix: 'Give each file a row.' }];
