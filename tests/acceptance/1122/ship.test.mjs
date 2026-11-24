// #1122: the near end ships the session's exact tree to another machine, the far end checks what it was sent, and the
// record comes back (docs/parallel-proof.md, section 8). The real `node scripts/lane-remote.mjs --host <host> unit`
// runs in a session's worktree, a scratch repository carrying this checkout's scripts/. The other machine is the one
// boundary stood in for: `ssh` and `scp` on PATH run their command here under the far machine's HOME, in a fresh
// environment (README: The far machine). Everything else is real: git, the tree, the far end, the lane and its record.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, exactTree, farWorktree, gitIn, here, HOST, idOf, laneRemote, lanesFolder, lines, LONG, nodeFile, ran, record, recordLine, recordNames, sandbox, verdictLine, worktree } from './helpers.mjs';

const UNTRACKED = 'tests/untracked-9122.test.mjs';
// The tag of a made-up issue: the lanes read #1122's tags only from this suite's own test names.
const NAME = '#9122.51c750de an untracked tagged test';

/** The fetched record a `--host` run names, read from the session's machine: the run exited as its state says. */
function fetched(box, run, tree) {
  const path = recordLine(run);
  assert.ok(path, `the near end's output names the record it wrote, as RECORD <path>\n${dump(run)}`);
  assert.ok(existsSync(path), `the RECORD line names a file that exists: ${path}\n${dump(run)}`);
  const found = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(path, join(lanesFolder(box.home), `${tree}-unit-${found.host}.json`), `the fetched record is ~/.deepbuild/lanes/<tree>-<lane>-<host>.json on the session's machine, <host> the record's own\n${dump(run)}`);
  assert.equal(found.tree, tree, `the fetched record's tree is the tree on the session's disk\n${dump(run)}`);
  return found;
}

test(`#1122.51c750de an untracked tagged test in the session worktree runs on the far machine, and its row comes back in the fetched record`, LONG, async (t) => {
  const box = sandbox(t);
  const session = worktree(box, { files: { 'src/tracked.mjs': 'export const word = "committed";\n' } });
  // The session's worktree as an agent leaves it mid-work: an uncommitted edit, an untracked test and an ignored file.
  writeFileSync(join(session.cwd, 'src/tracked.mjs'), 'export const word = "uncommitted";\n');
  writeFileSync(join(session.cwd, UNTRACKED), nodeFile(`import { word } from '../src/tracked.mjs';\ntest('${NAME}', () => { ran1122('untracked'); assert.equal(word, 'uncommitted'); });`));
  writeFileSync(join(session.cwd, 'ignored-1122.txt'), 'never shipped\n');
  assert.equal(session.git('status', '--porcelain', '--', UNTRACKED), `?? ${UNTRACKED}`, 'the fixture test is untracked');
  const tree = exactTree(box, session.cwd);

  const run = await laneRemote(box, session.cwd, ['--host', HOST, 'unit']);
  assert.equal(run.status, 0, `node scripts/lane-remote.mjs --host ${HOST} unit exits 0 on a tree whose unit lane passes\n${dump(run)}`);
  const found = fetched(box, run, tree);
  assert.equal(verdictLine(run, 'unit', ` on ${found.host}`), 'PASS', `the near end prints "PASS unit on <host>", by the fetched record's state\n${dump(run)}`);
  assert.equal(found.state, 'PASS', `the fetched record's state\n${JSON.stringify(found, null, 1)}`);

  const row = found.tests?.find(({ id }) => id === idOf(UNTRACKED, NAME));
  assert.deepEqual(row && { state: row.state, skipped: Boolean(row.skipped) }, { state: 'PASS', skipped: false }, `the fetched record holds the untracked test's row, run and passed: ${JSON.stringify(found.tests)}`);
  const far = ran(box.far).filter(({ name }) => name === 'untracked');
  const worktrees = join(box.far, 'deepbuild', '.claude', 'worktrees');
  assert.ok(far.length > 0 && far.every(({ cwd }) => cwd.startsWith(`${worktrees}/`)), `the untracked test ran on the far machine, in the session's worktree under ~/deepbuild/.claude/worktrees/: ${JSON.stringify(far)}\n${dump(run)}`);
  assert.deepEqual(ran(box.home).filter(({ name }) => name === 'untracked'), [], 'the remote lane ran nothing on the session\'s own machine');
  assert.ok(!existsSync(join(farWorktree(box, run), 'ignored-1122.txt')), 'a file git ignores is not shipped');
});

test('#1122.394befd9 a shipped merge base that differs from the one the far end computes refuses the run, naming both', LONG, async (t) => {
  const box = sandbox(t);
  const session = worktree(box, { files: { 'tests/shipped-9122.test.mjs': nodeFile("test('a shipped test', () => { ran1122('shipped'); assert.equal(1, 1); });") } });
  const tree = exactTree(box, session.cwd);

  // A true shipment first: the far end computes the merge base it was sent, runs the lane, and the record names it.
  const sent = await laneRemote(box, session.cwd, ['--host', HOST, 'unit']);
  assert.equal(sent.status, 0, `a shipment whose merge base the far end computes too runs the lane\n${dump(sent)}`);
  const found = record(box.home, `${tree}-unit-${here}.json`);
  assert.ok(found, `the fetched record of the true shipment: ${JSON.stringify(recordNames(box.home))}\n${dump(sent)}`);
  assert.equal(found.recipe?.base, session.base, `the record's recipe names the merge base the tree was shipped with: ${JSON.stringify(found.recipe)}`);
  assert.equal(found.recipe?.commit, session.head, `the record's recipe names the shipped commit: ${JSON.stringify(found.recipe)}`);

  // The far end again, as the design starts it: in the session's worktree, the lane's name, the manifest on stdin.
  // This manifest is the true one but for its merge base: a commit beside the change, so the merge base of HEAD and it
  // is the true base, never the commit shipped.
  const far = farWorktree(box, sent);
  const farGit = gitIn(box, far, box.far);
  const beside = farGit('commit-tree', `${session.base}^{tree}`, '-p', session.base, '-m', 'A commit main never held');
  const manifest = { commit: session.head, base: beside, tree, bundle: found.recipe.bundle, untracked: found.recipe.untracked, from: found.recipe.from };
  const before = { ran: ran(box.far).length, records: recordNames(box.far).map((name) => [name, statSync(join(lanesFolder(box.far), name)).mtimeMs]) };

  const refused = await laneRemote(box, far, ['unit'], { env: box.farEnv, input: `${JSON.stringify(manifest)}\n` });
  const line = `BLOCKED lane-remote: the merge base shipped is ${beside}; ${here} computes ${session.base}`;
  assert.ok(lines(refused).includes(line), `the far end refuses, naming the shipped merge base and the one it computes: "${line}"\n${dump(refused)}`);
  assert.equal(refused.status, 3, `the refusal exits 3\n${dump(refused)}`);
  assert.equal(recordLine(refused), null, `a refused run names no record\n${dump(refused)}`);
  assert.equal(ran(box.far).length, before.ran, `a refused run runs nothing\n${dump(refused)}`);
  assert.deepEqual(recordNames(box.far).map((name) => [name, statSync(join(lanesFolder(box.far), name)).mtimeMs]), before.records, 'a refused run writes no record');
});
