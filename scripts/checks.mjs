import { runLanes } from './preflight.mjs';

process.exitCode = runLanes([
  { name: 'typecheck', commands: [[process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit'], ['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
  { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check'], [process.execPath, '-e', `
    const fs = require('node:fs');
    if (fs.existsSync('.github/workflows') && fs.readdirSync('.github/workflows').length)
      throw Error('GitHub workflows are forbidden.');
  `]], fix: 'Format Rust with cargo fmt and remove any .github/workflows entries.' },
  { name: 'unit', commands: [
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run'],
    ['cargo', 'test', '--workspace', '--locked'],
    [process.execPath, '--test', 'tests/preflight.test.mjs', 'tests/benchmark.test.mjs'],
  ], fix: 'Repair the behavior named by the failing test.' },
  { name: 'parity quick', commands: [[process.execPath, 'scripts/parity.mjs']], fix: 'Repair the CLI behavior or cross-binary help/version mismatch.' },
]);
