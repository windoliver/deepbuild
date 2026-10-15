import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measureOnce } from './benchmark.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function runLanes(lanes, { cwd = root, write = console.log } = {}) {
  const failures = [];
  for (const lane of lanes) {
    const started = performance.now();
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
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    if (failure) failures.push(`${failure.state} ${lane.name}: ${failure.error}\n  Fix: ${lane.fix}\n  Elapsed: ${elapsed} s`);
    else write(`PASS ${lane.name} (${elapsed} s)`);
  }
  for (const failure of failures) write(failure);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = performance.now();
  let observation = {}, checkStatus = 1;
  try {
    const { elapsedMs, peakBytes, status, output } = measureOnce([process.execPath, 'scripts/checks.mjs'], root);
    if (output) console.log(output.trimEnd());
    observation = { elapsedMs, peakBytes, status };
    checkStatus = status === 0 ? 0 : 1;
  } catch (error) {
    console.log(`BLOCKED check workload: ${error.message}\n  Fix: Restore the check runner and native time/RSS measurement.`);
  }
  const perfStatus = runLanes([
    { name: 'perf', commands: [[process.execPath, 'scripts/perf.mjs', JSON.stringify(observation)]], fix: 'Restore the regressed budget; a first measurement adjustment needs its recorded reason.' },
  ]);
  process.exitCode = checkStatus || perfStatus;
  const elapsed = performance.now() - started;
  console.log(`Preflight elapsed: ${(elapsed / 1000).toFixed(2)} s (budget: <300 s)`);
  if (elapsed >= 300_000) {
    console.log('FAIL preflight budget: elapsed time reached 300 seconds\n  Fix: Reduce local check time below the issue #12 five-minute budget.');
    process.exitCode = 1;
  }
}
