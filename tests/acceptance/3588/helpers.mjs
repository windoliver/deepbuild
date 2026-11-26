// Helpers for #3588's acceptance tests (README). One scene a test: a fixture repository with a small Cargo workspace of
// one binary, built before the run, an untimed file that reads the binary through DEEP_BIN_DIR and then deletes it there
// (a cleanup), and a timed file that runs it through DEEP_BIN_DIR; `node scripts/affected.mjs --timed <both files>` run
// there with DEEP_AFFECTED_MIN at 3, on a throttle table of the test's own (DEEP_THROTTLE_TABLE, so the machine's
// ~/.deepbuild/throttle/ is never read or written); and other sessions' holders of every build slot of that table.
// Nothing here imports the code under test: affected.mjs is reached by running it, and read through its output, its
// exit status, the table it leaves and what the fixture files note. The blind suites' helpers are reused by import,
// never edited: #3567's sandbox, run, holders and table readers, #2820's workspace and fixture repository, #1115's
// timed path and #3296's machine preload.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { timedPath } from '../1115/helpers.mjs';
import { BUILD_SLOTS, fixture, prints, record, workspace } from '../2820/helpers.mjs';
import { dump as dump3567, hold, holding, noted, pause, passedCount, redact, sandbox as sandbox3567, start, stateLines, summary, throttleLog, throttleTable, until } from '../3567/helpers.mjs';

export { BUILD_SLOTS, passedCount, pause, record, stateLines, summary, throttleLog, throttleTable, until };

/** The bound the issue gives the run, DEEP_AFFECTED_MIN, in minutes. */
export const BOUND_MIN = 3;
/** "The run exits within 4 minutes of its start." */
export const EXIT_MS = 4 * 60_000;
/** How long past EXIT_MS a run is let go on, to say how late it is, before the test stops its process group. */
const GRACE_MS = 20_000;
/** A test: its scene (a lockfile and a cargo build on a loaded machine), its run to its limit, and its checks. */
export const SCENE = { timeout: EXIT_MS + GRACE_MS + 8 * 60_000 };
/** "The holders letting go 20 s after the run's timed phase began waiting." */
export const LET_GO_MS = 20_000;

/** The workspace's one binary, and what it prints. */
export const BINARY = 'tool3588';
export const PRINTS = 'tool3588 runs';
/** The untimed file, in the parallel block: tests/fixture-* is on no list of lanes.mjs. */
export const UNTIMED = 'tests/fixture-3588/cleanup.test.mjs';
/** A file of the real timed list, so the tree's lanes.mjs runs it in the timed phase. */
export const TIMED = timedPath('mjs');
/** The untimed file's test that fails on purpose (criterion 1). */
export const PLANTED = 'the cleanup fails one assertion on purpose';

// Where rustup's proxies live when cargo isn't on PATH, as #2820's sandbox looks.
const RUST_BINS = [join(homedir(), '.cargo', 'bin'), '/opt/homebrew/opt/rustup/bin'];

/**
 * #3567's sandbox (a HOME, a throttle table folder under DEEP_THROTTLE_TABLE and a TMPDIR of its own, every process
 * group a test started stopped after it by its PID, the sandbox removed), with cargo as #2820's sandbox gives it: no
 * target folder, wrapper or jobserver from this process (CARGO_BUILD_JOBS, a job count only, is kept), the real
 * toolchains and a CARGO_HOME of the sandbox's, so no user cargo config applies.
 */
export function sandbox(t) {
  const box = sandbox3567(t);
  for (const name of Object.keys(box.env)) if (/^(?:CARGO_|RUSTC|RUSTUP_TOOLCHAIN$|MAKEFLAGS$|MFLAGS$)/.test(name) && name !== 'CARGO_BUILD_JOBS') delete box.env[name];
  box.env.PATH = [box.env.PATH, ...RUST_BINS.filter((dir) => existsSync(join(dir, 'cargo')))].join(delimiter);
  box.env.RUSTUP_HOME = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');
  box.env.CARGO_HOME = join(box.dir, 'cargo');
  return box;
}

