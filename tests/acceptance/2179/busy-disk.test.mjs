// Acceptance tests for #2179: busy_disk reads INCONCLUSIVE when the disk isn't busy, never as a failed test.
//
// Each test runs the real `crates/deep-hook/tests/busy_disk.rs` as cargo builds and runs it, in a target folder of its own, and
// reads cargo's output as `node scripts/affected.mjs` reads its cargo job: cargoResults over the job's log, readSkips
// against known-failures.json's `skips`, then classify into KNOWN, INCONCLUSIVE/BLOCKED and NEW FAIL lines (README:
// The surface). Two stand-ins make each condition on purpose (README: How each condition is made):
//   - `dd`, first on the test's PATH: it writes nothing, so no run writes 60 files of 512 MB and the disk's own load
//     plays no part.
//   - the deep-hook binary the test spawns (its CARGO_BIN_EXE path in this suite's own target folder): a script that
//     says what a hook on the condition's disk says. A quiet disk: no call says its spooled line's sync outlasted the
//     deadline. A busy disk with a slow hook: every call says so, and takes 200 ms.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { test, before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
// Its own target folder, so the stand-in hook never replaces the deep-hook any other build or session runs.
const TARGET = join(CHECKOUT, 'target', 'acceptance-2179');
const HOOK = join(TARGET, 'debug', 'deep-hook');
const TEST = 'a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms';
// deep-hook's own words for a spooled line whose sync outlasted its deadline (crates/deep-hook/src/main.rs).
const LATE = "deep-hook: spooled s-2179, but its sync didn't finish within the hook's 50 ms";
const LONG = { timeout: 40 * 60_000 };

const { cargoResults, classify, crates } = await import(pathToFileURL(join(CHECKOUT, 'scripts/affected.mjs')).href);
const { readSkips, timed } = await import(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href);

const cargo = (args, env = {}, log) => {
  const descriptor = log ? openSync(log, 'w') : 'pipe';
  try {
    // One descriptor for stdout and stderr keeps cargo's Running line before the test's lines, as affected.mjs's log does.
    return spawnSync('cargo', args, { cwd: CHECKOUT, env: { ...process.env, ...env }, stdio: ['ignore', descriptor, descriptor], encoding: 'utf8', timeout: LONG.timeout });
  } finally {
    if (log) closeSync(descriptor);
  }
};

// The test binary cargo built, by the path its Running line names. Each test runs it as cargo test would, but directly:
// `cargo test` links a fresh deep-hook over the stand-in before it starts the test (seen at the base), so cargo builds
// here only.
let executable;
before(() => {
  const built = cargo(['test', '--locked', '-p', 'deep-hook', '--test', 'busy_disk', '--no-run', '--message-format=json', '--target-dir', TARGET]);
  executable = (built.stdout ?? '').split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
    .find((message) => message.reason === 'compiler-artifact' && message.target?.name === 'busy_disk' && message.executable)?.executable;
  if (built.status !== 0 || !executable) throw new Error(`BLOCKED: cargo couldn't build busy_disk: ${(built.stdout ?? '').split('\n').filter(Boolean).slice(-5).join(' | ')}`);
}, LONG);

/**
 * Runs busy_disk's test with the stand-ins: `hook` is the shell body of the deep-hook it spawns. Returns cargo's output
 * and status, how often each stand-in ran, and the lines affected.mjs prints for that output.
 */
