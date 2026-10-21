import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// The repo's declared test paths. The unit lane's runners take their file patterns from them, and perf
// sets the test files a change adds or modifies apart by them.
export const testPaths = ['tests/**', 'packages/**/test/**', 'packages/**/*.test.ts', 'crates/*/tests/**'];
/** A runner's file patterns: each declared path narrowed to that runner's test files. Cargo finds its own. */
export const testGlobs = (extension) => testPaths
  .map((path) => (path.endsWith('/**') ? `${path}/*.test.${extension}` : path))
  .filter((glob) => glob.endsWith(`.test.${extension}`) && !glob.startsWith('crates/'));

export const checks = [
  { name: 'typecheck', commands: [[process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit'], ['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
  { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check'], [process.execPath, 'scripts/repo-rules.mjs'], ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], [process.execPath, 'scripts/canvas-lint.mjs'], [process.execPath, 'scripts/conformance-lint.mjs']], fix: 'Format Rust with cargo fmt, follow the Fix line under each repo rule above, fix the clippy warnings, follow the Fix line under each canvas-lint finding, or repair the enum closure, code mapping, rule fake or planted code each conformance-lint FAIL line names.' },
  { name: 'unit', commands: [
    // The canvas acceptance files each build the deep-canvas binary before spawning it, and cargo
    // clones the binary into target/debug anew on every build, fresh or not, so a file spawning it
    // while a sibling file builds finds it gone or half-written: those files run one at a time, after
    // every other file has run in parallel.
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--exclude', 'tests/acceptance/389/**'],
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', 'tests/acceptance/389/'],
    ['cargo', 'test', '--workspace', '--locked'],
    // Node's acceptance suites under tests/acceptance/ run by hand, as their READMEs say: #48's live
    // tests spend plan usage, and #246's check that change against its own base.
    [process.execPath, '--test', 'tests/*.test.mjs', ...testGlobs('mjs').filter((glob) => !glob.startsWith('tests/'))],
  ], fix: 'Repair the behavior named by the failing test.' },
  // The event catalogue holds every kind the design docs and the open issues name (#605). It reads the
  // contracts package the typecheck lane builds.
  { name: 'catalogue drift', commands: [[process.execPath, 'scripts/catalogue-drift.mjs']], fix: 'Add each kind named above to the catalogue with its schema, or write the name so it does not read as an event kind; offline, run again with network and gh signed in.' },
  // The fixture corpus (#47): every covered agent version has a recorded set holding each event its
  // facts list, each set replays clean through its adapter, and the corpus stays under 200 MB.
  { name: 'corpus', commands: [[process.execPath, 'scripts/corpus.mjs', 'check']], fix: 'Follow the Fix line under each corpus failure above.' },
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
        const error = result.error?.message
          ?? lines.find((line) => /\b(?:[a-z]*error(?:\[[^\]]+\])?|fatal):|\berror TS\d+:|panicked at/i.test(line))
          ?? lines.find((line) => /\berror\b|AssertionError|panicked|\bFAIL\b|\bBLOCKED\b|\bINVALID\b|\bINCONCLUSIVE\b/i.test(line))
          ?? lines[0] ?? `${command} exited ${result.signal ?? result.status}`;
        // A diagnostic that names its own state keeps it: a check that couldn't run reads BLOCKED, not
        // FAIL, and one that couldn't read all it checks reads INCONCLUSIVE.
        const [, state, rest] = error.match(/^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)\s+(.+)/) ?? [];
        failure = { state: result.error ? 'BLOCKED' : state ?? 'FAIL', error: rest ?? error };
      }
    }
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    if (failure) failures.push(`${failure.state} ${lane.name}: ${failure.error}\n  Fix: ${lane.fix}\n  Elapsed: ${elapsed} s`);
    else console.log(`PASS ${lane.name} (${elapsed} s)`);
  }
  for (const failure of failures) console.log(failure);
  return failures.length ? 1 : 0;
}
