// #326 AC4, a second control lane table: the lane runs only for a change under crates/deep-app/, which
// still covers every module of the app's source.
export const checks = [
  { name: 'record reader', paths: ['crates/deep-app/**'], commands: [[process.execPath, 'tests/acceptance/326/panels/wrong/control.mjs']], fix: 'Fix it.' },
];
