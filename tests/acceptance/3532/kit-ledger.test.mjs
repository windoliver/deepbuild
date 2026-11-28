// #3532: the lint lane's kit ledger check, `node scripts/kit-ledger.mjs [--root <tree>]`, holds the committed
// crates/deep-show/kit-ledger.json to every canvas module's digest a debug deep-show of that tree dumps. README.md
// beside this file says what was read, where the tree and the build live, and each reading where the issue leaves a
// choice. Run: node --test tests/acceptance/3532/kit-ledger.test.mjs
//
// All three tests run on aafef3131's tree (#3394's merge, whose ledger held scene3d at another digest), exported once
// and kept with its cargo target folder, so after the first run the build is fresh. Each test that plants a ledger
// puts the committed one back after it. The budget runs first, on the committed ledger, so the file rebuilds
// deep-show's crate only for each plant.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checks } from '../../../scripts/lanes.mjs';

const AC1 = '#3532.4bbb848d';
const AC2 = '#3532.ed1562fc';
const AC3 = '#3532.400b035d';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SCRIPT = 'scripts/kit-ledger.mjs';
/** Kept between runs: the exported tree and its cargo target folder. */
const WORK = join(realpathSync(tmpdir()), 'deep-3532');
const TARGET = join(WORK, 'target');
const HOUR = 3_600_000;

/** #3394's merge. */
const MERGE = 'aafef31316f7da8f741647a5934a717d9019ffff';
/** scene3d's digest in aafef3131's committed ledger. */
const LEDGER_SCENE3D = '683377360bf94ea1a0bf34a1047052495d2fd83f0f1a72eb00eb6fce21e8fab7';
/**
 * scene3d's digest at aafef3131, as that tree's own debug `deep-show kinds --dump` gives it, and the digest #3388's
 * merge (2062d474f) wrote into the ledger for it (README: Expected values).
 */
const TREE_SCENE3D = '919d7004d7721fa4bad7f9cc7ea22474d9f72e0d9cc3ad8b9f3de0b87647b793';
/** The issue's limit, in seconds. */
const LIMIT_S = 5;

/**
 * git's and cargo's environment: no GIT_* variable reaches git or a build, the target folder is the suite's, and
 * rustup's Homebrew folder leads PATH, since a non-interactive shell on the Macs here has no cargo on it otherwise.
 */
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  PATH: `/opt/homebrew/opt/rustup/bin:${process.env.PATH ?? ''}`,
  CARGO_TARGET_DIR: TARGET,
};

