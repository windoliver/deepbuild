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

/** Vitest files a lane of their own runs, so the unit lane leaves them out. */
const ownLane = ['tests/acceptance/684/lean.test.ts'];
/** Vitest files the unit lane runs one at a time, after the parallel block (see the lane). */
const alone = ['tests/acceptance/389/', 'tests/acceptance/390/', 'tests/acceptance/391/', 'tests/acceptance/392/', 'tests/acceptance/393/', 'tests/acceptance/394/', 'tests/acceptance/305/', 'tests/acceptance/387/', 'tests/acceptance/16/', 'tests/acceptance/373/', 'tests/acceptance/96/', 'tests/acceptance/374/', 'tests/acceptance/375/', 'tests/acceptance/670/',
  'tests/acceptance/236/', 'tests/acceptance/30/', 'tests/acceptance/14/budgets.test.ts', 'tests/acceptance/42/budgets.test.ts', 'tests/acceptance/62/budgets.test.ts', 'tests/acceptance/311/budgets.test.ts', 'tests/acceptance/28/budgets.test.ts',
  'tests/acceptance/319/budgets.test.ts'];

export const checks = [
  { name: 'typecheck', commands: [[process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit'], ['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
  { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check'], [process.execPath, 'scripts/repo-rules.mjs'], ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], [process.execPath, 'scripts/canvas-lint.mjs'], [process.execPath, 'scripts/conformance-lint.mjs']], fix: 'Format Rust with cargo fmt, follow the Fix line under each repo rule above, fix the clippy warnings, follow the Fix line under each canvas-lint finding, or repair the enum closure, code mapping, rule fake or planted code each conformance-lint FAIL line names.' },
  { name: 'unit', commands: [
    // The canvas, text and marks acceptance files each build a binary before spawning it, and cargo
    // clones the binary into target/debug anew on every build, fresh or not, so a file spawning it
    // while a sibling file builds finds it gone or half-written: those files run one at a time, after
    // every other file has run in parallel. The hub's files (#16) start real hubs and time their
    // sockets to 2 ms, so they too run one at a time, with nothing beside them. So does each file
    // that times an issue's frozen budget on the reference Mac (gated by environmentProblem()): #14's
    // 5,000 appends a second fell to 3,300-4,000/s beside the parallel block and passed alone. The
    // supervisor's files (#236) too: they read the system's one sandbox log stream.
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', ...[...alone, ...ownLane].flatMap((path) => ['--exclude', path.endsWith('.ts') ? path : `${path}**`])],
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...alone],
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
  // The verdict table in Lean (#684): the model's proofs and their axioms, then the engine against the model's
  // seeded claims and the rank-swap twins. Lean builds take a while, so the local preflight runs it only for a
  // change to the engine or the model; the release preflight always does.
  {
    name: 'verdict proofs', paths: ['packages/verdicts/src/**', 'packages/verdicts/model/**'],
    commands: [[process.execPath, 'scripts/verdict-proofs.mjs'], [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/684', 'lean.test.ts', '-t', 'AC3|AC4', '--silent=false']],
    fix: 'Repair the proof or build error each FAIL line names, keeping every theorem on Lean\'s standard axioms, or make the engine and packages/verdicts/model agree on the vector named; under BLOCKED, install the toolchain as its Fix line says.',
  },
];

/**
 * The paths a change touches: every path that differs between the merge base with origin/main and the working
 * tree, committed or not, and new files git doesn't ignore. Null when that can't be worked out.
 */
function changedPaths(cwd) {
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 28 });
  const base = git('merge-base', 'HEAD', 'origin/main');
  if (base.status !== 0) return null;
  const diff = git('diff', '--name-only', '-z', '--no-renames', base.stdout.trim());
  const untracked = git('ls-files', '-z', '--others', '--exclude-standard');
  if (diff.status !== 0 || untracked.status !== 0) return null;
  return [...diff.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean);
}
/** A lane's path: a folder ending in `/**` matches everything under it, anything else matches itself. */
const covers = (path, file) => (path.endsWith('/**') ? file.startsWith(path.slice(0, -2)) : file === path);

export function runLanes(lanes, { cwd = root } = {}) {
  const failures = [];
  // The release preflight runs every lane; the local one runs a lane with paths only for a change that touches them.
  const release = process.env.DEEP_PREFLIGHT === 'release';
  let changed;
  for (const lane of lanes) {
    if (lane.paths && !release) {
      changed ??= changedPaths(cwd);
      if (changed && !changed.some((file) => lane.paths.some((path) => covers(path, file)))) {
        console.log(`SKIP ${lane.name}: the change touches none of ${lane.paths.join(', ')}`);
        continue;
      }
    }
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
