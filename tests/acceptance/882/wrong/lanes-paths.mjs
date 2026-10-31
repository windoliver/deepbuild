// #882 AC2, wrong lane table: the lint lane's paths skip the app.
export const checks = [
  { name: 'lint', paths: ['docs/**'], commands: [[process.execPath, 'tests/acceptance/882/wrong/lint-control.mjs']], fix: 'Fix it.' },
];
