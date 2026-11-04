// AC2 (the one exception: deep-show and its dependents rebuild when the canvas kit lane rewrote kit-ledger.json with
// different bytes, and the record names it), with the scope it needs: the kept copy's tree is replaced by bytes,
// with no backdating, and nothing a previous run left survives.
import assert from 'node:assert/strict';
import test from 'node:test';
import { control, crate, LEDGER, machineRepo, passed, perf, sandbox, show, sideRecord, treeFiles } from './helpers.mjs';

test('#1119.d33bc868 after the canvas kit lane rewrote kit-ledger.json with other bytes, a second worktree\'s perf rebuilds deep-show and its dependent only, and says so', { timeout: 40 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const tree = treeFiles(repo.a);
  // The first run's checks build, then rewrite kit-ledger.json with other bytes (and leave an untracked file),
  // then build again, so the kept target holds deep-show built from the rewritten ledger.
  control(box, { label: 'first', ledger: 'different' });
  const first = await perf(box, repo.a);
  passed(first, 'the first worktree\'s');
  const one = sideRecord(box, 'first', 'base', first);
  assert.equal(one.builds.length, 2, 'the first run\'s workload did not build twice');
  assert.ok(one.builds[1].compiling.includes('deep-show'), `the fixture's rewritten ledger did not rebuild deep-show in the first run\n${one.builds[1].stderr}`);

  control(box, { label: 'second', ledger: null });
  const second = await perf(box, repo.b);
  passed(second, 'the second worktree\'s');
  t.diagnostic(`reading: perf wall time ${first.wallSeconds} s from worktree a, ${second.wallSeconds} s from worktree b`);
  const two = sideRecord(box, 'second', 'base', second);
  const built = two.builds[0];
  assert.equal(built.status, 0, `the base side's release build failed in the second run\n${built.stderr}`);
  assert.deepEqual(built.artifacts.map(crate).sort(), ['deep-show', 'plain', 'show-panel'], `cargo reported other artifacts than the fixture's three crates\n${built.stderr}`);
  assert.deepEqual(built.artifacts.filter((artifact) => !artifact.fresh).map(crate).sort(), ['deep-show', 'show-panel'], 'the second worktree\'s base side compiled other crates than deep-show and its dependent (cargo\'s own fresh flags)');
  assert.deepEqual([...built.compiling].sort(), ['deep-show', 'show-panel'], 'cargo\'s Compiling lines on the second worktree\'s base side name other crates than deep-show and its dependent');

  // The kept copy got the tree's bytes back, with a fresh mtime, and lost what the previous run left.
  assert.equal(two.ledger.sha256, tree[LEDGER], `${LEDGER} in the kept copy still holds the bytes the previous run's lane wrote`);
  assert.ok(two.ledger.mtimeMs >= second.startedAt - 50, `${LEDGER} was put back with an mtime from before this run (${new Date(two.ledger.mtimeMs).toISOString()}; the run started ${new Date(second.startedAt).toISOString()})`);
  assert.deepEqual(two.files, tree, 'the kept base copy does not hold exactly the tree\'s files and bytes (outside .git, target and node_modules)');

  assert.match(second.stdout, /^perf: base\b[^\n]*crates\/deep-show\/kit-ledger\.json/m, `perf printed no "perf: base …" line naming ${LEDGER}, the file whose other bytes rebuild deep-show\n${show(second)}`);
});
