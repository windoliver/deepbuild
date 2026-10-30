import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inputs as configInputs } from './config-eval.mjs';
import { inputs as verdictInputs } from './verdict-proofs.mjs';

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
const alone = ['tests/acceptance/20/', 'tests/acceptance/356/', 'tests/acceptance/24/', 'tests/acceptance/26/', 'tests/acceptance/389/', 'tests/acceptance/390/', 'tests/acceptance/391/', 'tests/acceptance/392/', 'tests/acceptance/393/', 'tests/acceptance/394/', 'tests/acceptance/305/', 'tests/acceptance/387/', 'tests/acceptance/488/', 'tests/acceptance/388/', 'tests/acceptance/16/', 'tests/acceptance/373/', 'tests/acceptance/96/', 'tests/acceptance/374/', 'tests/acceptance/375/', 'tests/acceptance/670/', 'tests/acceptance/138/',
  'tests/acceptance/236/', 'tests/acceptance/30/', 'tests/acceptance/377/', 'tests/acceptance/378/', 'tests/acceptance/671/', 'tests/acceptance/381/', 'tests/acceptance/383/', 'tests/acceptance/384/', 'tests/acceptance/400/', 'tests/acceptance/401/', 'tests/acceptance/402/', 'tests/acceptance/327/', 'tests/acceptance/379/', 'tests/acceptance/777/', 'tests/acceptance/823/', 'tests/acceptance/14/budgets.test.ts', 'tests/acceptance/42/budgets.test.ts', 'tests/acceptance/62/budgets.test.ts', 'tests/acceptance/311/budgets.test.ts', 'tests/acceptance/28/budgets.test.ts',
  'tests/acceptance/319/budgets.test.ts', 'tests/acceptance/331/', 'tests/acceptance/315/', ...['replay', 'budgets', 'process-start'].map((f) => `tests/acceptance/21/${f}.test.ts`), 'tests/acceptance/348/', 'tests/acceptance/349/', 'tests/acceptance/351/', 'tests/acceptance/355/',
  'tests/acceptance/159/budgets.test.ts', 'tests/acceptance/761/budgets.test.ts', 'tests/acceptance/666/fast.test.ts', 'tests/acceptance/668/fast.test.ts', 'tests/acceptance/237/', 'tests/acceptance/34/', 'tests/acceptance/667/', 'tests/acceptance/380/', 'tests/acceptance/382/', 'tests/acceptance/371/', 'tests/acceptance/376/', 'tests/acceptance/306/', 'tests/acceptance/403/',
  'tests/acceptance/18/kit/', 'tests/acceptance/18/session/', 'tests/acceptance/18/binding/', ...['callers', 'failures', 'loops', 'mcp', 'prompts', 'record', 'replies'].map((f) => `tests/acceptance/18/mapping/${f}.test.ts`),
  ...['coexist', 'disable', 'install', 'stophold', 'tamper', 'waiter'].map((f) => `tests/acceptance/18/install/${f}.test.ts`), 'tests/acceptance/19/',
  'tests/acceptance/25/routes/', 'tests/acceptance/25/fallbacks/', 'tests/acceptance/25/live/budgets.test.ts', 'tests/acceptance/321/', 'tests/acceptance/303/', 'tests/acceptance/347/', 'tests/acceptance/340/',
  'tests/acceptance/29/hub.test.ts', 'tests/acceptance/29/slots.test.ts', 'tests/acceptance/29/budgets.test.ts',
  'tests/acceptance/23/permissions/', 'tests/acceptance/23/match/budgets.test.ts', 'tests/acceptance/83/', 'tests/acceptance/120/budgets.test.ts', 'tests/acceptance/120/budgets-idle-redraft.test.ts',
  ...['wake', 'repeat', 'waits', 'outcomes', 'budgets'].map((f) => `tests/acceptance/27/${f}.test.ts`), 'tests/acceptance/27/desktop-redraft/'];
/**
 * Vitest files run by hand, as their READMEs say: #685's proof checks need Lean 4.35 and Kani 0.68 installed, and
 * minutes; #666's and #668's live checkpoints and #18's live sessions start real Claude Code sessions on your plan, so
 * only the release preflight runs them (releaseLanes, below). #112's live eval replays 20 real tasks you export from
 * your archive, on your plan for up to two hours, so only you run it (tests/acceptance/112/README.md, The live run).
 * #27's first AC3 draft is kept as written but run by hand only: its step 3 is satisfied by step 1's wake (every ask
 * shares the option ID green), so its blind redraft, desktop-redraft/, is AC3's test (the owner's call on PR #816).
 */
