// #1122: a bug planted in a branch only the Mac runs makes the merged unit verdict FAIL. The two the issue names, on
// the real code: the darwin-only branch of packages/record/src/storage.ts, and deep-hook's macOS `args_of`
// (crates/deep-hook/src/main.rs). Each scene is a session's worktree carrying this checkout's scripts/ and the real
// component with its own real tests, and nothing else of the repository, so the lane is small enough to run:
//   1. the real unit lane runs whole on this Mac, on the tree as it is. If it FAILs there, before any plant, the scene
//      proves nothing and the test reads INCONCLUSIVE;
//   2. the Spark's record of that tree is planted as fetched, with the full run's own rows: the control. The real
//      `node scripts/lane-remote.mjs --only unit` then reads the full run's state, not FAIL;
//   3. the bug is planted, uncommitted, in the branch only macOS compiles or runs. The Spark's record of the new tree
//      is the same rows: a Linux run never reaches that branch;
//   4. `--only unit` again: the Mac's run of the tests reaching the platform-branching source fails, and the merged
//      verdict is FAIL.
// The Spark's record is the one thing not run for real (README: What stays unproven).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BUILD, CHECKOUT, dump, exactTree, fullRun, laneRemote, lanesFolder, LONG, mergeOf, noCargo, noRoom, notBuilt, notOnMac, onlyNames, plant, plantBug, record, sandbox, sparkRecord, verdictLine, worktree } from './helpers.mjs';

/** Steps 1 to 4 for one component. `fails` says whether a row is one of the component's own tests. */
async function plantedFails(t, box, session, { file, from, to, fails, ran }) {
  const sound = exactTree(box, session.cwd);
  const whole = await fullRun(box, session.cwd);
  const full = record(box.home, `${sound}-unit.json`);
  assert.ok(full, `the full Mac run of the unit lane wrote its record\n${dump(whole)}`);
  assert.ok(full.tests.some((row) => fails(row) && row.state === 'PASS'), `the full Mac run ran the component's own tests: ${JSON.stringify(full.tests.slice(0, 20))}\n${dump(whole)}`);
  // The component's own tests are real, and some read the clock: one that fails here before any plant, as under a
  // heavy load, leaves nothing the plant could be shown to change. That is unrun, never a pass and never the plant's.
  const failing = (rows) => rows.filter(({ state }) => state === 'FAIL').map(({ id }) => id);
  if (full.state === 'FAIL') return t.skip(`INCONCLUSIVE: before the plant the full Mac run of the unit lane already FAILs here (${failing(full.tests).join(', ') || 'no test named'}), so the scene can't show what the plant changes; run it again at a lower load`);
  renameSync(join(lanesFolder(box.home), `${sound}-unit.json`), join(box.dir, 'full-mac-run.json'));
  plant(box.home, sparkRecord(sound, 'unit', full.state, full.tests));

  const control = await laneRemote(box, session.cwd, ['--only', 'unit']);
  assert.ok(verdictLine(control, 'unit', ' (merged)'), `before the plant, node scripts/lane-remote.mjs --only unit ends with its merged line, "<STATE> unit (merged)"\n${dump(control)}`);
  const before = record(box.home, `${sound}-unit.json`);
  if (failing(before?.tests ?? []).length) return t.skip(`INCONCLUSIVE: before the plant the Mac's --only run already FAILs here (${failing(before.tests).join(', ')}), so the scene can't show what the plant changes; run it again at a lower load`);
  assert.equal(verdictLine(control, 'unit', ' (merged)'), full.state, `before the plant the merged verdict is the full Mac run's, ${full.state}\n${dump(control)}`);

  plantBug(session.cwd, file, from, to);
  const planted = exactTree(box, session.cwd);
  assert.notEqual(planted, sound, 'the plant changes the tree');
  plant(box.home, sparkRecord(planted, 'unit', full.state, full.tests));

  const run = await laneRemote(box, session.cwd, ['--only', 'unit']);
  const mac = record(box.home, `${planted}-unit.json`);
  assert.ok(mac, `the --only run wrote the Mac's record of the planted tree\n${dump(run)}`);
  assert.ok(onlyNames(mac.only).some(ran), `the --only run ran what reaches the platform-branching source: ${JSON.stringify(mac.only)}\n${dump(run)}`);
  const passed = new Set(full.tests.filter(({ state }) => state === 'PASS').map(({ id }) => id));
  assert.ok(mac.tests.some((row) => fails(row) && row.state === 'FAIL' && passed.has(row.id)), `a test of the component that passed before the plant fails on the Mac under it: ${JSON.stringify(mac.tests.filter(({ state }) => state !== 'PASS'))}\n${dump(run)}`);
  assert.equal(verdictLine(run, 'unit', ' (merged)'), 'FAIL', `the merged unit verdict is FAIL: "FAIL unit (merged)"\n${dump(run)}`);
  assert.equal(run.status, 1, `the run exits 1\n${dump(run)}`);
  assert.equal(mergeOf(box, planted).state, 'FAIL', 'mergeRecords(tree) reads FAIL');
}

