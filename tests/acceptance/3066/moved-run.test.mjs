// #3066 AC2, second sentence: a planted move of a folder that still reads `target/debug/<bin>` fails in that run,
// naming the folder. "That run" is read as an affected.mjs run whose parallel block holds the moved folder's file with
// at least 4 files beside it (README). The scene is a scratch repository with a one-crate Cargo workspace (deep-hook),
// this checkout's scripts/, and three planted suites that lanes.mjs runs alone on origin/main; the change moves two.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { LONG, adds, affected, cargoEnv, moves, plain, plant, readsBinDir, readsTarget, readsTargetIfBuilt, scene, workspace } from './helpers.mjs';

const STILL = 'tests/acceptance/9367/', READY = 'tests/acceptance/9368/', STAYS = 'tests/acceptance/9369/';
const FILES = { still: `${STILL}hook.test.mjs`, ready: `${READY}hook.test.mjs`, stays: `${STAYS}hook.test.mjs` };
const BESIDE = [1, 2, 3, 4].map((k) => `tests/fixture-3066/plain-${k}.test.mjs`);

const blockOf = (stdout, block) => stdout.split('\n').find((line) => line.startsWith(`${block} node: `))?.slice(`${block} node: `.length).replace(/ \(.*\)$/, '').split(' ') ?? [];
const failsNaming = (stdout, folder) => stdout.split('\n').filter((line) => /^(?:NEW FAIL|FAIL)\b/.test(line) && line.includes(folder));

test('#3066.5466dab5 a planted move of a folder that still reads target/debug/deep-hook fails in the affected.mjs run that holds it in the parallel block with 4 files beside it, naming the folder', LONG, async (t) => {
  // The binary prints a word only this scene's source holds.
  const word = `deep-hook ${randomBytes(6).toString('hex')}`;
  const box = scene(t);
  const env = cargoEnv(box);
  plant(box, 'the planted suites and their workspace, each folder alone for its binary', [adds(STILL, 'binary'), adds(READY, 'binary'), adds(STAYS, 'binary')], {
    ...workspace(box.dir, env, word),
    'scripts/known-failures.json': `${JSON.stringify({ failures: {}, lint: {}, timing: [] }, null, 2)}\n`,
    [FILES.still]: readsTarget(FILES.still, word),
    [FILES.ready]: readsBinDir(FILES.ready, word),
    [FILES.stays]: readsTargetIfBuilt(FILES.stays, word),
    ...Object.fromEntries(BESIDE.map((file) => [file, plain(file)])),
  });
  box.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  // A sibling's cargo build has left target/debug/deep-hook in the worktree, as it does in a real one.
  const built = spawnSync('cargo', ['build', '--locked', '--offline'], { cwd: box.cwd, env, encoding: 'utf8' });
  assert.equal(built.status, 0, `the scene's workspace does not build: ${built.error?.message ?? built.stderr}`);
  // The change: two folders leave alone. One reads DEEP_BIN_DIR; the other still reads target/debug/deep-hook.
  plant(box, 'move two binary folders out of alone', [moves(STILL), moves(READY)]);

  const run = await affected(box, [...Object.values(FILES), ...BESIDE]);
  const parallel = blockOf(run.stdout, 'parallel');
  assert.ok(parallel.includes(FILES.still) && parallel.filter((file) => file !== FILES.still).length >= 4, `the run's parallel block does not hold ${FILES.still} with at least 4 files beside it\n${run.all}`);
  assert.deepEqual(blockOf(run.stdout, 'alone'), [FILES.stays], `the run's alone block is not the one folder that stays alone\n${run.all}`);

  assert.notDeepEqual(failsNaming(run.stdout, STILL), [], `no FAIL line of the run names ${STILL}, moved to the parallel block while its file still reads target/debug/deep-hook\n${run.all}`);
  assert.notEqual(run.status, 0, `the run exited 0\n${run.all}`);
  // The folder that reads DEEP_BIN_DIR moved rightly, and the one that stays alone may read target/debug: neither fails.
  assert.deepEqual(failsNaming(run.stdout, READY), [], `the run fails ${READY}, moved to the parallel block with its file reading DEEP_BIN_DIR\n${run.all}`);
  assert.deepEqual(failsNaming(run.stdout, STAYS), [], `the run fails ${STAYS}, which stays alone\n${run.all}`);
  // Where the run went on to its tests, the folder that reads DEEP_BIN_DIR ran the run's own build.
  const ready = run.notes.find((note) => note.file === FILES.ready);
  if (ready) assert.equal(ready.stdout, word, `the moved folder that reads DEEP_BIN_DIR did not run the run's own deep-hook\n${run.all}`);
});