const byHand = ['tests/acceptance/685/', 'tests/acceptance/666/session.live.test.ts', 'tests/acceptance/668/session.live.test.ts', 'tests/acceptance/18/mapping/record.live.test.ts', 'tests/acceptance/18/install/tamper.live.test.ts', 'tests/acceptance/21/sessions.live.test.ts',
  'tests/acceptance/25/live/routes.live.test.ts', 'tests/acceptance/25/live-redraft/ac2.live.test.ts', 'tests/acceptance/112/live.test.ts', 'tests/acceptance/27/session.live.test.ts', 'tests/acceptance/27/desktop.test.ts'];

export const checks = [
  { name: 'typecheck', commands: [[process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit'], ['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
  { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check'], [process.execPath, 'scripts/repo-rules.mjs'], ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], [process.execPath, 'scripts/canvas-lint.mjs'], [process.execPath, 'scripts/conformance-lint.mjs'], [process.execPath, 'scripts/slots-check.mjs'], [process.execPath, 'scripts/record-reader-guard.mjs'], [process.execPath, 'scripts/guide.mjs', '--check']], fix: 'Format Rust with cargo fmt, follow the Fix line under each repo rule above, fix the clippy warnings, follow the Fix line under each canvas-lint finding, or repair the enum closure, code mapping, rule fake or planted code each conformance-lint FAIL line names, declare the slot each slots-check FAIL line names with its interface, kit and planted fill, read the record through the one reader in crates/deep-app/src/record.rs from each module a record-reader FAIL line names, or regenerate the extension guide with node scripts/guide.mjs.' },
  { name: 'unit', commands: [
    // The canvas, text and marks acceptance files each build a binary before spawning it, and cargo
    // clones the binary into target/debug anew on every build, fresh or not, so a file spawning it
    // while a sibling file builds finds it gone or half-written: those files run one at a time, after
    // every other file has run in parallel. The hub's files (#16) start real hubs and time their
    // sockets to 2 ms, so they too run one at a time, with nothing beside them. So does each file
    // that times an issue's frozen budget on the reference Mac (gated by environmentProblem()): #14's
    // 5,000 appends a second fell to 3,300-4,000/s beside the parallel block and passed alone. The
    // supervisor's files (#236) too: they read the system's one sandbox log stream. And deep-hook's
    // files (#315), and #666's checkpoint through it: they build it and time it to 50 ms.
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', ...[...alone, ...ownLane, ...byHand].flatMap((path) => ['--exclude', path.endsWith('.ts') ? path : `${path}**`])],
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...alone],
    ['cargo', 'test', '--workspace', '--locked'],
    // Node's acceptance suites under tests/acceptance/ run by hand, as their READMEs say: #48's live
    // tests spend plan usage, and #246's check that change against its own base.
    [process.execPath, '--test', 'tests/*.test.mjs', ...testGlobs('mjs').filter((glob) => !glob.startsWith('tests/'))],
  ], fix: 'Repair the behavior named by the failing test.' },
  // The GPU layer's render logic on wgpu's noop backend, with no GPU (#377): slots and fences,
  // uploads that settle, a lost device's rebuild and submission in frame order.
  { name: 'noop', commands: [['cargo', 'test', '--locked', '-p', 'deep-gpu']], fix: 'Repair the render logic the failing noop test names.' },
  // The event catalogue holds every kind the design docs and the open issues name (#605). It reads the
  // contracts package the typecheck lane builds.
  { name: 'catalogue drift', commands: [[process.execPath, 'scripts/catalogue-drift.mjs']], fix: 'Add each kind named above to the catalogue with its schema, or write the name so it does not read as an event kind; offline, run again with network and gh signed in.' },
  // The fixture corpus (#47): every covered agent version has a recorded set holding each event its
  // facts list, each set replays clean through its adapter, and the corpus stays under 200 MB.
  { name: 'corpus', commands: [[process.execPath, 'scripts/corpus.mjs', 'check']], fix: 'Follow the Fix line under each corpus failure above.' },
  // The canvas conformance kit over the shipped canvas modules (#138): every part, headless on Vello CPU and
  // wgpu's noop backend, no GPU. It rewrites crates/deep-show/kit-ledger.json, which a release build seals by.
  { name: 'canvas kit', commands: [[process.execPath, 'scripts/canvas-kit.mjs']], fix: 'Repair the canvas module and part each line above names; run the kit call alone to replay a failing seed.' },
  // Build first, so a broken build fails this lane instead of comparing a stale binary.
  { name: 'parity quick', commands: [['cargo', 'build', '--workspace', '--locked'], [process.execPath, 'scripts/parity.mjs']], fix: 'Repair the Rust build, the CLI behavior or the cross-binary help/version mismatch.' },
  // The proof lanes (#569): the test guard, fails before on the merge base, the trace lane, and the
  // lifecycle enumerator, crash suite and verdict replay when the change touches their paths. The release
  // preflight adds the mutation lane and runs the lifecycle enumerator and crash suite in full.
  { name: 'proof', commands: [[process.execPath, 'scripts/proof.mjs', ...(process.env.DEEP_PREFLIGHT === 'release' ? ['--release'] : [])]], fix: 'Follow the Fix line under each proof lane finding above.' },
  // The verdict table in Lean (#684): the model's proofs and their axioms, then the engine against the model's
  // seeded claims and the rank-swap twins. Lean builds take a while, so the local preflight runs it only for a
  // change to what its script says it checks (#821); the release preflight always does.
  {
    name: 'verdict proofs', paths: verdictInputs,
    commands: [[process.execPath, 'scripts/verdict-proofs.mjs'], [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/684', 'lean.test.ts', '-t', 'AC3|AC4', '--silent=false']],
    fix: 'Repair the proof or build error each FAIL line names, keeping every theorem on Lean\'s standard axioms, or make the engine and packages/verdicts/model agree on the vector named; under BLOCKED, install the toolchain as its Fix line says.',
  },
  // Configuration evals (#112): a change to an instruction file, a skill or the agents' settings lands only with a
  // replay of it on real past tasks that didn't regress. The replay spends plan usage, so you start it; this gate only
  // reads the report it left.
  {
    name: 'config eval', paths: configInputs,
    commands: [[process.execPath, 'scripts/config-eval.mjs', 'gate']],
    fix: 'Under BLOCKED, run the two commands its Fix line names; under FAIL, the change broke the tasks named, so rework it and replay it again.',
  },
];

/**
 * Lanes only the release preflight runs, after the checks and apart from their time budget: #666's spine checkpoint,
 * #668's setup checkpoint and #18's live sessions start real Claude Code sessions on your plan, and take minutes.
 */
export const releaseLanes = [
  {
    name: 'spine checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/666', 'session.live.test.ts']],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as a Claude Code version the adapter facts cover.',
  },
  {
    // #668's: deep setup beside your own hook, a real session in deep status with its tool calls and commit, the
    // doctor, off and on, and deep setup --undo leaving your settings byte for byte.
    name: 'setup checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/668', 'session.live.test.ts']],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    name: 'claude code adapter live',
    commands: [
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/18/mapping', 'record.live.test.ts'],
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/18/install', 'tamper.live.test.ts'],
      // #25's routes back into a session: the Stop hold, the waiter's wake, the next prompt and a resume's start.
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/25/live', 'routes.live.test.ts'],
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/25/live-redraft', 'ac2.live.test.ts'],
      // #27's exit criterion: an answer wakes an idle session, and a repeat in a new session is decided for you.
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/27', 'session.live.test.ts'],
    ],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` for the settings-tamper sessions.',
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
/**
 * Whether a lane's paths cover a file: a predicate, such as the `inputs` its script exports, or a list in which a
 * folder ending in `/**` matches everything under it and anything else matches itself.
 */
const covers = (paths, file) => (typeof paths === 'function' ? paths(file)
  : paths.some((path) => (path.endsWith('/**') ? file.startsWith(path.slice(0, -2)) : file === path)));
/**
 * The changed files a lane's script says it reads (its `inputs` export) that the lane's paths miss (#821); null when
 * the script can't be loaded, so what it reads is unknown. A child loads it, so runLanes stays synchronous.
 */
function missed(lane, changed, cwd) {
  const script = lane.commands.flat().find((arg) => /^scripts\/[^/]+\.mjs$/.test(arg));
  if (!script) return { files: [] };
  const code = `import { readFileSync } from 'node:fs';
    const { inputs } = await import(${JSON.stringify(pathToFileURL(join(cwd, script)).href)});
    const files = JSON.parse(readFileSync(0, 'utf8'));
    console.log(JSON.stringify(typeof inputs === 'function' ? files.filter((file) => inputs(file)) : []));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, input: JSON.stringify(changed), encoding: 'utf8', maxBuffer: 2 ** 28 });
  try {
    if (result.status !== 0) return null;
    const reads = JSON.parse(result.stdout.trim().split('\n').at(-1));
    return { script, files: reads.filter((file) => !covers(lane.paths, file)) };
  } catch {
    return null;
  }
}

export function runLanes(lanes, { cwd = root } = {}) {
  const failures = [];
  // The release preflight runs every lane; the local one runs a lane with paths only for a change that touches them.
  const release = process.env.DEEP_PREFLIGHT === 'release';
  let changed;
  for (const lane of lanes) {
    if (lane.paths && !release) {
      changed ??= changedPaths(cwd);
      // A lane skips only when its script reads none of the change either.
      if (changed && !changed.some((file) => covers(lane.paths, file))) {
        const misses = missed(lane, changed, cwd);
        if (misses?.files.length) {
          failures.push(`FAIL ${lane.name}: its paths miss ${misses.files.join(', ')}, which ${misses.script} reads\n  Fix: Take the lane's paths from the inputs ${misses.script} exports.`);
          continue;
        }
        if (misses) {
          console.log(`SKIP ${lane.name}: the change touches no file it reads`);
          continue;
        }
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
