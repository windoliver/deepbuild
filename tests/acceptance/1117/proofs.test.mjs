// AC6: tests/proof.test.mjs and the #569 scene proofs run on temporary copies and take no pair, inside and outside a
// held pair. "Take no pair" is read from the sandbox HOME: the throttle log holds no bay-pair grant or request of
// theirs, and no folder appears under <HOME>/deepbuild-bays. They are run the way they are run today (node --test
// from this checkout); bays.mjs itself, asked for a bay from a scene repository or from under a held pair, refuses.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, bayPairLog, bays, claimOf, finished, inBay, machineRepo, probe, sandbox, sceneRepo, show, step } from './helpers.mjs';

// tests/proof.test.mjs, and the #569 scene proofs that make temporary copies of the merge base and the change.
const PROOFS = ['tests/proof.test.mjs', 'tests/acceptance/569/before.test.mjs'];
const ran = (output) => Number(output.match(/^ℹ tests (\d+)$/m)?.[1] ?? 0);
const refusal = (stdout) => String(stdout).split('\n').find((line) => line.startsWith('NO BAY'));
const asked = (box) => bayPairLog(box).filter((line) => ['granted', 'timeout', 'passed'].includes(line.event));

test('#1117.ab479591 outside a held pair, tests/proof.test.mjs and the 569 scene proofs take no pair, and bays.mjs refuses a scene repository', { timeout: 900_000 }, async (t) => {
  const box = sandbox(t);
  machineRepo(box);
  const scene = sceneRepo(box);
  // Asked from a scene repository, as a test-started proof roots itself, with this checkout's scripts.
  const refused = bays(box, { script: join(CHECKOUT, 'scripts/bays.mjs'), cwd: scene, steps: [] });
  const result = await finished(refused, 120_000);
  assert.ok(refusal(result.stdout), `bays.mjs printed no "NO BAY" line for a scene repository\n${show(result)}`);
  assert.equal(result.status, 2, `bays.mjs exited ${result.status}, not 2, refusing a scene repository\n${show(result)}`);
  assert.equal(probe(refused), null, 'the command ran though bays.mjs refused');
  assert.equal(claimOf(result), undefined, 'bays.mjs printed a claim for a scene repository');

  const run = spawnSync(process.execPath, ['--test', ...PROOFS], { cwd: CHECKOUT, env: box.env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600_000 });
  const output = (run.stdout ?? '') + (run.stderr ?? '');
  assert.ok(ran(output) > 0, `the proofs ran no test\n${output.slice(-4000)}`);
  assert.deepEqual(asked(box), [], 'a proof outside any held pair asked for a bay pair');
  assert.ok(!existsSync(box.bays) || readdirSync(box.bays).length === 0, `${box.bays} holds ${existsSync(box.bays) ? readdirSync(box.bays) : ''}: a proof took a bay`);
});

test('#1117.ab479591 inside a held pair, tests/proof.test.mjs and the 569 scene proofs take no pair, and bays.mjs refuses under a pair\'s holder', { timeout: 900_000 }, async (t) => {
  const box = sandbox(t);
  const { worktree, bays: script } = machineRepo(box);
  const scene = sceneRepo(box);
  const inner = (name) => [process.execPath, box.probe, JSON.stringify({ name, out: join(box.dir, 'probes', `${name}.json`), refs: join(box.dir, 'refs'), steps: [] })];
  // The holder: a bay run whose command asks for bays again (from the worktree, which would get one at top level,
  // and from a scene repository) and runs the proofs, all as its descendants.
  const holder = bays(box, {
    script,
    cwd: worktree,
    steps: [
      { do: 'run', cwd: worktree, argv: [process.execPath, script, 'change', '--', ...inner('nested-worktree')], timeout: 120_000 },
      { do: 'run', cwd: scene, argv: [process.execPath, join(CHECKOUT, 'scripts/bays.mjs'), 'change', '--', ...inner('nested-scene')], timeout: 120_000 },
      { do: 'run', cwd: CHECKOUT, argv: [process.execPath, '--test', ...PROOFS], timeout: 600_000 },
    ],
  });
  const result = await finished(holder, 840_000);
  const { claim, probe: seen } = inBay(box, result, holder);
  for (const [index, where] of [[0, 'the worktree'], [1, 'a scene repository']]) {
    const nested = step(seen, 'run', index);
    assert.ok(refusal(nested.stdout), `under a held pair, bays.mjs asked from ${where} printed no "NO BAY" line\n${JSON.stringify(nested, null, 1)}`);
    assert.equal(nested.status, 2, `under a held pair, bays.mjs asked from ${where} exited ${nested.status}, not 2`);
    assert.ok(!existsSync(join(box.dir, 'probes', `${index ? 'nested-scene' : 'nested-worktree'}.json`)), `under a held pair, bays.mjs ran the command asked from ${where}`);
  }
  const proofs = step(seen, 'run', 2);
  assert.ok(ran(proofs.stdout + proofs.stderr) > 0, `the proofs ran no test under the held pair\n${(proofs.stdout + proofs.stderr).slice(-4000)}`);
  const grants = asked(box);
  assert.deepEqual(grants.map(({ event, index }) => `${event} ${index ?? ''}`.trim()), [`granted ${claim.index}`], 'something under the held pair asked for a bay pair of its own');
  assert.deepEqual(readdirSync(box.bays), [String(claim.index)], `${box.bays} holds more than the held pair's folder: a proof under it took a bay`);
});
