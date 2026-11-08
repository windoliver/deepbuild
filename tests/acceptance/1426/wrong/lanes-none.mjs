// #1426, wrong lanes: the lint lane runs something else.
export const checks = [{ name: 'lint', commands: [[process.execPath, 'scripts/repo-rules.mjs']], fix: 'x' }];
