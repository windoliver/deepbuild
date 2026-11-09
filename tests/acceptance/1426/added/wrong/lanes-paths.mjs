// #1426 added, a lanes table for the lane judge: the lint lane runs check only on a change to the gpui trees.
export const checks = [{ name: 'lint', paths: ['vendor/gpui-pre/**', 'vendor/gpui-pre-apple/**'], commands: [[process.execPath, 'scripts/vendor-rebase.mjs', 'check']], fix: 'Give each file a row.' }];
