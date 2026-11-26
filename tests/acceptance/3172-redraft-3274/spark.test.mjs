// AC1 (#3172.5a315338), the Spark's run: a cargo target that exits non-zero having printed `<its name>: INCONCLUSIVE;
// <reason>` and reported no test is read INCONCLUSIVE by the unit lane with that reason, never FAIL and never PASS; one
// that printed `<its name>: BLOCKED; <reason>` is read BLOCKED. The run is the Spark's saved cargo test at 0c73a8a4
// (docs/evidence/1121/spark-test-0c73a8a4.txt); the reader is the checkout's own cargoResults and crates; the workspace
// it reads the run against is the one the run was made in, 0c73a8a4's, not today's (README: The dispute).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, MINUTES, ofTarget, read, sandbox, SPARK_TARGETS, sparkRun } from '../3172/helpers.mjs';

/** The commit the saved run was made at: #1121's branch, with main c4337ea59 merged in. It is in main's history. */
const RUN_AT = '0c73a8a484332294d80b1f020bef3ac7af1cb5d0';

/**
 * The workspace as it was at RUN_AT, as far as `cargo metadata --no-deps` reads one: every Cargo.toml (the workspace's
 * and its members') with Cargo.lock, and every .rs file, which cargo needs to find a crate's own lib, bins and tests.
 * Read from this checkout's git objects by `git archive`, so offline and with no worktree of the repository made.
 */
function workspaceAt(box, commit) {
  const root = join(box.dir, `workspace-${commit.slice(0, 8)}`), tar = join(box.dir, 'workspace.tar');
  mkdirSync(root);
  const git = spawnSync('git', ['archive', '--format=tar', '-o', tar, commit, '--', ':(glob)**/Cargo.toml', ':(glob)**/*.rs', 'Cargo.lock'], { cwd: CHECKOUT, env: box.env, encoding: 'utf8' });
  assert.equal(git.status, 0, `this checkout's git holds ${commit}, the commit the Spark's run was made at: ${git.error?.message ?? git.stderr}`);
  const tarred = spawnSync('tar', ['-x', '-f', tar, '-C', root], { env: box.env, encoding: 'utf8' });
  assert.equal(tarred.status, 0, `the workspace at ${commit} unpacks: ${tarred.error?.message ?? tarred.stderr}`);
  return root;
}

// 18 targets say INCONCLUSIVE and acceptance_992_app BLOCKED, each in the one line it prints before it exits 1.
test('#3172.5a315338 the Spark\'s cargo test at 0c73a8a4, read against that commit\'s workspace: each of the issue\'s 19 targets is read as its line says, an INCONCLUSIVE one with its reason, never FAIL or PASS', MINUTES, async (t) => {
  const box = sandbox(t);
  const { output, status } = sparkRun();
  const { failures, passed } = await read(box, workspaceAt(box, RUN_AT), output, status);
  const wrong = [];
  for (const [rerun, state, reason] of SPARK_TARGETS) {
    const id = `cargo ${rerun}`;
    const own = ofTarget(failures, id);
    if (own.length !== 1 || own[0].id !== id || own[0].state !== state) wrong.push(`${id} reads ${own.map((failure) => `${failure.state} ${failure.id}: ${failure.message}`).join('; ') || 'nothing'}, not ${state}`);
    // The criterion asks the reason of an INCONCLUSIVE reading; of a BLOCKED one, only its state.
    else if (state === 'INCONCLUSIVE' && !own[0].message.includes(reason)) wrong.push(`${id} reads ${state} without its reason "${reason}": "${own[0].message}"`);
    if (passed.some((name) => name === id || name.startsWith(`${id} › `))) wrong.push(`${id} has a pass`);
  }
  assert.deepEqual(wrong, [], `of the 19 targets, ${wrong.length} are read otherwise than their lines say`);
});
