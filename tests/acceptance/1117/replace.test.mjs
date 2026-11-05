// AC2 (a run after an aborted run rebuilds every file the abort left different) and AC3 (a planted mutant or a
// rewritten kit-ledger.json from a previous run never survives into the next). Files are compared by their bytes:
// each wrong file is made with the size and the mtime of the right one, so a comparison of blob IDs, of the previous
// recipe or of stat fields keeps it (the blob-id-compare twin), and cargo only rebuilds it when the bay writes it
// with a new mtime (never backdated).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bays, expectedGreeting, finished, holding, inBay, lib, machineRepo, mutant, sandbox, show, step, treeFiles, write } from './helpers.mjs';

const LIB = 'crates/word/src/lib.rs';
const LEDGER = 'crates/word/kit-ledger.json';
const GREETING = 'crates/greet/greeting.txt';
const PLANTED = ['crates/word/src/planted.rs', 'packages/p/dist/index.js', 'crates/word/planted.log'];

/** The bay as the next run's command first sees it: exactly the tree's files, with the tree's bytes. */
function assertTree(worktree, seen, result) {
  const snapshot = step(seen, 'snapshot');
  assert.ok(snapshot, `the command never ran in the bay\n${show(result, seen)}`);
  const expected = treeFiles(worktree);
  const wrong = Object.keys({ ...expected, ...snapshot.files }).filter((path) => expected[path] !== snapshot.files[path]).sort();
  assert.deepEqual(wrong.map((path) => `${path}: ${!(path in snapshot.files) ? 'missing' : !(path in expected) ? 'not in the tree' : 'bytes differ'}`), [], 'the bay does not hold exactly the tree\'s files and bytes (outside .git, target and node_modules)');
  return snapshot;
}

test('#1117.b2c7cfc4 a run after an aborted run rebuilds every file the abort left different, though each kept its size and mtime', { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  const { worktree, bays: script } = machineRepo(box);
  const first = bays(box, { script, cwd: worktree, steps: [{ do: 'build' }] });
  const one = inBay(box, await finished(first), first);
  assert.equal(step(one.probe, 'build').build.status, 0, 'the first build failed in the bay');

  // The next tree: an uncommitted edit and a changed untracked file.
  write(worktree, { [LIB]: lib('next-word'), [GREETING]: 'hello again, untracked\n' });
  const next = readFileSync(join(worktree, LIB), 'utf8');
  // The aborted run: it gets the next tree, then its command leaves wrong bytes behind with the right size and
  // mtime, deletes a tracked file, plants new ones, and is killed with its whole process group.
  const aborted = bays(box, {
    script,
    cwd: worktree,
    steps: [
      { do: 'stamp', paths: [LIB, GREETING] },
      { do: 'write', files: { [LIB]: mutant(next), [GREETING]: 'HELLO AGAIN, UNTRACKED\n', [LEDGER]: null, ...Object.fromEntries(PLANTED.map((path) => [path, 'planted by the aborted run\n'])) } },
      { do: 'restamp', paths: [LIB, GREETING] },
      { do: 'hold' },
    ],
  });
  const seen = await holding(aborted);
  box.pids = [seen.pid];
  process.kill(-aborted.pid, 'SIGKILL');
  try { process.kill(seen.pid, 'SIGKILL'); } catch {}
  await aborted.done;

  const launched = Date.now();
  const after = bays(box, { script, cwd: worktree, steps: [{ do: 'snapshot', paths: PLANTED, mtimes: [LIB, GREETING] }, { do: 'build' }] });
  const result = await finished(after);
  const three = inBay(box, result, after);
  const snapshot = assertTree(worktree, three.probe, result);
  for (const path of PLANTED) assert.equal(snapshot.exists[path], false, `${path}, planted by the aborted run, survived into the next`);
  for (const path of [LIB, GREETING]) assert.ok(snapshot.mtimeMs[path] >= launched - 1000, `${path} was rewritten with an mtime from before this run (${new Date(snapshot.mtimeMs[path]).toISOString()}), which cargo can read as unchanged`);
  const built = step(three.probe, 'build');
  assert.equal(built.build.status, 0, `the build failed after the aborted run\n${built.build.stderr}`);
  assert.equal(built.greet, expectedGreeting(worktree), 'the binary built after the aborted run does not print what the tree holds');
  assert.equal(built.test.status, 0, `cargo test failed after the aborted run\n${built.test.output}`);
});

test('#1117.af1d4c7e a planted mutant or a rewritten kit-ledger.json from a previous run never survives into the next, nor do its planted files', { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  const { worktree, bays: script } = machineRepo(box);
  const tree = readFileSync(join(worktree, LIB), 'utf8');
  // The previous run: it builds, then, as a mutation run and the canvas-kit lane do, rewrites a source with a
  // same-size mutant and kit-ledger.json with other bytes, builds them into the target, and puts each file's old
  // mtime back. It plants an untracked source, an ignored dist file and log, and a file in .git, then ends normally.
  const previous = bays(box, {
    script,
    cwd: worktree,
    steps: [
      { do: 'build' },
      { do: 'stamp', paths: [LIB, LEDGER] },
      { do: 'write', files: { [LIB]: mutant(tree), [LEDGER]: '{"kit":"rewritten by a lane"}\n', ...Object.fromEntries(PLANTED.map((path) => [path, 'planted by the previous run\n'])) } },
      { do: 'build' },
      { do: 'restamp', paths: [LIB, LEDGER] },
      { do: 'write', files: { '.git/planted': 'planted by the previous run\n' } },
    ],
  });
  const one = inBay(box, await finished(previous), previous);
  assert.match(step(one.probe, 'build', 1).greet ?? '', /^M+\|\{"kit":"rewritten by a lane"\}/, `the fixture's previous run did not build its mutant into the target\n${JSON.stringify(step(one.probe, 'build', 1))}`);

  const launched = Date.now();
  const next = bays(box, { script, cwd: worktree, steps: [{ do: 'snapshot', paths: [...PLANTED, '.git/planted'], mtimes: [LIB, LEDGER] }, { do: 'build' }] });
  const result = await finished(next);
  const two = inBay(box, result, next);
  const snapshot = assertTree(worktree, two.probe, result);
  for (const path of [...PLANTED, '.git/planted']) assert.equal(snapshot.exists[path], false, `${path}, planted by the previous run, survived into the next`);
  for (const path of [LIB, LEDGER]) assert.ok(snapshot.mtimeMs[path] >= launched - 1000, `${path} was put back with an mtime from before this run (${new Date(snapshot.mtimeMs[path]).toISOString()}), which cargo reads as unchanged`);
  const built = step(two.probe, 'build');
  assert.equal(built.build.status, 0, `the build failed\n${built.build.stderr}`);
  assert.equal(built.greet, expectedGreeting(worktree), 'the mutant or the rewritten kit-ledger.json survived into the next run\'s binary');
  assert.equal(built.test.status, 0, `cargo test failed in the next run\n${built.test.output}`);
});
