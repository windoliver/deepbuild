// #2700 criterion 4 (#2700.db66efb8): "`canvas-patch-settled` and `canvas-patch-dirty` in `benchmarks/budgets.json`
// retire no more instructions than on the merge base, and `tests/acceptance/896/` and `tests/acceptance/854/` pass
// unchanged"
//   DEEP_2700_BASE=<built merge base> node --test tests/acceptance/2700/budgets.long.test.mjs     # by hand: hours, macOS
// Budgets: each task's command, as each checkout's budgets.json names it, runs in that checkout the way the perf lane
// runs a budget (scripts/benchmark.mjs `measure` and `judgeInstructions`, the judge's own code, not the code under
// test): one warm-up round, then 20 rounds alternating which side goes first, instructions retired counted for the
// command and every child it waits for, the pairs judged by the design's two seeded sign-flip tests. Only PASS
// passes: a rise above 2% at p under 0.01 FAILs, and a missing counter, an uncounted child or pairs that can't tell
// are INCONCLUSIVE. Suites: every file of the folder is the merge base's, byte for byte, and the folder's own run
// (its README's command) exits 0 with no test failed and none skipped; a skipped test ran nothing, so it is
// INCONCLUSIVE here, never a pass.
// Both checkouts need `npm ci` and room for the release deep-show the two tasks build; the tasks draw through Metal.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { AC, CHANGE, machine } from './lib.mjs';

const BASE = process.env.DEEP_2700_BASE ? resolve(process.env.DEEP_2700_BASE) : null;

/** Why the change and the merge base can't be compared, or null. */
function sidesProblem() {
  if (!BASE) return 'BLOCKED: set DEEP_2700_BASE to a checkout of the merge base (git merge-base HEAD origin/main; 83b82f94a when this suite was written), with npm ci run in it';
  for (const checkout of [BASE, CHANGE]) {
    const missing = ['benchmarks/budgets.json', 'benchmarks/canvas.mjs', 'scripts/benchmark.mjs', 'node_modules/vitest/vitest.mjs'].filter((file) => !existsSync(join(checkout, file)));
    if (missing.length) return `BLOCKED: the checkout at ${checkout === BASE ? 'DEEP_2700_BASE' : 'the change'} lacks ${missing.join(', ')}; run npm ci there`;
  }
  return null;
}

async function task(id) {
  const blocked = sidesProblem();
  if (blocked) assert.fail(blocked);
  const named = (checkout) => JSON.parse(readFileSync(join(checkout, 'benchmarks/budgets.json'), 'utf8')).tasks.find((entry) => entry.id === id);
  const now = named(CHANGE), then = named(BASE);
  assert.ok(now, `benchmarks/budgets.json has no task ${id}`);
  if (!then) assert.fail(`BLOCKED: the merge base's benchmarks/budgets.json has no task ${id}`);
  assert.deepEqual(now.command, then.command, `${id}'s command is not the merge base's`);
  const { measure, judgeInstructions } = await import(pathToFileURL(join(CHANGE, 'scripts/benchmark.mjs')).href);
  let current, base;
  try {
    [current, base] = measure(now.command, CHANGE, { command: then.command, cwd: BASE });
  } catch (error) {
    assert.fail(`BLOCKED: ${id} could not be measured on both sides: ${String(error.message).slice(0, 1500)}`);
  }
  const verdict = judgeInstructions(current.instructions.map((count, round) => ({ current: count, base: base.instructions[round] })), [...new Set([...current.uncounted, ...base.uncounted])]);
  console.log(`${AC.budgets} ${id}: ${verdict.status}${verdict.reason ? `: ${verdict.reason}` : ''} (${machine()})`);
  assert.equal(verdict.status, 'PASS', `${verdict.status}: ${id}: ${verdict.reason ?? ''}\n${JSON.stringify({ change: verdict.change, seed: verdict.seed, pAbove: verdict.pAbove, pBelow: verdict.pBelow, pairs: verdict.pairs })}`);
}

