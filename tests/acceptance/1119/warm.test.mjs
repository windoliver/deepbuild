// AC1 (a perf run from a second worktree compiles 0 crates on its base side), with the scope that criterion needs:
// the kept copies per machine, not per worktree path, and perf's lock machine-wide. AC3 (perf wall time) is a
// reading: each run's `PASS perf (<s> s)` is printed as a diagnostic, never judged.
import assert from 'node:assert/strict';
import test from 'node:test';
import { control, crate, keptPath, LEDGER, machineRepo, passed, perf, runs, sandbox, sideRecord } from './helpers.mjs';

test('#1119.a84127b8 a perf run from a second worktree of the same commit compiles 0 crates on its base side, in the kept copies per machine', { timeout: 40 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box, { ownTest: true });
  // The first run's checks rewrite kit-ledger.json with its own bytes, as the canvas kit lane does when the kit's
  // ledger is unchanged: not the exception AC2 names, so the second run still compiles nothing.
  control(box, { label: 'first', ledger: 'same' });
  const first = await perf(box, repo.a);
  passed(first, 'the first worktree\'s');
  const one = sideRecord(box, 'first', 'base', first);
  assert.equal(one.builds[0].status, 0, `the base side's release build failed in the first run\n${one.builds[0].stderr}`);

  control(box, { label: 'second', ledger: null });
  const second = await perf(box, repo.b);
  passed(second, 'the second worktree\'s');
  t.diagnostic(`reading: perf wall time ${first.wallSeconds} s from worktree a (first on the machine), ${second.wallSeconds} s from worktree b`);
  const two = sideRecord(box, 'second', 'base', second);
  const built = two.builds[0];
  assert.equal(built.status, 0, `the base side's release build failed in the second run\n${built.stderr}`);
  assert.ok(built.artifacts.length >= 3, `cargo reported ${built.artifacts.length} artifacts; the fixture has three crates\n${built.stderr}`);
  assert.deepEqual(built.artifacts.filter((artifact) => !artifact.fresh).map(crate), [], 'the second worktree\'s perf compiled crates on its base side (cargo\'s own fresh flags)');
  assert.deepEqual(built.compiling, [], 'cargo printed Compiling lines on the second worktree\'s base side');

  // The copies and their builds are the machine's, at one path whichever worktree perf runs from.
  const other = sideRecord(box, 'first', 'without-tests', first), again = sideRecord(box, 'second', 'without-tests', second);
  for (const record of [one, two, other, again]) {
    const side = keptPath(box, record.cwd)[1];
    const target = keptPath(box, record.target);
    assert.ok(target && target[1] === side, `the ${side} copy built into ${record.target}, not into <cache>/deepbuild-perf/<machine>/${side}/…`);
    assert.ok(!record.target.startsWith(`${record.cwd}/`), `the ${side} copy's builds lie inside the copy: ${record.target}`);
  }
  const machines = new Set([one, two, other, again].flatMap((record) => [keptPath(box, record.cwd)[0], keptPath(box, record.target)[0]]));
  assert.equal(machines.size, 1, `the kept copies lie under ${machines.size} folders of <cache>/deepbuild-perf (${[...machines].join(', ')}), not one for the machine: they are keyed by worktree`);
  assert.equal(two.cwd, one.cwd, 'the second worktree\'s base copy is not the first\'s');
  assert.equal(two.target, one.target, 'the second worktree\'s base side built into another directory');
  assert.equal(again.cwd, other.cwd, 'the second worktree\'s without-tests copy is not the first\'s');
  assert.equal(again.target, other.target, 'the second worktree\'s without-tests side built into another directory');
  assert.doesNotMatch(second.stdout, /^perf:.*kit-ledger\.json/m, 'perf named kit-ledger.json as rewritten, though its bytes never differed from the tree');
});

test('#1119.a84127b8 perf\'s lock is the machine\'s: a perf from a second worktree, started while the first holds the kept copies, is blocked and checks nothing', { timeout: 40 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  // The first run's checks start a perf from worktree b. It is a descendant of the first perf, so the throttle lets
  // its timed request through; DEEP_PERF_LOCK is dropped, so it has no claim on the first run's lock.
  control(box, { label: 'holder', ledger: null, nest: { cwd: repo.b, label: 'nested' } });
  const first = await perf(box, repo.a);
  passed(first, 'the holding');
  const held = sideRecord(box, 'holder', 'base', first);
  assert.ok(held.nested, 'the workload never started the nested perf');
  assert.deepEqual(runs(box).filter((record) => record.label === 'nested').map(({ cwd }) => cwd), [], `the nested perf from the second worktree ran its checks while the first perf held the kept copies\n${held.nested.stdout}`);
  assert.notEqual(held.nested.status, 0, `the nested perf from the second worktree exited 0 while the first perf held the kept copies\n${held.nested.stdout}${held.nested.stderr}`);
  assert.match(held.nested.stdout, /^BLOCKED perf: /m, `the nested perf printed no BLOCKED perf line\n${held.nested.stdout}${held.nested.stderr}`);
  assert.equal(held.nested.signal, null, 'the nested perf was stopped by the workload\'s timeout instead of ending');
});