// What both fixture files start with: a note into #2820's record file.
const head = (file) => `import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
const note = (fields) => appendFileSync(process.env.T2820_RECORD, JSON.stringify({ file: ${JSON.stringify(file)}, pid: process.pid, at: Date.now(), ...fields }) + '\\n');
`;

/**
 * The untimed file. Its test waits until the test says every build slot is held (the file T3588_GO), reads the binary
 * through DEEP_BIN_DIR, deletes it there, as a machine's cleanup would, and with `fails` fails one assertion on purpose.
 */
const untimed = (fails) => `${head(UNTIMED)}
test(${JSON.stringify(fails ? PLANTED : 'the cleanup reads the binary, then removes it')}, async () => {
  const dir = process.env.DEEP_BIN_DIR ?? null;
  const path = dir ? join(dir, '${BINARY}') : null;
  // deadline: the go comes once the holders hold; 3 min bounds a machine that never starts them.
  for (let k = 0; k < 1800 && !existsSync(process.env.T3588_GO); k++) await new Promise((done) => setTimeout(done, 100));
  const there = Boolean(path && existsSync(path));
  const result = there ? spawnSync(path, [], { encoding: 'utf8' }) : null;
  note({ event: 'read', dir, there, stdout: result?.stdout?.trim() ?? null });
  if (path) rmSync(path, { force: true });
  note({ event: 'deleted', dir, gone: !(path && existsSync(path)) });
  assert.ok(there, 'no ${BINARY} in DEEP_BIN_DIR');
  assert.equal(result.stdout.trim(), ${JSON.stringify(PRINTS)});
  ${fails ? "assert.equal('kept', 'cleaned', 'a planted failure of the untimed file');" : ''}
});
`;

/** The timed file: it notes that it loaded, and its test notes that it ran, then runs the binary through DEEP_BIN_DIR. */
const timedFile = `${head(TIMED)}
note({ event: 'timed-loaded' });
test('the timed file runs the binary through DEEP_BIN_DIR', () => {
  const dir = process.env.DEEP_BIN_DIR ?? null;
  const path = dir ? join(dir, '${BINARY}') : null;
  const there = Boolean(path && existsSync(path));
  const result = there ? spawnSync(path, [], { encoding: 'utf8' }) : null;
  note({ event: 'timed-ran', dir, there, stdout: result?.stdout?.trim() ?? null });
  assert.ok(there, 'no ${BINARY} in DEEP_BIN_DIR when the timed file ran');
  assert.equal(result.stdout.trim(), ${JSON.stringify(PRINTS)});
});
`;

/**
 * The scene: #2820's fixture repository (this checkout's scripts/, the lint lane's own scripts stubbed) with a Cargo
 * workspace of one binary crate, the untimed file (failing on purpose with `fails`) and the timed file, the binary
 * built there before the run by `cargo build --locked`, so the run's own build is quick. The run's environment adds
 * DEEP_AFFECTED_MIN, the go file, and #3296's machine preload, under which the load reads 0: a top-level timed request
 * waits for a load below the cores, and the machines this runs on are busy.
 */
export function scene(box, { fails }) {
  const files = { ...workspace(box, { [BINARY]: prints(PRINTS) }), [UNTIMED]: untimed(fails), [TIMED]: timedFile };
  const go = join(box.dir, 'go');
  const fx = fixture(box, files, {
    DEEP_AFFECTED_MIN: String(BOUND_MIN), T3588_GO: go,
    NODE_OPTIONS: `--import=${new URL('../3296/machine.mjs', import.meta.url).href}`,
  });
  const built = spawnSync('cargo', ['build', '--locked', '--offline'], { cwd: fx.cwd, env: box.env, encoding: 'utf8' });
  assert.equal(built.status, 0, `the fixture's workspace doesn't build before the run: ${built.error?.message ?? built.stderr}`);
  return { ...fx, go };
}

