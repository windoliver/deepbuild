import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export const checks = [
  { name: 'typecheck', commands: [[process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit'], ['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
  { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check'], [process.execPath, '-e', `
    const fs = require('node:fs');
    if (fs.existsSync('.github/workflows') && fs.readdirSync('.github/workflows').length)
      throw Error('GitHub workflows are forbidden.');
  `]], fix: 'Format Rust with cargo fmt and remove any .github/workflows entries.' },
  { name: 'unit', commands: [
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run'],
    ['cargo', 'test', '--workspace', '--locked'],
    [process.execPath, '--test', 'tests/*.test.mjs'],
  ], fix: 'Repair the behavior named by the failing test.' },
  // Build first, so a broken build fails this lane instead of comparing a stale binary.
  { name: 'parity quick', commands: [['cargo', 'build', '--workspace', '--locked'], [process.execPath, 'scripts/parity.mjs']], fix: 'Repair the Rust build, the CLI behavior or the cross-binary help/version mismatch.' },
];

export function runLanes(lanes, { cwd = root } = {}) {
  const failures = [];
  for (const lane of lanes) {
    const started = performance.now();
    console.log(`RUN ${lane.name}`);
    let failure = lane.commands.length ? undefined : { state: 'BLOCKED', error: 'No check was run' };
    for (const [command, ...args] of lane.commands) {
      let directory, descriptor, result, output = '';
      try {
        directory = mkdtempSync(join(tmpdir(), 'deep-preflight-output-'));
        const log = join(directory, 'output');
        descriptor = openSync(log, 'w', 0o600);
        // One shared descriptor preserves the child's stdout/stderr write order.
        result = spawnSync(command, args, { cwd, stdio: ['ignore', descriptor, descriptor] });
        output = readFileSync(log, 'utf8').trim();
      } catch (error) {
        result = { status: null, error };
      } finally {
        try {
          if (descriptor !== undefined) closeSync(descriptor);
          if (directory) rmSync(directory, { recursive: true, force: true });
        } catch (error) {
          result = { status: null, error };
        }
      }
      if (output) console.log(output);
      if (result.status !== 0 && !failure) {
        const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
        failure = {
          state: result.error ? 'BLOCKED' : 'FAIL',
          error: result.error?.message
            ?? lines.find((line) => /\b(?:[a-z]*error(?:\[[^\]]+\])?|fatal):|\berror TS\d+:|panicked at/i.test(line))
            ?? lines.find((line) => /\berror\b|AssertionError|panicked|\bFAIL\b|\bBLOCKED\b|\bINVALID\b/i.test(line))
            ?? lines[0] ?? `${command} exited ${result.signal ?? result.status}`,
        };
      }
    }
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    if (failure) failures.push(`${failure.state} ${lane.name}: ${failure.error}\n  Fix: ${lane.fix}\n  Elapsed: ${elapsed} s`);
    else console.log(`PASS ${lane.name} (${elapsed} s)`);
  }
  for (const failure of failures) console.log(failure);
  return failures.length ? 1 : 0;
}
