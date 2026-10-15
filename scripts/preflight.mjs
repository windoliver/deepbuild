import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function runLanes(lanes, { cwd = root, write = console.log } = {}) {
  const failures = [];
  for (const lane of lanes) {
    write(`RUN ${lane.name}`);
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
      if (output) write(output);
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
    if (failure) failures.push(`${failure.state} ${lane.name}: ${failure.error}\n  Fix: ${lane.fix}`);
    else write(`PASS ${lane.name}`);
  }
  for (const failure of failures) write(failure);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = performance.now();
  process.exitCode = runLanes([
    { name: 'typecheck/build', commands: [['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
    { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check']], fix: 'Format the Rust source with cargo fmt.' },
    { name: 'unit', commands: [
      [process.execPath, 'node_modules/vitest/vitest.mjs', 'run'],
      ['cargo', 'test', '--workspace', '--locked'],
      [process.execPath, '--test', 'tests/preflight.test.mjs'],
    ], fix: 'Repair the behavior named by the failing test.' },
  ]);
  if (existsSync(join(root, '.github/workflows')) && readdirSync(join(root, '.github/workflows')).length) {
    console.error('FAIL lint: GitHub workflows are forbidden.\n  Fix: Remove .github/workflows entries.');
    process.exitCode = 1;
  }
  const elapsed = performance.now() - started;
  console.log(`Preflight elapsed: ${(elapsed / 1000).toFixed(2)} s (budget: <300 s)`);
  if (elapsed >= 300_000) {
    console.log('FAIL preflight budget: elapsed time reached 300 seconds\n  Fix: Reduce local check time below the issue #12 five-minute budget.');
    process.exitCode = 1;
  }
}