function runBusyDisk(t, hook) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2179-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const ddLog = join(dir, 'dd.log'), hookLog = join(dir, 'hook.log'), log = join(dir, 'cargo.log');
  writeFileSync(join(bin, 'dd'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ddLog}'\nexit 0\n`);
  chmodSync(join(bin, 'dd'), 0o755);
  // A new file, never written through the old one: cargo's deps/ copy of the real hook stays as it was.
  rmSync(HOOK, { force: true });
  writeFileSync(HOOK, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${hookLog}'\ncat > /dev/null\n${hook}\n`);
  chmodSync(HOOK, 0o755);
  // cargo test's own shape: its Running line, then the test binary's output, run from the crate's folder, stdout and
  // stderr on one descriptor as affected.mjs's cargo job log has them.
  writeFileSync(log, `     Running tests/busy_disk.rs (${relative(CHECKOUT, executable)})\n`);
  const descriptor = openSync(log, 'a');
  let result;
  try {
    result = spawnSync(executable, [TEST], { cwd: join(CHECKOUT, 'crates/deep-hook'), env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` }, stdio: ['ignore', descriptor, descriptor], timeout: LONG.timeout });
  } finally {
    closeSync(descriptor);
  }
  const output = readFileSync(log, 'utf8');
  const count = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0);
  const calls = { dd: count(ddLog), hook: count(hookLog) };
  t.diagnostic(`busy_disk exited ${result.status}; dd ran ${calls.dd} times, the hook ${calls.hook}`);
  for (const line of output.split('\n').filter((line) => /^test |panicked|proves nothing|took|test result/.test(line))) t.diagnostic(line);
  if (!readFileSync(HOOK, 'utf8').includes(hookLog)) throw new Error('BLOCKED: the stand-in hook was replaced before the test ran it');
  if (calls.hook === 0) throw new Error(`BLOCKED: busy_disk's test never ran the stand-in hook (it exited ${result.status}): ${output.split('\n').filter(Boolean).slice(-5).join(' | ')}`);
  // affected.mjs's reading of its cargo job (scripts/affected.mjs, main): at load 0, so no timing budget reads unmeasured.
  const baseline = JSON.parse(readFileSync(join(CHECKOUT, 'scripts/known-failures.json'), 'utf8'));
  const results = cargoResults(output, result.status, crates(CHECKOUT));
  const { covered, open } = readSkips(results.skips ?? [], baseline.skips, timed);
  const { known, fresh, unsure } = classify([...results.failures, ...open], [], baseline, 0);
  const lines = [
    ...known.map(({ id, message }) => `KNOWN ${id}: ${message}`),
    ...unsure.map(({ id, state, message }) => `${state} ${id}${message ? `: ${message}` : ''}`),
    ...covered.map(({ id, note }) => `LISTED ${id}: ${note}`),
    ...fresh.map(({ id, message }) => `NEW FAIL ${id}${message ? `: ${message}` : ''}`),
    ...results.passed.map((id) => `PASS ${id}`),
  ];
  for (const line of lines) t.diagnostic(`affected.mjs: ${line}`);
  return { output, status: result.status, calls, lines, known, fresh, unsure, covered, passed: results.passed };
}

const ours = (id) => id.includes('busy_disk');

test('AC1 #2179.c2c274c4 A quiet disk reads INCONCLUSIVE: no spooled line\'s sync outlasts the deadline, and affected.mjs reports the test INCONCLUSIVE with its reason, never FAIL', LONG, (t) => {
  // No call says its line's sync outlasted the deadline: the hook a quiet disk gives.
  const run = runBusyDisk(t, 'exit 0');
  assert.ok(!run.fresh.some(({ id }) => ours(id)), `affected.mjs counted the quiet run as the hook failing: ${run.lines.join(' | ')}`);
  assert.ok(!run.known.some(({ id }) => ours(id)), `affected.mjs read the quiet run as a failure main already has: ${run.lines.join(' | ')}`);
  assert.ok(!run.passed.some(ours), `a run in which no sync outlasted the deadline passed, but it proves nothing: ${run.lines.join(' | ')}`);
  const reading = run.unsure.find(({ id }) => ours(id));
  assert.ok(reading, `affected.mjs printed no INCONCLUSIVE line for busy_disk: ${run.lines.join(' | ')}`);
  assert.equal(reading.state, 'INCONCLUSIVE', `busy_disk's quiet run read ${reading.state}, not INCONCLUSIVE`);
  assert.match(reading.message ?? '', /busy|outlast|proves nothing/i, `busy_disk's INCONCLUSIVE line names no reason: ${reading.id}: ${reading.message}`);
});

test('AC2 #2179.bbec3c91 A hook that takes more than 50 ms with its line still syncing still fails the test, and affected.mjs reports it a new FAIL, not INCONCLUSIVE', LONG, (t) => {
  // Every call says its line's sync outlasted the deadline, and takes 200 ms.
  const run = runBusyDisk(t, `sleep 0.2\nprintf '%s\\n' "${LATE}" >&2\nexit 0`);
  assert.ok(run.calls.hook >= 5, `the stand-in hook ran ${run.calls.hook} times, under the five late calls the test needs`);
  assert.ok(!run.passed.some(ours), `busy_disk passed with every late call taking over 200 ms: ${run.lines.join(' | ')}`);
  assert.ok(!run.unsure.some(({ id }) => ours(id)), `a slow hook read as unproven, not as failing its 50 ms: ${run.lines.join(' | ')}`);
  assert.ok(run.fresh.some(({ id, state }) => ours(id) && state === 'FAIL'), `affected.mjs printed no NEW FAIL line for busy_disk: ${run.lines.join(' | ')}`);
});
