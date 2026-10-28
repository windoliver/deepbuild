// #326 AC4, wrong lane table: the guard runs only in the release preflight, so the local one never runs it.
export const checks = [
  { name: 'lint', commands: [[process.execPath, 'scripts/repo-rules.mjs']], fix: 'Fix it.' },
];
export const releaseLanes = [
  { name: 'record reader', commands: [[process.execPath, 'tests/acceptance/326/panels/wrong/control.mjs']], fix: 'Fix it.' },
];