/**
 * Starts the run, `node scripts/affected.mjs --timed <untimed> <timed>`, in its own process group, limited to
 * EXIT_MS and GRACE_MS more (#3567's `start`). Then, as the criteria order it: once the run has given back its own build
 * grant (the table's log: the first build grant released), every build slot of the table is taken by other sessions'
 * holders (#3567's `hold`, each `throttle.mjs build --wait 30 -- node hold.mjs`, held until the test lets go or ends);
 * once all hold, the untimed file is let go on (its go file); and from the moment it has deleted the binary, that
 * DEEP_BIN_DIR is watched for the binary to come back. `done` resolves with #3567's run result.
 */
export async function runScene(box, fx) {
  const run = start(box, fx, ['--timed', UNTIMED, TIMED], { limit: EXIT_MS + GRACE_MS });
  let exited = false;
  const done = run.done.then((result) => { exited = true; return result; });
  const scene = { run, done, holders: [], appeared: [], watching: null, gaveBack: false, held: false };
  const released = () => throttleLog(box).some((entry) => entry.event === 'released' && entry.class === 'build');
  // deadline: the run builds a binary that is already built, on a table of its own; the run's own limit bounds it.
  await until(() => released() || exited, EXIT_MS + GRACE_MS);
  scene.gaveBack = released();
  if (!scene.gaveBack) return scene;
  scene.holders = Array.from({ length: BUILD_SLOTS }, () => hold(box, fx, 'build'));
  // deadline: the holders' grants come at once on slots the run gave back; 60 s bounds a machine that can't start them.
  await until(() => holding(box) === BUILD_SLOTS || exited, 60_000);
  scene.held = holding(box) === BUILD_SLOTS;
  if (!scene.held) return scene;
  writeFileSync(fx.go, '');
  // deadline: the untimed file deletes the binary once it is let go on; the run's own limit bounds it.
  await until(() => record(fx).some((entry) => entry.event === 'deleted') || exited, EXIT_MS + GRACE_MS);
  const deleted = record(fx).find((entry) => entry.event === 'deleted');
  if (deleted?.dir && existsSync(deleted.dir)) {
    scene.watching = deleted.dir;
    const watcher = watch(deleted.dir, (_, name) => { if (name === BINARY) scene.appeared.push(Date.now()); });
    done.finally(() => watcher.close());
    if (existsSync(join(deleted.dir, BINARY))) scene.appeared.push(Date.now());
  }
  return scene;
}

/**
 * The run's own requests for a build or a timed grant waiting in the table: its timed phase waiting, for the build
 * grant of its rebuild or the timed grant of its timed job. The holders' requests and grants are theirs, by PID.
 */
export const waiting = (box, holders) => (throttleTable(box).requests ?? []).filter((request) => ['build', 'timed'].includes(request.class) && !holders.includes(request.pid));

/** The holders let go: SIGTERM to each holder's throttle, which passes it to its command and gives its grant back. */
export function letGo(holders) {
  for (const pid of holders) if (Number.isInteger(pid) && pid > 1) try { process.kill(pid, 'SIGTERM'); } catch {}
}

/** All a failure needs to be read: #3567's dump of the run, the holders, and the fixture files' notes. */
export const dump = (box, fx, scene, result) => `${dump3567(box, result)}\n${redact(box, [
  `holders (their throttles' PIDs): ${scene.holders.join(', ') || 'none started'}; holding: ${holding(box)}; noted: ${noted(box).length}`,
  `DEEP_BIN_DIR watched: ${scene.watching ?? 'never'}; ${BINARY} appeared there after the cleanup: ${scene.appeared.length} times`,
  `fixture files' notes:\n${record(fx).map((entry) => JSON.stringify(entry)).join('\n')}`,
].join('\n'))}`;