/** aafef3131's tree, exported with git archive once and kept; nothing of .git goes with it. */
function tree() {
  const dir = join(WORK, 'trees', MERGE.slice(0, 9));
  const done = `${dir}.exported`;
  if (existsSync(done)) return dir;
  if (spawnSync('git', ['cat-file', '-e', `${MERGE}^{commit}`], { cwd: CHECKOUT, env: ENV }).status !== 0)
    throw Error(`BLOCKED: this repository holds no commit ${MERGE}, so its tree can't be exported`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const exported = spawnSync('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'sh', MERGE, dir], { cwd: CHECKOUT, env: ENV, encoding: 'utf8' });
  if (exported.status !== 0) throw Error(`BLOCKED: git archive ${MERGE} | tar -x failed: ${exported.stderr}`);
  writeFileSync(done, `${MERGE}\n`);
  return dir;
}

/** The tree with its ledger edited by `edit` for this test; the committed ledger goes back byte for byte after it. */
function planted(t, edit) {
  const root = tree();
  const file = join(root, 'crates', 'deep-show', 'kit-ledger.json');
  const committed = readFileSync(file, 'utf8');
  t.after(() => writeFileSync(file, committed));
  const ledger = JSON.parse(committed);
  edit(ledger);
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
  return root;
}

/** The ledger written again for scene3d, as #3388 wrote it: its record at the tree's digest, nothing else moved. */
function rewritten(ledger) {
  assert.equal(ledger.scene3d?.digest, LEDGER_SCENE3D, "the fixture: aafef3131's ledger holds scene3d at its old digest");
  ledger.scene3d.digest = TREE_SCENE3D;
}

/**
 * One run of the check on `root` under scripts/lease, from this checkout, with `prefix` before the command (the
 * timer). A run the throttle gave no grant is INCONCLUSIVE: the check never started.
 */
function check(root, prefix = []) {
  const run = spawnSync('sh', [join(CHECKOUT, 'scripts', 'lease'), ...prefix, process.execPath, SCRIPT, '--root', root], {
    cwd: CHECKOUT, env: ENV, encoding: 'utf8', maxBuffer: 2 ** 28,
  });
  const lines = (run.stdout ?? '').split('\n');
  if (lines.some((line) => /^(?:INCONCLUSIVE no grant|BLOCKED throttle)\b/.test(line)))
    throw Error(`INCONCLUSIVE: the throttle gave the check no grant:\n${run.stdout}`);
  const states = lines.filter((line) => /^(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE) kit ledger:/.test(line));
  const findings = new Map(states.flatMap((line) => {
    const [, module] = /^FAIL kit ledger: ([^:\s]+):/.exec(line) ?? [];
    return module ? [[module, line]] : [];
  }));
  return { status: run.status, states, findings, stderr: run.stderr ?? '', shown: `exit ${run.status}\nstdout:\n${run.stdout}\nstderr:\n${(run.stderr ?? '').slice(-4000)}` };
}

/** A pass: exit 0, a `PASS kit ledger:` line, and no line in another state. */
function assertPasses(run, why) {
  assert.equal(run.status, 0, `${why}: the check exits 0\n${run.shown}`);
  assert.ok(run.states.some((line) => line.startsWith('PASS kit ledger:')), `${why}: a PASS kit ledger line\n${run.shown}`);
  assert.deepEqual(run.states.filter((line) => !line.startsWith('PASS ')), [], `${why}: no line in another state\n${run.shown}`);
}

/** A failure on exactly `modules`: exit 1, one `FAIL kit ledger: <module>:` line each, no PASS and no BLOCKED. */
function assertFailsOn(run, modules, why) {
  assert.equal(run.status, 1, `${why}: the check exits 1\n${run.shown}`);
  assert.deepEqual([...run.findings.keys()].sort(), [...modules].sort(), `${why}: one FAIL kit ledger line for each of ${modules.join(', ')} and none other\n${run.shown}`);
  assert.deepEqual(run.states.filter((line) => !line.startsWith('FAIL kit ledger: ')), [], `${why}: no PASS and no BLOCKED line beside the findings\n${run.shown}`);
}

/** What a finding's line says after `FAIL kit ledger: <module>:`. */
const after = (run, module) => run.findings.get(module).slice(`FAIL kit ledger: ${module}:`.length);

test(`${AC3} on a built tree, aafef3131, the lint lane's kit ledger command takes under 5 s, one reading recorded with the load`, { timeout: 4 * HOUR }, (t) => {
  const lint = checks.find(({ name }) => name === 'lint');
  const command = lint?.commands.find((c) => c[0] === process.execPath && c[1] === SCRIPT);
  assert.ok(command, `the lint lane in scripts/lanes.mjs runs [process.execPath, '${SCRIPT}']; its commands are:\n${(lint?.commands ?? []).map((c) => c.slice(1).join(' ')).join('\n')}`);
  assert.deepEqual(command.slice(2), [], `the lint lane runs the check on its own checkout, with no arguments: ${command.slice(1).join(' ')}`);

  const root = tree();
  // The warm-up: it builds the tree's deep-show if it isn't built, so the reading below is on a built tree.
  assertFailsOn(check(root), ['scene3d'], 'the warm-up run on aafef3131');
  const before = loadavg()[0];
  const timed = check(root, ['/usr/bin/time', '-p']);
  const load = Math.max(before, loadavg()[0]), cores = availableParallelism();
  assertFailsOn(timed, ['scene3d'], 'the timed run on aafef3131');
  const [, real] = /^real\s+([\d.]+)\s*$/m.exec(timed.stderr) ?? [];
  if (real === undefined) throw Error(`INCONCLUSIVE: /usr/bin/time -p gave no real time:\n${timed.shown}`);
  const seconds = Number(real);
  t.diagnostic(`the check took ${seconds} s against ${LIMIT_S} s on a built tree, at a 1-minute load of ${load.toFixed(1)} on ${cores} cores`);
  if (seconds >= LIMIT_S && load > cores)
    throw Error(`INCONCLUSIVE: the check took ${seconds} s against ${LIMIT_S} s at a 1-minute load of ${load.toFixed(1)} on ${cores} cores, a loaded reading that counts neither way`);
  assert.ok(seconds < LIMIT_S, `the check adds under ${LIMIT_S} s on a built tree: it took ${seconds} s at a 1-minute load of ${load.toFixed(1)} on ${cores} cores\n${timed.shown}`);
});

test(`${AC1} on aafef3131, whose ledger wasn't written again after scene3d's shapes changed, the check fails naming scene3d with the ledger's digest and the tree's; with the ledger written again for scene3d it passes`, { timeout: 4 * HOUR }, (t) => {
  const stale = check(tree());
  assertFailsOn(stale, ['scene3d'], 'aafef3131');
  const said = after(stale, 'scene3d');
  assert.ok(said.includes(LEDGER_SCENE3D), `aafef3131: the scene3d line names the ledger's digest ${LEDGER_SCENE3D}\n${stale.shown}`);
  assert.ok(said.includes(TREE_SCENE3D), `aafef3131: the scene3d line names the tree's digest ${TREE_SCENE3D}\n${stale.shown}`);

  // The control in place of "its parent passes" (README: Readings, 3): the same tree, its ledger written again.
  assertPasses(check(planted(t, rewritten)), "aafef3131 with its ledger's scene3d record at the tree's digest");
});

test(`${AC2} a ledger that holds marks2d and look at aafef3131's own digests with the verdicts FAIL and INCONCLUSIVE fails, naming each module and its verdict`, { timeout: 4 * HOUR }, (t) => {
  const verdicts = { marks2d: 'FAIL', look: 'INCONCLUSIVE' };
  const root = planted(t, (ledger) => {
    rewritten(ledger);
    for (const [module, verdict] of Object.entries(verdicts)) {
      assert.equal(ledger[module]?.verdict, 'PASS', `the fixture: aafef3131's ledger holds ${module} as PASS before the plant`);
      ledger[module].verdict = verdict;
    }
  });
  const run = check(root);
  assertFailsOn(run, Object.keys(verdicts), 'aafef3131 with the planted verdicts');
  for (const [module, verdict] of Object.entries(verdicts))
    assert.match(after(run, module), new RegExp(`\\b${verdict}\\b`), `the ${module} line names its verdict ${verdict}\n${run.shown}`);
});