test('#1122.b0863068 a planted bug in the darwin-only branch of packages/record/src/storage.ts makes the merged unit verdict FAIL',
  { ...LONG, skip: notOnMac() ?? notBuilt('packages/record/dist/versions.json', 'packages/contracts/dist', 'packages/evidence/dist') }, async (t) => {
    const box = sandbox(t);
    const session = worktree(box, { copy: ['packages/record', 'packages/contracts/fixtures'] });
    await plantedFails(t, box, session, {
      file: 'packages/record/src/storage.ts',
      // The record's settings on macOS: every sync is F_FULLFSYNC. The plant turns it off, on macOS only.
      from: "if (process.platform === 'darwin') db.pragma('fullfsync = ON');",
      to: "if (process.platform === 'darwin') db.pragma('fullfsync = OFF');",
      fails: ({ id }) => id.startsWith('packages/record/test/'),
      ran: (name) => name.startsWith('packages/record/test/'),
    });
  });

test('#1122.b0863068 a planted bug in deep-hook\'s macOS args_of makes the merged unit verdict FAIL',
  { ...BUILD, skip: notOnMac() ?? noCargo() ?? noRoom(5) }, async (t) => {
    const box = sandbox(t, { cargo: 'real' });
    // deep-hook's own tests time a hub's answers; one at a time, they read the same on a busy Mac.
    box.env.RUST_TEST_THREADS = '1';
    // The workspace, cut to deep-hook and the one crate it depends on, with the lock cargo keeps for those two.
    const session = worktree(box, {
      copy: ['crates/deep-hook', 'crates/deep-contracts', 'adapters/claude-code.facts.json', 'adapters/mcp-servers.facts.json', 'Cargo.lock', 'rust-toolchain.toml'],
      prepare(cwd) {
        const manifest = readFileSync(join(CHECKOUT, 'Cargo.toml'), 'utf8');
        assert.match(manifest, /^members = \[.*\]$/m, 'the workspace lists its members on one line');
        writeFileSync(join(cwd, 'Cargo.toml'), manifest.replace(/^members = \[.*\]$/m, 'members = ["crates/deep-contracts", "crates/deep-hook"]'));
        const pruned = spawnSync('cargo', ['metadata', '--offline', '--format-version', '1'], { cwd, env: box.env, encoding: 'utf8', maxBuffer: 1 << 28 });
        assert.equal(pruned.status, 0, `cargo metadata --offline, which cuts the lock to the two crates: ${pruned.stderr}`);
      },
    });
    await plantedFails(t, box, session, {
      file: 'crates/deep-hook/src/main.rs',
      // KERN_PROCARGS2 holds argc strings; the plant reads only the first, inside the macOS block.
      from: '.take(argc)',
      to: '.take(1)',
      fails: ({ id }) => id.includes('deep-hook'),
      ran: (name) => name.includes('deep-hook'),
    });
  });
