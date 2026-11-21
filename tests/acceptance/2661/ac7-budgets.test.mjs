// AC7: `app-select-700` and `replica-memory` in benchmarks/budgets.json retire no more instructions and peak no higher
// than on the merge base.
//
// By hand or in a budget window only (it runs each task 42 times a side), never in CI:
//   DEEP_TIMED_2661=1 node --test tests/acceptance/2661/ac7-budgets.test.mjs      (cargo on PATH; macOS)
//
// Each task is judged as perf and the budget window judge it, by scripts/benchmark.mjs's own `judgeTask`: one warm-up
// round and 20 rounds a side, the sides alternating and swapping which runs first, each run under `/usr/bin/time -l`
// with every child's instructions retired counted (scripts/count-children.c). The change is this checkout; the merge
// base is `git merge-base HEAD origin/main`, archived (no .git) into a folder of its own with its own deep-drive build.
// Where the merge base is this commit, as on the merge base itself, both sides run this checkout.
//
// - Instructions: the rounds' pairs judged by `judgeInstructions` (a rise over 2% is FAIL at p under 0.01, a rise
//   ruled out at p under 0.01 is PASS, anything else INCONCLUSIVE). The criterion holds only on PASS.
// - Peak: the change's peak resident bytes over its 20 rounds no higher than the merge base's, within 5%, the smallest
//   margin the design gives a reading (Numbers version 0 has to hold: Every task carries its own budgets).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeTask } from '../../../scripts/benchmark.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OPTED = process.env.DEEP_TIMED_2661 === '1';
const TASKS = ['app-select-700', 'replica-memory'];
const PEAK_MARGIN = 0.05;
const MANIFEST = 'benchmarks/budgets.json';

// Git here reads this checkout only, with no inherited repository variables.
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/.test(key)));
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', env: gitEnv, maxBuffer: 1 << 28 }).trim();

function buildDrive(cwd, targetDir) {
  const env = { ...gitEnv, ...(targetDir ? { CARGO_TARGET_DIR: targetDir } : {}) };
  if (!targetDir) delete env.CARGO_TARGET_DIR;
  const r = spawnSync('cargo', ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive'], { cwd, env, encoding: 'utf8', timeout: 14_400_000, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) assert.fail(`BLOCKED: deep-drive can't be built in ${cwd}: ${(r.stderr ?? '').split('\n').filter((l) => /^error/.test(l)).slice(0, 6).join('\n')}`);
}

/** The merge base's tree, in a kept folder with its own deep-drive; this checkout when the merge base is HEAD. */
function baseTree(base) {
  if (git('rev-parse', 'HEAD') === base) return { cwd: REPO, same: true };
  const kept = join(homedir(), 'Library', 'Caches', 'deepbuild-2661', base.slice(0, 12));
  const copy = join(kept, 'copy'), target = join(kept, 'target');
  if (!existsSync(join(copy, MANIFEST))) {
    rmSync(copy, { recursive: true, force: true });
    mkdirSync(copy, { recursive: true });
    mkdirSync(target, { recursive: true });
    execFileSync('bash', ['-c', 'set -o pipefail; git archive "$1" | tar -xf - -C "$2"', 'bash', base, copy], { cwd: REPO, env: gitEnv });
    symlinkSync(target, join(copy, 'target'), 'dir');
  }
  buildDrive(copy, target);
  return { cwd: copy, same: false };
}

test('#2661 AC7 app-select-700 and replica-memory retire no more instructions and peak no higher than on the merge base', { skip: !OPTED && 'by hand or in a budget window: DEEP_TIMED_2661=1', timeout: 86_400_000 }, () => {
  if (process.platform !== 'darwin') assert.fail('INCONCLUSIVE: instructions retired are read from macOS\'s /usr/bin/time -l');
  delete process.env.CARGO_TARGET_DIR; // each side's benchmark finds its own deep-drive under its own tree
  let base;
  try {
    base = git('merge-base', 'HEAD', 'origin/main');
  } catch {
    assert.fail('BLOCKED: no merge base with origin/main; fetch main');
  }
  const current = JSON.parse(readFileSync(join(REPO, MANIFEST), 'utf8'));
  const established = JSON.parse(git('show', `${base}:${MANIFEST}`));
  buildDrive(REPO, null);
  const there = baseTree(base);

  const failures = [];
  for (const id of TASKS) {
    const budget = current.tasks.find((task) => task.id === id);
    const then = established.tasks.find((task) => task.id === id);
    if (!budget || !then) { failures.push(['FAIL', `${id} is missing from ${MANIFEST} ${budget ? 'at the merge base' : 'now'}`]); continue; }
    const judged = judgeTask(budget, then, REPO, there.cwd);
    const { now, then: was, instructions } = judged;
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const reading = `${id} against ${base.slice(0, 12)}${there.same ? ' (this commit: both sides ran this checkout)' : ''}: instructions retired, median ${median(now.instructions)} now, ${median(was.instructions)} then (${instructions.status}${instructions.change != null ? `, ${(instructions.change * 100).toFixed(2)}%` : ''}); peak ${now.peakBytes} bytes now, ${was.peakBytes} then`;
    console.log(reading);
    if (instructions.status !== 'PASS') failures.push([instructions.status, `${reading}: instructions ${instructions.status}${instructions.reason ? `: ${instructions.reason}` : ''}`]);
    if (now.peakBytes > was.peakBytes * (1 + PEAK_MARGIN)) failures.push(['FAIL', `${reading}: the peak is higher than the merge base's by more than ${PEAK_MARGIN * 100}%`]);
  }
  // A side that can't be told from the other is INCONCLUSIVE, never a pass.
  const verdict = failures.some(([status]) => status === 'FAIL') ? 'FAIL' : 'INCONCLUSIVE';
  assert.deepEqual(failures.map(([, said]) => said), [], `${verdict}: ${failures.map(([, said]) => said).join('; ')}`);
});