/** Every file under `folder` of `checkout`, by its path below the folder, less what a run leaves behind. */
function filesOf(checkout, folder) {
  const root = join(checkout, folder);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [relative(root, path)];
  });
  return existsSync(root) ? walk(root).sort() : [];
}

function suite(folder) {
  const blocked = sidesProblem();
  if (blocked) assert.fail(blocked);
  // Unchanged: the folder's files are the merge base's, byte for byte, none added and none gone.
  const [now, then] = [filesOf(CHANGE, folder), filesOf(BASE, folder)];
  if (!then.length) assert.fail(`BLOCKED: the merge base has no ${folder}`);
  assert.deepEqual(now, then, `${folder} does not hold the merge base's files`);
  const edited = now.filter((file) => !readFileSync(join(CHANGE, folder, file)).equals(readFileSync(join(BASE, folder, file))));
  assert.deepEqual(edited, [], `${folder} is not unchanged: ${edited.join(', ')} differ from the merge base's`);
  // Passes: the folder's own run, one file at a time, as its README runs it.
  const dir = mkdtempSync(join(tmpdir(), 'acc2700-suite-'));
  const report = join(dir, 'report.json');
  try {
    const args = ['node_modules/vitest/vitest.mjs', 'run', '--root', folder, '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`];
    // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
    const r = spawnSync(process.execPath, args, { cwd: CHANGE, encoding: 'utf8', timeout: 6 * 3_600_000, maxBuffer: 1 << 28 });
    if (r.error) assert.fail(`BLOCKED: vitest did not run ${folder}: ${r.error.message}`);
    if (!existsSync(report)) assert.fail(`BLOCKED: vitest wrote no report for ${folder} (exit ${r.status}): ${String(r.stderr).slice(-1500)}`);
    const result = JSON.parse(readFileSync(report, 'utf8'));
    const failed = result.testResults.flatMap((file) => file.assertionResults.filter((t) => t.status === 'failed').map((t) => `${relative(CHANGE, file.name)}: ${t.fullName}`));
    const skipped = result.testResults.flatMap((file) => file.assertionResults.filter((t) => !['passed', 'failed'].includes(t.status)).map((t) => `${relative(CHANGE, file.name)}: ${t.fullName}`));
    console.log(`${AC.budgets} ${folder}: ${result.numPassedTests} passed, ${failed.length} failed, ${skipped.length} skipped of ${result.numTotalTests} (${machine()})`);
    assert.deepEqual(failed, [], `${folder} does not pass: ${failed.length} of its tests fail`);
    assert.equal(r.status, 0, `${folder}'s run exits ${r.status}: ${String(r.stderr).slice(-1500)}`);
    assert.deepEqual(skipped, [], `INCONCLUSIVE: ${skipped.length} of ${folder}'s tests skipped, so they ran nothing on this machine (the suite judges its timings on a reference Mac only)`);
    assert.ok(result.numPassedTests > 0, `INCONCLUSIVE: no test of ${folder} ran`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    // What the run leaves in the folder: Vitest's own cache (the suites' READMEs: "delete it").
    rmSync(join(CHANGE, folder, 'node_modules', '.vite'), { recursive: true, force: true });
  }
}

test(`${AC.budgets} canvas-patch-settled retires no more instructions than on the merge base`, { timeout: 6 * 3_600_000 }, () => task('canvas-patch-settled'));
test(`${AC.budgets} canvas-patch-dirty retires no more instructions than on the merge base`, { timeout: 6 * 3_600_000 }, () => task('canvas-patch-dirty'));
test(`${AC.budgets} tests/acceptance/896/ passes unchanged`, { timeout: 7 * 3_600_000 }, () => suite('tests/acceptance/896'));
test(`${AC.budgets} tests/acceptance/854/ passes unchanged`, { timeout: 7 * 3_600_000 }, () => suite('tests/acceptance/854'));
