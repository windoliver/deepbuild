// #882 AC2, the control: the lint lane runs the control guard.
export const checks = [
  { name: 'lint', commands: [[process.execPath, 'scripts/repo-rules.mjs'], [process.execPath, 'tests/acceptance/882/wrong/lint-control.mjs']], fix: 'Use the role named.' },
];
